/**
 * __tests__/portfolio.test.ts
 * Unit tests for lib/portfolio.ts helpers (issue #362).
 */

import { Networks, Asset } from "@stellar/stellar-sdk";

jest.mock("@/lib/stellar", () => ({
  getBalances: jest.fn(),
  NETWORK_PASSPHRASE: require("@stellar/stellar-sdk").Networks.TESTNET,
}));

import * as stellarModule from "@/lib/stellar";
import {
  getPortfolioHoldings,
  isValidContractId,
  loadCustomTokens,
  addCustomToken,
  removeCustomToken,
  getPreferredFiatCurrency,
  setPreferredFiatCurrency,
  fetchTokenPrices,
  fetchTokenPricesCached,
  recordPortfolioValueSnapshot,
  loadPortfolioHistory,
  calculatePnL,
  CUSTOM_TOKENS_STORAGE_KEY,
  CUSTOM_TOKENS_STORAGE_VERSION,
} from "@/lib/portfolio";

const mockGetBalances = stellarModule.getBalances as jest.Mock;
const VALID_CONTRACT_ID = `C${"A".repeat(55)}`;

afterEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe("isValidContractId", () => {
  it("accepts a well-formed Soroban contract ID", () => {
    expect(isValidContractId(VALID_CONTRACT_ID)).toBe(true);
  });

  it("rejects a Stellar public key (G...) or malformed string", () => {
    expect(isValidContractId("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")).toBe(false);
    expect(isValidContractId("not-a-contract-id")).toBe(false);
    expect(isValidContractId("")).toBe(false);
  });
});

describe("getPortfolioHoldings", () => {
  it("derives the contract ID for the native XLM balance", async () => {
    mockGetBalances.mockResolvedValue([
      { asset: "native", balance: "100.0000000", assetCode: "XLM" },
    ]);

    const holdings = await getPortfolioHoldings("GPUBLICKEY");

    expect(holdings).toHaveLength(1);
    expect(holdings[0].code).toBe("XLM");
    expect(holdings[0].issuer).toBeUndefined();
    expect(holdings[0].contractId).toBe(Asset.native().contractId(Networks.TESTNET));
  });

  it("derives the contract ID for an issued asset from its code:issuer pair", async () => {
    const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    mockGetBalances.mockResolvedValue([
      { asset: `USDC:${issuer}`, balance: "50.0000000", assetCode: "USDC" },
    ]);

    const holdings = await getPortfolioHoldings("GPUBLICKEY");

    expect(holdings[0].code).toBe("USDC");
    expect(holdings[0].issuer).toBe(issuer);
    expect(holdings[0].contractId).toBe(new Asset("USDC", issuer).contractId(Networks.TESTNET));
  });
});

describe("custom tokens (localStorage)", () => {
  it("starts empty", () => {
    expect(loadCustomTokens()).toEqual([]);
  });

  it("adds and persists a valid contract ID", () => {
    const tokens = addCustomToken(VALID_CONTRACT_ID);
    expect(tokens).toEqual([{ contractId: VALID_CONTRACT_ID, addedAt: expect.any(Number) }]);
    expect(loadCustomTokens()).toHaveLength(1);
  });

  it("throws for an invalid contract ID instead of silently storing it", () => {
    expect(() => addCustomToken("not-a-contract-id")).toThrow();
    expect(loadCustomTokens()).toEqual([]);
  });

  it("is idempotent when the same contract ID is added twice", () => {
    addCustomToken(VALID_CONTRACT_ID);
    const tokens = addCustomToken(VALID_CONTRACT_ID);
    expect(tokens).toHaveLength(1);
  });

  it("removes a stored token", () => {
    addCustomToken(VALID_CONTRACT_ID);
    const tokens = removeCustomToken(VALID_CONTRACT_ID);
    expect(tokens).toEqual([]);
    expect(loadCustomTokens()).toEqual([]);
  });

  it("does not throw for corrupted stored data and rewrites an empty envelope", () => {
    localStorage.setItem(CUSTOM_TOKENS_STORAGE_KEY, "{not-json");

    expect(loadCustomTokens()).toEqual([]);
    expect(localStorage.getItem(CUSTOM_TOKENS_STORAGE_KEY)).toBe(
      JSON.stringify({ version: CUSTOM_TOKENS_STORAGE_VERSION, tokens: [] }),
    );
  });

  it("drops invalid items and rewrites the cleaned token list", () => {
    localStorage.setItem(
      CUSTOM_TOKENS_STORAGE_KEY,
      JSON.stringify({
        version: CUSTOM_TOKENS_STORAGE_VERSION,
        tokens: [
          { contractId: VALID_CONTRACT_ID, addedAt: 100 },
          { contractId: "invalid", addedAt: 200 },
          null,
        ],
      }),
    );

    expect(loadCustomTokens()).toEqual([{ contractId: VALID_CONTRACT_ID, addedAt: 100 }]);
    expect(localStorage.getItem(CUSTOM_TOKENS_STORAGE_KEY)).toBe(
      JSON.stringify({
        version: CUSTOM_TOKENS_STORAGE_VERSION,
        tokens: [{ contractId: VALID_CONTRACT_ID, addedAt: 100 }],
      }),
    );
  });

  it("normalizes the legacy array shape and known fields", () => {
    localStorage.setItem(
      CUSTOM_TOKENS_STORAGE_KEY,
      JSON.stringify([{ contractId: ` ${VALID_CONTRACT_ID} `, addedAt: "123" }]),
    );

    expect(loadCustomTokens()).toEqual([{ contractId: VALID_CONTRACT_ID, addedAt: 123 }]);
  });

  it("resets unsupported schema versions without exposing their tokens", () => {
    localStorage.setItem(
      CUSTOM_TOKENS_STORAGE_KEY,
      JSON.stringify({
        version: CUSTOM_TOKENS_STORAGE_VERSION + 1,
        tokens: [{ contractId: VALID_CONTRACT_ID, addedAt: 100 }],
      }),
    );

    expect(loadCustomTokens()).toEqual([]);
    expect(localStorage.getItem(CUSTOM_TOKENS_STORAGE_KEY)).toBe(
      JSON.stringify({ version: CUSTOM_TOKENS_STORAGE_VERSION, tokens: [] }),
    );
  });
});

