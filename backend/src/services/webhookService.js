/**
 * src/services/webhookService.js
 * Webhook registration, delivery, retry with exponential backoff,
 * dead letter queue, and Horizon SSE monitoring.
 *
 * Flow:
 *   1. Caller registers a webhook via `registerWebhook(publicKey, url, secret)`.
 *   2. The service starts a Horizon SSE stream for that public key (if not
 *      already monitoring it).
 *   3. When a `payment.received` event arrives it is delivered to every
 *      registered URL for that account, signed with HMAC-SHA256.
 *   4. Failed deliveries are retried with exponential backoff (1s, 5s, 25s, 125s).
 *   5. After 5 failures, delivery is marked as 'dead' in the dead letter queue.
 *   6. A background worker runs every 30 seconds to retry pending deliveries.
 *
 * Security:
 *   - Payloads are signed using HMAC-SHA256; consumers verify via X-Webhook-Signature.
 *   - Secrets should be long random strings (>= 32 bytes); never logged.
 *   - Delivery errors are logged but do not crash the process.
 */

"use strict";

const crypto = require("crypto");
const { Horizon } = require("@stellar/stellar-sdk");
const logger = require("../utils/logger");
const metrics = require("./metricsService");
const tracer = require("../config/tracing").getTracer("webhook-service");
const { propagation, context } = require("@opentelemetry/api");
const { getRequestIdHeader } = require("../utils/correlationId");
const { generateWebhookSignature } = require("../utils/webhookSignature");
const db = require("../db");
require("dotenv").config();

// Lazy-loaded to avoid circular dependency at parse time
function getCache() {
  try {
    return require("./cacheService");
  } catch {
    return null;
  }
}

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_URL);

const MAX_RETRIES = 5;
const RETRY_INTERVALS = [1000, 5000, 25000, 125000, 625000];
const RETRY_WORKER_INTERVAL = 30000;

/** @type {Map<string, {id:string,publicKey:string,url:string,secret:string,createdAt:string}>} */
const webhooks = new Map();
let nextId = 1;

/** @type {Map<string, Function>} Active Horizon SSE close-stream handles keyed by publicKey */
const activeStreams = new Map();

/** @type {Set<Promise<void>>} In-flight webhook delivery requests, tracked for graceful shutdown */
const pendingDeliveries = new Set();

let retryWorkerTimer = null;

// ─── Prepared Statements ──────────────────────────────────────────────────────

