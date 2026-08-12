/**
 * src/services/pushNotifier.js
 * Turns domain events into push notifications.
 *
 * Kept separate from pushService so the transport (web-push, VAPID,
 * subscription storage) stays independent of the product decisions about which
 * events are worth interrupting someone for, and what the notification says.
 *
 * Every function here is best-effort and never throws: these are called from
 * inside payment and indexing paths, where a failed notification must not fail
 * the operation that triggered it.
 */

"use strict";

const pushService = require("./pushService");
const logger = require("../utils/logger");

/** Stellar public keys as they appear inside a serialised event payload. */
const STELLAR_ADDRESS_RE = /G[A-Z2-7]{55}/g;

/**
 * Notification copy per indexed contract event type.
 *
 * Only events worth an interruption are listed; anything absent is ignored, so
 * new contract events do not start notifying users by accident.
 *
 * `url` is the click target the service worker opens.
 */
const EVENT_NOTIFICATIONS = {
  receipt: {
    title: "Payment received",
    body: "A payment just landed in your Finchippay account.",
    url: "/dashboard",
  },
  stream_open: {
    title: "Payment stream opened",
    body: "A stream was opened for you. Funds become claimable as it accrues.",
    url: "/dashboard",
  },
  stream_claim: {
    title: "Stream claimed",
    body: "A payment stream claim completed.",
    url: "/dashboard",
  },
  escrow_create: {
    title: "Escrow created",
    body: "An escrow naming you was created. You will be able to claim it once it unlocks.",
    url: "/escrow",
  },
  escrow_claim: {
    title: "Escrow claimed",
    body: "An escrow claim completed.",
    url: "/escrow",
  },
  escrow_claim_partial: {
    title: "Escrow partially claimed",
    body: "Part of an escrow was claimed.",
    url: "/escrow",
  },
};

/**
 * Pull Stellar addresses out of an indexed event payload.
 *
 * The indexer stores raw Soroban SCVals rather than decoded fields, so there is
 * no reliable "recipient" key to read. Scanning the serialised payload for
 * G-addresses is the same approach `queryEventsByPublicKey` already takes to
 * attribute events to accounts, and it is deliberately inclusive: a participant
 * who is notified about their own action is a far better failure than a
 * recipient who never hears about incoming money.
 *
 * @param {unknown} payload
 * @returns {string[]} unique addresses, in first-seen order
 */
function extractAddresses(payload) {
  if (payload == null) return [];

  let serialised;
  try {
    serialised = typeof payload === "string" ? payload : JSON.stringify(payload);
  } catch {
    return [];
  }

  if (!serialised) return [];

  const matches = serialised.match(STELLAR_ADDRESS_RE);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Notify the participants of one indexed contract event.
 *
 * @param {{event_type: string, payload: unknown}} event
 * @returns {Promise<{notified: number}>}
 */
async function notifyContractEvent(event) {
  const result = { notified: 0 };

  if (!event || !pushService.isPushEnabled()) return result;

  const template = EVENT_NOTIFICATIONS[event.event_type];
  if (!template) return result;

  const addresses = extractAddresses(event.payload);
  if (addresses.length === 0) return result;

  await Promise.all(
    addresses.map(async (address) => {
      try {
        const outcome = await pushService.sendNotification(address, {
          title: template.title,
          body: template.body,
          data: { url: template.url, eventType: event.event_type },
        });
        if (outcome.sent > 0) result.notified += outcome.sent;
      } catch (err) {
        logger.warn(
          { err, address, eventType: event.event_type },
          "Failed to notify participant of contract event",
        );
      }
    }),
  );

  return result;
}

/**
 * Notify participants for a batch of indexed events.
 *
 * @param {Array<{event_type: string, payload: unknown}>} events
 * @returns {Promise<{notified: number}>}
 */
async function notifyContractEvents(events) {
  const result = { notified: 0 };
  if (!Array.isArray(events) || events.length === 0) return result;
  if (!pushService.isPushEnabled()) return result;

  for (const event of events) {
    try {
      const outcome = await notifyContractEvent(event);
      result.notified += outcome.notified;
    } catch (err) {
      logger.warn({ err }, "Failed to notify for indexed event");
    }
  }

  return result;
}

/**
 * Notify a creator that they received a tip.
 *
 * Unlike the indexed events above, the recipient here is known exactly, so the
 * notification can name the amount.
 *
 * @param {{creatorPublicKey: string, amount: string|number, asset?: string}} tip
 * @returns {Promise<{sent: number}|{skipped: string}>}
 */
async function notifyTipReceived({ creatorPublicKey, amount, asset = "XLM" }) {
  if (!creatorPublicKey) return { skipped: "missing-recipient" };

  try {
    return await pushService.sendNotification(creatorPublicKey, {
      title: "Tip received",
      body: `You received ${amount} ${asset}.`,
      data: { url: "/dashboard", eventType: "tip" },
    });
  } catch (err) {
    logger.warn({ err }, "Failed to send tip push notification");
    return { skipped: "send-failed" };
  }
}

module.exports = {
  notifyContractEvent,
  notifyContractEvents,
  notifyTipReceived,
  extractAddresses,
  EVENT_NOTIFICATIONS,
};
