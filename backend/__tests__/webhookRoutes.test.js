/* eslint-env jest */
/**
 * Webhook registration HTTP routes (WS1: verifyJWT + ownership scoping).
 *
 * Uses the REAL verifyJWT middleware with issued tokens so both the 401
 * (unauthenticated) and 403 (cross-user / ownership) guarantees are exercised.
 * webhookService is mocked so no database is touched.
 */
"use strict";

jest.mock("../src/middleware/rateLimit", () => ({
  strictLimiter: (req, res, next) => next(),
  sensitiveLimiter: (req, res, next) => next(),
}));

jest.mock("../src/services/webhookService", () => ({
  registerWebhook: jest.fn(),
  getWebhooksByPublicKey: jest.fn(),
  deleteWebhook: jest.fn(),
  getWebhookById: jest.fn(),
  getEvents: jest.fn(),
  replayEvents: jest.fn(),
  getEventStats: jest.fn(),
  getDeadDeliveries: jest.fn(),
  retryDeadDeliveries: jest.fn(),
  getDeliveries: jest.fn(),
  getDeliveryById: jest.fn(),
  restoreWebhooks: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");
const webhookRoutes = require("../src/routes/webhooks");
const webhookService = require("../src/services/webhookService");
const { JWT_SECRET } = require("../src/middleware/auth");

const OWNER = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const OTHER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

function tokenFor(publicKey, expiresIn = 60) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: expiresIn * 60, algorithm: "HS256" });
}

function app() {
  const server = express();
  server.use(express.json());
  server.use("/api/webhooks", webhookRoutes);
  return server;
}

const VALID_PAYLOAD = {
  publicKey: OWNER,
  url: "https://x.test/hook",
  secret: "supersecret",
};

beforeEach(() => {
  jest.clearAllMocks();
  webhookService.registerWebhook.mockResolvedValue({
    id: "wh-1",
    publicKey: OWNER,
    url: "https://x.test/hook",
    createdAt: new Date().toISOString(),
  });
  webhookService.getWebhooksByPublicKey.mockResolvedValue([]);
  webhookService.getWebhookById.mockResolvedValue({
    id: "wh-1",
    publicKey: OWNER,
    url: "https://x.test/hook",
    secret: "enc:secret",
  });
});

describe("Authorization is enforced (WS1)", () => {
  it.each([
    ["POST", "/api/webhooks", VALID_PAYLOAD],
    ["GET", `/api/webhooks/${OWNER}`, undefined],
    ["GET", `/api/webhooks/${OWNER}/events`, undefined],
    ["GET", `/api/webhooks/${OWNER}/failures`, undefined],
    ["POST", `/api/webhooks/${OWNER}/retry`, undefined],
    ["DELETE", "/api/webhooks/wh-1", undefined],
  ])("%s %s returns 401 without a valid JWT", async (method, path, body) => {
    const req = request(app())[method.toLowerCase()](path);
    if (body) req.send(body);
    const res = await req;
    expect(res.status).toBe(401);
  });

  it.each([
    ["GET", `/api/webhooks/${OWNER}`],
    ["GET", `/api/webhooks/${OWNER}/events`],
    ["GET", `/api/webhooks/${OWNER}/events/stats`],
    ["GET", `/api/webhooks/${OWNER}/failures`],
    ["GET", `/api/webhooks/${OWNER}/deliveries`],
    ["POST", `/api/webhooks/${OWNER}/replay`],
    ["POST", `/api/webhooks/${OWNER}/retry`],
  ])("%s %s returns 403 for cross-user access", async (method, path) => {
    const res = await request(app())
      [method.toLowerCase()](path)
      .set("Authorization", `Bearer ${tokenFor(OTHER)}`);
    expect(res.status).toBe(403);
  });

  it("DELETE /api/webhooks/:id returns 403 for a webhook owned by another account", async () => {
    webhookService.getWebhookById.mockResolvedValue({
      id: "wh-1",
      publicKey: OTHER,
    });
    const res = await request(app())
      .delete("/api/webhooks/wh-1")
      .set("Authorization", `Bearer ${tokenFor(OWNER)}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/webhooks", () => {
  it("registers a webhook for the authenticated account", async () => {
    const res = await request(app())
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${tokenFor(OWNER)}`)
      .send({ publicKey: OWNER, url: "https://x.test/hook", secret: "supersecret" });

    expect(res.status).toBe(201);
    expect(webhookService.registerWebhook).toHaveBeenCalledWith(
      OWNER,
      "https://x.test/hook",
      "supersecret",
      ["all"], // schema default when topics is omitted
    );
  });

  it("rejects a body publicKey that differs from the authenticated account", async () => {
    const res = await request(app())
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${tokenFor(OWNER)}`)
      .send({ publicKey: OTHER, url: "https://x.test/hook", secret: "supersecret" });

    expect(res.status).toBe(403);
    expect(webhookService.registerWebhook).not.toHaveBeenCalled();
  });

  it("requires url and secret", async () => {
    const res = await request(app())
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${tokenFor(OWNER)}`)
      .send({ publicKey: OWNER, url: "https://x.test/hook" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });
});

// ─── GET /api/webhooks/:publicKey (authenticated) ──────────────────────────────

describe("GET /api/webhooks/:publicKey", () => {
  it("returns the caller's webhooks", async () => {
    webhookService.getWebhooksByPublicKey.mockResolvedValue([
      { id: "1", publicKey: OWNER, url: "https://x.test/hook", topics: ["all"] },
    ]);

    const res = await request(app())
      .get(`/api/webhooks/${OWNER}`)
      .set("Authorization", `Bearer ${tokenFor(OWNER)}`);

    expect(res.status).toBe(200);
    expect(res.body.webhooks).toHaveLength(1);
    expect(webhookService.getWebhooksByPublicKey).toHaveBeenCalledWith(OWNER);
  });

  it("validates public key format", async () => {
    const res = await request(app())
      .get("/api/webhooks/invalid")
      .set("Authorization", `Bearer ${tokenFor(OWNER)}`);
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/webhooks/:id (authenticated) ──────────────────────────────────

describe("DELETE /api/webhooks/:id", () => {
  it("deletes a webhook owned by the caller", async () => {
    webhookService.deleteWebhook.mockResolvedValue(true);

    const res = await request(app())
      .delete("/api/webhooks/wh-1")
      .set("Authorization", `Bearer ${tokenFor(OWNER)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(webhookService.deleteWebhook).toHaveBeenCalledWith("wh-1");
  });

  it("returns 404 when the webhook does not exist", async () => {
    webhookService.getWebhookById.mockResolvedValue(null);
    const res = await request(app())
      .delete("/api/webhooks/missing")
      .set("Authorization", `Bearer ${tokenFor(OWNER)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("RES_NOT_FOUND");
  });
});