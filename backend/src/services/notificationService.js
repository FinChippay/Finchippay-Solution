/**
 * src/services/notificationService.js
 *
 * Pluggable email notification service that sends templated alerts for
 * payment events (payment received, escrow released, stream depleted,
 * multi-sig threshold reached, tips) using Nodemailer.
 *
 * SMTP is configured via environment variables (see .env.example).
 * The service degrades gracefully when NOTIFICATION_EMAIL_ENABLED=false
 * or SMTP credentials are missing.
 */

"use strict";

var nodemailer = require("nodemailer");
var logger = require("../utils/logger");
var knex = require("../db/connection");
var emailTemplates = require("./emailTemplates");

// SMTP Configuration

var isEnabled = process.env.NOTIFICATION_EMAIL_ENABLED === "true";

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
    logger.error({ type: "notification_transport_error", error: err.message }, "Failed");
    return false;
  }
}

function getTransport() {
  if (!transport) {
    initTransport();
  }
  return transport;
}

// Public API

async function sendEmail(to, subject, html, options) {
  if (!options) options = {};
  var t = getTransport();
  if (!t) {
    return {
      sent: false,
      error: "Email notifications are not enabled or misconfigured",
    };
  }
  try {
    var info = await t.sendMail({
      from: fromAddress,
      to: to,
      subject: subject,
      html: html,
      text: options.text || undefined,
    });
    logger.info(
      {
        type: "email_sent",
        to: to,
        subject: subject,
        messageId: info.messageId,
      },
      "Sent",
    );
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    logger.error(
      {
        type: "email_send_failed",
        to: to,
        subject: subject,
        error: err.message,
      },
      "Failed",
    );
    return { sent: false, error: err.message };
  }
}

async function sendEventNotification(to, eventType, data) {
  if (!data) data = {};
  var html;
  try {
    html = emailTemplates.renderTemplate(eventType, data);
  } catch (err) {
    logger.error(
      {
        type: "template_render_error",
        eventType: eventType,
        error: err.message,
      },
      "Failed",
    );
    return { sent: false, error: err.message };
  }
  var labels = {
    payment_received: "Payment Received - Finchippay",
    escrow_released: "Escrow Released - Finchippay",
    stream_depleted: "Stream Depleted - Finchippay",
    multisig_executed: "Multi-Sig Executed - Finchippay",
    tip_received: "Tip Received - Finchippay",
  };
  var subject = labels[eventType] || "Finchippay Notification: " + eventType;
  var text = emailTemplates.renderPlainText(eventType, data);
  return sendEmail(to, subject, html, { text: text });
}

// Email Preference Management

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
    {
      type: "notification_email_registered",
      publicKey: publicKey,
      email: email,
    },
    "Saved",
  );
  return {
    publicKey: saved.public_key,
    email: saved.email,
    events: JSON.parse(saved.events || "[]"),
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function deleteEmailPreference(publicKey) {
  var deleted = await knex("notification_email_preferences").where("public_key", publicKey).del();
  if (deleted) {
    logger.info({ type: "notification_email_deleted", publicKey: publicKey }, "Deleted");
    return true;
  }
  return false;
}

async function notifySubscribers(eventType, data) {
  if (!data) data = {};
  if (!isEnabled || !getTransport()) {
    return { sent: 0, failed: 0 };
  }
  var allRows = await knex("notification_email_preferences").select();
  var matching = [];
  for (var i = 0; i < allRows.length; i++) {
    var row = allRows[i];
    var events;
    try {
      events = JSON.parse(row.events || "[]");
    } catch (e) {
      continue;
    }
    if (Array.isArray(events) && events.indexOf(eventType) !== -1) {
      matching.push(row);
    }
  }
  var sent = 0;
  var failed = 0;
  for (var j = 0; j < matching.length; j++) {
    var matchRow = matching[j];
    try {
      var result = await sendEventNotification(matchRow.email, eventType, {
        amount: data.amount,
        asset: data.asset,
        sender: data.sender,
        recipient: data.recipient || matchRow.public_key,
        timestamp: data.timestamp,
        memo: data.memo,
        txHash: data.txHash,
      });
      if (result.sent) {
        sent++;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }
  }
  return { sent: sent, failed: failed };
}

module.exports = {
  isEnabled: isEnabled,
  sendEmail: sendEmail,
  sendEventNotification: sendEventNotification,
  registerEmail: registerEmail,
  getEmailPreference: getEmailPreference,
  deleteEmailPreference: deleteEmailPreference,
  notifySubscribers: notifySubscribers,
};
