/**
 * src/services/priceFeedService.js
 *
 * Multi-source XLM/USD price feed with fallback providers, a 30-second
 * in-memory cache, and a per-provider health snapshot.
 *
 * Issue #1 (turret persistence + price feed): stop-loss evaluations must keep
 * working when the primary provider (CoinGecko) rate-limits the server. We
 * try providers in order until one returns a finite, positive price:
 *
 *   1. CoinGecko  — https://api.coingecko.com/api/v3/simple/price
 *                   PRO key (PRICE_FEED_COINGECKO_API_KEY) unlocks the
 *                   https://pro-api.coingecko.com/api/v3 endpoint.
 *   2. Binance    — https://api.binance.com/api/v3/ticker/price?symbol=XLMUSDT
 *   3. CoinCap    — https://api.coincap.io/v2/assets/stellar
 *
 * Responses are cached for 30 seconds; the cache is per provider, so a
 * single working provider keeps serving fresh prices even if the others are
 * down. The health snapshot (getPriceFeedStatus) reports the most recent
 * per-provider outcome so /api/turrets/health can surface degradation.
 */

"use strict";

const CACHE_TTL_MS = 30_000;
const PROVIDER_TIMEOUT_MS = 5_000;

const COINGECKO_FREE = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO = "https://pro-api.coingecko.com/api/v3";
const BINANCE = "https://api.binance.com";
const COINCAP = "https://api.coincap.io/v2";

/**
 * Per-provider in-memory cache. We track the most recent response from each
 * provider independently so a stale CoinGecko entry never poisons a Binance
 * one. A single shared lastError also makes the health check cheap to read.
 */
const providerState = {
  coingecko: { value: null, fetchedAt: 0, lastError: null, lastLatencyMs: null },
  binance: { value: null, fetchedAt: 0, lastError: null, lastLatencyMs: null },
  coincap: { value: null, fetchedAt: 0, lastError: null, lastLatencyMs: null },
};

/** Returned by the public getXLMPrice(); used by the runner + health check. */
let lastSuccessfulProvider = null;
let lastSuccessfulAt = 0;

function nowMs() {
  return Date.now();
}

function isCacheFresh(state) {
  return (
    state.value !== null &&
    state.value !== undefined &&
    nowMs() - state.fetchedAt < CACHE_TTL_MS
  );
}

