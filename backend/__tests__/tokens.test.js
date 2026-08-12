/* eslint-env jest */
/**
 * __tests__/tokens.test.js
 * Unit tests for the token price-history API (issue #362).
 */

"use strict";

const request = require("supertest");
const express = require("express");
const { Asset, Networks } = require("@stellar/stellar-sdk");

const ORIGINAL_FETCH = global.fetch;

// Native XLM's SEP-41 contract ID on testnet — the service's known-asset map
// is keyed by this exact value (see tokenPriceService.js), so tests reuse it
// rather than hard-coding a string that could drift from the SDK's encoding.
const XLM_CONTRACT_ID = Asset.native().contractId(Networks.TESTNET);

// Syntactically valid but unrecognised contract ID (matches the StrKey
// format the route validates, but isn't in the known-asset map).
const UNKNOWN_CONTRACT_ID = `C${"A".repeat(55)}`;

function makeResponse({ ok = true, status = 200, body = {} } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

function buildApp() {
  const tokensRoutes = require("../src/routes/tokens");
  const app = express();
  app.use(express.json());
  app.use("/api/v1/tokens", tokensRoutes);
  return app;
}

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.resetModules();
});

describe("GET /api/v1/tokens/:contractId/price-history", () => {
  test("returns price history for a known token (XLM)", async () => {
    jest.resetModules();
    const fetchMock = jest.fn().mockResolvedValue(
      makeResponse({
        body: {
          prices: [
            [1700000000000, 0.1],
            [1700003600000, 0.11],
          ],
        },
      }),
    );
    global.fetch = fetchMock;

    const app = buildApp();
    const res = await request(app).get(`/api/v1/tokens/${XLM_CONTRACT_ID}/price-history`);

    expect(res.status).toBe(200);
    expect(res.body.contractId).toBe(XLM_CONTRACT_ID);
    expect(res.body.range).toBe("30d");
    expect(res.body.prices).toEqual([
      { timestamp: 1700000000000, price: 0.1 },
      { timestamp: 1700003600000, price: 0.11 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("stellar");
    expect(fetchMock.mock.calls[0][0]).toContain("days=30");
  });

  test("accepts the range query param (7d -> days=7)", async () => {
    jest.resetModules();
    const fetchMock = jest.fn().mockResolvedValue(makeResponse({ body: { prices: [] } }));
    global.fetch = fetchMock;

    const app = buildApp();
    const res = await request(app).get(`/api/v1/tokens/${XLM_CONTRACT_ID}/price-history?range=7d`);

    expect(res.status).toBe(200);
    expect(res.body.range).toBe("7d");
    expect(fetchMock.mock.calls[0][0]).toContain("days=7");
  });

  test("returns 400 for an invalid range", async () => {
    jest.resetModules();
    const app = buildApp();
    const res = await request(app).get(`/api/v1/tokens/${XLM_CONTRACT_ID}/price-history?range=1y`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  test("returns 400 for a malformed contract ID", async () => {
    jest.resetModules();
    const app = buildApp();
    const res = await request(app).get("/api/v1/tokens/not-a-contract-id/price-history");

    expect(res.status).toBe(400);
  });

  test("returns an empty prices array for an unrecognised contract ID, without calling CoinGecko", async () => {
    jest.resetModules();
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const app = buildApp();
    const res = await request(app).get(`/api/v1/tokens/${UNKNOWN_CONTRACT_ID}/price-history`);

    expect(res.status).toBe(200);
    expect(res.body.prices).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("caches price history so a repeat request within the TTL doesn't refetch", async () => {
    jest.resetModules();
    const fetchMock = jest.fn().mockResolvedValue(makeResponse({ body: { prices: [[1, 0.1]] } }));
    global.fetch = fetchMock;

    const app = buildApp();
    const first = await request(app).get(
      `/api/v1/tokens/${XLM_CONTRACT_ID}/price-history?range=90d`,
    );
    const second = await request(app).get(
      `/api/v1/tokens/${XLM_CONTRACT_ID}/price-history?range=90d`,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("returns an empty prices array (not a 500) when CoinGecko is unreachable", async () => {
    jest.resetModules();
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));

    const app = buildApp();
    const res = await request(app).get(`/api/v1/tokens/${XLM_CONTRACT_ID}/price-history`);

    expect(res.status).toBe(200);
    expect(res.body.prices).toEqual([]);
  });
});
