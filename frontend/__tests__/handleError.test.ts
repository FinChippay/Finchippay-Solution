/**
 * __tests__/handleError.test.ts
 * #270 — mapping error codes to user-facing copy and recovery actions.
 */

import {
  describeError,
  handleApiError,
  handleError,
  handleContractError,
  formatForDisplay,
} from "@/lib/handleError";
import { ERROR_CODES } from "../../shared/errorCodes";

/** Minimal fetch Response stand-in. */
function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("describeError()", () => {
  it("returns user copy and a recovery action for a mapped code", () => {
    const handled = describeError("PAY_INSUFFICIENT_BALANCE");

    expect(handled.code).toBe("PAY_INSUFFICIENT_BALANCE");
    expect(handled.title).toBe("Not enough balance");
    expect(handled.userMessage).toMatch(/will not cover this payment/i);
    expect(handled.action).toEqual({ kind: "fund", label: "Add funds" });
  });

  it("keeps the catalogue message separate from the user-facing copy", () => {
    const handled = describeError("VAL_INVALID_PUBLIC_KEY");

    expect(handled.message).toBe(ERROR_CODES.VAL_INVALID_PUBLIC_KEY.message);
    expect(handled.userMessage).not.toBe(handled.message);
  });

  it("labels the owning layer", () => {
    expect(describeError("AUTH_FORBIDDEN").layer).toBe("api");
    expect(describeError("CONTRACT_PAUSED").layer).toBe("contract");
    expect(describeError("WALLET_LOCKED").layer).toBe("frontend");
  });

  it("falls back to the category default for an unmapped code", () => {
    // Registered, but deliberately absent from the user-copy table.
    const handled = describeError("VAL_INVALID_DATE");

    expect(handled.title).toBe("Check your details");
    expect(handled.action.kind).toBe("fix_input");
    // Still reads as a sentence rather than an empty string.
    expect(handled.userMessage).toBe(ERROR_CODES.VAL_INVALID_DATE.message);
  });

  it("falls back to GEN_UNKNOWN for a code that is not registered at all", () => {
    expect(describeError("NOT_A_REAL_CODE").code).toBe("GEN_UNKNOWN");
  });

  it("prefers contact support over retry when a retry cannot help", () => {
    // SRV_INTERNAL is both retryable and a support case; the user gets the
    // action that can actually resolve it.
    const handled = describeError("SRV_INTERNAL");

    expect(handled.retryable).toBe(true);
    expect(handled.action.kind).toBe("contact_support");
  });

  it("marks transient failures as retryable", () => {
    expect(describeError("SRV_HORIZON_UNAVAILABLE").retryable).toBe(true);
    expect(describeError("VAL_INVALID_AMOUNT").retryable).toBe(false);
  });

  it("routes expired sessions to re-authentication, including the legacy code", () => {
    expect(describeError("AUTH_EXPIRED_TOKEN").action.kind).toBe("reauth");
    expect(describeError("TOKEN_EXPIRED").action.kind).toBe("reauth");
  });

  it("carries the correlation ID through", () => {
    const handled = describeError("SRV_INTERNAL", { correlationId: "abc-123" });
    expect(handled.correlationId).toBe("abc-123");
  });
});

describe("every recovery action is one the UI knows how to render", () => {
  const KINDS = [
    "retry",
    "reconnect",
    "reauth",
    "fix_input",
    "wait",
    "fund",
    "contact_support",
    "none",
  ];

  it("holds for every code in the catalogue", () => {
    for (const code of Object.keys(ERROR_CODES)) {
      const handled = describeError(code);

      expect(KINDS).toContain(handled.action.kind);
      expect(handled.action.label.length).toBeGreaterThan(0);
      expect(handled.title.length).toBeGreaterThan(0);
      expect(handled.userMessage.length).toBeGreaterThan(0);
    }
  });
});

