/* eslint-env jest */
"use strict";

const express = require("express");
const request = require("supertest");
const correlationIdMiddleware = require("../src/middleware/correlationId");
const { setCorrelationIdProvider, formatErrorResponse } = require("../../shared/errorCodes");

function buildApp() {
  const app = express();
  app.use(correlationIdMiddleware);
  app.get("/ok", (req, res) => {
    res.json({ correlationId: req.correlationId, hasLog: typeof req.log?.info === "function" });
  });
  app.get("/error", (req, res) => {
    res.status(500).json(formatErrorResponse("SRV_INTERNAL"));
  });
  return app;
}

describe("correlationIdMiddleware", () => {
  beforeAll(() => {
    setCorrelationIdProvider(correlationIdMiddleware.getCorrelationId);
  });

  it("generates a UUIDv4 correlation ID and returns it in the response header", async () => {
    const app = buildApp();
    const res = await request(app).get("/ok");

    expect(res.headers["x-correlation-id"]).toBeDefined();
    expect(res.headers["x-correlation-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(res.body.correlationId).toBe(res.headers["x-correlation-id"]);
    expect(res.body.hasLog).toBe(true);
  });

  it("propagates an incoming X-Correlation-ID header instead of overwriting it", async () => {
    const app = buildApp();
    const incomingId = "client-supplied-id-123";
    const res = await request(app).get("/ok").set("X-Correlation-ID", incomingId);

    expect(res.headers["x-correlation-id"]).toBe(incomingId);
    expect(res.body.correlationId).toBe(incomingId);
  });

  it("ignores an invalid incoming header and generates a fresh ID instead", async () => {
    const app = buildApp();
    const res = await request(app).get("/ok").set("X-Correlation-ID", "not valid! header value");

    expect(res.headers["x-correlation-id"]).not.toBe("not valid! header value");
    expect(res.headers["x-correlation-id"]).toMatch(/^[A-Za-z0-9-]{1,128}$/);
  });

  it("includes the correlation ID in error response bodies", async () => {
    const app = buildApp();
    const incomingId = "error-path-test-id";
    const res = await request(app).get("/error").set("X-Correlation-ID", incomingId);

    expect(res.status).toBe(500);
    expect(res.body.error.correlationId).toBe(incomingId);
  });

  it("assigns a different correlation ID to each request when none is supplied", async () => {
    const app = buildApp();
    const [res1, res2] = await Promise.all([request(app).get("/ok"), request(app).get("/ok")]);

    expect(res1.headers["x-correlation-id"]).not.toBe(res2.headers["x-correlation-id"]);
  });
});
