/* eslint-env jest */
/**
 * __tests__/errorEnvelope.test.js
 * #635 — the RFC 7807 problem+json contract every API error must satisfy.
 *
 * Each case mounts the real middleware on a bare Express app instead of
 * server.js, which cannot load under Jest (@stellar/stellar-sdk ships ESM).
 */
"use strict";

const express = require("express");
const request = require("supertest");
const { z } = require("zod");

const { sendError, createError } = require("../src/utils/errorResponse");
const { correlationMiddleware } = require("../src/utils/correlationId");
const {
  bodyParserErrorHandler,
  notFoundHandler,
  errorHandler,
} = require("../src/middleware/errorHandler");
const { validate } = require("../src/validation/middleware");
const { verifyJWT } = require("../src/middleware/auth");
const { userLimiter } = require("../src/middleware/userRateLimit");
const { ERROR_CODES, PROBLEM_TYPE_BASE } = require("../../shared/errorCodes");

const PROBLEM_CONTENT_TYPE = "application/problem+json; charset=utf-8";

/** A bare app that only carries the correlation ID context. */
function baseApp() {
  const app = express();
  app.use(correlationMiddleware);
  return app;
}

/**
 * Assert the whole envelope: the five RFC 7807 members, the `code` extension,
 * the media type, and that the legacy `error` member still agrees with them.
 *
 * @param {import('supertest').Response} res
 * @param {{ code: string, status: number, instance: string, detail?: string }} expected
 */
function expectEnvelope(res, expected) {
  const { code, status, instance } = expected;

  expect(res.status).toBe(status);
  expect(res.headers["content-type"]).toBe(PROBLEM_CONTENT_TYPE);

  expect(res.body.type).toBe(`${PROBLEM_TYPE_BASE}#${code.toLowerCase()}`);
  expect(res.body.type.endsWith(`#${code.toLowerCase()}`)).toBe(true);
  expect(res.body.title).toBe(ERROR_CODES[code].message);
  expect(res.body.status).toBe(status);
  expect(res.body.status).toBe(res.status);
  expect(typeof res.body.detail).toBe("string");
  expect(res.body.detail.length).toBeGreaterThan(0);
  expect(res.body.instance).toBe(instance);
  expect(res.body.code).toBe(code);

  // The correlation ID is the value the client sees in the header, so a
  // user-quoted ID is searchable in the logs.
  expect(res.body.correlationId).toBeTruthy();
  expect(res.body.correlationId).toBe(res.headers["x-request-id"]);

  // Legacy member: same code, same message, same correlation ID.
  expect(res.body.error).toEqual(
    expect.objectContaining({
      code,
      message: res.body.detail,
      correlationId: res.body.correlationId,
    }),
  );

  if (expected.detail !== undefined) {
    expect(res.body.detail).toBe(expected.detail);
  }
}

// ─── 400 — zod validate() middleware ─────────────────────────────────────────

describe("400 from validate()", () => {
  const schema = z.object({
    amount: z.string({ required_error: "amount is required" }).min(1, "amount is required"),
  });

  function app() {
    const server = baseApp();
    server.use(express.json());
    server.post("/api/tips", validate(schema), (req, res) => res.json({ ok: true }));
    return server;
  }

  it("renders VAL_MISSING_FIELD with the field map as details", async () => {
    const res = await request(app()).post("/api/tips").send({});

    expectEnvelope(res, {
      code: "VAL_MISSING_FIELD",
      status: 400,
      instance: "/api/tips",
      detail: "amount is required",
    });
    expect(res.body.details).toEqual({ amount: ["amount is required"] });
    expect(res.body.error.details).toEqual(res.body.details);
  });

  it("keeps title at the registry message while detail names the field", async () => {
    const res = await request(app()).post("/api/tips").send({});

    expect(res.body.title).toBe(ERROR_CODES.VAL_MISSING_FIELD.message);
    expect(res.body.detail).not.toBe(res.body.title);
  });
});

// ─── 401 — auth middleware ───────────────────────────────────────────────────

describe("401 from verifyJWT()", () => {
  it("renders AUTH_MISSING_HEADER when the Authorization header is absent", async () => {
    const app = baseApp();
    app.get("/api/sep12/customer", verifyJWT, (req, res) => res.json({ ok: true }));

    const res = await request(app).get("/api/sep12/customer");

    expectEnvelope(res, {
      code: "AUTH_MISSING_HEADER",
      status: 401,
      instance: "/api/sep12/customer",
      detail: ERROR_CODES.AUTH_MISSING_HEADER.message,
    });
  });
});

// ─── 403 — direct sendError() ────────────────────────────────────────────────

describe("403 from sendError()", () => {
  it("renders AUTH_FORBIDDEN at the catalogue status", async () => {
    const app = baseApp();
    app.get("/api/admin/backup", (req, res) => sendError(res, "AUTH_FORBIDDEN"));

    const res = await request(app).get("/api/admin/backup");

    expectEnvelope(res, {
      code: "AUTH_FORBIDDEN",
      status: 403,
      instance: "/api/admin/backup",
      detail: ERROR_CODES.AUTH_FORBIDDEN.message,
    });
  });

  it("drops the query string from instance, which can carry secrets", async () => {
    const app = baseApp();
    app.get("/api/admin/backup", (req, res) => sendError(res, "AUTH_FORBIDDEN"));

    const res = await request(app).get("/api/admin/backup?token=s3cret&page=2");

    expect(res.body.instance).toBe("/api/admin/backup");
    expect(res.body.instance).not.toContain("s3cret");
  });
});

