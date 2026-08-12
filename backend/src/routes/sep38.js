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

module.exports = router;