describe("fiat currency preference (localStorage)", () => {
  it("defaults to USD", () => {
    expect(getPreferredFiatCurrency()).toBe("USD");
  });

  it("persists a supported currency", () => {
    setPreferredFiatCurrency("EUR");
    expect(getPreferredFiatCurrency()).toBe("EUR");
  });
});

describe("fetchTokenPrices", () => {
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it("maps the CoinGecko response to a per-fiat price snapshot", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stellar: {
          usd: 0.1,
          usd_24h_change: 2.5,
          eur: 0.09,
          eur_24h_change: 2.1,
          gbp: 0.08,
          gbp_24h_change: 1.9,
        },
      }),
    });

    const prices = await fetchTokenPrices(["XLM"]);

    expect(prices.XLM.prices).toEqual({ USD: 0.1, EUR: 0.09, GBP: 0.08 });
    expect(prices.XLM.change24hPct).toEqual({ USD: 2.5, EUR: 2.1, GBP: 1.9 });
  });

  it("omits codes with no known CoinGecko mapping without calling fetch", async () => {
    global.fetch = jest.fn();

    const prices = await fetchTokenPrices(["SOME_CUSTOM_TOKEN"]);

    expect(prices).toEqual({});
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns an empty map for an empty input list", async () => {
    global.fetch = jest.fn();
    expect(await fetchTokenPrices([])).toEqual({});
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("fetchTokenPricesCached", () => {
  const ORIGINAL_FETCH = global.fetch;
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it("fetches fresh and caches on first call", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.1 } }),
    });
    const { prices, stale } = await fetchTokenPricesCached(["XLM"]);
    expect(prices.XLM.prices.USD).toBe(0.1);
    expect(stale).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns cached prices without refetching within the TTL", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.1 } }),
    });
    await fetchTokenPricesCached(["XLM"]);
    const { prices, stale } = await fetchTokenPricesCached(["XLM"]);
    expect(prices.XLM.prices.USD).toBe(0.1);
    expect(stale).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to a stale cache entry when a refetch fails", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stellar: { usd: 0.1 } }),
    });
    await fetchTokenPricesCached(["XLM"]);

    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60 * 1000);
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));

    const { prices, stale } = await fetchTokenPricesCached(["XLM"]);
    expect(prices.XLM.prices.USD).toBe(0.1);
    expect(stale).toBe(true);
    (Date.now as jest.Mock).mockRestore();
  });
});

describe("portfolio value history and P&L", () => {
  it("records and loads a daily snapshot", () => {
    recordPortfolioValueSnapshot(100);
    const history = loadPortfolioHistory();
    expect(history).toHaveLength(1);
    expect(history[0].totalValue).toBe(100);
  });

  it("replaces, rather than duplicates, today's snapshot on a second call", () => {
    recordPortfolioValueSnapshot(100);
    recordPortfolioValueSnapshot(150);
    const history = loadPortfolioHistory();
    expect(history).toHaveLength(1);
    expect(history[0].totalValue).toBe(150);
  });

  it("returns a null percent and zero absolute P&L with no history", () => {
    const pnl = calculatePnL(500, 7);
    expect(pnl).toEqual({ absolute: 0, percent: null });
  });

  it("computes 7d P&L against the closest snapshot at or before 7 days ago", () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
    localStorage.setItem(
      "finchippay:portfolio-value-history",
      JSON.stringify([{ date: eightDaysAgo.toISOString().slice(0, 10), totalValue: 100 }])
    );
    const pnl = calculatePnL(150, 7);
    expect(pnl.absolute).toBe(50);
    expect(pnl.percent).toBeCloseTo(50, 5);
  });

  it("returns null percent when no snapshot is old enough for the requested window", () => {
    recordPortfolioValueSnapshot(100);
    const pnl = calculatePnL(150, 30);
    expect(pnl).toEqual({ absolute: 0, percent: null });
  });
});
