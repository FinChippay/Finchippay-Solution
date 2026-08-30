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
const TOKENS_TABLE = "push_tokens";

/** Maximum distinct devices (endpoints) an account may register. */
const MAX_DEVICES_PER_ACCOUNT = 10;

/** Web Push endpoint URLs are long but bounded to reject garbage payloads. */
const MAX_ENDPOINT_LENGTH = 2048;

/** p256dh / auth keys are base64url-encoded binary material from the browser. */
const MIN_P256DH_LENGTH = 80;
const MAX_P256DH_LENGTH = 256;
const MIN_AUTH_LENGTH = 16;
const MAX_AUTH_LENGTH = 64;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Native mobile device-token formats (FCM and APNs).
 *
 * APNs: 64 hexadecimal characters (32-byte device token).
 * FCM:  140–4096 characters from [A-Za-z0-9_-] (registration token).
 *
 * The combined check accepts either shape so clients do not need to declare
 * the provider up front; pass `provider: "fcm"` or `"apns"` to require one.
 */
const FCM_DEVICE_TOKEN_RE = /^[a-zA-Z0-9_-]{140,4096}$/;
const APNS_DEVICE_TOKEN_RE = /^[a-fA-F0-9]{64}$/;

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
 * Build a 400-class error for push validation failures.
 * @param {string} message
 * @returns {Error}
 */
function pushValidationError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * Validate a native push device token (FCM or APNs).
 *
 * @param {unknown} token
 * @param {"fcm"|"apns"|undefined} [provider]  When set, only that format is accepted.
 * @returns {boolean}
 */
function isValidDeviceToken(token, provider) {
  if (typeof token !== "string") return false;
  const trimmed = token.trim();
  if (!trimmed) return false;

  if (provider === "fcm") return FCM_DEVICE_TOKEN_RE.test(trimmed);
  if (provider === "apns") return APNS_DEVICE_TOKEN_RE.test(trimmed);

  return APNS_DEVICE_TOKEN_RE.test(trimmed) || FCM_DEVICE_TOKEN_RE.test(trimmed);
}

/**
 * Validate the shape of a PushSubscription sent by a browser.
 *
 * @param {unknown} subscription
 * @returns {boolean}
 */
function isValidSubscription(subscription) {
  if (
    !subscription ||
    typeof subscription !== "object" ||
    typeof subscription.endpoint !== "string" ||
    !subscription.endpoint.startsWith("https://") ||
    subscription.endpoint.length > MAX_ENDPOINT_LENGTH ||
    !subscription.keys ||
    typeof subscription.keys.p256dh !== "string" ||
    typeof subscription.keys.auth !== "string"
  ) {
    return false;
  }

  const { p256dh, auth } = subscription.keys;

  return (
    p256dh.length >= MIN_P256DH_LENGTH &&
    p256dh.length <= MAX_P256DH_LENGTH &&
    BASE64URL_RE.test(p256dh) &&
    auth.length >= MIN_AUTH_LENGTH &&
    auth.length <= MAX_AUTH_LENGTH &&
    BASE64URL_RE.test(auth)
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
    throw pushValidationError("A valid push subscription is required");
  }

  const { endpoint } = subscription;
  const { p256dh, auth } = subscription.keys;

  const existing = await knex(TABLE).where({ endpoint }).first();

  if (existing) {
    await knex(TABLE).where({ id: existing.id }).update({ public_key: publicKey, p256dh, auth });
    return { created: false };
  }

  const [{ count }] = await knex(TABLE).where({ public_key: publicKey }).count("* as count");
  if (Number(count) >= MAX_DEVICES_PER_ACCOUNT) {
    throw pushValidationError(`Maximum of ${MAX_DEVICES_PER_ACCOUNT} devices per account`);
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
 * Detect the provider for a validated native device token.
 * @param {string} token
 * @returns {"fcm"|"apns"}
 */
function detectDeviceTokenProvider(token) {
  const trimmed = token.trim();
  return APNS_DEVICE_TOKEN_RE.test(trimmed) ? "apns" : "fcm";
}

/**
 * Register a native mobile device token (FCM or APNs) for an account.
 *
 * Idempotent: re-registering the same token reassigns it to the caller and
 * refreshes provider metadata instead of creating a duplicate row.
 *
 * @param {string} publicKey
 * @param {string} token
 * @param {"fcm"|"apns"|undefined} [provider]
 * @returns {Promise<{created: boolean, provider: string}>}
 */
async function registerDeviceToken(publicKey, token, provider) {
  if (!publicKey) throw new Error("publicKey is required");
  if (!isValidDeviceToken(token, provider)) {
    throw pushValidationError("Invalid device token format");
  }

  const trimmed = token.trim();
  const resolvedProvider = provider || detectDeviceTokenProvider(trimmed);

  const existing = await knex(TOKENS_TABLE).where({ token: trimmed }).first();

  if (existing) {
    await knex(TOKENS_TABLE)
      .where({ id: existing.id })
      .update({ public_key: publicKey, provider: resolvedProvider });
    return { created: false, provider: resolvedProvider };
  }

  const [{ count }] = await knex(TOKENS_TABLE).where({ public_key: publicKey }).count("* as count");
  if (Number(count) >= MAX_DEVICES_PER_ACCOUNT) {
    throw pushValidationError(`Maximum of ${MAX_DEVICES_PER_ACCOUNT} devices per account`);
  }

  await knex(TOKENS_TABLE).insert({
    public_key: publicKey,
    token: trimmed,
    provider: resolvedProvider,
  });

  return { created: true, provider: resolvedProvider };
}

/**
 * List native device tokens registered for an account.
 * @param {string} publicKey
 * @returns {Promise<Array<object>>}
 */
async function listDeviceTokens(publicKey) {
  if (!publicKey) return [];
  return knex(TOKENS_TABLE).where({ public_key: publicKey }).select("*");
}

/**
 * Remove one native device token for an account.
 * @param {string} publicKey
 * @param {string} token
 * @returns {Promise<{removed: number}>}
 */
async function removeDeviceToken(publicKey, token) {
  if (!publicKey) throw new Error("publicKey is required");
  if (!token) throw new Error("token is required");

  const removed = await knex(TOKENS_TABLE)
    .where({ public_key: publicKey, token: token.trim() })
    .del();
  return { removed };
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
  MAX_DEVICES_PER_ACCOUNT,
  addSubscription,
  registerDeviceToken,
  removeDeviceToken,
  listDeviceTokens,
  removeSubscription,
  listSubscriptions,
  sendNotification,
  isPushEnabled,
  getPublicKey,
  isValidDeviceToken,
  isValidSubscription,
  resetVapidConfigForTests,
};
