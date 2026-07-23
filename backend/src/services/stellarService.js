/**
 * src/services/stellarService.js
 * Business logic for interacting with the Stellar Horizon API.
 * All blockchain reads happen here — this is the single source of truth.
 */

"use strict";

const { server, HORIZON_URL } = require("../config/stellar");
const logger = require("../utils/logger");
const metrics = require("./metricsService");
const { trace } = require("@opentelemetry/api");

const tracer = trace.getTracer("finchippay-stellar-service");

// Lazy-loaded cache service (avoids circular dependency at parse time)
function getCache() {
  return require("./cacheService");
}

// ─── Cache TTLs ──────────────────────────────────────────────────────────────
const ACCOUNT_CACHE_TTL_SEC = 30;
const PAYMENTS_CACHE_TTL_SEC = 60;

// ─── Timeout + retry ──────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

function isTransientError(err) {
  if (!err) return false;
  const status = err?.response?.status ?? err?.status;
  if (status === 404) return false; // definitive — don't retry
  if (status >= 500) return true;
  const msg = err?.message || "";
  return (
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("network") ||
    err.name === "AbortError"
  );
}

/**
 * Run `fn` with a hard timeout and retry up to MAX_RETRIES times on
 * transient errors, using exponential back-off (100 ms × 2^attempt).
 */
async function withTimeoutAndRetry(fn, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await Promise.race([
        fn(controller.signal),
        new Promise((_, reject) =>
          controller.signal.addEventListener("abort", () =>
            reject(
              Object.assign(new Error("Horizon request timed out"), {
                name: "AbortError",
              }),
            ),
          ),
        ),
      ]);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (!isTransientError(err) || attempt === MAX_RETRIES) throw err;
      // Exponential back-off: 100 ms, 200 ms, 400 ms …
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  throw lastErr;
}

// ─── Tracing helper ───────────────────────────────────────────────────────────

/**
 * Create an OpenTelemetry span wrapping a Horizon API call.
 * Sets attributes: horizon.url, horizon.operation, attempt count,
 * and http.status_code on success / error on failure.
 *
 * When the OTel SDK is not initialised (NODE_ENV=test or no
 * OTEL_EXPORTER_OTLP_ENDPOINT) the global tracer is a no-op and
 * spans are not exported — no overhead beyond a function call.
 *
 * @param {string} operation - e.g. "loadAccount", "getPayments"
 * @param {string} description - human-readable span name
 * @param {() => Promise<any>} fn - the Horizon call to wrap
 * @returns {Promise<any>}
 */
async function withTracedSpan(operation, description, fn) {
  const span = tracer.startSpan(description, {
    attributes: {
      "horizon.url": HORIZON_URL,
      "horizon.operation": operation,
    },
  });

  try {
    const result = await fn();
    span.setAttribute("http.status_code", 200);
    span.setStatus({ code: 1 }); // OK
    return result;
  } catch (err) {
    const status = err?.response?.status ?? err?.status ?? 500;
    span.setAttribute("http.status_code", status);
    span.recordException(err);
    span.setStatus({ code: 2, message: err.message }); // ERROR
    throw err;
  } finally {
    span.end();
  }
}

// ─── Account ──────────────────────────────────────────────────────────────────

/**
 * Load a Stellar account and return its balances.
 * Cached with 30s TTL via Redis+LRU.
 */
async function getAccount(publicKey) {
  validatePublicKey(publicKey);

  const cache = getCache();
  const cacheKey = `account:${publicKey}`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    metrics.horizonRequestsTotal.inc({ operation: "loadAccount", status: "cache_hit" });
    return cached;
  }

  try {
    const account = await withTracedSpan(
      "loadAccount",
      "Horizon.loadAccount",
      () => withTimeoutAndRetry(() => server.loadAccount(publicKey)),
    );

    const balances = account.balances.map((b) => {
      if (b.asset_type === "native") {
        return { assetCode: "XLM", balance: b.balance, asset_type: "native" };
      }
      return {
        assetCode: b.asset_code,
        balance: b.balance,
        assetIssuer: b.asset_issuer,
        asset_type: b.asset_type,
      };
    });

    const result = {
      publicKey,
      sequence: account.sequence,
      balances,
      subentryCount: account.subentry_count,
    };

    await cache.set(cacheKey, result, ACCOUNT_CACHE_TTL_SEC);
    return result;
  } catch (err) {
    metrics.horizonRequestsTotal.inc({ operation: "loadAccount", status: "error" });
    if (err?.response?.status === 404) {
      const error = new Error(
        "Account not found. It may not be funded yet. Use Friendbot on testnet.",
      );
      error.status = 404;
      logger.error(
        { err: error, publicKey: publicKey.replace(/[\r\n]/g, "") },
        "Account not found",
      );
      throw error;
    }
    logger.error(
      { err, publicKey: publicKey.replace(/[\r\n]/g, "") },
      "Error loading account from Horizon",
    );
    throw err;
  }
}

