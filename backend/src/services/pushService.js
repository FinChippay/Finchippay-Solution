/**
 * src/services/pushService.js
 * Web Push delivery and subscription storage.
 *
 * Subscriptions live in the push_subscriptions table (migration 009). Sending
 * is best-effort by design: a push failure must never fail the financial
 * operation that triggered it, so callers get a summary rather than a throw.
 *
 * VAPID keys come from the environment (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 * VAPID_SUBJECT). When they are absent the service degrades to a no-op and
 * says so once, which keeps dev and CI runnable without keys.
 */

"use strict";

const webpush = require("web-push");
const knex = require("../db/connection");
const logger = require("../utils/logger");

const TABLE = "push_subscriptions";

/**
 * Status codes a push service returns when a subscription is permanently
 * dead: the user cleared site data, uninstalled the PWA, or the endpoint
 * expired. Anything else (429, 5xx, network) may be transient and is kept.
 */
const GONE_STATUS_CODES = new Set([404, 410]);

let vapidConfigured = null;

/**
 * Configure web-push from the environment, once.
 *
 * Read lazily rather than at import time so tests and scripts can set the
 * variables after requiring the module.
 *
 * @returns {boolean} true when VAPID keys are available.
 */
function ensureVapidConfigured() {
  if (vapidConfigured !== null) return vapidConfigured;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:support@finchippay.com";

  if (!publicKey || !privateKey) {
    logger.warn(
      "VAPID keys are not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). " +
        "Push notifications are disabled.",
    );
    vapidConfigured = false;
    return vapidConfigured;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  } catch (err) {
    // Malformed keys throw here rather than at send time. Treat as disabled
    // so a bad deploy degrades instead of erroring on every notification.
    logger.error({ err }, "Invalid VAPID configuration; push notifications are disabled");
    vapidConfigured = false;
  }

  return vapidConfigured;
}

/** Test seam: forget the cached VAPID decision. */
function resetVapidConfigForTests() {
  vapidConfigured = null;
}

/**
 * Whether push sending is currently possible.
 * @returns {boolean}
 */
function isPushEnabled() {
  return ensureVapidConfigured();
}

/**
 * The public VAPID key, for the frontend's applicationServerKey.
 * @returns {string|null}
 */
function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Validate the shape of a PushSubscription sent by a browser.
 *
 * @param {unknown} subscription
 * @returns {boolean}
 */
function isValidSubscription(subscription) {
  return Boolean(
    subscription &&
    typeof subscription === "object" &&
    typeof subscription.endpoint === "string" &&
    subscription.endpoint.startsWith("https://") &&
    subscription.keys &&
    typeof subscription.keys.p256dh === "string" &&
    typeof subscription.keys.auth === "string",
  );
}

/**
 * Store a subscription for an account, or move an existing endpoint to it.
 *
 * Idempotent: re-subscribing the same browser updates the keys instead of
 * creating duplicate rows, because browsers may rotate keys for a stable
 * endpoint.
 *
 * @param {string} publicKey  Stellar account the device belongs to.
 * @param {object} subscription  PushSubscription JSON from the browser.
 * @returns {Promise<{created: boolean}>}
 */
async function addSubscription(publicKey, subscription) {
  if (!publicKey) throw new Error("publicKey is required");
  if (!isValidSubscription(subscription)) {
    throw new Error("A valid push subscription is required");
  }

  const { endpoint } = subscription;
  const { p256dh, auth } = subscription.keys;

  const existing = await knex(TABLE).where({ endpoint }).first();

  if (existing) {
    await knex(TABLE).where({ id: existing.id }).update({ public_key: publicKey, p256dh, auth });
    return { created: false };
  }

  await knex(TABLE).insert({
    public_key: publicKey,
    endpoint,
    p256dh,
    auth,
  });

  return { created: true };
}

/**
 * Remove one device's subscription for an account.
 *
 * Scoped by public_key as well as endpoint so one account cannot delete
 * another account's subscription by guessing an endpoint.
 *
 * @param {string} publicKey
 * @param {string} endpoint
 * @returns {Promise<{removed: number}>}
 */
async function removeSubscription(publicKey, endpoint) {
  if (!publicKey) throw new Error("publicKey is required");
  if (!endpoint) throw new Error("endpoint is required");

  const removed = await knex(TABLE).where({ public_key: publicKey, endpoint }).del();
  return { removed };
}

/**
 * List an account's stored subscriptions.
 *
 * @param {string} publicKey
 * @returns {Promise<Array<object>>}
 */
async function listSubscriptions(publicKey) {
  if (!publicKey) return [];
  return knex(TABLE).where({ public_key: publicKey }).select("*");
}

/** Shape a stored row back into what web-push expects. */
function toWebPushSubscription(row) {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
}

/**
 * Send a notification to every device registered for an account.
 *
 * Never throws: each device is attempted independently, permanently dead
 * endpoints are pruned, and the caller receives counts. This is what makes it
 * safe to call from inside a payment or claim handler.
 *
 * @param {string} publicKey  Recipient account.
 * @param {object} payload
 * @param {string} payload.title
 * @param {string} payload.body
 * @param {object} [payload.data]  Extra fields; `data.url` drives the click
 *   target handled by the service worker.
 * @returns {Promise<{sent: number, failed: number, pruned: number, skipped?: string}>}
 */
async function sendNotification(publicKey, { title, body, data = {} } = {}) {
  const result = { sent: 0, failed: 0, pruned: 0 };

  if (!ensureVapidConfigured()) {
    return { ...result, skipped: "vapid-not-configured" };
  }

  if (!publicKey || !title) {
    return { ...result, skipped: "missing-recipient-or-title" };
  }

  let rows;
  try {
    rows = await listSubscriptions(publicKey);
  } catch (err) {
    logger.error({ err, publicKey }, "Failed to load push subscriptions");
    return { ...result, skipped: "subscription-lookup-failed" };
  }

  if (rows.length === 0) {
    return { ...result, skipped: "no-subscriptions" };
  }

  // The service worker JSON.parse()s this; keep it to primitives.
  const notification = JSON.stringify({ title, body, ...data });

  const deadEndpoints = [];

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(toWebPushSubscription(row), notification);
        result.sent += 1;
      } catch (err) {
        if (GONE_STATUS_CODES.has(err?.statusCode)) {
          deadEndpoints.push(row.endpoint);
        } else {
          result.failed += 1;
          logger.warn(
            { err, endpoint: row.endpoint, statusCode: err?.statusCode },
            "Push delivery failed",
          );
        }
      }
    }),
  );

  if (deadEndpoints.length > 0) {
    try {
      result.pruned = await knex(TABLE).whereIn("endpoint", deadEndpoints).del();
    } catch (err) {
      logger.warn({ err }, "Failed to prune expired push subscriptions");
    }
  }

  if (result.sent > 0) {
    try {
      await knex(TABLE)
        .where({ public_key: publicKey })
        .whereNotIn("endpoint", deadEndpoints)
        .update({ last_used_at: knex.fn.now() });
    } catch (err) {
      // Bookkeeping only — the notifications already went out.
      logger.debug({ err }, "Failed to update push last_used_at");
    }
  }

  return result;
}

module.exports = {
  addSubscription,
  removeSubscription,
  listSubscriptions,
  sendNotification,
  isPushEnabled,
  getPublicKey,
  isValidSubscription,
  resetVapidConfigForTests,
};
