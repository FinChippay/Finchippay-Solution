/**
 * src/services/pushService.js
 * Push notification payload generation and delivery.
 */

"use strict";

const webpush = require("web-push");
const logger = require("../utils/logger");

// Lazy-loaded to avoid circular dependency at parse time
function getCache() {
  try {
    return require("./cacheService");
  } catch {
    return null;
  }
}

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@finchippay.com";

if (PUBLIC_KEY && PRIVATE_KEY) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
} else {
  logger.warn("VAPID keys are missing. Push notifications will be disabled.");
}

/**
 * Retrieve subscriptions for a given public key.
 * In a real app, this should come from a database.
 * We are using cacheService to store them.
 */
async function getSubscriptions(publicKey) {
  const cache = getCache();
  if (!cache) return [];
  try {
    const data = await cache.get(`push_subscriptions:${publicKey}`);
    if (data) {
      return JSON.parse(data);
    }
  } catch (err) {
    logger.error({ err, publicKey }, "Error fetching subscriptions from cache");
  }
  return [];
}

/**
 * Save a subscription for a given public key.
 */
async function saveSubscription(publicKey, subscription) {
  const cache = getCache();
  if (!cache) return;
  try {
    let subs = await getSubscriptions(publicKey);
    // Add if not already exists (checking endpoint)
    if (!subs.some((s) => s.endpoint === subscription.endpoint)) {
      subs.push(subscription);
      // Keep subscriptions indefinitely or with a very long TTL
      await cache.set(`push_subscriptions:${publicKey}`, JSON.stringify(subs), 60 * 60 * 24 * 30); // 30 days
    }
  } catch (err) {
    logger.error({ err, publicKey }, "Error saving subscription to cache");
  }
}

/**
 * Remove a subscription for a given public key.
 */
async function removeSubscription(publicKey, endpoint) {
  const cache = getCache();
  if (!cache) return;
  try {
    let subs = await getSubscriptions(publicKey);
    subs = subs.filter((s) => s.endpoint !== endpoint);
    await cache.set(`push_subscriptions:${publicKey}`, JSON.stringify(subs), 60 * 60 * 24 * 30);
  } catch (err) {
    logger.error({ err, publicKey }, "Error removing subscription from cache");
  }
}

/**
 * Send push notification to all subscriptions of a user.
 */
async function sendPushNotification(publicKey, payload) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return;

  const subs = await getSubscriptions(publicKey);
  if (!subs.length) return;

  const payloadString = JSON.stringify(payload);

  const deliveryPromises = subs.map((sub) =>
    webpush.sendNotification(sub, payloadString).catch(async (error) => {
      if (error.statusCode === 404 || error.statusCode === 410) {
        logger.info({ endpoint: sub.endpoint }, "Subscription expired or removed");
        await removeSubscription(publicKey, sub.endpoint);
      } else {
        logger.error({ err: error, endpoint: sub.endpoint }, "Failed to send push notification");
      }
    })
  );

  await Promise.allSettled(deliveryPromises);
}

/**
 * Send notification for received payment.
 */
async function notifyPaymentReceived(publicKey, payment) {
  const amount = payment.amount;
  const asset = payment.asset || "XLM";
  const from = payment.from ? `${payment.from.substring(0, 4)}...${payment.from.substring(52)}` : "Unknown";
  
  const payload = {
    title: "Payment Received",
    body: `You received ${amount} ${asset} from ${from}`,
    url: "/transactions",
  };

  await sendPushNotification(publicKey, payload);
}

/**
 * Send reminder for scheduled payment due.
 */
async function notifyScheduledDue(publicKey, scheduleId) {
  const payload = {
    title: "Scheduled Payment Due",
    body: "A scheduled payment is due for submission.",
    url: "/dashboard",
  };

  await sendPushNotification(publicKey, payload);
}

/**
 * Send notification for multi-sig approval needed.
 */
async function notifyMultiSigNeeded(publicKey, proposalId) {
  const payload = {
    title: "Multi-sig Approval Needed",
    body: `Your approval is needed for a multi-sig payment (ID: ${proposalId}).`,
    url: "/escrow", // Assuming multi-sig is managed on the escrow page or dashboard
  };

  await sendPushNotification(publicKey, payload);
}

module.exports = {
  saveSubscription,
  removeSubscription,
  sendPushNotification,
  notifyPaymentReceived,
  notifyScheduledDue,
  notifyMultiSigNeeded,
};
