/**
 * __tests__/errorResponse.test.js
 * #270 — the canonical error response utility and its correlation-ID wiring.
 */
"use strict";

const express = require("express");
const request = require("supertest");

const {
  buildErrorResponse,
  sendError,
  sendContractError,
  createError,
  errorLogFields,
  statusForCode,
} = require("../src/utils/errorResponse");
const { correlationMiddleware } = require("../src/utils/correlationId");
const { ERROR_CODES } = require("../../shared/errorCodes");

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe("buildErrorResponse()", () => {
  it("returns the canonical shape with the catalogue message", () => {
    const body = buildErrorResponse("VAL_INVALID_AMOUNT");

    expect(body).toEqual({
      error: {
        code: "VAL_INVALID_AMOUNT",
        message: ERROR_CODES.VAL_INVALID_AMOUNT.message,
      },
    });
  });

  it("keeps the error key at the top level for existing consumers", () => {
    expect(Object.keys(buildErrorResponse("RES_NOT_FOUND"))).toEqual(["error"]);
  });

  it("includes details when supplied", () => {
    const body = buildErrorResponse("VAL_MISSING_FIELD", {
      details: { fields: ["anchorName"] },
    });

    expect(body.error.details).toEqual({ fields: ["anchorName"] });
  });

  it("allows a context-specific message to override the catalogue default", () => {
    const body = buildErrorResponse("AUTH_FORBIDDEN", {
      message: "You may only access your own account data.",
    });

    expect(body.error.code).toBe("AUTH_FORBIDDEN");
    expect(body.error.message).toBe(
      "You may only access your own account data.",
    );
  });

  it("falls back to GEN_UNKNOWN for an unregistered code", () => {
    expect(buildErrorResponse("NOT_A_REAL_CODE").error.code).toBe("GEN_UNKNOWN");
  });

  it("omits correlationId outside a request context", () => {
    expect(buildErrorResponse("SRV_INTERNAL").error).not.toHaveProperty(
      "correlationId",
    );
  });
});

describe("statusForCode()", () => {
  it("reads the status from the catalogue", () => {
    expect(statusForCode("AUTH_FORBIDDEN")).toBe(403);
    expect(statusForCode("RES_NOT_FOUND")).toBe(404);
    expect(statusForCode("RATE_LIMITED_GLOBAL")).toBe(429);
  });

  it("maps client-only codes (httpStatus 0) to 500", () => {
    expect(ERROR_CODES.WALLET_NOT_CONNECTED.httpStatus).toBe(0);
    expect(statusForCode("WALLET_NOT_CONNECTED")).toBe(500);
  });
});

describe("createError()", () => {
  it("carries the code, status, and details for the global handler", () => {
    const err = createError("RES_USERNAME_CONFLICT", {
      details: { username: "alice" },
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.errorCode).toBe("RES_USERNAME_CONFLICT");
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ username: "alice" });
    expect(err.message).toBe(ERROR_CODES.RES_USERNAME_CONFLICT.message);
  });

  it("accepts a status override and a cause", () => {
    const cause = new Error("upstream exploded");
    const err = createError("SRV_INTERNAL", { status: 503, cause });

    expect(err.status).toBe(503);
    expect(err.cause).toBe(cause);
  });
});

describe("errorLogFields()", () => {
  it("reports the code, layer, and status for structured logging", () => {
    expect(errorLogFields("CONTRACT_NOT_FOUND")).toEqual({
      errorCode: "CONTRACT_NOT_FOUND",
      errorLayer: "contract",
      status: 404,
    });
  });

  it("labels API and frontend codes with their own layer", () => {
    expect(errorLogFields("AUTH_FORBIDDEN").errorLayer).toBe("api");
    expect(errorLogFields("WALLET_LOCKED").errorLayer).toBe("frontend");
  });
});

// ─── Express integration ──────────────────────────────────────────────────────

function appWith(handler) {
  const app = express();
  app.use(correlationMiddleware);
  app.get("/boom", handler);
  return app;
}

describe("sendError() over HTTP", () => {
  it("uses the catalogue status and returns the canonical body", async () => {
    const app = appWith((req, res) => sendError(res, "AUTH_FORBIDDEN"));
    const res = await request(app).get("/boom");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AUTH_FORBIDDEN");
    expect(res.body.error.message).toBe(ERROR_CODES.AUTH_FORBIDDEN.message);
  });

  it("honours an explicit status override", async () => {
    const app = appWith((req, res) =>
      sendError(res, "SRV_INTERNAL", { status: 503 }),
    );

    expect((await request(app).get("/boom")).status).toBe(503);
  });

  it("stamps the request's correlation ID onto the body", async () => {
    const app = appWith((req, res) => sendError(res, "RES_NOT_FOUND"));
    const res = await request(app).get("/boom");

    expect(res.body.error.correlationId).toBeTruthy();
    // Same value as the header, so a user-quoted ID is searchable in the logs.
    expect(res.body.error.correlationId).toBe(res.headers["x-request-id"]);
  });

  it("adopts an inbound X-Request-ID so a trace spans services", async () => {
    const app = appWith((req, res) => sendError(res, "RES_NOT_FOUND"));
    const res = await request(app)
      .get("/boom")
      .set("X-Request-ID", "trace-me-123");

    expect(res.body.error.correlationId).toBe("trace-me-123");
  });

  it("gives concurrent requests distinct correlation IDs", async () => {
    const app = appWith((req, res) => sendError(res, "RES_NOT_FOUND"));
    const [a, b] = await Promise.all([
      request(app).get("/boom"),
      request(app).get("/boom"),
    ]);

    expect(a.body.error.correlationId).not.toBe(b.body.error.correlationId);
  });
});

describe("sendContractError()", () => {
  it("maps a numeric ContractError variant to its code and status", async () => {
    const app = appWith((req, res) => sendContractError(res, 5));
    const res = await request(app).get("/boom");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CONTRACT_NOT_FOUND");
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it("falls back to GEN_UNKNOWN for an unmapped variant", async () => {
    const app = appWith((req, res) => sendContractError(res, 999));
    const res = await request(app).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("GEN_UNKNOWN");
  });
});
