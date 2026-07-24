/**
 * __tests__/priceFeedService.test.js
 *
 * Unit tests for the multi-provider XLM/USD price feed. We stub `global.fetch`
 * with Jest's fake timers and `jest.fn()` so the tests are deterministic and
 * do not touch the public internet.
 *
 * Covers:
 *   1. Successful read from the first (CoinGecko) provider.
 *   2. Fallback to Binance when CoinGecko fails.
 *   3. Fallback to CoinCap when both CoinGecko and Binance fail.
 *   4. Throwing `PRICE_FEED_UNAVAILABLE` when every provider fails.
 *   5. 30-second cache prevents repeat fetches inside the TTL window.
 *   6. `forceRefresh: true` bypasses the cache.
 *   7. `PRICE_FEED_COINGECKO_API_KEY` switches the base URL to the pro
 *      endpoint and adds the `x-cg-pro-api-key` header.
 *   8. `getPriceFeedStatus` reflects the per-provider state.
 */

"use strict";

// Capture the original fetch so we can restore it after the test suite
// (other test files may use the global fetch).
const ORIGINAL_FETCH = global.fetch;

function makeResponse({ ok = true, status = 200, body = {} } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  delete process.env.PRICE_FEED_COINGECKO_API_KEY;
  jest.resetModules();
});

describe("priceFeedService.getXLMPrice", () => {
  test("returns the price from CoinGecko when it succeeds", async () => {
    jest.resetModules();
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse({
        ok: true,
        body: { stellar: { usd: 0.123 } },
      }),
    );
    global.fetch = fetchMock;

    const { getXLMPrice, _resetForTests } = require("../src/services/priceFeedService");
    _resetForTests();

    const result = await getXLMPrice({ forceRefresh: true });

    expect(result.price).toBeCloseTo(0.123);
    expect(result.source).toBe("coingecko");
    expect(typeof result.timestamp).toBe("string");
    // Only one provider was hit, since CoinGecko succeeded.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("coingecko.com");
  });

  test("falls back to Binance when CoinGecko fails", async () => {
    jest.resetModules();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse({ ok: false, status: 429, body: { error: "rate limit" } }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          body: { symbol: "XLMUSDT", price: "0.456" },
        }),
      );
    global.fetch = fetchMock;

    const { getXLMPrice, _resetForTests } = require("../src/services/priceFeedService");
    _resetForTests();

    const result = await getXLMPrice({ forceRefresh: true });

    expect(result.price).toBeCloseTo(0.456);
    expect(result.source).toBe("binance");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("falls back to CoinCap when CoinGecko + Binance both fail", async () => {
    jest.resetModules();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse({ ok: false, status: 500, body: {} }),
      )
      .mockResolvedValueOnce(
        makeResponse({ ok: false, status: 503, body: {} }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          body: { data: { priceUsd: "0.789" } },
        }),
      );
    global.fetch = fetchMock;

    const { getXLMPrice, _resetForTests } = require("../src/services/priceFeedService");
    _resetForTests();

    const result = await getXLMPrice({ forceRefresh: true });

    expect(result.price).toBeCloseTo(0.789);
    expect(result.source).toBe("coincap");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("throws PRICE_FEED_UNAVAILABLE when every provider fails", async () => {
    jest.resetModules();
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse({ ok: false, status: 500, body: {} }),
    );
    global.fetch = fetchMock;

    const { getXLMPrice, _resetForTests } = require("../src/services/priceFeedService");
    _resetForTests();

    await expect(getXLMPrice({ forceRefresh: true })).rejects.toMatchObject({
      status: 503,
      errorCode: "PRICE_FEED_UNAVAILABLE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("returns the cached value without re-fetching within the TTL", async () => {
    jest.resetModules();
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse({ ok: true, body: { stellar: { usd: 0.42 } } }),
    );
    global.fetch = fetchMock;

    const { getXLMPrice, _resetForTests } = require("../src/services/priceFeedService");
    _resetForTests();

    const a = await getXLMPrice({ forceRefresh: true });
    const b = await getXLMPrice(); // no forceRefresh → use cache
    const c = await getXLMPrice();

    expect(a.price).toBeCloseTo(0.42);
    expect(b.price).toBeCloseTo(0.42);
    expect(c.price).toBeCloseTo(0.42);
    // Only the first call should have hit the network.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("forceRefresh=true bypasses the cache", async () => {
    jest.resetModules();
    let price = 0.1;
    const fetchMock = jest.fn().mockImplementation(async () =>
      makeResponse({ ok: true, body: { stellar: { usd: price } } }),
    );
    global.fetch = fetchMock;

    const { getXLMPrice, _resetForTests } = require("../src/services/priceFeedService");
    _resetForTests();

    const a = await getXLMPrice({ forceRefresh: true });
    expect(a.price).toBeCloseTo(0.1);

    price = 0.2;
    const b = await getXLMPrice({ forceRefresh: true });
    expect(b.price).toBeCloseTo(0.2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("uses the pro endpoint + x-cg-pro-api-key header when the API key is set", async () => {
    jest.resetModules();
    process.env.PRICE_FEED_COINGECKO_API_KEY = "test-pro-key";
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse({ ok: true, body: { stellar: { usd: 0.55 } } }),
    );
    global.fetch = fetchMock;

    const { getXLMPrice, _resetForTests } = require("../src/services/priceFeedService");
    _resetForTests();

    await getXLMPrice({ forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("pro-api.coingecko.com");
    expect(options.headers["x-cg-pro-api-key"]).toBe("test-pro-key");
  });
});

describe("priceFeedService.getPriceFeedStatus", () => {
  test("reflects the most recent per-provider state", async () => {
    jest.resetModules();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse({ ok: false, status: 500, body: {} }),
      )
      .mockResolvedValueOnce(
        makeResponse({ ok: true, body: { symbol: "XLMUSDT", price: "0.31" } }),
      );
    global.fetch = fetchMock;

    const {
      getXLMPrice,
      getPriceFeedStatus,
      _resetForTests,
    } = require("../src/services/priceFeedService");
    _resetForTests();

    await getXLMPrice({ forceRefresh: true });
    const status = getPriceFeedStatus();

    expect(status.activeProvider).toBe("binance");
    expect(status.cacheTtlMs).toBe(30_000);
    expect(status.providers.coingecko.status).toBe("error");
    expect(status.providers.coingecko.lastError).toBeTruthy();
    expect(status.providers.binance.status).toBe("ok");
    expect(status.providers.binance.cachedPrice).toBeCloseTo(0.31);
    // CoinCap was never probed in this scenario.
    expect(status.providers.coincap.status).toBe("unknown");
  });
});
