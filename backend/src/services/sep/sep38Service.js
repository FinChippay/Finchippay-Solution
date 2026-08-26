/**
 * src/services/sep/sep38Service.js
 * Implementation of SEP-0038 Anchor RFQ (Request for Quote) Service.
 */

"use strict";

const USDC_ASSET = "stellar:USDC:GBBD47IF2HOHSI6QB6Y24RGLAT2SUI7O47BGCH6WO7GBH44H7QEWEWPX";
const XLM_ASSET = "stellar:native";
const USD_ASSET = "iso4217:USD";

const SUPPORTED_ASSETS = [
  {
    name: USDC_ASSET,
    exchangeable_targets: [
      { name: XLM_ASSET, type: "stellar" },
      { name: USD_ASSET, type: "fiat" },
    ],
  },
  {
    name: XLM_ASSET,
    exchangeable_targets: [
      { name: USDC_ASSET, type: "stellar" },
      { name: USD_ASSET, type: "fiat" },
    ],
  },
  {
    name: USD_ASSET,
    exchangeable_targets: [
      { name: USDC_ASSET, type: "stellar" },
      { name: XLM_ASSET, type: "stellar" },
    ],
  },
];

// Rates are defined as: 1 unit of Sell Asset = X units of Buy Asset
// exchangeRates[sell_asset][buy_asset] = rate
const exchangeRates = {
  [XLM_ASSET]: {
    [USDC_ASSET]: 0.1,
    [USD_ASSET]: 0.1,
  },
  [USDC_ASSET]: {
    [XLM_ASSET]: 10.0,
    [USD_ASSET]: 1.0,
  },
  [USD_ASSET]: {
    [XLM_ASSET]: 10.0,
    [USDC_ASSET]: 1.0,
  },
};

/**
 * Get supported assets configuration.
 */
function getInfo() {
  return {
    assets: SUPPORTED_ASSETS,
  };
}

/**
 * Calculate the price for exchanging asset_a to asset_b.
 *
 * @param {string} sellAsset - The asset being sold.
 * @param {string} buyAsset - The asset being bought.
 * @param {string} [sellAmount] - The amount of sellAsset.
 * @param {string} [buyAmount] - The amount of buyAsset.
 * @returns {object} { price, sell_amount, buy_amount }
 */
function getPrice(sellAsset, buyAsset, sellAmount, buyAmount) {
  if (!sellAsset || !buyAsset) {
    const err = new Error("sell_asset and buy_asset are required");
    err.status = 400;
    throw err;
  }

  if (!exchangeRates[sellAsset] || !exchangeRates[sellAsset][buyAsset]) {
    const err = new Error(`Exchange from ${sellAsset} to ${buyAsset} is not supported`);
    err.status = 400;
    throw err;
  }

  if (sellAmount && buyAmount) {
    const err = new Error("Cannot specify both sell_amount and buy_amount");
    err.status = 400;
    throw err;
  }

  if (!sellAmount && !buyAmount) {
    const err = new Error("Must specify either sell_amount or buy_amount");
    err.status = 400;
    throw err;
  }

  const rate = exchangeRates[sellAsset][buyAsset];

  let sellAmt, buyAmt;

  if (sellAmount) {
    sellAmt = parseFloat(sellAmount);
    if (isNaN(sellAmt) || sellAmt <= 0) {
      const err = new Error("sell_amount must be a positive number");
      err.status = 400;
      throw err;
    }
    buyAmt = sellAmt * rate;
  } else {
    buyAmt = parseFloat(buyAmount);
    if (isNaN(buyAmt) || buyAmt <= 0) {
      const err = new Error("buy_amount must be a positive number");
      err.status = 400;
      throw err;
    }
    sellAmt = buyAmt / rate;
  }

  return {
    price: rate.toFixed(4),
    sell_amount: sellAmt.toFixed(4),
    buy_amount: buyAmt.toFixed(4),
  };
}

/**
 * Get prices for a sell asset to all other buy assets.
 *
 * @param {string} sellAsset - The asset being sold.
 * @param {string} sellAmount - The amount being sold.
 * @returns {object} { buy_assets: [{ name, price }] }
 */
