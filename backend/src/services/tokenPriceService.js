/**
 * src/services/tokenPriceService.js
 *
 * Price history for tokens identified by their Soroban contract ID (issue
 * #362 — portfolio dashboard). Every classic Stellar asset has a
 * deterministic SEP-41 contract ID (`Asset.contractId(NETWORK_PASSPHRASE)`);
 * this service maps the contract IDs of the assets we recognise (native XLM
 * plus the well-known assets in the frontend's `assetDiscovery.ts`) to
 * CoinGecko ids, and serves cached OHLC-less price history from CoinGecko's
 * `market_chart` endpoint.
 *
 * Contract IDs outside this known set (e.g. a user-added custom token) have
 * no price source in this codebase yet — `getPriceHistory` returns an empty
 * `prices` array for them rather than throwing, so the frontend can render a
 * graceful "unavailable" state.
 */

"use strict";

const { Asset, Networks } = require("@stellar/stellar-sdk");
const cache = require("./cacheService");
const logger = require("../utils/logger");

const CACHE_TTL_SECONDS = 300; // 5 minutes, per issue #362
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

/** Known assets and their CoinGecko ids, mirroring frontend/lib/assetDiscovery.ts + priceAlerts.ts. */
const KNOWN_ASSETS = [
  { code: "XLM", issuer: null, coingeckoId: "stellar" },
  {
    code: "USDC",
    issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    coingeckoId: "usd-coin",
  },
];

/** contractId -> coingeckoId, built once at module load. */
const CONTRACT_ID_TO_COINGECKO_ID = new Map();
for (const asset of KNOWN_ASSETS) {
  const stellarAsset = asset.issuer ? new Asset(asset.code, asset.issuer) : Asset.native();
  const contractId = stellarAsset.contractId(NETWORK_PASSPHRASE);
  CONTRACT_ID_TO_COINGECKO_ID.set(contractId, asset.coingeckoId);
}

const RANGE_TO_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

function cacheKey(contractId, range) {
  return `token:priceHistory:${contractId}:${range}`;
}

/**
 * Fetch price history for a token identified by its Soroban contract ID.
 *
 * @param {string} contractId
 * @param {"7d"|"30d"|"90d"} range
 * @returns {Promise<{ contractId: string, range: string, prices: Array<{timestamp: number, price: number}> }>}
 */
async function getPriceHistory(contractId, range) {
  const cached = await cache.get(cacheKey(contractId, range));
  if (cached) {
    return cached;
  }

  const coingeckoId = CONTRACT_ID_TO_COINGECKO_ID.get(contractId);
  if (!coingeckoId) {
    const result = { contractId, range, prices: [] };
    await cache.set(cacheKey(contractId, range), result, CACHE_TTL_SECONDS);
    return result;
  }

  const days = RANGE_TO_DAYS[range];
  const url = `${COINGECKO_BASE}/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}`;

  let prices = [];
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`CoinGecko market_chart returned HTTP ${res.status}`);
    }
    const data = await res.json();
    prices = (data.prices || []).map(([timestamp, price]) => ({
      timestamp,
      price,
    }));
  } catch (err) {
    logger.warn(
      { err, contractId, coingeckoId, range },
      "Failed to fetch token price history from CoinGecko",
    );
    // Serve an empty (short-lived) result rather than a 500 — a transient
    // provider failure shouldn't break the portfolio page.
    return { contractId, range, prices: [] };
  }

  const result = { contractId, range, prices };
  await cache.set(cacheKey(contractId, range), result, CACHE_TTL_SECONDS);
  return result;
}

module.exports = {
  getPriceHistory,
  _CONTRACT_ID_TO_COINGECKO_ID: CONTRACT_ID_TO_COINGECKO_ID,
};
