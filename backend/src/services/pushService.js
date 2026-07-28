/**
 * src/services/pushService.js
 * Web Push notification service using the web-push library.
 *
 * Stores subscriptions in the push_subscriptions table (migration 009).
 * Sends notifications via VAPID-signed Web Push to all subscriptions
 * registered for a given Stellar public key.
 */

"use strict";

const webpush = require("web-push");
const knex = require("../db/connection");
const logger = require("../utils/logger");

// ─── VAPID initialisation ─────────────────────────────────────────────────────

const {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:noreply@finchippay.io",
} = process.env;

let vapidConfigured = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidConfigured = true;
} else {
  logger.warn(
    "Push notifications disabled: VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY not set."
  );
}

// ─── Subscription management ──────────────────────────────────────────────────

/**
 * Store a push subscription for a Stellar public key.
 * Performs an upsert: if the same (publicKey, endpoint) pair already exists
 * the keys/auth are refreshed in case the browser rotated them.
 *
 * @param {string} publicKey  - Stellar public key of the user
 * @param {object} subscription - PushSubscription JSON from the browser
 */
async function addSubscription(publicKey, subscription) {
  if (!publicKey || !subscription?.endpoint) {
    const err = new Error("publicKey and subscription.endpoint are required");
    err.status = 400;
    throw err;
  }

  const { endpoint, keys } = subscription;
  const p256dh = keys?.p256dh ?? null;
  const auth = keys?.auth ?? null;

  const existing = await knex("push_subscriptions")
    .where({ public_key: publicKey, endpoint })
    .first();

  if (existing) {
    await knex("push_subscriptions")
      .where({ public_key: publicKey, endpoint })
      .update({ p256dh, auth, updated_at: new Date().toISOString() });
  } else {
    await knex("push_subscriptions").insert({
      public_key: publicKey,
      endpoint,
      p256dh,
      auth,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Remove a push subscription by public key + endpoint.
 *
 * @param {string} publicKey - Stellar public key of the user
 * @param {string} endpoint  - The subscription endpoint URL to remove
 */
async function removeSubscription(publicKey, endpoint) {
  if (!publicKey || !endpoint) {
    const err = new Error("publicKey and endpoint are required");
    err.status = 400;
    throw err;
  }

  await knex("push_subscriptions")
    .where({ public_key: publicKey, endpoint })
    .delete();
}

/**
 * Send a push notification to all subscriptions registered for a public key.
 * Expired / invalid subscriptions (HTTP 410 Gone) are automatically cleaned up.
 *
 * @param {string} publicKey     - Stellar public key of the recipient
 * @param {object} payload       - Notification payload
 * @param {string} payload.title - Notification title
 * @param {string} payload.body  - Notification body
 * @param {string} [payload.url] - URL to open on notification click
 * @returns {Promise<number>}    Number of successfully dispatched notifications
 */
async function sendNotification(publicKey, { title, body, url = "/dashboard" }) {
  if (!vapidConfigured) {
    logger.warn({ publicKey }, "Push skipped: VAPID keys not configured");
    return 0;
  }

  if (!publicKey) {
    throw new Error("publicKey is required");
  }

  const subscriptions = await knex("push_subscriptions").where({
    public_key: publicKey,
  });

  if (subscriptions.length === 0) return 0;

  const notificationPayload = JSON.stringify({ title, body, url });
  let dispatched = 0;
  const toDelete = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, notificationPayload);
        dispatched++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription has expired or been revoked by the browser
          logger.info(
            { publicKey, endpoint: sub.endpoint },
            "Removing expired push subscription"
          );
          toDelete.push(sub.endpoint);
        } else {
          logger.error(
            { err, publicKey, endpoint: sub.endpoint },
            "Failed to send push notification"
          );
        }
      }
    })
  );

  // Clean up expired subscriptions outside the map to avoid mutation during iteration
  if (toDelete.length > 0) {
    await knex("push_subscriptions")
      .where({ public_key: publicKey })
      .whereIn("endpoint", toDelete)
      .delete();
  }

  return dispatched;
}

module.exports = { addSubscription, removeSubscription, sendNotification };
