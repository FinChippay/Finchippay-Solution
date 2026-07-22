/**
 * __tests__/errorHandler.test.ts
 * Unit tests for the frontend errorHandler module.
 */

import {
  parseApiError,
  getContractErrorMessage,
  getErrorMessage,
  isRetryableError,
  isSupportError,
} from "@/lib/errorHandler";
import { ERROR_CODES } from "../../shared/errorCodes";

// Helper to create a mock fetch Response
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "Mock",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
    redirected: false,
    type: "basic",
    url: "https://test/api",
    clone: () => mockResponse(status, body),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
  } as unknown as Response;
}

describe("parseApiError()", () => {
  it("parses a canonical error response shape", async () => {
    const res = mockResponse(400, {
      error: {
        code: "VAL_MISSING_FIELD",
        message: "Required field is missing.",
        details: { fields: ["email"] },
      },
    });

    const err = await parseApiError(res);
    expect(err.code).toBe("VAL_MISSING_FIELD");
    expect(err.message).toBe("Required field is missing.");
    expect(err.details).toEqual({ fields: ["email"] });
  });

  it("falls back to default code when code is missing in response", async () => {
    const res = mockResponse(400, {
      error: {
        message: "Something is wrong",
      },
    });

    const err = await parseApiError(res);
    expect(err.code).toBe("VAL_MISSING_FIELD"); // from HTTP 400
    expect(err.message).toBe("Something is wrong");
  });

  it("handles legacy { error: 'string' } shape", async () => {
    const res = mockResponse(404, {
      error: "Account not found",
    });

    const err = await parseApiError(res);
    expect(err.code).toBe("RES_NOT_FOUND");
    expect(err.message).toBe("Account not found");
  });

  it("handles legacy { message: 'string' } shape", async () => {
    const res = mockResponse(500, {
      message: "Server crashed",
    });

    const err = await parseApiError(res);
    expect(err.code).toBe("SRV_INTERNAL");
    expect(err.message).toBe("Server crashed");
  });

  it("handles non-JSON responses by synthesising from status", async () => {
    const res = {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.reject(new Error("Not JSON")),
      text: () => Promise.resolve("Service Unavailable"),
      headers: new Headers(),
      redirected: false,
      type: "basic",
      url: "https://test/api",
      clone: () => res,
      body: null,
      bodyUsed: false,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      blob: () => Promise.resolve(new Blob()),
      formData: () => Promise.resolve(new FormData()),
    } as unknown as Response;

    const err = await parseApiError(res);
    expect(err.code).toBe("SRV_INTERNAL");
    expect(err.message).toBe("An internal server error occurred.");
  });

  it("handles null body gracefully", async () => {
    const res = mockResponse(500, null);
    const err = await parseApiError(res);
    expect(err.code).toBe("SRV_INTERNAL");
  });

  it("maps 401 status to AUTH_INVALID_TOKEN", async () => {
    const res = mockResponse(401, {});
    const err = await parseApiError(res);
    expect(err.code).toBe("AUTH_INVALID_TOKEN");
  });

  it("maps 429 status to RATE_LIMITED_GLOBAL", async () => {
    const res = mockResponse(429, {});
    const err = await parseApiError(res);
    expect(err.code).toBe("RATE_LIMITED_GLOBAL");
  });

  it("maps 404 status to RES_NOT_FOUND", async () => {
    const res = mockResponse(404, {});
    const err = await parseApiError(res);
    expect(err.code).toBe("RES_NOT_FOUND");
  });
});

describe("getContractErrorMessage()", () => {
  it("maps contract error code 1 to CONTRACT_ALREADY_INITIALIZED", () => {
    const err = getContractErrorMessage(1);
    expect(err.code).toBe("CONTRACT_ALREADY_INITIALIZED");
    expect(err.message).toBe("Contract is already initialized.");
  });

  it("maps contract error code 2 with raw message", () => {
    const err = getContractErrorMessage(2, "Unauthorized caller");
    expect(err.code).toBe("CONTRACT_UNAUTHORIZED");
    expect(err.details).toEqual({ contractMessage: "Unauthorized caller" });
  });

  it("maps unknown contract code to GEN_UNKNOWN", () => {
    const err = getContractErrorMessage(999);
    expect(err.code).toBe("GEN_UNKNOWN");
  });
});

describe("getErrorMessage()", () => {
  it("returns the correct error for a known code", () => {
    const err = getErrorMessage("AUTH_FORBIDDEN");
    expect(err.code).toBe("AUTH_FORBIDDEN");
    expect(err.message).toBe(
      "You do not have permission to access this resource.",
    );
  });

  it("falls back to GEN_UNKNOWN for an unknown code", () => {
    const err = getErrorMessage("MADE_UP_CODE");
    expect(err.code).toBe("GEN_UNKNOWN");
  });

  it("includes optional details", () => {
    const err = getErrorMessage("VAL_INVALID_PUBLIC_KEY", {
      provided: "bad-key",
    });
    expect(err.details).toEqual({ provided: "bad-key" });
  });
});

describe("isRetryableError()", () => {
  it("returns true for SRV_INTERNAL", () => {
    expect(isRetryableError("SRV_INTERNAL")).toBe(true);
  });

  it("returns true for rate limit errors", () => {
    expect(isRetryableError("RATE_LIMITED_GLOBAL")).toBe(true);
    expect(isRetryableError("RATE_LIMITED_SENSITIVE")).toBe(true);
  });

  it("returns true for network/timeout errors", () => {
    expect(isRetryableError("GEN_NETWORK_ERROR")).toBe(true);
    expect(isRetryableError("PAY_CONFIRMATION_TIMEOUT")).toBe(true);
  });

  it("returns false for validation errors", () => {
    expect(isRetryableError("VAL_INVALID_PUBLIC_KEY")).toBe(false);
    expect(isRetryableError("VAL_MISSING_FIELD")).toBe(false);
  });

  it("returns false for auth errors", () => {
    expect(isRetryableError("AUTH_EXPIRED_TOKEN")).toBe(false);
    expect(isRetryableError("AUTH_FORBIDDEN")).toBe(false);
  });
});

describe("isSupportError()", () => {
  it("returns true for internal server errors", () => {
    expect(isSupportError("SRV_INTERNAL")).toBe(true);
  });

  it("returns true for contract transfer failures", () => {
    expect(isSupportError("CONTRACT_TRANSFER_FAILED")).toBe(true);
  });

  it("returns false for common errors", () => {
    expect(isSupportError("AUTH_EXPIRED_TOKEN")).toBe(false);
    expect(isSupportError("VAL_MISSING_FIELD")).toBe(false);
  });
});

describe("error codes contract with ERROR_CODES", () => {
  it("every retryable code exists in ERROR_CODES", () => {
    // Spot-check a few known retryable codes
    const sample = ["SRV_INTERNAL", "RATE_LIMITED_GLOBAL", "GEN_NETWORK_ERROR"];
    for (const code of sample) {
      expect(ERROR_CODES[code]).toBeDefined();
    }
  });

  it("every support code exists in ERROR_CODES", () => {
    const sample = ["SRV_INTERNAL", "CONTRACT_TRANSFER_FAILED"];
    for (const code of sample) {
      expect(ERROR_CODES[code]).toBeDefined();
    }
  });
});
