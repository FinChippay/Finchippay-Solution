/**
 * src/services/emailTrackingService.js
 *
 * Email delivery tracking service.
 *
 * Responsibilities:
 * - Generate unique email IDs and tracking pixel URLs
 * - Record email_events (sent, delivered, opened, clicked, bounced)
 * - Bounce handling: suppress email after 3 hard bounces
 * - Query tracking status for a given email_id
 */

"use strict";

const crypto = require("crypto");
const knex = require("../db/connection");
const logger = require("../utils/logger");

const BASE_URL = process.env.APP_BASE_URL || "https://finchippay.io";
const HARD_BOUNCE_THRESHOLD = 3;

// ─── ID generation ────────────────────────────────────────────────────────────

/**
 * Generate a unique, URL-safe email tracking ID.
 * @returns {string}
 */
function generateEmailId() {
  return crypto.randomBytes(18).toString("base64url");
}

/**
 * Build the 1×1 tracking pixel URL for a given email_id.
 * @param {string} emailId
 * @returns {string}
 */
function trackingPixelUrl(emailId) {
  return `${BASE_URL}/api/emails/track/${emailId}/open.gif`;
}

// ─── Event recording ─────────────────────────────────────────────────────────

/**
 * Record a tracking event into email_events.
 *
 * @param {string} emailId
 * @param {string} eventType  "sent"|"delivered"|"opened"|"clicked"|"bounced"|"complained"
 * @param {object} [meta]     { userAgent, ip, metadata }
 */
async function recordEvent(emailId, eventType, meta) {
  if (!meta) meta = {};
  try {
    await knex("email_events").insert({
      email_id: emailId,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      user_agent: meta.userAgent || null,
      ip: meta.ip || null,
      metadata: meta.metadata ? JSON.stringify(meta.metadata) : null,
    });
    logger.info({ type: "email_event_recorded", emailId, eventType }, "Email event");
  } catch (err) {
    logger.error(
      { type: "email_event_record_failed", emailId, eventType, error: err.message },
      "Failed",
    );
  }
}

/**
 * Handle an open event triggered by loading the tracking pixel.
 * @param {string} emailId
 * @param {object} [meta]  { userAgent, ip }
 */
async function handleOpen(emailId, meta) {
  // Gate open-tracking on explicit consent per recipient (default off)
  const queueRow = await knex("email_send_queue")
    .where("email_id", emailId)
    .select("to_address")
    .first();
  if (queueRow) {
    const prefRow = await knex("notification_email_preferences")
      .where("email", queueRow.to_address)
      .select("consent_open_tracking")
      .first();

    if (prefRow && prefRow.consent_open_tracking) {
      await module.exports.recordEvent(emailId, "opened", meta);
    } else {
      logger.debug(
        { type: "tracking_omitted_consent", emailId },
        "Omitted tracking pixel log due to lack of explicit consent",
      );
    }
  } else {
    // If we can't find who we sent it to, we shouldn't track them.
    logger.debug(
      { type: "tracking_omitted_unknown", emailId },
      "Omitted tracking pixel log for unknown recipient",
    );
  }
}

/**
 * Handle a click-through event.
 * @param {string} emailId
 * @param {string} clickUrl
 * @param {object} [meta]  { userAgent, ip }
 */
async function handleClick(emailId, clickUrl, meta) {
  await module.exports.recordEvent(
    emailId,
    "clicked",
    Object.assign({}, meta, { metadata: { url: clickUrl } }),
  );
}

// ─── Bounce handling ──────────────────────────────────────────────────────────

/**
 * Process a bounce webhook event.
 * Marks email as bounced and suppresses further sends to the address
 * once HARD_BOUNCE_THRESHOLD is reached.
 *
 * @param {string} emailAddress
 * @param {string} emailId
 * @param {string} [bounceType]   "hard"|"soft"
 * @param {string} [reason]
 * @returns {{ suppressed: boolean }}
 */
async function handleBounce(emailAddress, emailId, bounceType, reason) {
  await module.exports.recordEvent(emailId, "bounced", { metadata: { type: bounceType, reason } });

  if (bounceType !== "hard") {
    return { suppressed: false };
  }

  // Count hard bounces for this address across all sent emails
  const rows = await knex("email_events")
    .join("email_send_queue", "email_events.email_id", "email_send_queue.email_id")
    .where("email_send_queue.to_address", emailAddress)
    .where("email_events.event_type", "bounced")
    .count("email_events.id as cnt")
    .first();

  const count = parseInt((rows && rows.cnt) || "0", 10);

  if (count >= HARD_BOUNCE_THRESHOLD) {
    // Insert unsubscribe record to suppress all future sends
    const token = crypto.randomBytes(24).toString("base64url");
    try {
      await knex("email_unsubscribes")
        .insert({
          email: emailAddress,
          category: "all",
          reason: `Auto-suppressed after ${count} hard bounces`,
          token,
          unsubscribed_at: new Date().toISOString(),
        })
        .onConflict(["email", "category"])
        .ignore();
    } catch (_) {
      // already exists — ok
    }
    logger.warn(
      { type: "email_bounce_suppressed", emailAddress, count },
      "Email suppressed after hard bounces",
    );
    return { suppressed: true };
  }

  return { suppressed: false };
}

// ─── Suppression check ────────────────────────────────────────────────────────

/**
 * Check whether a given email address is suppressed (unsubscribed / bounced).
 *
 * @param {string} emailAddress
 * @param {string} [category]  defaults to "all"
 * @returns {Promise<boolean>}
 */
async function isSuppressed(emailAddress, category) {
  if (!category) category = "all";
  // Suppressed if unsubscribed from "all" OR from specific category
  const rows = await knex("email_unsubscribes")
    .where("email", emailAddress)
    .whereIn("category", [category, "all"])
    .select("id")
    .limit(1);
  return rows.length > 0;
}

// ─── Status query ─────────────────────────────────────────────────────────────

/**
 * Return all tracking events for a given email_id.
 * @param {string} emailId
 * @returns {Promise<Array>}
 */
async function getEvents(emailId) {
  return knex("email_events")
    .where("email_id", emailId)
    .orderBy("timestamp", "asc")
    .select("event_type", "timestamp", "user_agent", "ip", "metadata");
}

module.exports = {
  generateEmailId,
  trackingPixelUrl,
  recordEvent,
  handleOpen,
  handleClick,
  handleBounce,
  isSuppressed,
  getEvents,
  HARD_BOUNCE_THRESHOLD,
};
