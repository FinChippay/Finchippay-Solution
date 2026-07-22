/**
 * src/services/webhookService.js
 * Webhook registration, delivery, retry with exponential backoff,
 * dead letter queue, and Horizon SSE monitoring.
 *
 * Flow:
 *   1. Caller registers a webhook via `registerWebhook(publicKey, url, secret)`.
 *   2. The raw secret is never stored; a keyed HMAC-SHA256 digest is persisted
 *      in SQLite (db/webhookDb.js) instead.
 *   3. The service starts a Horizon SSE stream for that public key (if not
 *      already monitoring it).
 *   4. When a `payment.received` event arrives it is delivered to every
 *      registered URL for that account, signed with HMAC-SHA256.
 *   5. Failed deliveries are retried with exponential backoff (1s, 5s, 25s, 125s, 625s).
 *   6. After MAX_RETRIES failures, delivery is marked dead in the dead letter queue.
 *   7. A background worker runs every 30 seconds to surface pending retries.
 *   8. On server startup call `restoreWebhooks()` to reload all active
 *      registrations and re-establish Horizon SSE streams.
 *
 * Security:
 *   - Secrets are stored as HMAC-SHA256(WEBHOOK_SECRET_KEY, id:secret) — a keyed
 *     digest, never the raw value.
 *   - Delivery signatures use the caller-supplied secret held in memory for
 *     this process lifetime; only the hash persists to disk.
 *   - Payloads are signed; consumers must reject requests with invalid sigs.
 *   - Delivery errors are logged but do not crash the process.
 *
 * NOTE: Because delivery requires the original plaintext secret, the in-memory
 * Map holds the raw secret for webhooks registered in the current process.
 * Webhooks reloaded on restart cannot sign payloads until the merchant
 * re-registers. This is a deliberate security trade-off: never store plaintext
 * secrets on disk.
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
const webhookDb = require("../../db/webhookDb");
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

/**
 * Server-side secret used to produce the stored hash.
 * Must be set in the environment; defaults to a generated value that won't
 * survive restarts — force explicit configuration in production.
 */
const WEBHOOK_SECRET_KEY =
  process.env.WEBHOOK_SECRET_KEY || crypto.randomBytes(32).toString("hex");

/**
 * In-memory store for webhooks registered in the current process.
 * Includes the raw `secret` so outgoing payloads can be signed.
 *
 * @type {Map<string, {id:string, publicKey:string, url:string, secret:string|null, createdAt:string}>}
 */
const webhooks = new Map();

/** @type {Map<string, Function>} Active Horizon SSE close handles keyed by publicKey */
const activeStreams = new Map();

/** @type {Set<Promise<void>>} In-flight webhook delivery requests, tracked for graceful shutdown */
const pendingDeliveries = new Set();

let retryWorkerTimer = null;

// ─── Secret hashing ───────────────────────────────────────────────────────────

/**
 * Produce a deterministic HMAC-SHA256 hash of `secret` keyed by `id`.
 * This is what gets written to the database — never the raw secret.
 *
 * @param {string} id
 * @param {string} secret
 * @returns {string} hex digest
 */
function hashSecret(id, secret) {
  return crypto
    .createHmac("sha256", WEBHOOK_SECRET_KEY)
    .update(`${id}:${secret}`)
    .digest("hex");
}

// ─── ID generation ────────────────────────────────────────────────────────────

/**
 * Generate a collision-resistant webhook ID.
 * Uses crypto.randomUUID() so IDs survive process restarts without a counter.
 *
 * @returns {string}
 */
