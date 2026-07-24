/**
 * src/services/webhookService.js
 *
 * Webhook registration, delivery, retry with exponential backoff, dead
 * letter queue, and Horizon SSE monitoring.
 *
 * Storage: Knex (the project's standard database abstraction). Earlier
 * revisions used better-sqlite3 prepared statements; the migration to
 * Knex was incomplete and left a hybrid implementation behind, so this
 * rewrite consolidates every read/write through `knex("table_name")` so
 * the same code path works on both SQLite and PostgreSQL.
 *
 * Flow:
 *   1. Caller registers a webhook via `registerWebhook(publicKey, url, secret)`.
 *   2. The service starts a Horizon SSE stream for that public key.
 *   3. When a `payment.received` event arrives it is delivered to every
 *      registered URL for that account, signed with HMAC-SHA256.
 *   4. Failed deliveries are retried with exponential backoff
 *      (1s, 5s, 25s, 125s, 625s).
 *   5. After 5 failures the delivery is marked 'dead' in the dead letter
 *      queue.
 *   6. A background worker runs every 30 seconds to retry pending
 *      deliveries.
 *
 * Security:
 *   - Payloads are signed using HMAC-SHA256; consumers verify via
 *     X-Webhook-Signature.
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
const knex = require("../db/connection");
require("dotenv").config();

// Lazy-loaded to avoid circular dependency at parse time
function getCache() {
  try {
    return require("./cacheService");
  } catch {
    return null;
  }
}

const HORIZON_URL =
  process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_URL);

const MAX_RETRIES = 5;
const RETRY_INTERVALS = [1000, 5000, 25000, 125000, 625000];
const RETRY_WORKER_INTERVAL = 30000;

/** In-process cache of the most recently registered webhooks (by id). The DB
 *  is the source of truth — this Map just gives the SSE delivery path a
 *  cheap way to resolve `id → secret + url` without a SELECT per payment. */
const webhooks = new Map();

/** Active Horizon SSE close-stream handles keyed by publicKey. */
const activeStreams = new Map();

/** In-flight webhook deliveries, tracked for graceful shutdown. */
const pendingDeliveries = new Set();

let retryWorkerTimer = null;

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register a new webhook for a Stellar public key.
 *
 * @param {string} publicKey - Stellar public key to monitor (G...)
 * @param {string} url - HTTPS endpoint that will receive POST payloads
 * @param {string} secret - Shared secret used to compute HMAC-SHA256 signatures
 * @returns {Promise<{ id, publicKey, url, createdAt }>}
 */
async function registerWebhook(publicKey, url, secret) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await knex("webhooks").insert({
    id,
    public_key: publicKey,
    url,
    secret,
    created_at: createdAt,
  });

  const webhook = { id, publicKey, url, secret, createdAt };
  webhooks.set(id, webhook);
  startMonitoring(webhook);
  logger.info({ type: "webhook_registered", id, publicKey, url });
  return { id, publicKey, url, createdAt };
}

/**
 * Return all webhooks registered for `publicKey`.
 */
async function getWebhooksByPublicKey(publicKey) {
  const rows = await knex("webhooks").where("public_key", publicKey);
  return rows.map((row) => ({
    id: row.id,
    publicKey: row.public_key,
    url: row.url,
    createdAt: row.created_at,
  }));
}

/**
 * Delete a webhook by ID.
 *
 * @returns {Promise<boolean>} true if the webhook existed and was deleted
 */
async function deleteWebhook(id) {
  const deleted = await knex("webhooks").where("id", id).del();
  webhooks.delete(id);
  if (deleted) {
    logger.info({ type: "webhook_deleted", id });
    return true;
  }
  return false;
}

/**
 * Look up a webhook by ID. Falls back to the database if the in-process
 * cache hasn't seen it yet (e.g. a retry worker replaying a delivery
 * recorded by another process).
 */
async function getWebhookById(id) {
  if (webhooks.has(id)) return webhooks.get(id);
  const row = await knex("webhooks").where("id", id).first();
  if (!row) return null;
  const webhook = {
    id: row.id,
    publicKey: row.public_key,
    url: row.url,
    secret: row.secret,
    createdAt: row.created_at,
  };
  webhooks.set(id, webhook);
  return webhook;
}

// ─── Signature ────────────────────────────────────────────────────────────────

