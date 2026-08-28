"use strict";

const {
  accountCacheKey,
  networkCacheNamespace,
  paymentsCacheKey,
  paymentsCountCacheKey,
  paymentsCachePattern,
} = require("../src/services/stellarCacheKeys");

const PUBLIC_KEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const TESTNET = "https://horizon-testnet.stellar.org";
const MAINNET = "https://horizon.stellar.org";

describe("Stellar Horizon cache keys", () => {
  it("uses distinct namespaces for testnet and mainnet", () => {
    expect(networkCacheNamespace(TESTNET)).not.toBe(
      networkCacheNamespace(MAINNET),
    );
  });

  it("scopes account cache entries to the configured Horizon URL", () => {
    expect(accountCacheKey(PUBLIC_KEY)).toBe(
      `account:${networkCacheNamespace(TESTNET)}:${PUBLIC_KEY}`,
    );
  });

  it("keeps payment list and count entries separate by network and query", () => {
    const testnetPayments = `payments:${networkCacheNamespace(TESTNET)}:${PUBLIC_KEY}:20`;
    const mainnetPayments = `payments:${networkCacheNamespace(MAINNET)}:${PUBLIC_KEY}:20`;

    expect(paymentsCacheKey(PUBLIC_KEY, 20)).toBe(testnetPayments);
    expect(testnetPayments).not.toBe(mainnetPayments);
    expect(paymentsCountCacheKey(PUBLIC_KEY, 200)).toBe(
      `payments:count:${networkCacheNamespace(TESTNET)}:${PUBLIC_KEY}:200`,
    );
  });

  it("uses the same namespace when invalidating payment entries", () => {
    expect(paymentsCachePattern(PUBLIC_KEY)).toBe(
      `payments:${networkCacheNamespace(TESTNET)}:${PUBLIC_KEY}:*`,
    );
  });
});