async function timedFetch(url, options = {}) {
  const start = nowMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const latencyMs = nowMs() - start;
    if (!res.ok) {
      const err = new Error(
        `Provider responded with HTTP ${res.status} for ${url}`,
      );
      err.status = res.status;
      err.latencyMs = latencyMs;
      throw err;
    }
    return { data: await res.json(), latencyMs };
  } catch (err) {
    const latencyMs = nowMs() - start;
    if (err.name === "AbortError") {
      const timeoutErr = new Error(
        `Provider request to ${url} timed out after ${PROVIDER_TIMEOUT_MS} ms`,
      );
      timeoutErr.latencyMs = latencyMs;
      throw timeoutErr;
    }
    if (typeof err.latencyMs !== "number") {
      err.latencyMs = latencyMs;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read XLM/USD from CoinGecko. Uses the pro endpoint when a key is configured
 * via PRICE_FEED_COINGECKO_API_KEY; otherwise falls back to the public
 * endpoint.
 */
async function fetchFromCoinGecko() {
  const apiKey = process.env.PRICE_FEED_COINGECKO_API_KEY;
  const base = apiKey ? COINGECKO_PRO : COINGECKO_FREE;
  const url = `${base}/simple/price?ids=stellar&vs_currencies=usd`;

  const headers = apiKey ? { "x-cg-pro-api-key": apiKey } : {};

  const { data, latencyMs } = await timedFetch(url, { headers });
  const value = Number(data?.stellar?.usd);

  if (!Number.isFinite(value) || value <= 0) {
    const err = new Error("Invalid price response from CoinGecko");
    err.latencyMs = latencyMs;
    throw err;
  }
  return { value, latencyMs };
}

/** Read XLM/USDT from Binance (USDT is treated as a USD proxy). */
async function fetchFromBinance() {
  const url = `${BINANCE}/api/v3/ticker/price?symbol=XLMUSDT`;
  const { data, latencyMs } = await timedFetch(url);

  const value = Number(data?.price);
  if (!Number.isFinite(value) || value <= 0) {
    const err = new Error("Invalid price response from Binance");
    err.latencyMs = latencyMs;
    throw err;
  }
  return { value, latencyMs };
}

/** Read XLM/USD from CoinCap (asset id "stellar"). */
async function fetchFromCoinCap() {
  const url = `${COINCAP}/assets/stellar`;
  const { data, latencyMs } = await timedFetch(url);

  const value = Number(data?.data?.priceUsd);
  if (!Number.isFinite(value) || value <= 0) {
    const err = new Error("Invalid price response from CoinCap");
    err.latencyMs = latencyMs;
    throw err;
  }
  return { value, latencyMs };
}

const PROVIDERS = [
  { name: "coingecko", fetch: fetchFromCoinGecko },
  { name: "binance", fetch: fetchFromBinance },
  { name: "coincap", fetch: fetchFromCoinCap },
];

/**
 * Try each provider in order until one returns a valid price. Each call
 * updates the provider's per-source cache (success or error) so health
 * checks always reflect the latest probe.
 */
async function probeAllProviders() {
  for (const provider of PROVIDERS) {
    const state = providerState[provider.name];
    try {
      const { value, latencyMs } = await provider.fetch();
      state.value = value;
      state.fetchedAt = nowMs();
      state.lastError = null;
      state.lastLatencyMs = latencyMs;
      lastSuccessfulProvider = provider.name;
      lastSuccessfulAt = state.fetchedAt;
      return { value, source: provider.name, latencyMs };
    } catch (err) {
      state.lastError = err.message;
      state.lastLatencyMs = err.latencyMs ?? null;
      // continue to the next provider
    }
  }
  return null;
}

/**
 * Return a cached price if the most recent successful provider is still
 * fresh; otherwise probe all providers and cache the first success.
 *
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh=false]
 *   Skip the cache and probe every provider. Used by /api/turrets/health
 *   when operators want to see the live state.
 * @returns {Promise<{ price: number, source: string, timestamp: string }>}
 */
async function getXLMPrice(options = {}) {
  const { forceRefresh = false } = options;

  if (!forceRefresh) {
    for (const provider of PROVIDERS) {
      const state = providerState[provider.name];
      if (isCacheFresh(state)) {
        return {
          price: state.value,
          source: provider.name,
          timestamp: new Date(state.fetchedAt).toISOString(),
        };
      }
    }
  }

  const result = await probeAllProviders();
  if (!result) {
    const err = new Error(
      "All XLM/USD price providers are currently unreachable",
    );
    err.status = 503;
    err.errorCode = "PRICE_FEED_UNAVAILABLE";
    throw err;
  }

  return {
    price: result.value,
    source: result.source,
    timestamp: new Date(providerState[result.source].fetchedAt).toISOString(),
  };
}

/**
 * Return a per-provider health snapshot. Used by GET /api/turrets/health.
 *
 * Each entry has:
 *   - status: "ok" if the most recent probe succeeded, "error" otherwise.
 *   - latencyMs: most recent probe latency (or null if never probed).
 *   - lastError: most recent error message, or null.
 *   - lastSuccessAt: ISO timestamp of the most recent successful read, or null.
 *   - cacheAgeMs: how old the cached value is, or null.
 *
 * The snapshot is cheap to read — providers are not probed here, only the
 * in-memory state is read. Call getXLMPrice({ forceRefresh: true }) from the
 * route to refresh before returning the snapshot.
 */
function getPriceFeedStatus() {
  const providers = {};
  for (const { name } of PROVIDERS) {
    const state = providerState[name];
    const age = state.fetchedAt ? nowMs() - state.fetchedAt : null;
    providers[name] = {
      status: state.lastError ? "error" : state.value !== null ? "ok" : "unknown",
      latencyMs: state.lastLatencyMs,
      lastError: state.lastError,
      lastSuccessAt:
        state.value !== null && !state.lastError
          ? new Date(state.fetchedAt).toISOString()
          : null,
      cacheAgeMs: age,
      cachedPrice: state.value,
    };
  }

  return {
    activeProvider: lastSuccessfulProvider,
    activeProviderAt: lastSuccessfulAt
      ? new Date(lastSuccessfulAt).toISOString()
      : null,
    cacheTtlMs: CACHE_TTL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    providers,
  };
}

/**
 * Reset all provider caches and statuses. Intended for tests; not used in
 * production code paths.
 */
function _resetForTests() {
  for (const { name } of PROVIDERS) {
    providerState[name] = {
      value: null,
      fetchedAt: 0,
      lastError: null,
      lastLatencyMs: null,
    };
  }
  lastSuccessfulProvider = null;
  lastSuccessfulAt = 0;
}

module.exports = {
  getXLMPrice,
  getPriceFeedStatus,
  // exported for tests:
  _resetForTests,
  _providerState: providerState,
};
