/**
 * src/services/rateLimitAlertService.js
 *
 * Alerts when blocks/min exceeds configurable threshold.
 * Supports webhook and email alert channels with cooldown.
 */
"use strict";

const logger = require("../utils/logger");
const knex = require("../db/connection");

const ALERT_THRESHOLD = parseInt(process.env.RL_ALERT_THRESHOLD || "50", 10);
const COOLDOWN_MS = 5 * 60 * 1000;

const lastAlertTimestamps = {};

async function checkAndAlert() {
  const now = Date.now();
  const oneMinuteAgo = new Date(now - 60000).toISOString();

  const [{ count }] = await knex("rate_limit_events")
    .where("blocked", true)
    .andWhere("occurred_at", ">=", oneMinuteAgo)
    .count("* as count");

  const blockCount = parseInt(count, 10);

  if (blockCount >= ALERT_THRESHOLD) {
    const lastAlert = lastAlertTimestamps["high_block_rate"] || 0;
    if (now - lastAlert >= COOLDOWN_MS) {
      lastAlertTimestamps["high_block_rate"] = now;
      logger.warn(
        { type: "rate_limit_alert", blockCount, threshold: ALERT_THRESHOLD },
        `Rate limit alert: ${blockCount} blocks in the last minute (threshold: ${ALERT_THRESHOLD})`,
      );
      await sendAlert({ blockCount, threshold: ALERT_THRESHOLD });
      return { alerted: true, blockCount };
    }
  }
  return { alerted: false, blockCount };
}

async function sendAlert(data) {
  const webhookUrl = process.env.RL_ALERT_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "rate_limit_alert",
          ...data,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (err) {
      logger.error({ err }, "Failed to send rate limit alert webhook");
    }
  }

  const adminEmail = process.env.RL_ALERT_EMAIL;
  if (adminEmail) {
    try {
      const notificationService = require("./notificationService");
      await notificationService.sendEmail(
        adminEmail,
        "Rate Limit Alert - Finchippay",
        `<h2>Rate Limit Alert</h2>
         <p>Block count: ${data.blockCount} in the last minute</p>
         <p>Threshold: ${data.threshold}</p>
         <p>Timestamp: ${new Date().toISOString()}</p>`,
      );
    } catch (err) {
      logger.error({ err }, "Failed to send rate limit alert email");
    }
  }
}

module.exports = {
  checkAndAlert,
  ALERT_THRESHOLD,
  COOLDOWN_MS,
};