function getPrices(sellAsset, sellAmount) {
  if (!sellAsset || !sellAmount) {
    const err = new Error("sell_asset and sell_amount are required");
    err.status = 400;
    throw err;
  }

  const sellAmt = parseFloat(sellAmount);
  if (isNaN(sellAmt) || sellAmt <= 0) {
    const err = new Error("sell_amount must be a positive number");
    err.status = 400;
    throw err;
  }

  if (!exchangeRates[sellAsset]) {
    const err = new Error(`Asset ${sellAsset} is not supported for exchange`);
    err.status = 400;
    throw err;
  }

  const buyAssets = Object.entries(exchangeRates[sellAsset]).map(([buyAsset, rate]) => ({
    name: buyAsset,
    price: rate.toFixed(4),
  }));

  return {
    buy_assets: buyAssets,
  };
}

const orderBookService = require("./orderBookService");

/**
 * Get aggregated quote across Stellar DEX order book depth for best execution.
 *
 * @param {string} sellAsset - The asset being sold.
 * @param {string} buyAsset - The asset being bought.
 * @param {string|number} sellAmount - The amount being sold.
 * @returns {Promise<object>} Aggregated quote with depth, slippage, and price impact metrics.
 */
async function getAggregatedQuote(sellAsset, buyAsset, sellAmount) {
  if (!sellAsset || !buyAsset) {
    const err = new Error("sell_asset and buy_asset are required");
    err.status = 400;
    throw err;
  }

  if (!sellAmount) {
    const err = new Error("sell_amount is required");
    err.status = 400;
    throw err;
  }

  const sellAmt = parseFloat(sellAmount);
  if (isNaN(sellAmt) || sellAmt <= 0) {
    const err = new Error("sell_amount must be a positive number");
    err.status = 400;
    throw err;
  }

  let orderBook;
  try {
    orderBook = await orderBookService.getOrderBook(sellAsset, buyAsset);
  } catch (fetchErr) {
    // If order book fetch fails or is non-stellar pair, fallback to fixed exchange rates if available
    if (exchangeRates[sellAsset] && exchangeRates[sellAsset][buyAsset]) {
      const singleQuote = getPrice(sellAsset, buyAsset, String(sellAmount));
      return {
        sellAsset,
        buyAsset,
        sellAmount: String(sellAmount),
        buyAmount: singleQuote.buy_amount,
        price: singleQuote.price,
        topOfBookPrice: singleQuote.price,
        slippagePercent: "0.00",
        priceImpactPercent: "0.00",
        levelsConsumed: 1,
        isPartialFill: false,
        remainingSellAmount: "0.0000",
      };
    }
    throw fetchErr;
  }

  if (!orderBook || !orderBook.bids || orderBook.bids.length === 0) {
    // If order book is empty, fallback to fixed exchange rate if defined
    if (exchangeRates[sellAsset] && exchangeRates[sellAsset][buyAsset]) {
      const singleQuote = getPrice(sellAsset, buyAsset, String(sellAmount));
      return {
        sellAsset,
        buyAsset,
        sellAmount: String(sellAmount),
        buyAmount: singleQuote.buy_amount,
        price: singleQuote.price,
        topOfBookPrice: singleQuote.price,
        slippagePercent: "0.00",
        priceImpactPercent: "0.00",
        levelsConsumed: 1,
        isPartialFill: false,
        remainingSellAmount: "0.0000",
      };
    }

    const err = new Error(`Insufficient liquidity in order book for ${sellAsset} to ${buyAsset}`);
    err.status = 400;
    throw err;
  }

  const slippageInfo = orderBookService.estimateSlippage(orderBook.bids, sellAmt);

  if (slippageInfo.sellAmountFilled <= 0) {
    const err = new Error(`Insufficient liquidity in order book for ${sellAsset} to ${buyAsset}`);
    err.status = 400;
    throw err;
  }

  return {
    sellAsset,
    buyAsset,
    sellAmount: String(sellAmount),
    buyAmount: slippageInfo.buyAmountFilled.toFixed(4),
    price: slippageInfo.weightedPrice,
    topOfBookPrice: slippageInfo.topOfBookPrice,
    slippagePercent: slippageInfo.slippagePercent,
    priceImpactPercent: slippageInfo.priceImpactPercent,
    levelsConsumed: slippageInfo.levelsConsumed,
    isPartialFill: !slippageInfo.isFullyFilled,
    remainingSellAmount: slippageInfo.remainingSellAmount.toFixed(4),
  };
}

module.exports = {
  USDC_ASSET,
  XLM_ASSET,
  USD_ASSET,
  getInfo,
  getPrice,
  getPrices,
  getAggregatedQuote,
};
