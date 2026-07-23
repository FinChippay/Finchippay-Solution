/**
 * src/services/adminService.js
 * Business logic for the admin dashboard.
 *
 * Provides four aggregate views:
 *   - getSystemStats()     – total/active users, transaction count + volume
 *   - getContractStats()   – escrow / stream / multisig counts from the on-chain indexer
 *   - getRecentErrors()    – last 50 error log entries with correlation IDs
 *   - getWebhookHealth()   – registered webhooks + delivery success rate
 *
 * Data sources:
 *   - The in-process SQLite DB (same handle used by the event indexer)
 *   - The webhook in-memory store exposed by webhookService
 *   - The in-process error log ring-buffer kept in this module
 */

"use strict";

const logger = require("../utils/logger");
const db = require("../db");

// ─── Error log ring-buffer ────────────────────────────────────────────────────

/** Maximum number of error entries kept in memory. */
const MAX_ERROR_LOG_ENTRIES = 200;

/**
 * In-memory ring buffer of recent errors.
 * Each entry: { timestamp, level, code, message, correlationId, details }
 *
 * Populated by `recordAdminError`, which is called by the global error handler
 * in server.js after it is wired up.
 *
 * @type {Array<object>}
 */
const errorLog = [];

/**
 * Append a structured error entry to the in-memory ring buffer.
 * Oldest entries are discarded once the buffer reaches MAX_ERROR_LOG_ENTRIES.
 *
 * @param {object} entry
 * @param {string} entry.code         - Error code (e.g. "SRV_INTERNAL")
 * @param {string} entry.message      - Human-readable message
 * @param {string} [entry.correlationId] - X-Request-ID if available
 * @param {*}      [entry.details]    - Any extra diagnostic data
 */
function recordAdminError({ code, message, correlationId, details } = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: "error",
    code: code || "UNKNOWN",
    message: message || "Unknown error",
    correlationId: correlationId || null,
    details: details || null,
  };

  errorLog.push(entry);

  // Trim to the last MAX_ERROR_LOG_ENTRIES entries.
  if (errorLog.length > MAX_ERROR_LOG_ENTRIES) {
    errorLog.splice(0, errorLog.length - MAX_ERROR_LOG_ENTRIES);
  }
}

// ─── System stats ─────────────────────────────────────────────────────────────

/**
 * Return aggregate system statistics.
 *
 * "Active users" are wallets that appear in a payment in the last 24 hours.
 * The query falls back to zero when the `payments` table does not yet exist
 * (fresh install before the first sync).
 *
 * @returns {Promise<{
 *   totalUsers:       number,
 *   activeUsers24h:   number,
 *   totalTransactions: number,
 *   totalVolumeXLM:   string,
 *   generatedAt:      string
 * }>}
 */
async function getSystemStats() {
  try {
    // Derive stats from the event indexer's SQLite tables.
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('contract_events','webhook_deliveries')"
      )
      .all()
      .map((r) => r.name);

    const hasEvents = tables.includes("contract_events");
    const hasDeliveries = tables.includes("webhook_deliveries");

    let totalTransactions = 0;
    let totalVolumeXLM = "0.0000000";
    let uniqueFromAddresses = 0;
    let activeAddresses24h = 0;

    if (hasEvents) {
      const stats = db
        .prepare(
          `SELECT
             COUNT(*) AS cnt,
             COUNT(DISTINCT from_address) AS unique_from,
             COALESCE(SUM(CAST(amount AS REAL)), 0) AS volume
           FROM contract_events
           WHERE event_type = 'send_tip' OR event_type = 'batch_send'`
        )
        .get();

      if (stats) {
        totalTransactions = stats.cnt || 0;
        uniqueFromAddresses = stats.unique_from || 0;
        totalVolumeXLM = (stats.volume || 0).toFixed(7);
      }

      // Active in last 24 h
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const active = db
        .prepare(
          `SELECT COUNT(DISTINCT from_address) AS cnt
           FROM contract_events
           WHERE created_at >= ?`
        )
        .get(cutoff);

      activeAddresses24h = active?.cnt || 0;
    }

    // If no data from contract events, try webhook deliveries as a proxy for user count
    if (!hasEvents && hasDeliveries) {
      const wStats = db.prepare("SELECT COUNT(DISTINCT webhook_id) AS cnt FROM webhook_deliveries").get();
      uniqueFromAddresses = wStats?.cnt || 0;
    }

    return {
      totalUsers: uniqueFromAddresses,
      activeUsers24h: activeAddresses24h,
      totalTransactions,
      totalVolumeXLM,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err }, "adminService.getSystemStats failed");
    return {
      totalUsers: 0,
      activeUsers24h: 0,
      totalTransactions: 0,
      totalVolumeXLM: "0.0000000",
      generatedAt: new Date().toISOString(),
    };
  }
}

