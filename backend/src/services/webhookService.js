/**
 * src/services/webhookService.js
 * Webhook registration, delivery, and Horizon SSE monitoring.
 *
 * Webhooks let external services (e.g. a merchant backend) receive a POST
 * notification whenever a registered Stellar account receives a payment.
 *
 * Flow:
 *   1. Caller registers a webhook via `registerWebhook(publicKey, url, secret)`.
 *   2. The service starts a Horizon SSE stream for that public key (if not
 *      already monitoring it).
 *   3. When a `payment.received` event arrives it is delivered to every
 *      registered URL for that account, signed with HMAC-SHA256.
 *   4. Consumers verify the signature using the shared secret:
 *        expected = HMAC-SHA256(secret, JSON.stringify(payload))
 *        compare  = received X-Webhook-Signature header
 *
 * Security:
 *   - Payloads are signed; consumers must reject requests with invalid sigs.
 *   - Secrets should be long random strings (>= 32 bytes); never logged.
 *   - Delivery errors are logged but do not crash the process.
 */

"use strict";

const crypto = require("crypto");
const { Horizon } = require("@stellar/stellar-sdk");
const logger = require("../utils/logger");
const metrics = require("./metricsService");
const { getRequestIdHeader } = require("../utils/correlationId");
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

/** @type {Map<string, {id:string,publicKey:string,url:string,secret:string,createdAt:string}>} */
const webhooks = new Map();
let nextId = 1;

/** @type {Map<string, Function>} Active Horizon SSE close-stream handles keyed by publicKey */
const activeStreams = new Map();

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register a new webhook for a Stellar public key.
 *
 * Starts a Horizon SSE monitor for the account if none is already active.
 * The same account can have multiple webhook URLs.
 *
 * @param {string} publicKey - Stellar public key to monitor (G…)
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

// ─── Signature ────────────────────────────────────────────────────────────────

/**
 * Compute the HMAC-SHA256 signature for a payload.
 *
 * @param {string} secret
 * @param {object} payload - Will be JSON.stringify'd before signing
 * @returns {string} Hex-encoded digest
 */
function signPayload(secret, payload) {
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

/**
 * Deliver a signed webhook payload to a single registered endpoint.
 *
 * Errors are caught and logged; they do not propagate to the caller so that
 * one failing endpoint does not block delivery to others.
 *
 * @param {{ id:string, url:string, secret:string }} webhook
 * @param {object} payload
 * @returns {Promise<void>}
 */
async function deliverWebhook(webhook, payload) {
  const signature = signPayload(webhook.secret, payload);
  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        ...getRequestIdHeader(),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.error({
        type: "webhook_delivery_failed",
        id: webhook.id,
        status: res.status,
        url: webhook.url,
      });
    } else {
      logger.info({ type: "webhook_delivered", id: webhook.id, url: webhook.url });
    }
  } catch (err) {
    logger.error({
      type: "webhook_delivery_error",
      id: webhook.id,
      url: webhook.url,
      error: err.message,
    });
  }
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
        // Deliver in parallel; individual failures are swallowed in deliverWebhook.
        await Promise.allSettled(hooks.map((h) => deliverWebhook(h, payload)));
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

module.exports = { registerWebhook, getWebhooksByPublicKey, deleteWebhook, signPayload };