// ─── 404 — notFoundHandler ───────────────────────────────────────────────────

describe("404 from notFoundHandler()", () => {
  it("renders RES_ROUTE_NOT_FOUND for an unmatched route", async () => {
    const app = baseApp();
    app.use(notFoundHandler);

    const res = await request(app).get("/api/nope");

    expectEnvelope(res, {
      code: "RES_ROUTE_NOT_FOUND",
      status: 404,
      instance: "/api/nope",
      detail: ERROR_CODES.RES_ROUTE_NOT_FOUND.message,
    });
  });
});

// ─── 400 / 413 — bodyParserErrorHandler ──────────────────────────────────────

describe("body-parser failures", () => {
  function app() {
    const server = baseApp();
    server.use(express.json({ limit: "1kb" }));
    server.post("/api/payments/send", (req, res) => res.json({ ok: true }));
    server.use(bodyParserErrorHandler);
    return server;
  }

  it("renders VAL_INVALID_JSON for a malformed body", async () => {
    const res = await request(app())
      .post("/api/payments/send")
      .set("Content-Type", "application/json")
      .send('{"amount": ');

    expectEnvelope(res, {
      code: "VAL_INVALID_JSON",
      status: 400,
      instance: "/api/payments/send",
      detail: ERROR_CODES.VAL_INVALID_JSON.message,
    });
  });

  it("renders VAL_BODY_TOO_LARGE at 413 for an oversize body", async () => {
    const res = await request(app())
      .post("/api/payments/send")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ memo: "x".repeat(4096) }));

    expectEnvelope(res, {
      code: "VAL_BODY_TOO_LARGE",
      status: 413,
      instance: "/api/payments/send",
      detail: ERROR_CODES.VAL_BODY_TOO_LARGE.message,
    });
  });
});

// ─── 429 — rate limiter ──────────────────────────────────────────────────────

describe("429 from the user rate limiter", () => {
  it("renders RATE_LIMITED_USER once the window is exhausted", async () => {
    const app = baseApp();
    app.use("/api/payments/send", userLimiter, (req, res) => res.json({ ok: true }));

    // The limiter defaults to 30 per window; exhaust it, then trip it.
    for (let i = 0; i < 30; i++) {
      await request(app).get("/api/payments/send").set("Authorization", "Bearer envelope-user");
    }
    const res = await request(app)
      .get("/api/payments/send")
      .set("Authorization", "Bearer envelope-user");

    expectEnvelope(res, {
      code: "RATE_LIMITED_USER",
      status: 429,
      instance: "/api/payments/send",
      detail: "Too many requests from this account",
    });
    // The per-occurrence detail may differ from the stable per-code title.
    expect(res.body.title).toBe(ERROR_CODES.RATE_LIMITED_USER.message);
  });
});

// ─── 500 — terminal errorHandler ─────────────────────────────────────────────

describe("500 from errorHandler()", () => {
  const INTERNAL = "connect ECONNREFUSED 127.0.0.1:5432 at /srv/app/src/db/connection.js:41";

  function app() {
    const server = baseApp();
    server.get("/api/payments/send", () => {
      throw new Error(INTERNAL);
    });
    server.use(errorHandler);
    return server;
  }

  it("renders SRV_INTERNAL for an unexpected throw", async () => {
    const res = await request(app()).get("/api/payments/send");

    expectEnvelope(res, {
      code: "SRV_INTERNAL",
      status: 500,
      instance: "/api/payments/send",
      detail: ERROR_CODES.SRV_INTERNAL.message,
    });
  });

  it("never leaks the internal message, a path, or a stack", async () => {
    const res = await request(app()).get("/api/payments/send");
    const body = JSON.stringify(res.body);

    expect(res.body.detail).not.toContain(INTERNAL);
    expect(res.body.detail).not.toContain("ECONNREFUSED");
    expect(body).not.toContain("ECONNREFUSED");
    expect(body).not.toContain("/srv/app/src/db/connection.js");
    expect(res.body).not.toHaveProperty("stack");
    expect(res.body.error).not.toHaveProperty("stack");
  });
});

// ─── createError() handed to next() ──────────────────────────────────────────

describe("createError() through next()", () => {
  it("renders the code, status, and details carried by the error", async () => {
    const app = baseApp();
    app.post("/api/accounts/register", (req, res, next) =>
      next(createError("RES_USERNAME_CONFLICT", { details: { username: "alice" } })),
    );
    app.use(errorHandler);

    const res = await request(app).post("/api/accounts/register");

    expectEnvelope(res, {
      code: "RES_USERNAME_CONFLICT",
      status: 409,
      instance: "/api/accounts/register",
      detail: ERROR_CODES.RES_USERNAME_CONFLICT.message,
    });
    expect(res.body.details).toEqual({ username: "alice" });
  });

  it("honours a status override without changing the code", async () => {
    const app = baseApp();
    app.get("/api/health", (req, res, next) => next(createError("SRV_INTERNAL", { status: 503 })));
    app.use(errorHandler);

    const res = await request(app).get("/api/health");

    expectEnvelope(res, {
      code: "SRV_INTERNAL",
      status: 503,
      instance: "/api/health",
      detail: ERROR_CODES.SRV_INTERNAL.message,
    });
    // `status` mirrors what was sent, not the catalogue default.
    expect(ERROR_CODES.SRV_INTERNAL.httpStatus).toBe(500);
  });
});