function ensureStatements() {
  if (ensureStatements._prepared) return;
  ensureStatements._prepared = true;

  ensureStatements.insertDelivery = db.prepare(`
    INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status, attempts, created_at)
    VALUES (?, ?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP)
  `);

  ensureStatements.incrementAttempts = db.prepare(`
    UPDATE webhook_deliveries
    SET attempts = attempts + 1,
        last_attempt_at = CURRENT_TIMESTAMP,
        last_error = ?,
        next_retry_at = ?,
        status = CASE WHEN attempts + 1 >= ? THEN 'dead' ELSE 'pending' END
    WHERE id = ?
  `);

  ensureStatements.markDelivered = db.prepare(`
    UPDATE webhook_deliveries
    SET status = 'delivered',
        last_attempt_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  ensureStatements.getPendingRetries = db.prepare(`
    SELECT * FROM webhook_deliveries
    WHERE status = 'pending'
      AND next_retry_at <= CURRENT_TIMESTAMP
      AND attempts < ?
  `);

  ensureStatements.getDeadDeliveries = db.prepare(`
    SELECT d.* FROM webhook_deliveries d
    JOIN webhooks w ON d.webhook_id = w.id
    WHERE w.publicKey = ? AND d.status = 'dead'
    ORDER BY d.created_at DESC
  `);

  ensureStatements.resetDeadDeliveries = db.prepare(`
    UPDATE webhook_deliveries
    SET status = 'pending', attempts = 0, next_retry_at = NULL
    WHERE webhook_id IN (
      SELECT id FROM webhooks WHERE publicKey = ?
    ) AND status = 'dead'
  `);

  ensureStatements.getDeliveryById = db.prepare(`
    SELECT * FROM webhook_deliveries WHERE id = ?
  `);
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register a new webhook for a Stellar public key.
 *
 * Starts a Horizon SSE monitor for the account if none is already active.
 * The same account can have multiple webhook URLs.
 *
 * @param {string} publicKey - Stellar public key to monitor (G...)
 * @param {string} url - HTTPS endpoint that will receive POST payloads
 * @param {string} secret - Shared secret used to compute HMAC-SHA256 signatures
 * @returns {{ id:string, publicKey:string, url:string, createdAt:string }}
 */
function registerWebhook(publicKey, url, secret) {
  const id = String(nextId++);
  const webhook = {
    id,
    publicKey,
    url,
    secret,
    createdAt: new Date().toISOString(),
  };
  webhooks.set(id, webhook);
  startMonitoring(webhook);
  logger.info({ type: "webhook_registered", id, publicKey, url });
  return { id, publicKey, url, createdAt: webhook.createdAt };
}

/**
 * Return all webhooks registered for `publicKey`.
 *
 * @param {string} publicKey
 * @returns {Array<{id:string,publicKey:string,url:string,createdAt:string}>}
 */
function getWebhooksByPublicKey(publicKey) {
  return Array.from(webhooks.values())
    .filter((w) => w.publicKey === publicKey)
    .map(({ id, publicKey: pk, url, createdAt }) => ({ id, publicKey: pk, url, createdAt }));
}

/**
 * Delete a webhook by ID.
 *
 * @param {string} id - Webhook ID returned by `registerWebhook`
 * @returns {boolean} `true` if the webhook existed and was deleted
 */
function deleteWebhook(id) {
  const exists = webhooks.has(id);
  if (exists) {
    webhooks.delete(id);
    logger.info({ type: "webhook_deleted", id });
  }
  return exists;
}

/**
 * Get a webhook by ID (internal use for delivery retries).
 *
 * @param {string} id
 * @returns {{ id:string, publicKey:string, url:string, secret:string } | undefined}
 */
function getWebhookById(id) {
  return webhooks.get(id);
}

// ─── Signature ────────────────────────────────────────────────────────────────

/**
 * Compute the HMAC-SHA256 signature for a payload.
 * Uses the shared webhookSignature utility.
 *
 * @param {string} secret
 * @param {object} payload - Will be JSON.stringify'd before signing
 * @returns {string} Hex-encoded digest
 */
function signPayload(secret, payload) {
  return generateWebhookSignature(payload, secret);
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

/**
 * Attempt to deliver a signed webhook payload to a single endpoint.
 *
 * @param {{ id:string, url:string, secret:string }} webhook
 * @param {object} payload
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function attemptDelivery(webhook, payload) {
  const signature = signPayload(webhook.secret, payload);
  const headers = {
    "Content-Type": "application/json",
    "X-Webhook-Signature": signature,
    ...getRequestIdHeader(),
  };

  propagation.inject(context.active(), headers);

  const res = await fetch(webhook.url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}` };
  }

  return { ok: true };
}

/**
 * Deliver a signed webhook payload to a single registered endpoint.
 * Creates a delivery record and manages retry logic with exponential backoff.
 *
 * @param {{ id:string, url:string, secret:string }} webhook
 * @param {object} payload
 * @param {string} eventType - The event type (e.g., 'payment.received')
 * @returns {Promise<void>}
 */
async function deliverWebhook(webhook, payload, eventType = "payment.received") {
  ensureStatements();
  const span = tracer.startSpan("webhook.delivery");
  span.setAttributes({
    "webhook.id": webhook.id,
    "webhook.url": webhook.url,
    "event.type": eventType,
  });

  const deliveryId = crypto.randomUUID();
  const payloadStr = JSON.stringify(payload);

  try {
    ensureStatements.insertDelivery.run(deliveryId, webhook.id, eventType, payloadStr);
  } catch (err) {
    logger.error({ type: "webhook_delivery_db_error", id: deliveryId, error: err.message });
    span.recordException(err);
    span.end();
    return;
  }

  try {
    const result = await attemptDelivery(webhook, payload);

    if (result.ok) {
      ensureStatements.markDelivered.run(deliveryId);
      logger.info({ type: "webhook_delivered", id: webhook.id, url: webhook.url, deliveryId });
      span.setStatus({ code: 1 });
    } else {
      handleDeliveryFailure(deliveryId, webhook, payload, eventType, result.error, span);
    }
  } catch (err) {
    handleDeliveryFailure(deliveryId, webhook, payload, eventType, err.message, span);
  } finally {
    span.end();
  }
}

