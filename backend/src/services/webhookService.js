/**
 * src/services/webhookService.js
 *
 * Webhook registration, delivery, retry with exponential backoff, dead
 * letter queue, and Horizon SSE monitoring.
 *
 * Storage: Knex (the project's standard database abstraction). Every
 * read/write goes through `knex("table_name")` so the same code path
 * works on both SQLite and PostgreSQL.
 *
 * Flow:
 *   1. Caller registers a webhook via `registerWebhook(publicKey, url, secret)`.
 *   2. The raw secret is never stored in plaintext; an AES-256-GCM ciphertext
 *      is persisted (for signing) and a keyed HMAC-SHA256 digest (secret_hash)
 *      is stored for verification without decryption.
 *   3. The service starts a Horizon SSE stream for that public key (if not
 *      already monitoring it).
 *   4. When a `payment.received` event arrives it is delivered to every
 *      registered URL for that account, signed with HMAC-SHA256.
 *   5. Failed deliveries are retried with exponential backoff
 *      (1s, 5s, 25s, 125s, 625s).
 *   6. After 5 failures the delivery is marked 'dead' in the dead letter
 *      queue.
 *   7. A background worker runs every 30 seconds to retry pending deliveries.
 *
 * Security:
 *   - Secrets are stored as AES-256-GCM ciphertext (via encryptSecret).
 *   - A keyed HMAC-SHA256 digest (secret_hash) is also stored for
 *     verification. Raw secrets are never written to disk.
 *   - Payloads are signed using HMAC-SHA256; consumers verify via
 *     X-Webhook-Signature.
 *   - Secrets should be long random strings (>= 32 bytes); never logged.
 *   - Delivery errors are logged but do not crash the process.
 *
 * NOTE: Because delivery requires the original plaintext secret, the in-memory
 * Map holds the raw secret for webhooks registered in the current process.
 * Webhooks reloaded on restart use the stored encrypted secret via
 * decryptSecret() — no re-registration required.
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
const { encryptSecret, decryptSecret } = require("../utils/encryption");
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

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_URL);

const MAX_RETRIES = parseInt(process.env.WEBHOOK_MAX_RETRIES, 10) || 6;
// Exponential backoff schedule in seconds: 1min, 5min, 15min, 1h, 6h, 24h.
const RETRY_INTERVALS_SECONDS = [60, 300, 900, 3600, 21600, 86400];
const RETRY_WORKER_INTERVAL = 30000;

/**
 * Server-side secret used to produce the stored HMAC-SHA256 hash.
 * Must be set in the environment; defaults to a generated value that won't
 * survive restarts — force explicit configuration in production.
 */
const WEBHOOK_SECRET_KEY = process.env.WEBHOOK_SECRET_KEY || crypto.randomBytes(32).toString("hex");

if (!process.env.WEBHOOK_SECRET_KEY && process.env.NODE_ENV !== "test") {
  logger.warn(
    "WEBHOOK_SECRET_KEY is not set — a random key will be used. " +
      "Stored secret hashes will not be reproducible across restarts. " +
      "Set WEBHOOK_SECRET_KEY in your environment for production use.",
  );
}

/** In-process cache of the most recently registered webhooks (by id). The DB
 *  is the source of truth — this Map just gives the SSE delivery path a
 *  cheap way to resolve `id → secret + url` without a SELECT per payment. */
/** @type {Map<string, {id:string,publicKey:string,url:string,secret:string,createdAt:string}>} */
const webhooks = new Map();

/** @type {Map<string, Function>} Active Horizon SSE close handles keyed by publicKey */
const activeStreams = new Map();

/** @type {Set<Promise<void>>} In-flight webhook delivery requests, tracked for graceful shutdown */
const pendingDeliveries = new Set();

let retryWorkerTimer = null;

// ─── Secret hashing ───────────────────────────────────────────────────────────

/**
 * Produce a deterministic HMAC-SHA256 hash of `secret` keyed by `id`.
 * This is stored alongside the encrypted secret so the hash can be
 * verified without decryption.
 *
 * @param {string} id
 * @param {string} secret
 * @returns {string} hex digest
 */
