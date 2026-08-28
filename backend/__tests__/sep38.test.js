/* eslint-env jest */
/**
 * __tests__/sep38.test.js
 * Unit tests for SEP-0038 RFQ API endpoints.
 */

"use strict";

const request = require("supertest");
const express = require("express");
const sep38Routes = require("../src/routes/sep38");
const sep38Service = require("../src/services/sep/sep38Service");

const app = express();
app.use(express.json());
app.use("/sep38", sep38Routes);

describe("SEP-0038 RFQ API", () => {
  describe("GET /sep38/info", () => {
    it("returns the supported assets info", async () => {
      const res = await request(app).get("/sep38/info");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("assets");
      expect(Array.isArray(res.body.assets)).toBe(true);
      expect(res.body.assets.length).toBeGreaterThan(0);
      expect(res.body.assets[0]).toHaveProperty("name");
      expect(res.body.assets[0]).toHaveProperty("exchangeable_targets");
    });
  });

  describe("GET /sep38/price", () => {
    it("returns correct price and buy_amount when sell_amount is specified", async () => {
      const res = await request(app).get("/sep38/price").query({
        sell_asset: sep38Service.XLM_ASSET,
        buy_asset: sep38Service.USDC_ASSET,
        sell_amount: "100",
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("price");
      expect(res.body).toHaveProperty("sell_amount", "100.0000");
      expect(res.body).toHaveProperty("buy_amount", "10.0000");
    });

    it("returns correct price and sell_amount when buy_amount is specified", async () => {
      const res = await request(app).get("/sep38/price").query({
        sell_asset: sep38Service.USDC_ASSET,
        buy_asset: sep38Service.XLM_ASSET,
        buy_amount: "100",
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("price");
      expect(res.body).toHaveProperty("sell_amount", "10.0000");
      expect(res.body).toHaveProperty("buy_amount", "100.0000");
    });

    it("returns 400 when both sell_amount and buy_amount are specified", async () => {
      const res = await request(app).get("/sep38/price").query({
        sell_asset: sep38Service.XLM_ASSET,
        buy_asset: sep38Service.USDC_ASSET,
        sell_amount: "100",
        buy_amount: "10",
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when neither sell_amount nor buy_amount is specified", async () => {
      const res = await request(app).get("/sep38/price").query({
        sell_asset: sep38Service.XLM_ASSET,
        buy_asset: sep38Service.USDC_ASSET,
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for unsupported asset exchange pair", async () => {
      const res = await request(app).get("/sep38/price").query({
        sell_asset: sep38Service.XLM_ASSET,
        buy_asset: "iso4217:EUR",
        sell_amount: "100",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /sep38/prices", () => {
    it("returns list of buy assets and prices for a supported sell asset", async () => {
      const res = await request(app).get("/sep38/prices").query({
        sell_asset: sep38Service.XLM_ASSET,
        sell_amount: "100",
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("buy_assets");
      expect(Array.isArray(res.body.buy_assets)).toBe(true);
      expect(res.body.buy_assets.length).toBe(2);
      expect(res.body.buy_assets[0]).toHaveProperty("name");
      expect(res.body.buy_assets[0]).toHaveProperty("price");
    });

    it("returns 400 when sell_amount is missing", async () => {
      const res = await request(app).get("/sep38/prices").query({
        sell_asset: sep38Service.XLM_ASSET,
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /sep38/quote/aggregated", () => {
    const orderBookService = require("../src/services/sep/orderBookService");

    it("returns aggregated quote across order book depth with slippage and price impact", async () => {
      jest.spyOn(orderBookService, "getOrderBook").mockResolvedValueOnce({
        bids: [
          { price: "0.9900", amount: "500.0000" },
          { price: "0.9700", amount: "500.0000" },
        ],
        asks: [],
      });

      const res = await request(app).get("/sep38/quote/aggregated").query({
        sell_asset: sep38Service.XLM_ASSET,
        buy_asset: sep38Service.USDC_ASSET,
        sell_amount: "1000",
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("sellAsset", sep38Service.XLM_ASSET);
      expect(res.body).toHaveProperty("buyAsset", sep38Service.USDC_ASSET);
      expect(res.body).toHaveProperty("sellAmount", "1000");
      expect(res.body).toHaveProperty("buyAmount", "980.0000");
      expect(res.body).toHaveProperty("price", "0.9800");
      expect(res.body).toHaveProperty("topOfBookPrice", "0.9900");
      expect(res.body).toHaveProperty("slippagePercent", "1.01");
      expect(res.body).toHaveProperty("priceImpactPercent", "2.02");
      expect(res.body).toHaveProperty("levelsConsumed", 2);
    });

    it("handles camelCase parameters (sellAsset, buyAsset, sellAmount)", async () => {
      jest.spyOn(orderBookService, "getOrderBook").mockResolvedValueOnce({
        bids: [{ price: "0.1000", amount: "1000.0000" }],
        asks: [],
      });

      const res = await request(app).get("/sep38/quote/aggregated").query({
        sellAsset: sep38Service.XLM_ASSET,
        buyAsset: sep38Service.USDC_ASSET,
        sellAmount: "100",
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("buyAmount", "10.0000");
      expect(res.body).toHaveProperty("price", "0.1000");
      expect(res.body).toHaveProperty("slippagePercent", "0.00");
    });

    it("returns 400 when sell_asset or buy_asset is missing", async () => {
      const res = await request(app).get("/sep38/quote/aggregated").query({
        sell_asset: sep38Service.XLM_ASSET,
        sell_amount: "100",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when sell_amount is missing or non-positive", async () => {
      const res = await request(app).get("/sep38/quote/aggregated").query({
        sell_asset: sep38Service.XLM_ASSET,
        buy_asset: sep38Service.USDC_ASSET,
        sell_amount: "0",
      });
      expect(res.status).toBe(400);
    });

    it("falls back to fixed exchange rates when order book has no liquidity for supported pair", async () => {
      jest.spyOn(orderBookService, "getOrderBook").mockResolvedValueOnce({
        bids: [],
        asks: [],
      });

      const res = await request(app).get("/sep38/quote/aggregated").query({
        sell_asset: sep38Service.XLM_ASSET,
        buy_asset: sep38Service.USDC_ASSET,
        sell_amount: "100",
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("buyAmount", "10.0000");
      expect(res.body).toHaveProperty("price", "0.1000");
      expect(res.body).toHaveProperty("slippagePercent", "0.00");
    });
  });
});
