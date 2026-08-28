"use strict";

const knex = require("../db/connection");
const logger = require("../utils/logger");

const RETENTION_DAYS = parseInt(process.env.WEBHOOK_EVENT_RETENTION_DAYS || "14", 10);
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cleanupTimer = null;

async function runCleanup() {
  try {
    const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const deletedCount = await knex("webhook_events").where("created_at", "<", cutoffDate).del();

    if (deletedCount > 0) {
      logger.info({
        type: "webhook_event_cleanup",
        deletedCount,
        retentionDays: RETENTION_DAYS,
      });
    }
  } catch (err) {
    logger.error({
      type: "webhook_event_cleanup_error",
      error: err.message,
    });
  }
}

function startCleanupWorker() {
  if (cleanupTimer) return;
  // Run immediately on startup, then periodically
  runCleanup();
  cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  logger.info({
    type: "cleanup_worker_started",
    intervalMs: CLEANUP_INTERVAL_MS,
    retentionDays: RETENTION_DAYS,
  });
}

function stopCleanupWorker() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    logger.info({ type: "cleanup_worker_stopped" });
  }
}

module.exports = {
  runCleanup,
  startCleanupWorker,
  stopCleanupWorker,
};