/**
 * Get only the native XLM balance.
 */
async function getXLMBalance(publicKey) {
  const { balances } = await getAccount(publicKey);
  const xlm = balances.find((b) => b.assetCode === "XLM");
  return xlm ? xlm.balance : "0";
}

// ─── Payments ─────────────────────────────────────────────────────────────────

/**
 * Fetch payment history for an account from Horizon.
 * Cached with 60s TTL via Redis+LRU. Only caches the default (no-cursor) query.
 *
 * @param {string} publicKey
 * @param {{ limit?: number, cursor?: string }} options
 */
async function getPayments(publicKey, { limit = 20, cursor } = {}) {
  validatePublicKey(publicKey);

  // Only cache the default (non-paginated) query — cursor-based pagination is dynamic.
  const shouldCache = !cursor && limit === 20;
  const cache = getCache();
  const paymentsCacheKey = `payments:${publicKey}:${limit}`;

  if (shouldCache) {
    const cached = await cache.get(paymentsCacheKey);
    if (cached) {
      metrics.horizonRequestsTotal.inc({ operation: "getPayments", status: "cache_hit" });
      return cached;
    }
  }

  let query = server
    .payments()
    .forAccount(publicKey)
    .limit(limit)
    .order("desc");

  if (cursor) {
    query = query.cursor(cursor);
  }

  const result = await withTracedSpan(
    "getPayments",
    "Horizon.getPayments",
    () => withTimeoutAndRetry(() => query.call()),
  );

  const payments = [];

  const PAYMENT_TYPES = new Set([
    "payment",
    "path_payment_strict_send",
    "path_payment_strict_receive",
  ]);

  for (const op of result.records) {
    if (!PAYMENT_TYPES.has(op.type)) continue;

    // path_payment ops expose dest_asset_* and dest_amount for the received side
    const isPathPayment = op.type !== "payment";
    const isSent = op.from === publicKey;

    let assetCode;
    if (isPathPayment && !isSent) {
      assetCode =
        op.dest_asset_type === "native"
          ? "XLM"
          : op.dest_asset_code || "UNKNOWN";
    } else {
      assetCode =
        op.asset_type === "native" ? "XLM" : op.asset_code || "UNKNOWN";
    }

    const amount = isPathPayment && !isSent ? op.dest_amount : op.amount;

    let memo;
    try {
      const tx = await withTracedSpan(
        "getTransaction",
        "Horizon.getTransaction",
        () => withTimeoutAndRetry(() => op.transaction()),
      );
      if (tx.memo_type === "text" && tx.memo) {
        memo = tx.memo;
      }
    } catch (err) {
      logger.error(
        { err, transactionHash: op.transaction_hash },
        "Failed to fetch memo for transaction",
      );
      // memo is optional
    }

    payments.push({
      id: op.id,
      type: isSent ? "sent" : "received",
      amount,
      asset: assetCode,
      from: op.from,
      to: op.to,
      memo,
      createdAt: op.created_at,
      transactionHash: op.transaction_hash,
      pagingToken: op.paging_token,
    });
  }

  // Cache the result if this was the default query
  if (shouldCache) {
    try {
      await cache.set(paymentsCacheKey, payments, PAYMENTS_CACHE_TTL_SEC);
    } catch (err) {
      logger.warn({ err }, "Failed to cache payment history");
    }
  }

  return payments;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validatePublicKey(publicKey) {
  if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const err = new Error("Invalid Stellar public key format");
    err.status = 400;
    throw err;
  }
}

module.exports = {
  getAccount,
  getXLMBalance,
  getPayments,
  validatePublicKey,
};
