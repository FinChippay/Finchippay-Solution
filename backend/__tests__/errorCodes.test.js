/**
 * __tests__/errorCodes.test.js
 * Unit tests for the shared/errorCodes.js module.
 *
 * Verifies:
 *   - Every error code has a non-empty httpStatus, message, and code.
 *   - getError() returns the correct entry and falls back to GEN_UNKNOWN.
 *   - formatErrorResponse() produces the canonical shape.
 *   - CONTRACT_ERROR_MAP maps all 17 contract error codes.
 *   - getContractErrorCode() returns the correct key.
 */

"use strict";

const {
  ERROR_CODES,
  CONTRACT_ERROR_MAP,
  getError,
  formatErrorResponse,
  getContractErrorCode,
  formatContractErrorResponse,
} = require("../../shared/errorCodes");

describe("ERROR_CODES registry", () => {
  it("contains at least 40 error codes covering all categories", () => {
    const keys = Object.keys(ERROR_CODES);
    expect(keys.length).toBeGreaterThanOrEqual(40);
  });

  it("every error entry has code, httpStatus, and message properties", () => {
    for (const [key, entry] of Object.entries(ERROR_CODES)) {
      expect(typeof entry.code).toBe("string");
      expect(entry.code.length).toBeGreaterThan(0);
      expect(typeof entry.httpStatus).toBe("number");
      expect(typeof entry.message).toBe("string");
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });

  it("every httpStatus is a valid HTTP status code (100–599 or 0)", () => {
    for (const entry of Object.values(ERROR_CODES)) {
      expect([0, ...Array.from({ length: 500 }, (_, i) => i + 100)]).toContain(
        entry.httpStatus,
      );
    }
  });

  it("has expected auth error codes", () => {
    const authCodes = Object.keys(ERROR_CODES).filter((k) =>
      k.startsWith("AUTH_"),
    );
    expect(authCodes).toContain("AUTH_MISSING_TOKEN");
    expect(authCodes).toContain("AUTH_EXPIRED_TOKEN");
    expect(authCodes).toContain("AUTH_INVALID_TOKEN");
    expect(authCodes).toContain("AUTH_MISSING_HEADER");
    expect(authCodes).toContain("AUTH_FORBIDDEN");
    expect(authCodes).toContain("AUTH_CHALLENGE_FAILED");
  });

  it("has expected validation error codes", () => {
    const valCodes = Object.keys(ERROR_CODES).filter((k) =>
      k.startsWith("VAL_"),
    );
    expect(valCodes).toContain("VAL_INVALID_PUBLIC_KEY");
    expect(valCodes).toContain("VAL_MISSING_FIELD");
    expect(valCodes).toContain("VAL_INVALID_JSON");
    expect(valCodes).toContain("VAL_BODY_TOO_LARGE");
    expect(valCodes).toContain("VAL_CONTENT_TYPE");
  });

  it("has expected resource error codes", () => {
    const resCodes = Object.keys(ERROR_CODES).filter((k) =>
      k.startsWith("RES_"),
    );
    expect(resCodes).toContain("RES_NOT_FOUND");
    expect(resCodes).toContain("RES_CONFLICT");
    expect(resCodes).toContain("RES_ROUTE_NOT_FOUND");
  });

  it("has expected rate limit error codes", () => {
    expect(ERROR_CODES.RATE_LIMITED_GLOBAL).toBeDefined();
    expect(ERROR_CODES.RATE_LIMITED_SENSITIVE).toBeDefined();
    expect(ERROR_CODES.RATE_LIMITED_USER).toBeDefined();
    expect(ERROR_CODES.RATE_LIMITED_GLOBAL.httpStatus).toBe(429);
    expect(ERROR_CODES.RATE_LIMITED_SENSITIVE.httpStatus).toBe(429);
  });

  it("has expected server error codes", () => {
    expect(ERROR_CODES.SRV_INTERNAL).toBeDefined();
    expect(ERROR_CODES.SRV_HORIZON_UNAVAILABLE).toBeDefined();
    expect(ERROR_CODES.SRV_FEDERATION_FAILED).toBeDefined();
    expect(ERROR_CODES.SRV_NOT_IMPLEMENTED).toBeDefined();
    expect(ERROR_CODES.SRV_INTERNAL.httpStatus).toBe(500);
    expect(ERROR_CODES.SRV_NOT_IMPLEMENTED.httpStatus).toBe(501);
  });

  it("has expected generic error codes", () => {
    expect(ERROR_CODES.GEN_UNKNOWN).toBeDefined();
    expect(ERROR_CODES.GEN_NETWORK_ERROR).toBeDefined();
    expect(ERROR_CODES.GEN_OFFLINE).toBeDefined();
  });
});

describe("getError()", () => {
  it("returns the correct error entry for a known code", () => {
    const entry = getError("AUTH_MISSING_TOKEN");
    expect(entry.code).toBe("AUTH_MISSING_TOKEN");
    expect(entry.httpStatus).toBe(401);
    expect(entry.message).toBe(
      "Authentication token is required.",
    );
  });

  it("falls back to GEN_UNKNOWN for an unknown code", () => {
    const entry = getError("NONEXISTENT_CODE");
    expect(entry.code).toBe("GEN_UNKNOWN");
    expect(entry.httpStatus).toBe(500);
  });

  it("returns GEN_UNKNOWN for undefined", () => {
    const entry = getError(undefined);
    expect(entry.code).toBe("GEN_UNKNOWN");
  });

  it("returns GEN_UNKNOWN for null", () => {
    const entry = getError(null);
    expect(entry.code).toBe("GEN_UNKNOWN");
  });

  it("returns GEN_UNKNOWN for empty string", () => {
    const entry = getError("");
    expect(entry.code).toBe("GEN_UNKNOWN");
  });
});

describe("formatErrorResponse()", () => {
  it("returns the canonical { error: { code, message } } shape", () => {
    const response = formatErrorResponse("AUTH_EXPIRED_TOKEN");
    expect(response).toEqual({
      error: {
        code: "AUTH_EXPIRED_TOKEN",
        message: "Token has expired. Please re-authenticate.",
      },
    });
  });

  it("includes details when provided", () => {
    const response = formatErrorResponse("VAL_MISSING_FIELD", {
      fields: ["username"],
    });
    expect(response.error.code).toBe("VAL_MISSING_FIELD");
    expect(response.error.details).toEqual({ fields: ["username"] });
  });

  it("omits details when not provided", () => {
    const response = formatErrorResponse("RES_NOT_FOUND");
    expect(response.error.details).toBeUndefined();
  });

  it("falls back to GEN_UNKNOWN for unknown code", () => {
    const response = formatErrorResponse("UNKNOWN_KEY");
    expect(response.error.code).toBe("GEN_UNKNOWN");
    expect(response.error.httpStatus).toBeUndefined();
  });

  it("handles falsy code gracefully", () => {
    const response = formatErrorResponse(null);
    expect(response.error.code).toBe("GEN_UNKNOWN");
  });
});

describe("CONTRACT_ERROR_MAP", () => {
  it("maps all 17 contract error codes (1–17)", () => {
    for (let i = 1; i <= 17; i++) {
      expect(CONTRACT_ERROR_MAP[i]).toBeDefined();
      expect(typeof CONTRACT_ERROR_MAP[i]).toBe("string");
      expect(CONTRACT_ERROR_MAP[i].startsWith("CONTRACT_")).toBe(true);
    }
  });

  it("has no extra keys beyond 1–17", () => {
    const keys = Object.keys(CONTRACT_ERROR_MAP).map(Number);
    expect(Math.max(...keys)).toBe(17);
    expect(Math.min(...keys)).toBe(1);
    expect(keys.length).toBe(17);
  });

  it("maps contract code 2 (Unauthorized) to CONTRACT_UNAUTHORIZED", () => {
    expect(CONTRACT_ERROR_MAP[2]).toBe("CONTRACT_UNAUTHORIZED");
  });

  it("maps contract code 12 (ContractPaused) to CONTRACT_PAUSED", () => {
    expect(CONTRACT_ERROR_MAP[12]).toBe("CONTRACT_PAUSED");
  });

  it("maps contract code 17 (TransferFailed) to CONTRACT_TRANSFER_FAILED", () => {
    expect(CONTRACT_ERROR_MAP[17]).toBe("CONTRACT_TRANSFER_FAILED");
  });
});

describe("getContractErrorCode()", () => {
  it("returns the correct code for a known numeric contract error", () => {
    expect(getContractErrorCode(2)).toBe("CONTRACT_UNAUTHORIZED");
    expect(getContractErrorCode(5)).toBe("CONTRACT_NOT_FOUND");
    expect(getContractErrorCode(12)).toBe("CONTRACT_PAUSED");
  });

  it("returns GEN_UNKNOWN for an out-of-range code", () => {
    expect(getContractErrorCode(0)).toBe("GEN_UNKNOWN");
    expect(getContractErrorCode(18)).toBe("GEN_UNKNOWN");
    expect(getContractErrorCode(999)).toBe("GEN_UNKNOWN");
  });

  it("returns GEN_UNKNOWN for non-numeric input", () => {
    expect(getContractErrorCode(undefined)).toBe("GEN_UNKNOWN");
    expect(getContractErrorCode(null)).toBe("GEN_UNKNOWN");
    expect(getContractErrorCode("2")).toBe("GEN_UNKNOWN");
    expect(getContractErrorCode(NaN)).toBe("GEN_UNKNOWN");
  });
});

describe("formatContractErrorResponse()", () => {
  it("builds a canonical error response from a numeric contract error", () => {
    const response = formatContractErrorResponse(5);
    expect(response.error.code).toBe("CONTRACT_NOT_FOUND");
    expect(response.error.message).toBe(
      "The contract resource (escrow, stream, proposal) was not found.",
    );
  });

  it("includes details when provided", () => {
    const response = formatContractErrorResponse(17, {
      tokenAddress: "GABC...",
    });
    expect(response.error.code).toBe("CONTRACT_TRANSFER_FAILED");
    expect(response.error.details).toEqual({ tokenAddress: "GABC..." });
  });
});
