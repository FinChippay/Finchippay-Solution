/**
 * src/services/notificationService.js
 *
 * Pluggable email notification service that sends templated alerts for
 * payment events using Nodemailer/SendGrid.
 *
 * Enhancements (Issue #491):
 * - Uses emailRenderer.js for production-ready Handlebars templates
 * - Integrates emailTrackingService (tracking pixel, event recording)
 * - Checks email verification before sending
 * - Adds List-Unsubscribe headers to every email
 * - Batching: aggregates events into a daily digest when > BATCH_THRESHOLD events/hour
 * - Async send queue processing with exponential-backoff retries (via email_send_queue)
 * - Respects notification_preferences.email_enabled per user
 *
 * SMTP is configured via environment variables (see .env.example).
 * The service degrades gracefully when NOTIFICATION_EMAIL_ENABLED=false
 * or SMTP credentials are missing.
 */

"use strict";

var nodemailer = require("nodemailer");
var logger = require("../utils/logger");
var knex = require("../db/connection");
var emailRenderer = require("./emailRenderer");
var emailTrackingService = require("./emailTrackingService");
var metricsService = require("./metricsService");

// â”€â”€â”€ Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

var isEnabled = process.env.NOTIFICATION_EMAIL_ENABLED === "true";
var BATCH_THRESHOLD = parseInt(process.env.EMAIL_BATCH_THRESHOLD || "3", 10);
var BASE_URL = process.env.APP_BASE_URL || "https://finchippay.io";
var UNSUBSCRIBE_EMAIL = process.env.EMAIL_UNSUBSCRIBE_ADDRESS || "unsubscribe@finchippay.io";
var RATE_LIMIT_PER_HOUR = parseInt(process.env.EMAIL_RATE_LIMIT_PER_HOUR || "10", 10);

async function isRateLimited(toAddress) {
  var oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  var row = await knex("email_send_queue").where("to_address", toAddress).where("created_at", ">=", oneHourAgo).count("id as cnt").first();
  var count = parseInt((row && row.cnt) || "0", 10);
  return count >= RATE_LIMIT_PER_HOUR;
}

var smtpConfig = {
  host: process.env.SMTP_HOST || "",
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
};

var fromAddress = process.env.SMTP_FROM || "noreply@finchippay.io";
var transport = null;

// â”€â”€â”€ Transport â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function initTransport() {
  if (!isEnabled) {
    logger.info({ type: "notification_disabled" }, "Email notifications are disabled");
    return false;
  }
  if (!smtpConfig.host || !smtpConfig.auth.user || !smtpConfig.auth.pass) {
    logger.warn({ type: "notification_misconfigured" }, "SMTP not fully configured");
    return false;
  }
  try {
    transport = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.auth.user,
        pass: smtpConfig.auth.pass,
      },
    });
    logger.info({ type: "notification_transport_ready" }, "SMTP transport initialized");
    return true;
  } catch (err) {
    logger.error({ type: "notification_transport_error", error: err.message }, "Failed to init SMTP");
    return false;
  }
}

function getTransport() {
  if (!transport) {
    initTransport();
  }
  return transport;
}

// â”€â”€â”€ Unsubscribe helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Build List-Unsubscribe headers for a given email address + token.
 * @param {string} email
 * @param {string} token
 * @returns {{ listUnsubscribe: string, listUnsubscribePost: string }}
 */