/**
 * Handle a failed delivery by incrementing attempts and scheduling retry.
 * After MAX_RETRIES failures, marks delivery as 'dead'.
 *
 * @param {string} deliveryId
 * @param {{ id:string, url:string, secret:string }} webhook
 * @param {object} payload
 * @param {string} eventType
 * @param {string} errorMsg
 * @param {object} span - OpenTelemetry span
 */
function handleDeliveryFailure(deliveryId, webhook, payload, eventType, errorMsg, span) {
  const nextRetryMs = RETRY_INTERVALS[Math.min(webhook.attempts || 0, RETRY_INTERVALS.length - 1)];
  const nextRetryAt = new Date(Date.now() + nextRetryMs).toISOString();

  try {
    ensureStatements.incrementAttempts.run(errorMsg, nextRetryAt, MAX_RETRIES, deliveryId);
  } catch (err) {
    logger.error({ type: "webhook_retry_update_error", id: deliveryId, error: err.message });
  }

  const currentAttempt = (webhook.attempts || 0) + 1;
  webhook.attempts = currentAttempt;

  if (currentAttempt >= MAX_RETRIES) {
    logger.error({
      type: "webhook_delivery_dead",
      id: webhook.id,
      deliveryId,
      url: webhook.url,
      error: errorMsg,
      attempts: currentAttempt,
    });
    span.setStatus({ code: 2, message: `Delivery dead after ${currentAttempt} attempts: ${errorMsg}` });
  } else {
    logger.warn({
      type: "webhook_delivery_retry_scheduled",
      id: webhook.id,
      deliveryId,
      url: webhook.url,
      error: errorMsg,
      attempt: currentAttempt,
      nextRetryAt,
    });
    span.setStatus({ code: 2, message: `Retry ${currentAttempt}/${MAX_RETRIES}: ${errorMsg}` });
  }
}

// ─── Retry Worker ─────────────────────────────────────────────────────────────

/**
 * Process pending webhook deliveries that are due for retry.
 * Called by the background retry worker interval.
 */
async function processRetryQueue() {
  ensureStatements();
  try {
    const pending = ensureStatements.getPendingRetries.all(MAX_RETRIES);

    for (const delivery of pending) {
      const webhook = getWebhookById(delivery.webhook_id);
      if (!webhook) {
        logger.warn({ type: "webhook_not_found_for_retry", deliveryId: delivery.id, webhookId: delivery.webhook_id });
        continue;
      }

      let payload;
      try {
        payload = JSON.parse(delivery.payload);
      } catch {
        logger.error({ type: "webhook_invalid_payload", deliveryId: delivery.id });
        ensureStatements.incrementAttempts.run("Invalid payload", null, MAX_RETRIES, delivery.id);
        continue;
      }

      const span = tracer.startSpan("webhook.retry");
      span.setAttributes({
        "webhook.id": webhook.id,
        "delivery.id": delivery.id,
        "delivery.attempts": delivery.attempts,
      });

      try {
        const result = await attemptDelivery(webhook, payload);

        if (result.ok) {
          ensureStatements.markDelivered.run(delivery.id);
          logger.info({
            type: "webhook_retry_delivered",
            id: webhook.id,
            deliveryId: delivery.id,
            attempt: delivery.attempts + 1,
          });
          span.setStatus({ code: 1 });
        } else {
          handleDeliveryFailure(delivery.id, webhook, payload, delivery.event_type, result.error, span);
        }
      } catch (err) {
        handleDeliveryFailure(delivery.id, webhook, payload, delivery.event_type, err.message, span);
      } finally {
        span.end();
      }
    }
  } catch (err) {
    logger.error({ type: "retry_worker_error", error: err.message });
  }
}

/**
 * Start the background retry worker that processes the retry queue.
 */
function startRetryWorker() {
  if (retryWorkerTimer) return;
  retryWorkerTimer = setInterval(processRetryQueue, RETRY_WORKER_INTERVAL);
  logger.info({ type: "retry_worker_started", intervalMs: RETRY_WORKER_INTERVAL });
}

/**
 * Stop the background retry worker.
 */
function stopRetryWorker() {
  if (retryWorkerTimer) {
    clearInterval(retryWorkerTimer);
    retryWorkerTimer = null;
    logger.info({ type: "retry_worker_stopped" });
  }
}

// ─── Dead Letter Queue ────────────────────────────────────────────────────────

