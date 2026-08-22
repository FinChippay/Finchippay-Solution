/**
 * src/services/sep/orderBookService.js
 * Stellar DEX Order Book service for SEP-38 aggregated quoting with depth analysis.
 */

"use strict";

/**
 * Stellar Asset helper compatible with @stellar/stellar-sdk Asset interface.
 */
class StellarAsset {
  constructor(code, issuer = null) {
    this.code = code;
    this.issuer = issuer;
  }

  static native() {
    return new StellarAsset("XLM", null);
  }

  isNative() {
    return !this.issuer || (this.code === "XLM" && !this.issuer);
  }

  getCode() {
    return this.code;
  }

  getIssuer() {
    return this.issuer;
  }

  toString() {
    return this.isNative() ? "native" : `${this.code}:${this.issuer}`;
  }
}

function getAssetClass() {
  try {
    const sdk = require("@stellar/stellar-sdk");
    if (sdk && sdk.Asset) return sdk.Asset;
  } catch {
    // fallback to internal class
  }
  return StellarAsset;
}

const Asset = getAssetClass();
const logger = require("../../utils/logger");

// Lazy-loaded cache service (avoids circular dependency)
function getCache() {
  return require("../cacheService");
}

// Lazy-loaded Horizon server
function getServer() {
  try {
    const { server } = require("../../config/stellar");
    return server;
  } catch {
    return null;
  }
}

const ORDERBOOK_CACHE_TTL_SEC = 2; // 2-second TTL: order books change rapidly
const DEFAULT_DEPTH = 20;

// Known asset issuers
const DEFAULT_USDC_ISSUER =
  process.env.USDC_ISSUER || "GBBD47IF2HOHSI6QB6Y24RGLAT2SUI7O47BGCH6WO7GBH44H7QEWEWPX";

/**
 * Parse SEP-38 / Stellar asset identifier into Stellar SDK Asset instance.
 *
 * Supported formats:
 * - Asset instance
 * - "stellar:native", "native", "XLM", "stellar:XLM"
 * - "stellar:CODE:ISSUER"
 * - "CODE:ISSUER"
 * - "USDC" (resolves using DEFAULT_USDC_ISSUER)
 *
 * @param {string|Asset} assetInput
 * @returns {Asset}
 */
function parseAsset(assetInput) {
  if (!assetInput) {
    const err = new Error("sell_asset and buy_asset are required");
    err.status = 400;
    throw err;
  }

  if (typeof assetInput === "object" && typeof assetInput.isNative === "function") {
    return assetInput;
  }

  const str = String(assetInput).trim();

  if (
    str === "stellar:native" ||
    str === "native" ||
    str.toUpperCase() === "XLM" ||
    str.toUpperCase() === "STELLAR:XLM"
  ) {
    return Asset.native();
  }

  if (str.startsWith("stellar:")) {
    const parts = str.split(":");
    if (parts.length === 2 && parts[1] === "native") {
      return Asset.native();
    }
    if (parts.length === 3) {
      return new Asset(parts[1], parts[2]);
    }
  }

  if (str.includes(":")) {
    const parts = str.split(":");
    if (parts.length === 2) {
      return new Asset(parts[0], parts[1]);
    }
  }

  if (str.toUpperCase() === "USDC") {
    return new Asset("USDC", DEFAULT_USDC_ISSUER);
  }

  const err = new Error(`Unsupported or invalid asset identifier: ${str}`);
  err.status = 400;
  throw err;
}

/**
 * Format asset identifier string for cache key and logging.
 *
 * @param {Asset|string} asset
 * @returns {string}
 */
function formatAssetString(asset) {
  if (typeof asset === "string") {
    return asset;
  }
  if (asset.isNative()) {
    return "native";
  }
  return `${asset.getCode()}:${asset.getIssuer()}`;
}

/**
 * Fetch order book from Horizon for a given trading pair with 2-second caching.
 *
 * In Stellar DEX orderbook terms:
 * selling_asset is base asset, buying_asset is counter asset.
 * - bids: orders willing to buy base (selling_asset) and pay counter (buying_asset).
 *   price is in counter/base (e.g. USDC per XLM).
 * - asks: orders willing to sell base and receive counter.
 *
 * @param {string|Asset} sellAsset - Selling asset (base)
 * @param {string|Asset} buyAsset - Buying asset (counter)
 * @param {number} [depth=20] - Order book depth limit
 * @returns {Promise<{ bids: Array<{ price: string, amount: string, price_r: object }>, asks: Array<{ price: string, amount: string, price_r: object }> }>}
 */
