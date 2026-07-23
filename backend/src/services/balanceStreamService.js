/**
 * src/services/balanceStreamService.js
 * Real-time balance fan-out backed by Horizon's payment stream (#157).
 *
 * Horizon is streamed once per account, no matter how many SSE clients are
 * watching it. Subscribers are held in a Set keyed by public key; the Horizon
 * stream is opened when the first subscriber arrives and closed when the last
 * one leaves, so several browser tabs never create duplicate Horizon streams.
 */

"use strict";

const { server } = require("../config/stellar");
const stellarService = require("./stellarService");
const logger = require("../utils/logger");

// Lazy-loaded to match stellarService and avoid a circular require at parse time.
function getCache() {
  return require("./cacheService");
}

/**
 * publicKey -> {
 *   subscribers: Set<{ onBalance, onError }>,
 *   closeHorizonStream: () => void,
 *   lastBalance: string | null,
 *   refreshing: Promise | null,
 *   pendingRefresh: boolean,
 * }
 */
const streams = new Map();

/** Strip CR/LF before logging anything derived from a request parameter. */
function safeKey(publicKey) {
  return String(publicKey).replace(/[\r\n]/g, "");
}

function broadcast(entry, event, payload) {
  for (const subscriber of entry.subscribers) {
    try {
      if (event === "error") {
        subscriber.onError(payload);
      } else {
        subscriber.onBalance(payload);
      }
    } catch (err) {
      logger.error({ err }, "Balance stream subscriber threw");
    }
  }
}

/**
 * Read the account's current XLM balance straight from Horizon and push it to
 * every subscriber. `getAccount` caches for 30s, so the cached entry is dropped
 * first — a payment event means the cached balance is known to be stale.
 *
 * Concurrent calls collapse into a single in-flight fetch followed by at most
 * one more, so a burst of payments cannot fan out into a burst of Horizon reads.
 */
async function refreshBalance(publicKey) {
  const entry = streams.get(publicKey);
  if (!entry) return;

  if (entry.refreshing) {
    entry.pendingRefresh = true;
    return entry.refreshing;
  }

  entry.refreshing = (async () => {
    try {
      await getCache().del(`account:${publicKey}`);
      const xlm = await stellarService.getXLMBalance(publicKey);

      // Still registered? The last client may have disconnected mid-fetch.
      const current = streams.get(publicKey);
      if (!current) return;

      current.lastBalance = xlm;
      broadcast(current, "balance", { publicKey, xlm, updatedAt: Date.now() });
    } catch (err) {
      logger.error(
        { err, publicKey: safeKey(publicKey) },
        "Failed to refresh balance for stream",
      );
      const current = streams.get(publicKey);
      if (current) {
        broadcast(current, "error", {
          message: "Failed to load the latest balance from Horizon.",
        });
      }
    }
  })();

  try {
    await entry.refreshing;
  } finally {
    entry.refreshing = null;
    if (entry.pendingRefresh) {
      entry.pendingRefresh = false;
      void refreshBalance(publicKey);
    }
  }
}

function openHorizonStream(publicKey) {
  // `cursor("now")` only delivers payments made after the stream is opened;
  // the current balance is sent separately when a subscriber connects.
  return server
    .payments()
    .forAccount(publicKey)
    .cursor("now")
    .stream({
      onmessage: () => {
        void refreshBalance(publicKey);
      },
      onerror: (err) => {
        // The SDK reconnects on its own; surface the blip without tearing the
        // SSE connection down, so the client can decide whether to fall back.
        logger.warn(
          { err, publicKey: safeKey(publicKey) },
          "Horizon payment stream error",
        );
        const entry = streams.get(publicKey);
        if (entry) {
          broadcast(entry, "error", { message: "Horizon stream interrupted." });
        }
      },
    });
}

/**
 * Subscribe to balance updates for an account.
 *
 * @param {string} publicKey
 * @param {{ onBalance: (data: object) => void, onError: (data: object) => void }} handlers
 * @returns {() => void} unsubscribe — closes the Horizon stream once the last
 *   subscriber for this account has left.
 */
function subscribe(publicKey, handlers) {
  let entry = streams.get(publicKey);

  if (!entry) {
    entry = {
      subscribers: new Set(),
      closeHorizonStream: null,
      lastBalance: null,
      refreshing: null,
      pendingRefresh: false,
    };
    streams.set(publicKey, entry);
    entry.closeHorizonStream = openHorizonStream(publicKey);
    logger.info(
      { publicKey: safeKey(publicKey) },
      "Opened Horizon payment stream",
    );
  }

  entry.subscribers.add(handlers);

  let unsubscribed = false;
  return function unsubscribe() {
    if (unsubscribed) return;
    unsubscribed = true;

    const current = streams.get(publicKey);
    if (!current) return;

    current.subscribers.delete(handlers);
    if (current.subscribers.size > 0) return;

    streams.delete(publicKey);
    try {
      current.closeHorizonStream?.();
    } catch (err) {
      logger.error({ err }, "Failed to close Horizon payment stream");
    }
    logger.info(
      { publicKey: safeKey(publicKey) },
      "Closed Horizon payment stream",
    );
  };
}

/** Number of accounts currently streamed from Horizon (one stream each). */
function activeStreamCount() {
  return streams.size;
}

/** Number of SSE clients watching a given account. */
function subscriberCount(publicKey) {
  return streams.get(publicKey)?.subscribers.size ?? 0;
}

/** Close every Horizon stream. Used on shutdown and between tests. */
function closeAll() {
  for (const [publicKey, entry] of streams) {
    try {
      entry.closeHorizonStream?.();
    } catch (err) {
      logger.error(
        { err, publicKey: safeKey(publicKey) },
        "Failed to close Horizon payment stream",
      );
    }
  }
  streams.clear();
}

module.exports = {
  subscribe,
  refreshBalance,
  activeStreamCount,
  subscriberCount,
  closeAll,
};