describe("handleApiError()", () => {
  it("reads the code, message, and correlation ID from the canonical body", async () => {
    const handled = await handleApiError(
      mockResponse(400, {
        error: {
          code: "VAL_MISSING_FIELD",
          message: "Required field is missing.",
          correlationId: "req-42",
          details: { fields: ["anchorName"] },
        },
      }),
    );

    expect(handled.code).toBe("VAL_MISSING_FIELD");
    expect(handled.title).toBe("Missing information");
    expect(handled.action.kind).toBe("fix_input");
    expect(handled.correlationId).toBe("req-42");
    expect(handled.details).toEqual({ fields: ["anchorName"] });
  });

  it("falls back to the X-Request-ID header when the body omits the ID", async () => {
    const handled = await handleApiError(
      mockResponse(
        500,
        { error: { code: "SRV_INTERNAL", message: "boom" } },
        { "X-Request-ID": "header-id" },
      ),
    );

    expect(handled.correlationId).toBe("header-id");
  });

  it("still handles a legacy { error: string } body", async () => {
    const handled = await handleApiError(
      mockResponse(404, { error: "Not found" }),
    );

    expect(handled.code).toBe("RES_NOT_FOUND");
    expect(handled.title).toBe("Not found");
  });

  it("handles a non-JSON body by synthesising from the status", async () => {
    const broken = {
      status: 429,
      headers: new Headers(),
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response;

    const handled = await handleApiError(broken);

    expect(handled.code).toBe("RATE_LIMITED_GLOBAL");
    expect(handled.action.kind).toBe("wait");
  });
});

describe("handleError()", () => {
  it("uses a code carried on the thrown object", () => {
    const handled = handleError({
      code: "WALLET_NOT_CONNECTED",
      correlationId: "x-1",
    });

    expect(handled.code).toBe("WALLET_NOT_CONNECTED");
    expect(handled.action.kind).toBe("reconnect");
    expect(handled.correlationId).toBe("x-1");
  });

  it("recognises a wallet rejection from its message", () => {
    const handled = handleError(new Error("User declined access"));

    expect(handled.code).toBe("WALLET_SIGNATURE_REJECTED");
    expect(handled.action.kind).toBe("retry");
  });

  it("recognises a failed fetch as a network problem", () => {
    const handled = handleError(new TypeError("Failed to fetch"));

    expect(handled.code).toBe("GEN_NETWORK_ERROR");
    expect(handled.action.kind).toBe("retry");
  });

  it("uses the caller's fallback code when nothing is inferable", () => {
    const handled = handleError(new Error("???"), "WALLET_NOT_INSTALLED");

    expect(handled.code).toBe("WALLET_NOT_INSTALLED");
    // The raw message is kept for logs, not shown to the user.
    expect(handled.message).toBe("???");
    expect(handled.userMessage).toMatch(/freighter/i);
  });

  it("defaults to GEN_UNKNOWN with no fallback supplied", () => {
    expect(handleError(null).code).toBe("GEN_UNKNOWN");
    expect(handleError(undefined).code).toBe("GEN_UNKNOWN");
    expect(handleError("some string").code).toBe("GEN_UNKNOWN");
  });
});

describe("handleContractError()", () => {
  it("maps a numeric ContractError variant to user copy", () => {
    const handled = handleContractError(12);

    expect(handled.code).toBe("CONTRACT_PAUSED");
    expect(handled.layer).toBe("contract");
    expect(handled.action.kind).toBe("wait");
  });

  it("keeps the raw contract message in details", () => {
    const handled = handleContractError(5, "Error(Contract, #5)");

    expect(handled.code).toBe("CONTRACT_NOT_FOUND");
    expect(handled.details).toEqual({ contractMessage: "Error(Contract, #5)" });
  });

  it("falls back to GEN_UNKNOWN for an unmapped variant", () => {
    expect(handleContractError(99).code).toBe("GEN_UNKNOWN");
  });
});

describe("formatForDisplay()", () => {
  it("appends the reference for support cases", () => {
    const handled = describeError("SRV_INTERNAL", { correlationId: "abc-123" });

    expect(formatForDisplay(handled)).toContain("(reference: abc-123)");
  });

  it("omits the reference when the user can fix it themselves", () => {
    const handled = describeError("VAL_INVALID_AMOUNT", {
      correlationId: "abc-123",
    });

    expect(formatForDisplay(handled)).toBe(handled.userMessage);
    expect(formatForDisplay(handled)).not.toContain("abc-123");
  });

  it("omits the reference on a support case with no ID", () => {
    const handled = describeError("SRV_INTERNAL");

    expect(formatForDisplay(handled)).toBe(handled.userMessage);
  });
});