// ─── Contract stats ───────────────────────────────────────────────────────────

/**
 * Return on-chain contract activity counts sourced from the event indexer DB.
 *
 * @returns {Promise<{
 *   escrows:   number,
 *   streams:   number,
 *   multisigs: number,
 *   tips:      number,
 *   batches:   number,
 *   generatedAt: string
 * }>}
 */
async function getContractStats() {
  try {
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contract_events'")
      .get();

    if (!tableExists) {
      return { escrows: 0, streams: 0, multisigs: 0, tips: 0, batches: 0, generatedAt: new Date().toISOString() };
    }

    const rows = db
      .prepare(
        `SELECT event_type, COUNT(*) AS cnt
         FROM contract_events
         GROUP BY event_type`
      )
      .all();

    const counts = Object.fromEntries(rows.map((r) => [r.event_type, r.cnt]));

    return {
      escrows: (counts["create_escrow"] || 0),
      streams: (counts["open_stream"] || 0),
      multisigs: (counts["create_multisig"] || 0),
      tips: (counts["send_tip"] || 0),
      batches: (counts["batch_send"] || 0),
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err }, "adminService.getContractStats failed");
    return { escrows: 0, streams: 0, multisigs: 0, tips: 0, batches: 0, generatedAt: new Date().toISOString() };
  }
}

// ─── Recent errors ────────────────────────────────────────────────────────────

/**
 * Return the most recent `limit` error entries from the ring buffer.
 *
 * @param {number} [limit=50]
 * @returns {{ errors: object[], total: number, generatedAt: string }}
 */
function getRecentErrors(limit = 50) {
  const slice = errorLog.slice(-limit).reverse();
  return {
    errors: slice,
    total: errorLog.length,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Webhook health ───────────────────────────────────────────────────────────

/**
 * Return webhook health metrics derived from the `webhook_deliveries` table.
 *
 * @returns {Promise<{
 *   totalRegistered:   number,
 *   successfulDeliveries: number,
 *   failedDeliveries:  number,
 *   deadDeliveries:    number,
 *   successRate:       string,
 *   generatedAt:       string
 * }>}
 */
async function getWebhookHealth() {
  try {
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='webhook_deliveries'")
      .get();

    const webhooksTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='webhooks'")
      .get();

    let totalRegistered = 0;
    let successfulDeliveries = 0;
    let failedDeliveries = 0;
    let deadDeliveries = 0;

    if (webhooksTable) {
      const wRow = db.prepare("SELECT COUNT(*) AS cnt FROM webhooks").get();
      totalRegistered = wRow?.cnt || 0;
    }

    if (tableExists) {
      const rows = db
        .prepare(
          `SELECT status, COUNT(*) AS cnt FROM webhook_deliveries GROUP BY status`
        )
        .all();

      for (const row of rows) {
        if (row.status === "delivered") successfulDeliveries = row.cnt;
        else if (row.status === "pending") failedDeliveries = row.cnt;
        else if (row.status === "dead") deadDeliveries = row.cnt;
      }
    }

    const totalAttempts = successfulDeliveries + failedDeliveries + deadDeliveries;
    const successRate =
      totalAttempts > 0
        ? ((successfulDeliveries / totalAttempts) * 100).toFixed(1)
        : "100.0";

    return {
      totalRegistered,
      successfulDeliveries,
      failedDeliveries,
      deadDeliveries,
      successRate,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err }, "adminService.getWebhookHealth failed");
    return {
      totalRegistered: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      deadDeliveries: 0,
      successRate: "100.0",
      generatedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  recordAdminError,
  getSystemStats,
  getContractStats,
  getRecentErrors,
  getWebhookHealth,
};