function generateId() {
  return crypto.randomUUID();
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register a new webhook for a Stellar public key.
 *
 * Persists the registration to SQLite (secret stored as a keyed hash), keeps
 * the raw secret in memory for this process lifetime, and starts a Horizon
 * SSE monitor for the account if none is already active.
 *
 * ⚠️  Session-scoped secret: the signing secret is held in memory only and is
 * never written to disk. If the server restarts, Horizon SSE monitoring
 * resumes automatically but signed delivery requires the merchant to
 * re-register the webhook (providing the secret again).
 *
 * @param {string} publicKey - Stellar public key to monitor (G…)
 * @param {string} url       - HTTPS endpoint that will receive POST payloads
 * @param {string} secret    - Shared secret used to compute HMAC-SHA256 signatures
 * @returns {{ id:string, publicKey:string, url:string, createdAt:string }}
 */
function registerWebhook(publicKey, url, secret) {
  const id = generateId();
  const createdAt = new Date().toISOString();
  const secretHash = hashSecret(id, secret);

  // Persist to SQLite (hash only, never plaintext secret)
  webhookDb.insertWebhook({ id, publicKey, url, secretHash, createdAt });

  // Keep the plaintext secret in-memory for signed delivery this session
  const webhook = { id, publicKey, url, secret, createdAt };
  webhooks.set(id, webhook);

  startMonitoring(webhook);
  logger.info({ type: "webhook_registered", id, publicKey, url });
  return { id, publicKey, url, createdAt };
}

/**
 * Return all active webhooks registered for `publicKey`.
 * Data is read from the database so results survive restarts.
 *
 * @param {string} publicKey
 * @returns {Array<{id:string, publicKey:string, url:string, createdAt:string}>}
 */
function getWebhooksByPublicKey(publicKey) {
  return webhookDb.getByPublicKey(publicKey);
}

/**
 * Delete (soft-deactivate) a webhook by ID.
 * Also removes the in-memory entry.
 *
 * @param {string} id
 * @returns {boolean} `true` if the webhook existed and was deactivated
 */
function deleteWebhook(id) {
  const deleted = webhookDb.deactivate(id);
  if (deleted) {
    webhooks.delete(id);
    logger.info({ type: "webhook_deleted", id });
  }
  return deleted;
}

/**
 * Get a webhook by ID from the in-memory store (used for delivery retries).
 *
 * @param {string} id
 * @returns {{ id:string, publicKey:string, url:string, secret:string|null }|undefined}
 */
function getWebhookById(id) {
  return webhooks.get(id);
}

/**
 * Reload all active webhook registrations from the database and re-establish
 * Horizon SSE streams for each unique public key.
 *
 * Call this once during server startup. Because the raw secrets are not
 * persisted, reloaded webhooks can monitor for events but cannot sign delivery
 * payloads — the merchant will need to re-register to restore signing.
 *
 * @returns {number} Count of unique accounts for which streams were started.
 */
function restoreWebhooks() {
  const rows = webhookDb.getAllActive();
  let restored = 0;
  const seenKeys = new Set();

  for (const row of rows) {
    // Re-populate in-memory map without a plaintext secret (delivery is
    // gated on having the secret; see deliverWebhook).
    if (!webhooks.has(row.id)) {
      webhooks.set(row.id, {
        id: row.id,
        publicKey: row.publicKey,
        url: row.url,
        secret: null, // plaintext not persisted by design
        createdAt: row.createdAt,
      });
    }

    if (!seenKeys.has(row.publicKey)) {
      seenKeys.add(row.publicKey);
      startMonitoring({ publicKey: row.publicKey });
      restored++;
    }
  }

  logger.info({ type: "webhooks_restored", count: rows.length, streams: restored });
  return restored;
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
 * Attempt a single HTTP delivery of a signed webhook payload.
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
 * Manages retry logic with exponential backoff via handleDeliveryFailure.
 *
 * Webhooks with a null secret (restored from DB without plaintext) are
 * skipped — they cannot produce a valid signature.
 *
 * @param {{ id:string, url:string, secret:string|null, attempts?: number }} webhook
 * @param {object} payload
 * @param {string} [eventType]
 * @returns {Promise<void>}
 */
async function deliverWebhook(webhook, payload, eventType = "payment.received") {
  if (!webhook.secret) {
    logger.warn({
      type: "webhook_delivery_skipped",
      id: webhook.id,
      reason: "secret_not_available_after_restart",
    });
    return;
  }

  const span = tracer.startSpan("webhook.delivery");
  span.setAttributes({
    "webhook.id": webhook.id,
    "webhook.url": webhook.url,
    "event.type": eventType,
  });

  try {
    const result = await attemptDelivery(webhook, payload);

    if (result.ok) {
      logger.info({ type: "webhook_delivered", id: webhook.id, url: webhook.url });
      span.setStatus({ code: 1 });
    } else {
      handleDeliveryFailure(webhook, payload, eventType, result.error, span);
    }
  } catch (err) {
    handleDeliveryFailure(webhook, payload, eventType, err.message, span);
  } finally {
    span.end();
  }
}

/**
 * Handle a failed delivery by scheduling a retry with exponential backoff.
 * After MAX_RETRIES failures, logs the delivery as dead.
 *
 * @param {{ id:string, url:string, attempts?: number }} webhook
 * @param {object} payload
 * @param {string} eventType
 * @param {string} errorMsg
 * @param {object} span - OpenTelemetry span
 */
function handleDeliveryFailure(webhook, payload, eventType, errorMsg, span) {
  const currentAttempt = (webhook.attempts || 0) + 1;
  webhook.attempts = currentAttempt;

  if (currentAttempt >= MAX_RETRIES) {
    logger.error({
      type: "webhook_delivery_dead",
      id: webhook.id,
      url: webhook.url,
      error: errorMsg,
      attempts: currentAttempt,
    });
    span.setStatus({ code: 2, message: `Delivery dead after ${currentAttempt} attempts: ${errorMsg}` });
  } else {
    const nextRetryMs = RETRY_INTERVALS[Math.min(currentAttempt - 1, RETRY_INTERVALS.length - 1)];
    logger.warn({
      type: "webhook_delivery_retry_scheduled",
      id: webhook.id,
      url: webhook.url,
      error: errorMsg,
      attempt: currentAttempt,
      nextRetryMs,
    });
    span.setStatus({ code: 2, message: `Retry ${currentAttempt}/${MAX_RETRIES}: ${errorMsg}` });
    setTimeout(() => {
      const promise = deliverWebhook(webhook, payload, eventType).finally(() =>
        pendingDeliveries.delete(promise),
      );
      pendingDeliveries.add(promise);
    }, nextRetryMs);
  }
}

// ─── Retry Worker ─────────────────────────────────────────────────────────────

/**
 * Start the background retry worker that periodically logs a heartbeat tick.
 * Actual retries are scheduled inline via setTimeout in handleDeliveryFailure.
 */
function startRetryWorker() {
  if (retryWorkerTimer) return;
  retryWorkerTimer = setInterval(() => {
    logger.debug({ type: "retry_worker_tick" });
  }, RETRY_WORKER_INTERVAL);
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
 * Return in-memory webhooks for `publicKey` that have exhausted all retries.
 *
 * @param {string} publicKey
 * @returns {Array}
 */
function getDeadDeliveries(publicKey) {
  return Array.from(webhooks.values()).filter(
    (w) => w.publicKey === publicKey && (w.attempts || 0) >= MAX_RETRIES,
  );
}

/**
 * Reset attempt counters for dead deliveries so they become eligible again.
 *
 * @param {string} publicKey
 * @returns {{ reset: number }}
 */
function retryDeadDeliveries(publicKey) {
  let count = 0;
  for (const w of webhooks.values()) {
    if (w.publicKey === publicKey && (w.attempts || 0) >= MAX_RETRIES) {
      w.attempts = 0;
      count++;
    }
  }
  logger.info({ type: "webhook_dead_deliveries_reset", publicKey, count });
  return { reset: count };
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
            asset: payment.asset_type === "native" ? "XLM" : payment.asset_code,
            createdAt: payment.created_at,
          },
        };

        // Fetch live in-memory entries (includes plaintext secrets when available)
        const hooks = Array.from(webhooks.values()).filter(
          (w) => w.publicKey === webhook.publicKey,
        );
        // Deliver in parallel; individual failures are handled in deliverWebhook.
        // Each delivery is tracked in pendingDeliveries for graceful shutdown.
        const deliveries = hooks.map((h) => {
          const promise = deliverWebhook(h, payload, "payment.received").finally(() =>
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
  restoreWebhooks,
  signPayload,
  deliverWebhook,
  getDeadDeliveries,
  retryDeadDeliveries,
  startRetryWorker,
  stopRetryWorker,
  closeAllStreams,
};
