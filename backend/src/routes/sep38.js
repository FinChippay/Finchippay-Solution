/**
 * src/routes/sep38.js
 * Express routes for SEP-0038 Anchor RFQ API.
 */

"use strict";

const express = require("express");
const router = express.Router();
const sep38Service = require("../services/sep/sep38Service");

/**
 * GET /sep38/info
 * Returns information about supported asset pairs for exchange.
 */
router.get("/info", (req, res, next) => {
  try {
    const info = sep38Service.getInfo();
    res.json(info);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sep38/price
 * Returns the price for exchanging a sell asset to a buy asset.
 */
router.get("/price", (req, res, next) => {
  try {
    const { sell_asset, buy_asset, sell_amount, buy_amount } = req.query;
    const priceInfo = sep38Service.getPrice(sell_asset, buy_asset, sell_amount, buy_amount);
    res.json(priceInfo);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sep38/prices
 * Returns the prices of all exchange targets for a sell asset.
 */
router.get("/prices", (req, res, next) => {
  try {
    const { sell_asset, sell_amount } = req.query;
    const pricesInfo = sep38Service.getPrices(sell_asset, sell_amount);
    res.json(pricesInfo);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sep38/quote/aggregated or /api/v1/sep38/quote/aggregated
 * Returns aggregated RFQ quote across Stellar DEX order book depth.
 */
router.get(["/quote/aggregated", "/aggregated"], async (req, res, next) => {
  try {
    const sellAsset = req.query.sell_asset || req.query.sellAsset;
    const buyAsset = req.query.buy_asset || req.query.buyAsset;
    const sellAmount = req.query.sell_amount || req.query.sellAmount;

    const aggregatedQuote = await sep38Service.getAggregatedQuote(sellAsset, buyAsset, sellAmount);
    res.json(aggregatedQuote);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