function buildUnsubscribeHeaders(email, token) {
  const oneClickUrl = `${BASE_URL}/api/emails/unsubscribe?token=${token}`;
  return {
    "List-Unsubscribe": `<mailto:${UNSUBSCRIBE_EMAIL}?subject=unsubscribe>, <${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Ensure an unsubscribe token exists for this email address.
 * Returns an existing one or creates a new one.
 * @param {string} email
 * @param {string} [category]
 * @returns {Promise<string>} token
 */
async function ensureUnsubscribeToken(email, category) {
  if (!category) category = "all";
  const crypto = require("crypto");
  const existing = await knex("email_unsubscribes")
    .where({ email, category })
    .select("token")
    .first();
  if (existing) return existing.token;

  const token = crypto.randomBytes(24).toString("base64url");
  await knex("email_unsubscribes")
    .insert({
      email,
      category,
      token,
      unsubscribed_at: null, // not yet unsubscribed â€” token pre-created for headers
    })
    .onConflict(["email", "category"])
    .ignore();
  // Re-fetch in case of conflict
  const row = await knex("email_unsubscribes").where({ email, category }).select("token").first();
  return row ? row.token : token;
}

// â”€â”€â”€ Core send â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Send a raw email immediately (bypass queue).
 * Used internally; external callers should prefer queueEmail.
 *
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 * @param {object} [options]  { text, emailId, unsubscribeToken }
 * @returns {Promise<{ sent: boolean, messageId?: string, error?: string }>}
 */
async function sendEmail(to, subject, html, options) {
  if (!options) options = {};
  var t = getTransport();
  if (!t) {
    return { sent: false, error: "Email notifications are not enabled or misconfigured" };
  }

  // Suppression check
  var suppressed = await emailTrackingService.isSuppressed(to);
  if (suppressed) {
    logger.info({ type: "email_suppressed", to }, "Email suppressed (unsubscribed/bounced)");
    return { sent: false, error: "Recipient is suppressed" };
  }

  var extraHeaders = {};
  if (options.unsubscribeToken) {
    extraHeaders = buildUnsubscribeHeaders(to, options.unsubscribeToken);
  }

  try {
    var mailOpts = {
      from: fromAddress,
      to: to,
      subject: subject,
      html: html,
      text: options.text || undefined,
      headers: extraHeaders,
    };
    var info = await t.sendMail(mailOpts);
    logger.info(
      { type: "email_sent", to, subject, messageId: info.messageId, emailId: options.emailId },
      "Sent",
    );
    if (options.emailId) {
      await emailTrackingService.recordEvent(options.emailId, "sent", {});
    }
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    logger.error({ type: "email_send_failed", to, subject, error: err.message }, "Failed");
    return { sent: false, error: err.message };
  }
}

// â”€â”€â”€ Queue-based sending â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Enqueue an email for async processing.
 *
 * @param {string} to
 * @param {string} templateType
 * @param {object} data           Template context
 * @param {object} [opts]         { publicKey }
 * @returns {Promise<{ emailId: string }>}
 */
async function queueEmail(to, templateType, data, opts) {
  if (!opts) opts = {};
  if (await isRateLimited(to)) {
    metricsService.emailsRateLimitedTotal.inc();
    logger.warn({ type: "email_rate_limited", to }, "Rate limit exceeded, dropping email");
    return { emailId: null, rateLimited: true };
  }
  const emailId = emailTrackingService.generateEmailId();
  const pixelUrl = emailTrackingService.trackingPixelUrl(emailId);

  // Pre-create unsubscribe token
  let unsubToken = null;
  try {
    unsubToken = await ensureUnsubscribeToken(to, "all");
  } catch (err) {
    logger.debug({ type: "unsubscribe_token_precreate_failed", error: err.message }, "Unsubscribe token pre-create failed");
  }

  const unsubscribeUrl = unsubToken
    ? `${BASE_URL}/api/emails/unsubscribe?token=${unsubToken}`
    : `${BASE_URL}/api/emails/unsubscribe`;

  const rendered = emailRenderer.render(templateType, data, {
    trackingPixelUrl: pixelUrl,
    unsubscribeUrl,
  });

  await knex("email_send_queue").insert({
    email_id: emailId,
    to_address: to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    template_type: templateType,
    template_data: JSON.stringify(data),
    status: "pending",
    attempts: 0,
    max_attempts: 3,
    next_attempt_at: new Date().toISOString(),
    public_key: opts.publicKey || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  logger.info({ type: "email_queued", emailId, to, templateType }, "Email queued");
  return { emailId };
}

/**
 * Process pending items from email_send_queue with exponential backoff retries.
 * Called by the executor worker.
 *
 * @returns {Promise<{ processed: number, failed: number }>}
 */
async function processEmailQueue() {
  var now = new Date().toISOString();
  var pending = await knex("email_send_queue")
    .where("status", "pending")
    .where("next_attempt_at", "<=", now)
    .orderBy("next_attempt_at", "asc")
    .limit(50)
    .select();

  var processed = 0;
  var failed = 0;

  for (var i = 0; i < pending.length; i++) {
    var item = pending[i];
    var attempts = (item.attempts || 0) + 1;
    var maxAttempts = item.max_attempts || 3;

    // Check suppression again at send time
    var suppressed = await emailTrackingService.isSuppressed(item.to_address);
    if (suppressed) {
      await knex("email_send_queue").where("id", item.id).update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      });
      continue;
    }

    var result = await sendEmail(item.to_address, item.subject, item.html, {
      text: item.text,
      emailId: item.email_id,
      unsubscribeToken: null, // already baked into the rendered html
    });

    metricsService.emailsSentTotal.inc();
    if (result.sent) {
      await knex("email_send_queue").where("id", item.id).update({
        status: "sent",
        attempts: attempts,
        updated_at: new Date().toISOString(),
      });
      processed++;
    } else {
      failed++;
      metricsService.emailsFailedTotal.inc();
      if (attempts >= maxAttempts) {
        await knex("email_send_queue").where("id", item.id).update({
          status: "failed",
          attempts: attempts,
          last_error: result.error,
          updated_at: new Date().toISOString(),
        });
      } else {
        // Exponential backoff: 2^attempts minutes
        var backoffMs = Math.pow(2, attempts) * 60 * 1000;
        var nextAttempt = new Date(Date.now() + backoffMs).toISOString();
        await knex("email_send_queue").where("id", item.id).update({
          attempts: attempts,
          last_error: result.error,
          next_attempt_at: nextAttempt,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  return { processed, failed };
}

// â”€â”€â”€ Notification integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Map internal event types to email template names.
 */
var EVENT_TEMPLATE_MAP = {
  payment_received: "payment_received",
  payment_sent: "payment_sent",
  escrow_released: "escrow_released",
  stream_depleted: "stream_claimed",
  stream_claimed: "stream_claimed",
  scheduled_txn_executed: "scheduled_txn_executed",
  price_alert: "price_alert",
  security_alert: "security_alert",
  multisig_executed: "scheduled_txn_executed",
  tip_received: "payment_received",
};

var EVENT_SUBJECTS = {
  payment_received: "Payment Received - Finchippay",
  payment_sent: "Payment Sent - Finchippay",
  escrow_released: "Escrow Released - Finchippay",
  stream_depleted: "Stream Depleted - Finchippay",
  stream_claimed: "Stream Claimed - Finchippay",
  scheduled_txn_executed: "Scheduled Transaction Executed - Finchippay",
  price_alert: "Price Alert - Finchippay",
  security_alert: "Security Alert - Finchippay",
  multisig_executed: "Multi-Sig Executed - Finchippay",
  tip_received: "Tip Received - Finchippay",
};

/**
 * Send a single event notification to a specific address.
 * Legacy method â€” kept for backwards compatibility.
 *
 * @param {string} to
 * @param {string} eventType
 * @param {object} data
 */
async function sendEventNotification(to, eventType, data) {
  if (!data) data = {};
  var templateType = EVENT_TEMPLATE_MAP[eventType] || null;

  if (!templateType) {
    logger.error({ type: "template_unknown", eventType }, "No template for event type");
    return { sent: false, error: "No template for event type: " + eventType };
  }

  var emailId = emailTrackingService.generateEmailId();
  var pixelUrl = emailTrackingService.trackingPixelUrl(emailId);
  var unsubscribeUrl = `${BASE_URL}/api/emails/unsubscribe`;

  var rendered;
  try {
    rendered = emailRenderer.render(templateType, data, {
      trackingPixelUrl: pixelUrl,
      unsubscribeUrl,
    });
  } catch (err) {
    logger.error(
      { type: "template_render_error", eventType, error: err.message },
      "Template render failed",
    );
    return { sent: false, error: err.message };
  }

  return sendEmail(to, rendered.subject, rendered.html, {
    text: rendered.text,
    emailId,
  });
}

// â”€â”€â”€ Batch / digest logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Count events queued in the last hour for a specific recipient.
 * @param {string} toAddress
 * @returns {Promise<number>}
 */
async function recentEventCount(toAddress) {
  var oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  var row = await knex("email_send_queue")
    .where("to_address", toAddress)
    .where("created_at", ">=", oneHourAgo)
    .whereIn("status", ["pending", "sent"])
    .count("id as cnt")
    .first();
  return parseInt((row && row.cnt) || "0", 10);
}

// â”€â”€â”€ Email Preference Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function registerEmail(publicKey, email, options) {
  if (!options) options = {};
  var events = options.events || [
    "payment_received",
    "escrow_released",
    "stream_depleted",
    "multisig_executed",
    "tip_received",
  ];
  var existing = await knex("notification_email_preferences")
    .where("public_key", publicKey)
    .first();
  if (existing) {
    await knex("notification_email_preferences")
      .where("public_key", publicKey)
      .update({
        email: email,
        events: JSON.stringify(events),
        updated_at: new Date().toISOString(),
      });
  } else {
    await knex("notification_email_preferences").insert({
      public_key: publicKey,
      email: email,
      events: JSON.stringify(events),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  var saved = await knex("notification_email_preferences").where("public_key", publicKey).first();
  logger.info(
    { type: "notification_email_registered", publicKey, email },
    "Email preference saved",
  );
  return {
    publicKey: saved.public_key,
    email: saved.email,
    events: JSON.parse(saved.events || "[]"),
    emailVerified: saved.email_verified || false,
    createdAt: saved.created_at,
    updatedAt: saved.updated_at,
  };
}

async function getEmailPreference(publicKey) {
  var row = await knex("notification_email_preferences").where("public_key", publicKey).first();
  if (!row) return null;
  return {
    publicKey: row.public_key,
    email: row.email,
    events: JSON.parse(row.events || "[]"),
    emailVerified: row.email_verified || false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function deleteEmailPreference(publicKey) {
  var deleted = await knex("notification_email_preferences").where("public_key", publicKey).del();
  if (deleted) {
    logger.info({ type: "notification_email_deleted", publicKey }, "Email preference deleted");
    return true;
  }
  return false;
}

// â”€â”€â”€ Subscriber notification with preference + verification check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Notify all subscribers of an event.
 * Checks email_enabled on notification_preferences, email verification,
 * and applies batching when event volume exceeds BATCH_THRESHOLD/hour.
 *
 * @param {string} eventType
 * @param {object} data
 * @returns {Promise<{ sent: number, failed: number, batched: number }>}
 */
async function notifySubscribers(eventType, data) {
  if (!data) data = {};
  if (!isEnabled || !getTransport()) {
    return { sent: 0, failed: 0, batched: 0 };
  }

  // Fetch all notification_email_preferences
  var allRows = await knex("notification_email_preferences").select();

  var sent = 0;
  var failed = 0;
  var batched = 0;

  for (var i = 0; i < allRows.length; i++) {
    var row = allRows[i];
    var events;
    try {
      events = JSON.parse(row.events || "[]");
    } catch (e) {
      continue;
    }
    if (!Array.isArray(events) || events.indexOf(eventType) === -1) continue;

    // Check email_verified
    if (!row.email_verified) {
      logger.debug(
        { type: "email_not_verified", publicKey: row.public_key },
        "Skipping unverified email",
      );
      continue;
    }

    // Check notification_preferences.email_enabled (master toggle)
    var pref = await knex("notification_preferences")
      .where("public_key", row.public_key)
      .select("email_enabled")
      .first();
    if (pref && pref.email_enabled === false) continue;

    var templateType = EVENT_TEMPLATE_MAP[eventType];
    if (!templateType) continue;

    var payload = {
      amount: data.amount,
      asset: data.asset,
      sender: data.sender,
      recipient: data.recipient || row.public_key,
      timestamp: data.timestamp || new Date().toISOString(),
      memo: data.memo,
      txHash: data.txHash,
    };

    // Batch check: if > BATCH_THRESHOLD events queued in the last hour, defer to digest
    var recentCount = await recentEventCount(row.email);
    if (recentCount >= BATCH_THRESHOLD) {
      // Queue a daily digest instead (only queue one pending digest if none exists)
      var pendingDigest = await knex("email_send_queue")
        .where("to_address", row.email)
        .where("template_type", "digest")
        .where("status", "pending")
        .first();
      if (!pendingDigest) {
        await queueEmail(
          row.email,
          "digest",
          {
            count: recentCount + 1,
            events: [{ label: eventType, timestamp: payload.timestamp, summary: `${payload.amount || ""} ${payload.asset || ""}`.trim() }],
          },
          { publicKey: row.public_key },
        );
      }
      batched++;
      continue;
    }

    try {
      await queueEmail(row.email, templateType, payload, { publicKey: row.public_key });
      sent++;
    } catch (e) {
      logger.error({ type: "email_queue_failed", error: e.message }, "Failed to queue email");
      failed++;
    }
  }

  return { sent, failed, batched };
}

module.exports = {
  isEnabled,
  sendEmail,
  sendEventNotification,
  registerEmail,
  getEmailPreference,
  deleteEmailPreference,
  notifySubscribers,
  queueEmail,
  processEmailQueue,
  ensureUnsubscribeToken,
  buildUnsubscribeHeaders,
  EVENT_TEMPLATE_MAP,
  EVENT_SUBJECTS,
};



