"use strict";

const cron = require("node-cron");
const db = require("../db");
const logger = require("../utils/logger");

function getRetentionDays() {
  const parsed = parseInt(process.env.DATA_RETENTION_DAYS, 10);
  return Number.isNaN(parsed) || parsed < 1 ? 365 : parsed;
}

function getCache() {
  return require("./cacheService");
}

function cutoffDate(retentionDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

async function writeAuditLog(action, details, targetPublicKey = null) {
  try {
    await db("audit_log").insert({
      action,
      target_public_key: targetPublicKey,
      details: JSON.stringify(details),
    });
  } catch (err) {
    logger.error({ err, action }, "Failed to write audit log entry");
  }
}

async function purgeOldData() {
  const retentionDays = getRetentionDays();
  const cutoff = cutoffDate(retentionDays);
  const purged = {};

  try {
    purged.webhookDeliveries = await db("webhook_deliveries")
      .where("created_at", "<", cutoff)
      .del();
  } catch (err) {
    logger.error({ err }, "Failed to purge webhook_deliveries");
    purged.webhookDeliveries = 0;
  }

  try {
    purged.tips = await db("tips").where("created_at", "<", cutoff).del();
  } catch (err) {
    logger.error({ err }, "Failed to purge tips");
    purged.tips = 0;
  }

  try {
    purged.auditLog = await db("audit_log").where("created_at", "<", cutoff).del();
  } catch (err) {
    logger.error({ err }, "Failed to purge audit_log");
    purged.auditLog = 0;
  }

  try {
    const cache = getCache();
    purged.analyticsCacheKeysCleared = await cache.delPattern("analytics:*");
  } catch (err) {
    logger.error({ err }, "Failed to purge analytics cache");
    purged.analyticsCacheKeysCleared = 0;
  }

  const summary = { retentionDays, cutoff: cutoff.toISOString(), purged };
  logger.info(summary, "Data retention purge completed");
  await writeAuditLog("data_purge", summary);

  return summary;
}

let task = null;

function startRetentionCron() {
  if (task) return task;
  task = cron.schedule("0 3 * * *", () => {
    purgeOldData().catch((err) => {
      logger.error({ err }, "Data retention cron run failed");
    });
  });
  return task;
}

function stopRetentionCron() {
  if (task) {
    task.stop();
    task = null;
  }
}

module.exports = {
  getRetentionDays,
  purgeOldData,
  startRetentionCron,
  stopRetentionCron,
  writeAuditLog,
};
