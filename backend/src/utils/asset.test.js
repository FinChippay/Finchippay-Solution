"use strict";

const { normalizeAsset } = require("./asset");

describe("normalizeAsset", () => {
  it("accepts XLM without issuer", () => {
    expect(normalizeAsset("XLM")).toBe("XLM");
  });

  it("accepts empty string as XLM", () => {
    expect(normalizeAsset("")).toBe("XLM");
    expect(normalizeAsset(undefined)).toBe("XLM");
    expect(normalizeAsset(null)).toBe("XLM");
  });

  it("accepts USDC:G... with issuer", () => {
    expect(normalizeAsset("USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2CJXQVDCE4Z5O3DB3V3YQ4Q")).toBe(
      "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2CJXQVDCE4Z5O3DB3V3YQ4Q"
    );
  });

  it("rejects USDC without issuer", () => {
    expect(() => normalizeAsset("USDC")).toThrow("Non-XLM asset must be formatted as CODE:ISSUER");
    try {
      normalizeAsset("USDC");
    } catch (err) {
      expect(err.status).toBe(400);
    }
  });

  it("rejects missing code with issuer", () => {
    expect(() => normalizeAsset(":GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2CJXQVDCE4Z5O3DB3V3YQ4Q")).toThrow("Non-XLM asset must be formatted as CODE:ISSUER");
  });
});
