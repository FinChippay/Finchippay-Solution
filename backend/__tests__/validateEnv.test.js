/**
 * __tests__/validateEnv.test.js
 * Unit tests for startup environment validation.
 */

"use strict";

const { collectErrors, parseAllowedOrigins } = require("../src/config/validateEnv");

// ─── collectErrors ────────────────────────────────────────────────────────────

describe("validateEnv.collectErrors", () => {
  it("returns no errors when required vars are valid", () => {
    expect(
      collectErrors({
        STELLAR_NETWORK: "testnet",
        HORIZON_URL: "https://horizon-testnet.stellar.org",
      })
    ).toEqual([]);
  });

  it("flags missing STELLAR_NETWORK and HORIZON_URL", () => {
    const errors = collectErrors({});
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("STELLAR_NETWORK is required"),
        expect.stringContaining("HORIZON_URL is required"),
      ])
    );
  });

  it("rejects invalid STELLAR_NETWORK values", () => {
    const errors = collectErrors({
      STELLAR_NETWORK: "devnet",
      HORIZON_URL: "https://horizon-testnet.stellar.org",
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('STELLAR_NETWORK must be "testnet" or "mainnet"'),
      ])
    );
  });

  it("rejects malformed HORIZON_URL", () => {
    const errors = collectErrors({
      STELLAR_NETWORK: "testnet",
      HORIZON_URL: "not-a-url",
    });
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining("HORIZON_URL must be a valid URL")])
    );
  });

  it("returns no errors when ALLOWED_ORIGINS is absent (uses default)", () => {
    expect(
      collectErrors({
        STELLAR_NETWORK: "testnet",
        HORIZON_URL: "https://horizon-testnet.stellar.org",
        // ALLOWED_ORIGINS intentionally omitted
      })
    ).toEqual([]);
  });

  it("returns no errors for well-formed ALLOWED_ORIGINS", () => {
    expect(
      collectErrors({
        STELLAR_NETWORK: "testnet",
        HORIZON_URL: "https://horizon-testnet.stellar.org",
        ALLOWED_ORIGINS: "https://app.example.com,http://localhost:3000",
      })
    ).toEqual([]);
  });

  it("surfaces malformed ALLOWED_ORIGINS entries as errors", () => {
    const errors = collectErrors({
      STELLAR_NETWORK: "testnet",
      HORIZON_URL: "https://horizon-testnet.stellar.org",
      ALLOWED_ORIGINS: "https://app.example.com/,http://localhost:3000",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ALLOWED_ORIGINS entry "https:\/\/app\.example\.com\/" is malformed/);
  });

  it("surfaces every malformed entry when multiple are present", () => {
    const errors = collectErrors({
      STELLAR_NETWORK: "testnet",
      HORIZON_URL: "https://horizon-testnet.stellar.org",
      ALLOWED_ORIGINS: "https://a.com/path,*.evil.com,https://good.com",
    });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/"https:\/\/a\.com\/path"/);
    expect(errors[1]).toMatch(/".*evil\.com"/);
  });
});

// ─── parseAllowedOrigins ──────────────────────────────────────────────────────

describe("parseAllowedOrigins", () => {
  it("returns localhost fallback for undefined input", () => {
    const { origins, warnings } = parseAllowedOrigins(undefined);
    expect(origins).toEqual(["http://localhost:3000"]);
    expect(warnings).toEqual([]);
  });

  it("returns localhost fallback for empty string", () => {
    const { origins, warnings } = parseAllowedOrigins("   ");
    expect(origins).toEqual(["http://localhost:3000"]);
    expect(warnings).toEqual([]);
  });

  it("parses a single valid https origin", () => {
    const { origins, warnings } = parseAllowedOrigins("https://app.example.com");
    expect(origins).toEqual(["https://app.example.com"]);
    expect(warnings).toEqual([]);
  });

  it("parses a valid http origin with a port", () => {
    const { origins, warnings } = parseAllowedOrigins("http://localhost:3000");
    expect(origins).toEqual(["http://localhost:3000"]);
    expect(warnings).toEqual([]);
  });

  it("parses multiple valid origins separated by commas", () => {
    const { origins, warnings } = parseAllowedOrigins(
      "https://app.example.com,http://localhost:3000"
    );
    expect(origins).toEqual(["https://app.example.com", "http://localhost:3000"]);
    expect(warnings).toEqual([]);
  });

  it("trims whitespace around each entry", () => {
    const { origins, warnings } = parseAllowedOrigins(
      "  https://app.example.com , http://localhost:3000  "
    );
    expect(origins).toEqual(["https://app.example.com", "http://localhost:3000"]);
    expect(warnings).toEqual([]);
  });

  it("flags a trailing slash", () => {
    const { origins, warnings } = parseAllowedOrigins("https://app.example.com/");
    expect(origins).toEqual(["https://app.example.com/"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/trailing slash/);
  });

  it("flags a path component", () => {
    const { origins, warnings } = parseAllowedOrigins("https://app.example.com/sub");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/"https:\/\/app\.example\.com\/sub"/);
  });

  it("flags a wildcard prefix", () => {
    const { origins, warnings } = parseAllowedOrigins("*.example.com");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/wildcard/);
  });

  it("flags a bare domain with no scheme", () => {
    const { origins, warnings } = parseAllowedOrigins("example.com");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/"example\.com"/);
  });

  it("flags an ftp scheme as malformed", () => {
    const { origins, warnings } = parseAllowedOrigins("ftp://files.example.com");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/"ftp:\/\/files\.example\.com"/);
  });

  it("still includes the malformed entry in the returned origins list", () => {
    // The entry is returned so startup warnings don't silently change runtime
    // CORS behaviour — a human decides whether to fix or remove it.
    const { origins } = parseAllowedOrigins("https://app.example.com/bad");
    expect(origins).toContain("https://app.example.com/bad");
  });

  it("skips empty segments from double commas", () => {
    const { origins, warnings } = parseAllowedOrigins("https://a.com,,https://b.com");
    expect(origins).toEqual(["https://a.com", "https://b.com"]);
    expect(warnings).toEqual([]);
  });

  it("produces one warning per malformed entry", () => {
    const { warnings } = parseAllowedOrigins("https://a.com/,*.evil.com,https://ok.com");
    expect(warnings).toHaveLength(2);
  });
});
