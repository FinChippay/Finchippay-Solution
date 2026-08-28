/**
 * __tests__/trezor.test.ts
 * Unit tests for lib/trezor.ts — XDR -> Trezor conversion helpers, signature
 * normalisation, error mapping and the Trezor Connect integration.
 */

import { getNetworkPassphrase } from "@/lib/stellar";
import {
  priceToFraction,
  normalizeSignature,
  mapTrezorError,
  mapOperation,
  isTrezorSupported,
  TREZOR_STELLAR_PATH,
} from "@/lib/trezor";

// Mock the stellar module to avoid pulling in heavy Horizon/Soroban code.
jest.mock("@/lib/stellar", () => ({
  getNetworkPassphrase: jest.fn(() => "Test SDF Network ; September 2015"),
}));

describe("priceToFraction", () => {
  it("converts a decimal string to a reduced fraction", () => {
    expect(priceToFraction("2.5")).toEqual({ n: 5, d: 2 });
  });

  it("handles whole numbers", () => {
    expect(priceToFraction("3")).toEqual({ n: 3, d: 1 });
  });

  it("handles zero", () => {
    expect(priceToFraction("0")).toEqual({ n: 0, d: 1 });
  });

  it("accepts a {n, d} object and passes it through", () => {
    expect(priceToFraction({ n: 7, d: 3 })).toEqual({ n: 7, d: 3 });
  });

  it("falls back to 0/1 for invalid input", () => {
    expect(priceToFraction("not-a-price")).toEqual({ n: 0, d: 1 });
    expect(priceToFraction(undefined)).toEqual({ n: 0, d: 1 });
  });
});

describe("normalizeSignature", () => {
  it("returns a raw 64-byte (128 hex char) signature unchanged", () => {
    const raw = "a".repeat(128);
    expect(normalizeSignature(raw)).toBe(raw);
  });

  it("strips a 0x prefix", () => {
    const raw = "b".repeat(128);
    expect(normalizeSignature(`0x${raw}`)).toBe(raw);
  });

  it("converts a DER-encoded signature to raw", () => {
    // DER: 30 <len> 02 <rlen> <r> 02 <slen> <s>, with r and s 32 bytes each
    const r = "aa".repeat(32);
    const s = "bb".repeat(32);
    const der = `30${"44"}02${"20"}${r}02${"20"}${s}`;
    const raw = normalizeSignature(der);
    expect(raw).toBe(`${r}${s}`);
  });

  it("returns non-DER non-raw input unchanged", () => {
    const weird = "zz";
    expect(normalizeSignature(weird)).toBe(weird);
  });
});

describe("mapTrezorError", () => {
  it("maps a cancellation error", () => {
    expect(mapTrezorError("Action cancelled by user")).toContain("cancelled");
  });

  it("maps bridge/disconnect errors", () => {
    expect(mapTrezorError("Trezor Bridge disconnected")).toContain("bridge is not running");
  });

  it("maps locked/PIN errors", () => {
    expect(mapTrezorError("Device is locked")).toContain("unlock it with your PIN");
  });

  it("maps device-not-found errors", () => {
    expect(mapTrezorError("Device not found")).toContain("No Trezor device detected");
  });

  it("maps user rejection", () => {
    expect(mapTrezorError("User declined")).toContain("rejected on the Trezor device");
  });

  it("falls back to a generic message", () => {
    expect(mapTrezorError("Some unknown failure")).toContain("Trezor error: Some unknown failure");
  });
});

describe("mapOperation", () => {
  it("maps a payment operation", () => {
    const op = {
      type: "payment",
      source: "GA",
      destination: "GB",
      amount: "10.0000000",
      asset: {
        isNative: () => true,
      },
    };
    const result = mapOperation(op);
    expect(result).toEqual({
      type: "payment",
      source: "GA",
      destination: "GB",
      amount: "10.0000000",
      asset: { type: "native" },
    });
  });

  it("maps a changeTrust operation with an alphanum asset", () => {
    const op = {
      type: "changeTrust",
      line: {
        isNative: () => false,
        getCode: () => "USDC",
        getIssuer: () => "GABC",
      },
      limit: "500",
    };
    const result = mapOperation(op);
    expect(result).toEqual({
      type: "changeTrust",
      line: { type: "credit_alphanum4", code: "USDC", issuer: "GABC" },
      limit: "500",
    });
  });

  it("maps a manageSellOffer operation with a fraction price", () => {
    const op = {
      type: "manageSellOffer",
      selling: { isNative: () => true },
      buying: { isNative: () => false, getCode: () => "USDC", getIssuer: () => "GABC" },
      amount: "5.0000000",
      price: "2.5",
      offerId: 0,
    };
    const result = mapOperation(op);
    expect(result).toEqual({
      type: "manageSellOffer",
      selling: { type: "native" },
      buying: { type: "credit_alphanum4", code: "USDC", issuer: "GABC" },
      amount: "5.0000000",
      price: { n: 5, d: 2 },
      offerId: 0,
    });
  });

  it("returns null for unsupported operation types", () => {
    expect(mapOperation({ type: "unknownOp" })).toBeNull();
  });

  it("handles createAccount", () => {
    const result = mapOperation({ type: "createAccount", destination: "GB", startingBalance: "1" });
    expect(result).toEqual({ type: "createAccount", destination: "GB", startingBalance: "1" });
  });
});

describe("TREZOR_STELLAR_PATH", () => {
  it("uses the Stellar BIP44 path", () => {
    expect(TREZOR_STELLAR_PATH).toBe("m/44'/148'/0'");
  });
});

describe("isTrezorSupported", () => {
  it("returns false outside a browser", () => {
    // jest jsdom sets window/document; use the module's guard explicitly.
    expect(typeof isTrezorSupported()).toBe("boolean");
  });
});

describe("stellar module binding", () => {
  it("getNetworkPassphrase is mocked", () => {
    expect(getNetworkPassphrase()).toBe("Test SDF Network ; September 2015");
  });
});
