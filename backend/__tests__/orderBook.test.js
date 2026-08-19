/* eslint-env jest */
/**
 * __tests__/orderBook.test.js
 * Unit tests for orderBookService and DEX order book depth aggregation.
 */

"use strict";

const mockOrderbook = jest.fn();

jest.mock("../src/config/stellar", () => ({
  server: {
    orderbook: mockOrderbook,
  },
  HORIZON_URL: "https://horizon-testnet.stellar.org",
}));

const orderBookService = require("../src/services/sep/orderBookService");
const cacheService = require("../src/services/cacheService");

describe("orderBookService", () => {
  beforeEach(() => {
    cacheService.clearLRU();
    jest.clearAllMocks();
  });

  describe("parseAsset", () => {
    it("parses native XLM identifiers", () => {
      expect(orderBookService.parseAsset("stellar:native").isNative()).toBe(true);
      expect(orderBookService.parseAsset("native").isNative()).toBe(true);
      expect(orderBookService.parseAsset("XLM").isNative()).toBe(true);
      expect(orderBookService.parseAsset("stellar:XLM").isNative()).toBe(true);
    });

    it("parses stellar:CODE:ISSUER formatted assets", () => {
      const issuer = "GBBD47IF2HOHSI6QB6Y24RGLAT2SUI7O47BGCH6WO7GBH44H7QEWEWPX";
      const asset = orderBookService.parseAsset(`stellar:USDC:${issuer}`);
      expect(asset.isNative()).toBe(false);
      expect(asset.getCode()).toBe("USDC");
      expect(asset.getIssuer()).toBe(issuer);
    });

    it("parses CODE:ISSUER formatted assets", () => {
      const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
      const asset = orderBookService.parseAsset(`USDC:${issuer}`);
      expect(asset.getCode()).toBe("USDC");
      expect(asset.getIssuer()).toBe(issuer);
    });

    it("parses USDC shorthand using default issuer", () => {
      const asset = orderBookService.parseAsset("USDC");
      expect(asset.getCode()).toBe("USDC");
      expect(asset.getIssuer()).toBe(orderBookService.DEFAULT_USDC_ISSUER);
    });

    it("throws 400 for missing or invalid asset identifier", () => {
      expect(() => orderBookService.parseAsset("")).toThrow();
      expect(() => orderBookService.parseAsset("invalid_format_without_issuer")).toThrow();
    });
  });

  describe("calculateWeightedPrice", () => {
    it("handles single-level fill when order amount exceeds sell amount", () => {
      const orders = [
        { price: "0.1000", amount: "1000.0000" },
        { price: "0.0900", amount: "1000.0000" },
      ];
      const result = orderBookService.calculateWeightedPrice(orders, "500");

      expect(result.sellAmountFilled).toBe(500);
      expect(result.buyAmountFilled).toBe(50); // 500 * 0.10
      expect(result.weightedPrice).toBe(0.1);
      expect(result.topOfBookPrice).toBe(0.1);
      expect(result.marginalPrice).toBe(0.1);
      expect(result.levelsConsumed).toBe(1);
      expect(result.isFullyFilled).toBe(true);
      expect(result.remainingSellAmount).toBe(0);
    });

    it("handles multi-level fill correctly aggregating across depth", () => {
      const orders = [
        { price: "0.1000", amount: "400.0000" }, // 400 * 0.10 = 40
        { price: "0.0800", amount: "400.0000" }, // 400 * 0.08 = 32
        { price: "0.0600", amount: "400.0000" }, // 200 * 0.06 = 12
      ];
      // Total 1000: 40 + 32 + 12 = 84 buyAsset, weighted price = 84 / 1000 = 0.084
      const result = orderBookService.calculateWeightedPrice(orders, "1000");

      expect(result.sellAmountFilled).toBe(1000);
      expect(result.buyAmountFilled).toBe(84);
      expect(result.weightedPrice).toBeCloseTo(0.084, 5);
      expect(result.topOfBookPrice).toBe(0.1);
      expect(result.marginalPrice).toBe(0.06);
      expect(result.levelsConsumed).toBe(3);
      expect(result.isFullyFilled).toBe(true);
      expect(result.remainingSellAmount).toBe(0);
    });

    it("handles insufficient liquidity (partial fill)", () => {
      const orders = [
        { price: "0.1000", amount: "300.0000" },
        { price: "0.0900", amount: "200.0000" },
      ];
      // Total available: 500. Request: 1000.
      const result = orderBookService.calculateWeightedPrice(orders, "1000");

      expect(result.sellAmountFilled).toBe(500);
      expect(result.buyAmountFilled).toBe(48); // 30 + 18
      expect(result.weightedPrice).toBeCloseTo(0.096, 5);
      expect(result.levelsConsumed).toBe(2);
      expect(result.isFullyFilled).toBe(false);
      expect(result.remainingSellAmount).toBe(500);
    });

    it("throws 400 on invalid or non-positive sell amount", () => {
      expect(() => orderBookService.calculateWeightedPrice([], "0")).toThrow();
      expect(() => orderBookService.calculateWeightedPrice([], "-50")).toThrow();
      expect(() => orderBookService.calculateWeightedPrice([], "abc")).toThrow();
    });
  });

  describe("estimateSlippage", () => {
    it("returns 0% slippage and price impact for single-level fills", () => {
      const orders = [{ price: "0.1000", amount: "1000.0000" }];
      const result = orderBookService.estimateSlippage(orders, "500");

      expect(result.topOfBookPrice).toBe("0.1000");
      expect(result.weightedPrice).toBe("0.1000");
      expect(result.slippagePercent).toBe("0.00");
      expect(result.priceImpactPercent).toBe("0.00");
      expect(result.levelsConsumed).toBe(1);
    });

    it("calculates accurate slippage and price impact for multi-level fills", () => {
      // Top of book = 0.99 (500), Level 2 = 0.97 (500)
      // For 1000: buyAmount = 500*0.99 + 500*0.97 = 495 + 485 = 980
      // Weighted price = 980 / 1000 = 0.98
      // Slippage = ((0.99 - 0.98) / 0.99) * 100 = 1.0101% -> "1.01"
      // Price impact = ((0.99 - 0.97) / 0.99) * 100 = 2.0202% -> "2.02"
      const orders = [
        { price: "0.9900", amount: "500.0000" },
        { price: "0.9700", amount: "500.0000" },
      ];
      const result = orderBookService.estimateSlippage(orders, "1000");

      expect(result.topOfBookPrice).toBe("0.9900");
      expect(result.weightedPrice).toBe("0.9800");
      expect(result.slippagePercent).toBe("1.01");
      expect(result.priceImpactPercent).toBe("2.02");
      expect(result.levelsConsumed).toBe(2);
      expect(result.buyAmountFilled).toBe(980);
    });
  });

  describe("getOrderBook with caching", () => {
    it("queries Horizon orderbook and caches result with 2s TTL", async () => {
      const mockOrderbookCall = jest.fn().mockResolvedValue({
        bids: [
          { price: "0.1000", amount: "500.0000" },
          { price: "0.0900", amount: "800.0000" },
        ],
        asks: [{ price: "10.0000", amount: "1000.0000" }],
      });

      const orderbookBuilder = {
        limit: jest.fn().mockReturnThis(),
        call: mockOrderbookCall,
      };

      mockOrderbook.mockReturnValue(orderbookBuilder);

      // First call: fetches from Horizon
      const result1 = await orderBookService.getOrderBook("XLM", "USDC", 20);
      expect(mockOrderbook).toHaveBeenCalledTimes(1);
      expect(result1.bids.length).toBe(2);

      // Second call: served from cache (mockOrderbook should not be called again)
      const result2 = await orderBookService.getOrderBook("XLM", "USDC", 20);
      expect(mockOrderbook).toHaveBeenCalledTimes(1);
      expect(result2.bids.length).toBe(2);
    });
  });
});