function hashSecret(id, secret) {
  return crypto.createHmac("sha256", WEBHOOK_SECRET_KEY).update(`${id}:${secret}`).digest("hex");
}

// ─── ID generation ────────────────────────────────────────────────────────────

/**
 * Generate a collision-resistant webhook ID.
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
 * Persists the registration to the database with the secret stored as
 * AES-256-GCM ciphertext and a keyed HMAC-SHA256 hash (for verification).
 * Keeps the raw secret in memory for this process lifetime and starts a
 * Horizon SSE monitor for the account if none is already active.
 *
 * @param {string} publicKey - Stellar public key to monitor (G...)
 * @param {string} url - HTTPS endpoint that will receive POST payloads
 * @param {string} secret - Shared secret used to compute HMAC-SHA256 signatures
 * @returns {Promise<{ id, publicKey, url, createdAt }>}
 */
async function registerWebhook(publicKey, url, secret) {
  const id = generateId();
  const createdAt = new Date().toISOString();
  const encryptedSecret = encryptSecret(secret);
  const secretHash = hashSecret(id, secret);

  await knex("webhooks").insert({
    id,
    public_key: publicKey,
    url,
    secret: encryptedSecret,
    secret_hash: secretHash,
    created_at: createdAt,
  });

  // Keep the plaintext secret in-memory for signed delivery this session
  const webhook = { id, publicKey, url, secret, createdAt };
  webhooks.set(id, webhook);
  startMonitoring(publicKey);
  logger.info({ type: "webhook_registered", id, publicKey, url });
  return { id, publicKey, url, createdAt };
}

/**
 * Return all webhooks registered for `publicKey` (secrets redacted).
 *
 * @param {string} publicKey
 * @returns {Promise<Array<{id:string,publicKey:string,url:string,createdAt:string}>>}
 */
async function getWebhooksByPublicKey(publicKey) {
  const rows = await knex("webhooks").where("public_key", publicKey).select("*");
  return rows.map((row) => ({
    id: row.id,
    publicKey: row.public_key,
    url: row.url,
    secret: "[protected]",
    createdAt: row.created_at,
  }));
}

/**
 * Delete a webhook by ID. Stops SSE monitoring if this was the last
 * webhook for the associated public key.
 *
 * @returns {Promise<boolean>} true if the webhook existed and was deleted
 */
async function deleteWebhook(id) {
  const webhook = webhooks.get(id);
  const publicKey = webhook ? webhook.publicKey : null;
  const deleted = await knex("webhooks").where("id", id).del();
  webhooks.delete(id);

  if (deleted) {
    logger.info({ type: "webhook_deleted", id });
    const remaining = Array.from(webhooks.values()).filter((w) => w.publicKey === publicKey);
    if (remaining.length === 0 && publicKey && activeStreams.has(publicKey)) {
      activeStreams.get(publicKey)();
      activeStreams.delete(publicKey);
      metrics.activeWebhookStreams.set(activeStreams.size);
      logger.info({ type: "horizon_monitoring_stopped", publicKey });
    }
    return true;
  }
  return false;
}

/**
 * Look up a webhook by ID. Falls back to the database if the in-process
 * cache hasn't seen it yet. Decrypts the stored secret so delivery can sign.
 *
 * @param {string} id
 * @returns {Promise<{id:string, publicKey:string, url:string, secret:string|null}|null>}
 */
async function getWebhookById(id) {
  if (webhooks.has(id)) return webhooks.get(id);
  const row = await knex("webhooks").where("id", id).first();
  if (!row) return null;
  const webhook = {
    id: row.id,
    publicKey: row.public_key,
    url: row.url,
    secret: row.secret, // encrypted; decryptSecret() called at delivery time
    createdAt: row.created_at,
  };
  webhooks.set(id, webhook);
  return webhook;
}

/**
 * Reload all webhook registrations from the database and re-establish
 * Horizon SSE streams for each unique public key.
 *
 * Call this once during server startup. Secrets are decrypted at delivery
 * time via decryptSecret() — no re-registration required after restart.
 *
 * @returns {Promise<number>} Count of unique accounts for which streams were started.
 */