/**
 * Get failed (dead) webhook deliveries for a given public key.
 *
 * @param {string} publicKey - Stellar public key
 * @returns {Array} Dead deliveries
 */
function getDeadDeliveries(publicKey) {
  ensureStatements();
  return ensureStatements.getDeadDeliveries.all(publicKey);
}

/**
 * Reset dead deliveries to pending status for manual retry.
 *
 * @param {string} publicKey - Stellar public key
 * @returns {{ reset: number }} Number of deliveries reset
 */
function retryDeadDeliveries(publicKey) {
  ensureStatements();
  const result = ensureStatements.resetDeadDeliveries.run(publicKey);
  logger.info({ type: "webhook_dead_deliveries_reset", publicKey, count: result.changes });
  return { reset: result.changes };
}

// ─── Monitoring ───────────────────────────────────────────────────────────────

/**
 * Start a Horizon SSE stream for `webhook.publicKey` if one is not already
 * active. Incoming `payment` operations trigger delivery to all registered
 * URLs for that account.
 *
 * @param {{ publicKey:string }} webhook
 */
function startMonitoring(webhook) {
  metrics.horizonRequestsTotal.inc({ operation: "startSSE", status: "success" });
  if (activeStreams.has(webhook.publicKey)) {
    return;
  }

  const closeStream = server
    .payments()
    .forAccount(webhook.publicKey)
    .cursor("now")
    .stream({
      onmessage: async (payment) => {
        if (payment.type !== "payment" || payment.to !== webhook.publicKey) return;

        // Invalidate account & payment cache for the receiving account
        try {
          const cache = getCache();
          if (cache) {
            await cache.del(`account:${webhook.publicKey}`);
            await cache.delPattern(`payments:${webhook.publicKey}:*`);
          }
        } catch {
          // cache invalidation is best-effort
        }

        const payload = {
          event: "payment.received",
          publicKey: webhook.publicKey,
          payment: {
            id: payment.id,
            from: payment.from,
            to: payment.to,
            amount: payment.amount,
            asset:
              payment.asset_type === "native" ? "XLM" : payment.asset_code,
            createdAt: payment.created_at,
          },
        };

        const hooks = getWebhooksByPublicKey(webhook.publicKey);
        // Deliver in parallel; individual failures are handled in deliverWebhook.
        // Each delivery is tracked in `pendingDeliveries` so a graceful shutdown
        // can wait for in-flight HTTP requests before closing streams.
        const deliveries = hooks.map((h) => {
          const webhookData = getWebhookById(h.id);
          const promise = deliverWebhook(webhookData || h, payload, "payment.received").finally(() =>
            pendingDeliveries.delete(promise),
          );
          pendingDeliveries.add(promise);
          return promise;
        });
        await Promise.allSettled(deliveries);
      },
      onerror: (err) => {
        logger.error({
          type: "horizon_sse_error",
          publicKey: webhook.publicKey,
          error: err.message,
        });
        metrics.horizonRequestsTotal.inc({ operation: "sse", status: "error" });
        // Remove so a fresh stream can be created on the next registration.
        activeStreams.delete(webhook.publicKey);
        metrics.activeWebhookStreams.set(activeStreams.size);
      },
    });

  activeStreams.set(webhook.publicKey, closeStream);
  metrics.activeWebhookStreams.set(activeStreams.size);
  logger.info({ type: "horizon_monitoring_started", publicKey: webhook.publicKey });
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

/**
 * Close all active Horizon SSE streams and wait for in-flight deliveries.
 *
 * @param {number} [timeoutMs=5000] - Maximum time to wait for in-flight deliveries
 * @returns {Promise<void>}
 */
async function closeAllStreams(timeoutMs = 5000) {
  stopRetryWorker();

  for (const [publicKey, close] of activeStreams) {
    try {
      close();
    } catch (err) {
      logger.error({ type: "stream_close_error", publicKey, error: err.message });
    }
  }
  activeStreams.clear();
  metrics.activeWebhookStreams.set(0);

  if (pendingDeliveries.size > 0) {
    await Promise.race([
      Promise.allSettled([...pendingDeliveries]),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
  pendingDeliveries.clear();
}

module.exports = {
  registerWebhook,
  getWebhooksByPublicKey,
  deleteWebhook,
  signPayload,
  deliverWebhook,
  getDeadDeliveries,
  retryDeadDeliveries,
  startRetryWorker,
  stopRetryWorker,
  closeAllStreams,
};