function signPayload(secret, payload) {
  return generateWebhookSignature(payload, secret);
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

/**
 * Attempt to deliver a signed webhook payload to a single endpoint.
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
 * Creates a delivery record and manages retry logic with exponential
 * backoff.
 */
async function deliverWebhook(webhook, payload, eventType = "payment.received") {
  const span = tracer.startSpan("webhook.delivery");
  span.setAttributes({
    "webhook.id": webhook.id,
    "webhook.url": webhook.url,
    "event.type": eventType,
  });

  const deliveryId = crypto.randomUUID();
  const payloadStr = JSON.stringify(payload);

  try {
    await knex("webhook_deliveries").insert({
      id: deliveryId,
      webhook_id: webhook.id,
      event_type: eventType,
      payload: payloadStr,
      status: "pending",
      attempts: 0,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({
      type: "webhook_delivery_db_error",
      id: deliveryId,
      error: err.message,
    });
    span.recordException(err);
    span.end();
    return;
  }

  try {
    const result = await attemptDelivery(webhook, payload);

    if (result.ok) {
      await knex("webhook_deliveries")
        .where("id", deliveryId)
        .update({
          status: "delivered",
          last_attempt_at: new Date().toISOString(),
        });
      logger.info({
        type: "webhook_delivered",
        id: webhook.id,
        url: webhook.url,
        deliveryId,
      });
      span.setStatus({ code: 1 });
    } else {
      await handleDeliveryFailure(
        deliveryId,
        webhook,
        result.error,
      );
    }
  } catch (err) {
    await handleDeliveryFailure(deliveryId, webhook, err.message);
  } finally {
    span.end();
  }
}

/**
 * Handle a failed delivery by incrementing attempts and scheduling retry.
 * After MAX_RETRIES failures, marks the delivery as 'dead'.
 */
async function handleDeliveryFailure(deliveryId, webhook, errorMsg) {
  const currentAttempt = (webhook.attempts || 0) + 1;
  const nextRetryMs =
    RETRY_INTERVALS[Math.min(currentAttempt - 1, RETRY_INTERVALS.length - 1)];
  const nextRetryAt = new Date(Date.now() + nextRetryMs).toISOString();
  const isDead = currentAttempt >= MAX_RETRIES;

  try {
    await knex("webhook_deliveries").where("id", deliveryId).update({
      attempts: currentAttempt,
      last_attempt_at: new Date().toISOString(),
      last_error: errorMsg,
      next_retry_at: isDead ? null : nextRetryAt,
      status: isDead ? "dead" : "pending",
    });
  } catch (err) {
    logger.error({
      type: "webhook_retry_update_error",
      id: deliveryId,
      error: err.message,
    });
  }

  webhook.attempts = currentAttempt;

  if (isDead) {
    logger.error({
      type: "webhook_delivery_dead",
      id: webhook.id,
      deliveryId,
      url: webhook.url,
      error: errorMsg,
      attempts: currentAttempt,
    });
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
  }
}

// ─── Retry Worker ─────────────────────────────────────────────────────────────

/**
 * Process pending webhook deliveries that are due for retry.
 */
async function processRetryQueue() {
  try {
    const pending = await knex("webhook_deliveries")
      .where("status", "pending")
      .where("attempts", "<", MAX_RETRIES)
      .andWhere(function () {
        this.whereNull("next_retry_at").orWhere(
          "next_retry_at",
          "<=",
          new Date().toISOString(),
        );
      });

    for (const delivery of pending) {
      const webhook = await getWebhookById(delivery.webhook_id);
      if (!webhook) {
        logger.warn({
          type: "webhook_not_found_for_retry",
          deliveryId: delivery.id,
          webhookId: delivery.webhook_id,
        });
        continue;
      }

      let payload;
      try {
        payload = JSON.parse(delivery.payload);
      } catch {
        logger.error({
          type: "webhook_invalid_payload",
          deliveryId: delivery.id,
        });
        await handleDeliveryFailure(delivery.id, webhook, "Invalid payload");
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
          await knex("webhook_deliveries")
            .where("id", delivery.id)
            .update({
              status: "delivered",
              last_attempt_at: new Date().toISOString(),
            });
          logger.info({
            type: "webhook_retry_delivered",
            id: webhook.id,
            deliveryId: delivery.id,
            attempt: delivery.attempts + 1,
          });
          span.setStatus({ code: 1 });
        } else {
          await handleDeliveryFailure(delivery.id, webhook, result.error);
        }
      } catch (err) {
        await handleDeliveryFailure(delivery.id, webhook, err.message);
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
 */
async function getDeadDeliveries(publicKey) {
  return knex("webhook_deliveries as d")
    .join("webhooks as w", "d.webhook_id", "w.id")
    .where("w.public_key", publicKey)
    .andWhere("d.status", "dead")
    .orderBy("d.created_at", "desc")
    .select("d.*");
}

/**
 * Reset dead deliveries to pending status for manual retry.
 *
 * @returns {Promise<{ reset: number }>}
 */
async function retryDeadDeliveries(publicKey) {
  const ids = await knex("webhooks").where("public_key", publicKey).select("id");
  if (ids.length === 0) return { reset: 0 };
  const webhookIds = ids.map((r) => r.id);
  const count = await knex("webhook_deliveries")
    .whereIn("webhook_id", webhookIds)
    .andWhere("status", "dead")
    .update({
      status: "pending",
      attempts: 0,
      next_retry_at: null,
    });
  logger.info({
    type: "webhook_dead_deliveries_reset",
    publicKey,
    count,
  });
  return { reset: count };
}

// ─── Monitoring ───────────────────────────────────────────────────────────────

/**
 * Start a Horizon SSE stream for `webhook.publicKey` if one is not already
 * active. Incoming `payment` operations trigger delivery to all registered
 * URLs for that account.
 */
function startMonitoring(webhook) {
  metrics.horizonRequestsTotal.inc({
    operation: "startSSE",
    status: "success",
  });
  if (activeStreams.has(webhook.publicKey)) {
    return;
  }

  const closeStream = server
    .payments()
    .forAccount(webhook.publicKey)
    .cursor("now")
    .stream({
      onmessage: async (payment) => {
        if (payment.type !== "payment" || payment.to !== webhook.publicKey)
          return;

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

        const hooks = await getWebhooksByPublicKey(webhook.publicKey);
        const deliveries = hooks.map((h) => {
          const promise = deliverWebhook(h, payload, "payment.received").finally(
            () => pendingDeliveries.delete(promise),
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
  logger.info({
    type: "horizon_monitoring_started",
    publicKey: webhook.publicKey,
  });
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

/**
 * Close all active Horizon SSE streams and wait for in-flight deliveries.
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