async function restoreWebhooks() {
  const rows = await knex("webhooks").select("*");
  let restored = 0;
  const seenKeys = new Set();

  for (const row of rows) {
    if (!webhooks.has(row.id)) {
      webhooks.set(row.id, {
        id: row.id,
        publicKey: row.public_key,
        url: row.url,
        secret: row.secret, // encrypted; decryptSecret() called at delivery time
        createdAt: row.created_at,
      });
    }

    if (!seenKeys.has(row.public_key)) {
      seenKeys.add(row.public_key);
      startMonitoring({ publicKey: row.public_key });
      restored++;
    }
  }

  logger.info({ type: "webhooks_restored", count: rows.length, streams: restored });
  return restored;
}

// ─── Signature ────────────────────────────────────────────────────────────────

/**
 * Compute the HMAC-SHA256 signature for a payload.
 *
 * @param {string} secret
 * @param {object} payload
 * @returns {string} Hex-encoded digest
 */
function signPayload(secret, payload) {
  return generateWebhookSignature(payload, secret);
}

function generateIdempotencyKey(webhookId, eventType, payloadStr, timestamp) {
  return crypto
    .createHash("sha256")
    .update(webhookId + eventType + payloadStr + timestamp)
    .digest("hex");
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

/**
 * Attempt to deliver a signed webhook payload to a single endpoint.
 */
async function attemptDelivery(webhook, payload, idempotencyKey) {
  const plainSecret = decryptSecret(webhook.secret);
  const signature = signPayload(plainSecret, payload);
  const headers = {
    "Content-Type": "application/json",
    "X-Webhook-Signature": signature,
    "X-Idempotency-Key": idempotencyKey || "legacy-retry",
    ...getRequestIdHeader(),
  };

  propagation.inject(context.active(), headers);

  const res = await fetch(webhook.url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return { ok: true };
}

/**
 * Deliver a signed webhook payload to a single registered endpoint.
 * Creates a delivery record and manages retry logic with exponential backoff.
 */
async function deliverWebhook(webhook, payload, eventType = "payment.received") {
  if (!webhook.secret) {
    logger.warn({
      type: "webhook_delivery_skipped",
      id: webhook.id,
      reason: "secret_not_available",
    });
    return;
  }

  const span = tracer.startSpan("webhook.delivery");
  span.setAttributes({
    "webhook.id": webhook.id,
    "webhook.url": webhook.url,
    "event.type": eventType,
  });

  const deliveryId = crypto.randomUUID();
  const payloadStr = JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const idempotencyKey = generateIdempotencyKey(webhook.id, eventType, payloadStr, timestamp);

  try {
    await knex("webhook_events").insert({
      id: crypto.randomUUID(),
      webhook_id: webhook.id,
      event_type: eventType,
      payload: payloadStr,
      idempotency_key: idempotencyKey,
      created_at: timestamp,
    });
  } catch (err) {
    if (err.code !== "23505" && err.code !== "SQLITE_CONSTRAINT") {
      logger.error({
        type: "webhook_event_db_error",
        webhookId: webhook.id,
        error: err.message,
      });
    }
  }

  try {
    await knex("webhook_deliveries").insert({
      id: deliveryId,
      webhook_id: webhook.id,
      event_type: eventType,
      payload: payloadStr,
      idempotency_key: idempotencyKey,
      status: "pending",
      attempts: 0,
      created_at: timestamp,
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
    const result = await attemptDelivery(webhook, payload, idempotencyKey);
    if (result.ok) {
      await knex("webhook_deliveries")
        .where("id", deliveryId)
        .update({ status: "delivered", last_attempt_at: new Date().toISOString() });
      await knex("webhook_events")
        .where("idempotency_key", idempotencyKey)
        .update({ delivered_at: new Date().toISOString() });
      logger.info({ type: "webhook_delivered", id: webhook.id, url: webhook.url, deliveryId });
      span.setStatus({ code: 1 });
    } else {
      await handleDeliveryFailure(deliveryId, webhook, result.error, payload);
    }
  } catch (err) {
    await handleDeliveryFailure(deliveryId, webhook, err.message, payload);
  } finally {
    span.end();
  }
}

async function writeToDeadLetterQueue(deliveryId, webhook, payload, errorMsg, retryTimestamps) {
  try {
    await knex("dead_letter_queue").insert({
      id: crypto.randomUUID(),
      delivery_id: deliveryId,
      webhook_id: webhook.id,
      payload: typeof payload === "string" ? payload : JSON.stringify(payload),
      retry_timestamps: JSON.stringify(retryTimestamps),
      final_error: errorMsg,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ type: "webhook_dlq_insert_error", id: deliveryId, error: err.message });
  }
}

/**
 * Handle a failed delivery by incrementing attempts and scheduling retry.
 * After MAX_RETRIES failures, marks the delivery as 'dead' and writes to DLQ.
 */
async function handleDeliveryFailure(deliveryId, webhook, errorMsg, payload) {
  const currentAttempt = (webhook.attempts || 0) + 1;
  const nextRetrySeconds =
    RETRY_INTERVALS_SECONDS[Math.min(currentAttempt - 1, RETRY_INTERVALS_SECONDS.length - 1)];
  const nextRetryAt = new Date(Date.now() + nextRetrySeconds * 1000).toISOString();
  const isDead = currentAttempt >= MAX_RETRIES;
  const now = new Date().toISOString();

  try {
    await knex("webhook_deliveries")
      .where("id", deliveryId)
      .update({
        attempts: currentAttempt,
        retry_attempts: currentAttempt,
        last_attempt_at: now,
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
    let retryTimestamps = [];
    try {
      const row = await knex("webhook_deliveries").where("id", deliveryId).first();
      retryTimestamps = row ? [{ attempt: currentAttempt, at: now, error: errorMsg }] : [];
    } catch {
      /* best effort */
    }
    await writeToDeadLetterQueue(deliveryId, webhook, payload, errorMsg, retryTimestamps);
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
        this.whereNull("next_retry_at").orWhere("next_retry_at", "<=", new Date().toISOString());
      })
      .orderBy([
        { column: "delivery_priority", order: "desc" },
        { column: "attempts", order: "asc" },
        { column: "next_retry_at", order: "asc" },
      ])
      .limit(50);
    for (const delivery of pending) {
      const webhook = await getWebhookById(delivery.webhook_id);
      if (!webhook) continue;

      let payload;
      try {
        payload = JSON.parse(delivery.payload);
      } catch {
        await handleDeliveryFailure(delivery.id, webhook, "Invalid payload", delivery.payload);
        continue;
      }
      const span = tracer.startSpan("webhook.retry");
      span.setAttributes({
        "webhook.id": webhook.id,
        "delivery.id": delivery.id,
        "delivery.attempts": delivery.attempts,
      });

      try {
        const result = await attemptDelivery(webhook, payload, delivery.idempotency_key);
        if (result.ok) {
          await knex("webhook_deliveries")
            .where("id", delivery.id)
            .update({ status: "delivered", last_attempt_at: new Date().toISOString() });
          if (delivery.idempotency_key) {
            await knex("webhook_events")
              .where("idempotency_key", delivery.idempotency_key)
              .update({ delivered_at: new Date().toISOString() });
          }
          logger.info({
            type: "webhook_retry_delivered",
            id: webhook.id,
            deliveryId: delivery.id,
            attempt: delivery.attempts + 1,
          });
          span.setStatus({ code: 1 });
        } else {
          await handleDeliveryFailure(delivery.id, webhook, result.error, payload);
        }
      } catch (err) {
        await handleDeliveryFailure(delivery.id, webhook, err.message, payload);
      } finally {
        span.end();
      }
    }
  } catch (err) {
    logger.error({ type: "retry_worker_error", error: err.message });
  }
}

/**
 * Start the background retry worker.
 */
function startRetryWorker() {
  if (retryWorkerTimer) return;
  retryWorkerTimer = setInterval(() => {
    const promise = processRetryQueue().catch((err) =>
      logger.error({ type: "retry_worker_error", error: err.message }),
    );
    pendingDeliveries.add(promise);
    promise.finally(() => pendingDeliveries.delete(promise));
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
 * Reset attempt counters for dead deliveries so they become eligible again.
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
    .update({ status: "pending", attempts: 0, next_retry_at: null });
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
  if (activeStreams.has(webhook.publicKey)) return;
  const closeStream = server
    .payments()
    .forAccount(webhook.publicKey)
    .cursor("now")
    .stream({
      onmessage: async (payment) => {
        if (payment.type !== "payment" || payment.to !== webhook.publicKey) return;
        try {
          const cache = getCache();
          if (cache) {
            await cache.del(`account:${webhook.publicKey}`);
            await cache.delPattern(`payments:${webhook.publicKey}:*`);
          }
        } catch {
          /* cache clear failure is non-critical */
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
        const hooks = await getWebhooksByPublicKey(webhook.publicKey);
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
 * @param {number} [timeoutMs=5000]
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

// ─── Event Replay & Querying ──────────────────────────────────────────────────

async function getEvents(publicKey, { since, until, type, limit = 50, cursor } = {}) {
  const query = knex("webhook_events as e")
    .join("webhooks as w", "e.webhook_id", "w.id")
    .where("w.public_key", publicKey)
    .orderBy("e.created_at", "desc")
    .select("e.*");
  if (since) query.andWhere("e.created_at", ">=", since);
  if (until) query.andWhere("e.created_at", "<=", until);
  if (type) query.andWhere("e.event_type", type);
  if (cursor) query.andWhere("e.id", "<", cursor);
  query.limit(limit);
  return query;
}

async function replayEvents(publicKey, { eventIds, since, until }) {
  const query = knex("webhook_events as e")
    .join("webhooks as w", "e.webhook_id", "w.id")
    .where("w.public_key", publicKey)
    .select("e.*");
  if (eventIds && eventIds.length > 0) {
    query.whereIn("e.id", eventIds);
  } else {
    if (since) query.andWhere("e.created_at", ">=", since);
    if (until) query.andWhere("e.created_at", "<=", until);
  }
  const eventsToReplay = await query;
  if (!eventsToReplay.length) return { replayed: 0 };
  let replayCount = 0;
  for (const event of eventsToReplay) {
    const webhook = await getWebhookById(event.webhook_id);
    if (!webhook) continue;
    const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
    deliverWebhook(webhook, payload, event.event_type);
    replayCount++;
  }
  return { replayed: replayCount };
}

async function getEventStats(publicKey) {
  return knex("webhook_events as e")
    .join("webhooks as w", "e.webhook_id", "w.id")
    .where("w.public_key", publicKey)
    .groupBy("e.event_type")
    .select("e.event_type")
    .count("e.id as count");
}

// ─── Delivery Status Query API ────────────────────────────────────────────────

async function getDeliveries(publicKey, { status, page = 1, limit = 20 } = {}) {
  const offset = (Math.max(1, page) - 1) * limit;
  const base = knex("webhook_deliveries as d")
    .join("webhooks as w", "d.webhook_id", "w.id")
    .where("w.public_key", publicKey);
  if (status) base.andWhere("d.status", status);

  const [rows, [{ count }]] = await Promise.all([
    base
      .clone()
      .orderBy([
        { column: "d.delivery_priority", order: "desc" },
        { column: "d.created_at", order: "desc" },
      ])
      .limit(limit)
      .offset(offset)
      .select("d.*"),
    base.clone().count("d.id as count"),
  ]);

  return { deliveries: rows, total: parseInt(count, 10), page: Number(page), limit: Number(limit) };
}

async function getDeliveryById(publicKey, id) {
  const delivery = await knex("webhook_deliveries as d")
    .join("webhooks as w", "d.webhook_id", "w.id")
    .where("w.public_key", publicKey)
    .andWhere("d.id", id)
    .select("d.*")
    .first();
  return delivery || null;
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
  getEvents,
  replayEvents,
  getEventStats,
  processRetryQueue,
  getDeliveries,
  getDeliveryById,
  restoreWebhooks,
  MAX_RETRIES,
  RETRY_INTERVALS_SECONDS,
};
