/**
 * __tests__/turretsHealth.test.js
 *
 * Integration tests for the GET /api/turrets/health endpoint. The price feed
 * is mocked so the tests are deterministic and never hit the public internet.
 */

"use strict";

const request = require("supertest");

// Force the price feed to a known state before requiring the app so the
// controller's first probe lands on the mocked response.
jest.mock("../src/services/priceFeedService", () => {
  const original = jest.requireActual("../src/services/priceFeedService");
  return {
    ...original,
    getXLMPrice: jest.fn(),
    getPriceFeedStatus: jest.fn(),
  };
});

const priceFeedService = require("../src/services/priceFeedService");

const app = require("../src/server");

afterAll(async () => {
  // Allow the Express server to release any open handles (rate-limit timers).
  await new Promise((r) => setTimeout(r, 50));
});

describe("GET /api/turrets/health", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns 200 with provider status when at least one provider is healthy", async () => {
    priceFeedService.getXLMPrice.mockResolvedValue({
      price: 0.42,
      source: "binance",
      timestamp: "2026-07-24T00:00:00.000Z",
    });
    priceFeedService.getPriceFeedStatus.mockReturnValue({
      activeProvider: "binance",
      activeProviderAt: "2026-07-24T00:00:00.000Z",
      cacheTtlMs: 30_000,
      timeoutMs: 5_000,
      providers: {
        coingecko: { status: "error", lastError: "HTTP 429" },
        binance: { status: "ok", cachedPrice: 0.42 },
        coincap: { status: "unknown" },
      },
    });

    const res = await request(app).get("/api/turrets/health");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.priceFeed.activeProvider).toBe("binance");
    expect(res.body.data.priceFeed.providers.coingecko.status).toBe("error");
    expect(res.body.data.priceFeed.providers.binance.status).toBe("ok");
    expect(res.body.data.priceFeed.activePrice).toMatchObject({
      price: 0.42,
      source: "binance",
    });
    expect(res.body.data.deployments).toEqual(
      expect.objectContaining({
        active: expect.any(Number),
        paused: expect.any(Number),
        total: expect.any(Number),
      }),
    );
    expect(typeof res.body.data.uptime).toBe("number");
    expect(typeof res.body.data.timestamp).toBe("string");
  });

  test("returns 'degraded' when every provider is down", async () => {
    priceFeedService.getXLMPrice.mockRejectedValue(
      Object.assign(new Error("All XLM/USD price providers are unreachable"), {
        status: 503,
        errorCode: "PRICE_FEED_UNAVAILABLE",
      }),
    );
    priceFeedService.getPriceFeedStatus.mockReturnValue({
      activeProvider: null,
      activeProviderAt: null,
      cacheTtlMs: 30_000,
      timeoutMs: 5_000,
      providers: {
        coingecko: { status: "error", lastError: "HTTP 500" },
        binance: { status: "error", lastError: "HTTP 500" },
        coincap: { status: "error", lastError: "HTTP 500" },
      },
    });

    const res = await request(app).get("/api/turrets/health");

    // The health route does not throw on total provider outage — it
    // surfaces "degraded" so operators can still see counts and the error
    // breakdown. The runner simply won't be able to evaluate prices.
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("degraded");
    expect(res.body.data.priceFeed.activeProvider).toBeNull();
    expect(res.body.data.priceFeed.activePrice).toBeNull();
  });
});