async function getOrderBook(sellAsset, buyAsset, depth = DEFAULT_DEPTH) {
  const selling = parseAsset(sellAsset);
  const buying = parseAsset(buyAsset);

  const sellStr = formatAssetString(selling);
  const buyStr = formatAssetString(buying);

  const cache = getCache();
  const cacheKey = `orderbook:${sellStr}:${buyStr}:${depth}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  } catch (err) {
    logger.warn({ err, cacheKey }, "Failed to read orderbook from cache");
  }

  try {
    const serverInstance = getServer();
    if (!serverInstance || typeof serverInstance.orderbook !== "function") {
      throw new Error("Horizon server orderbook client is not available");
    }

    const response = await serverInstance.orderbook(selling, buying).limit(depth).call();

    const result = {
      bids: response.bids || [],
      asks: response.asks || [],
      base: response.base,
      counter: response.counter,
    };

    try {
      await cache.set(cacheKey, result, ORDERBOOK_CACHE_TTL_SEC);
    } catch (err) {
      logger.warn({ err, cacheKey }, "Failed to set orderbook in cache");
    }

    return result;
  } catch (err) {
    logger.error(
      { err, sellAsset: sellStr, buyAsset: buyStr },
      "Failed to fetch order book from Horizon",
    );
    throw err;
  }
}

/**
 * Calculate weighted average execution price by walking order book levels.
 *
 * When selling sellAsset to receive buyAsset:
 * We match against bids (buyers offering buyAsset in exchange for sellAsset).
 * Each bid has:
 * - price: units of buyAsset per 1 unit of sellAsset
 * - amount: available sellAsset volume
 *
 * @param {Array<{ price: string|number, amount: string|number }>} orders - Order book bids
 * @param {string|number} sellAmount - Amount of sellAsset to exchange
 * @returns {{
 *   sellAmount: string,
 *   sellAmountFilled: number,
 *   buyAmountFilled: number,
 *   weightedPrice: number,
 *   topOfBookPrice: number,
 *   marginalPrice: number,
 *   levelsConsumed: number,
 *   isFullyFilled: boolean,
 *   remainingSellAmount: number
 * }}
 */
function calculateWeightedPrice(orders, sellAmount) {
  const totalSellRequired = parseFloat(sellAmount);
  if (isNaN(totalSellRequired) || totalSellRequired <= 0) {
    const err = new Error("sell_amount must be a positive number");
    err.status = 400;
    throw err;
  }

  const orderList = Array.isArray(orders)
    ? orders
    : orders && Array.isArray(orders.bids)
      ? orders.bids
      : [];

  let remainingSell = totalSellRequired;
  let totalSellFilled = 0;
  let totalBuyFilled = 0;
  let levelsConsumed = 0;
  let marginalPrice = 0;
  const topOfBookPrice = orderList.length > 0 ? parseFloat(orderList[0].price) : 0;

  for (const order of orderList) {
    if (remainingSell <= 0.000000001) break;

    const levelPrice = parseFloat(order.price);
    const levelAmount = parseFloat(order.amount);

    if (isNaN(levelPrice) || isNaN(levelAmount) || levelPrice <= 0 || levelAmount <= 0) {
      continue;
    }

    const fillSell = Math.min(remainingSell, levelAmount);
    const fillBuy = fillSell * levelPrice;

    totalSellFilled += fillSell;
    totalBuyFilled += fillBuy;
    remainingSell -= fillSell;
    levelsConsumed += 1;
    marginalPrice = levelPrice;
  }

  const weightedPrice = totalSellFilled > 0 ? totalBuyFilled / totalSellFilled : 0;
  const isFullyFilled = remainingSell <= 0.000000001;

  return {
    sellAmount: totalSellRequired.toString(),
    sellAmountFilled: totalSellFilled,
    buyAmountFilled: totalBuyFilled,
    weightedPrice,
    topOfBookPrice,
    marginalPrice,
    levelsConsumed,
    isFullyFilled,
    remainingSellAmount: Math.max(0, remainingSell),
  };
}

/**
 * Estimate slippage and price impact for an order book fill.
 *
 * - Slippage (%): Execution price degradation vs. the top-of-book price.
 *   ((topOfBookPrice - weightedPrice) / topOfBookPrice) * 100
 * - Price Impact (%): Market movement from top-of-book to the marginal fill price level.
 *   ((topOfBookPrice - marginalPrice) / topOfBookPrice) * 100
 *
 * @param {Array<{ price: string|number, amount: string|number }>} orders
 * @param {string|number} sellAmount
 * @returns {{
 *   slippagePercent: string,
 *   priceImpactPercent: string,
 *   topOfBookPrice: string,
 *   weightedPrice: string,
 *   sellAmountFilled: number,
 *   buyAmountFilled: number,
 *   levelsConsumed: number,
 *   isFullyFilled: boolean,
 *   remainingSellAmount: number
 * }}
 */
function estimateSlippage(orders, sellAmount) {
  const result = calculateWeightedPrice(orders, sellAmount);
  const topPrice = result.topOfBookPrice;
  const weightedPrice = result.weightedPrice;

  let slippagePercent = 0;
  if (topPrice > 0 && weightedPrice > 0 && topPrice > weightedPrice) {
    slippagePercent = ((topPrice - weightedPrice) / topPrice) * 100;
  }

  let priceImpactPercent = 0;
  if (topPrice > 0 && result.marginalPrice > 0 && topPrice > result.marginalPrice) {
    priceImpactPercent = ((topPrice - result.marginalPrice) / topPrice) * 100;
  }

  return {
    ...result,
    slippagePercent: slippagePercent.toFixed(2),
    priceImpactPercent: priceImpactPercent.toFixed(2),
    topOfBookPrice: topPrice.toFixed(4),
    weightedPrice: weightedPrice.toFixed(4),
  };
}

module.exports = {
  ORDERBOOK_CACHE_TTL_SEC,
  DEFAULT_DEPTH,
  DEFAULT_USDC_ISSUER,
  parseAsset,
  formatAssetString,
  getOrderBook,
  calculateWeightedPrice,
  estimateSlippage,
};
