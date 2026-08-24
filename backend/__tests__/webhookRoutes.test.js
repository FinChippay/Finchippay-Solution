/* eslint-env jest */
/**
 * Webhook registration HTTP routes — auth & ownership checks (#696).
 */
"use strict";

const ME = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const OTHER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../src/middleware/auth");

function tokenFor(publicKey) {
  return jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: "1h" });
}

const mockStore = new Map();
let mockNextId = 1;

jest.mock("../src/services/webhookService", () => ({
  registerWebhook: jest.fn((publicKey, url, secret, topics = ["all"]) => {
    const webhook = {
      id: String(mockNextId++),
      publicKey,
      url,
      secret,
      topics,
      createdAt: new Date().toISOString(),
    };
    mockStore.set(webhook.id, webhook);
    return webhook;
  }),
  getWebhooksByPublicKey: jest.fn((publicKey) =>
    Array.from(mockStore.values()).filter((w) => w.publicKey === publicKey),
  ),
  getWebhookById: jest.fn((id) => mockStore.get(id) || null),
  deleteWebhook: jest.fn((id) => mockStore.delete(id)),
  restoreWebhooks: jest.fn(() => 0),
  getDeadDeliveries: jest.fn(() => []),
  retryDeadDeliveries: jest.fn(() => ({ reset: 0 })),
  getEvents: jest.fn(() => []),
  replayEvents: jest.fn(() => ({ replayed: 0 })),
  getEventStats: jest.fn(() => []),
  getDeliveries: jest.fn(() => ({ deliveries: [], total: 0, page: 1, limit: 20 })),
  getDeliveryById: jest.fn(() => null),
}));

const express = require("express");
const request = require("supertest");
const webhookRoutes = require("../src/routes/webhooks");
const webhookService = require("../src/services/webhookService");

function app() {
  const server = express();
  server.use(express.json());
  server.use("/api/webhooks", webhookRoutes);
  return server;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockNextId = 1;
});

// ─── Auth rejection tests ──────────────────────────────────────────────────────

describe("webhook routes — auth requirements (#696)", () => {
  it("GET /:publicKey rejects unauthenticated requests with 401", async () => {
    const res = await request(app()).get(`/api/webhooks/${ME}`);
    expect(res.status).toBe(401);
  });

  it("GET /:publicKey rejects accessing another account's webhooks with 403", async () => {
    const res = await request(app())
      .get(`/api/webhooks/${OTHER}`)
      .set("Authorization", `Bearer ${tokenFor(ME)}`);
    expect(res.status).toBe(403);
  });

  it("POST / rejects publicKey mismatch with 403", async () => {
    const res = await request(app())
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${tokenFor(ME)}`)
      .send({
        publicKey: OTHER,
        url: "https://x.test/hook",
        secret: "supersecret",
      });
    expect(res.status).toBe(403);
  });

  it("POST /:publicKey/replay rejects unauthenticated requests with 401", async () => {
    const res = await request(app())
      .post(`/api/webhooks/${ME}/replay`)
      .send({ eventIds: ["ev1"] });
    expect(res.status).toBe(401);
  });

  it("DELETE /:id rejects unauthenticated requests with 401", async () => {
    const res = await request(app()).delete("/api/webhooks/1");
    expect(res.status).toBe(401);
  });

  it("DELETE /:id rejects when webhook belongs to another account", async () => {
    mockStore.set("wh-other", {
      id: "wh-other",
      publicKey: OTHER,
      url: "https://x.test/h2",
      secret: "enc-secret",
      topics: ["all"],
      createdAt: new Date().toISOString(),
    });

    const res = await request(app())
      .delete("/api/webhooks/wh-other")
      .set("Authorization", `Bearer ${tokenFor(ME)}`);
    expect(res.status).toBe(403);
  });
});

// ─── POST /api/webhooks (authenticated) ────────────────────────────────────────

describe("POST /api/webhooks", () => {
  it("requires publicKey, url, and secret", async () => {
    const res = await request(app())
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${tokenFor(ME)}`)
      .send({ url: "https://x.test/h" });
    // Validation runs before ownership check; body missing publicKey
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("defaults omitted topics to all", async () => {
    const res = await request(app())
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${tokenFor(ME)}`)
      .send({
        publicKey: ME,
        url: "https://x.test/hook",
        secret: "supersecret",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.webhook.topics).toEqual(["all"]);
    expect(webhookService.registerWebhook).toHaveBeenCalledWith(
      ME,
      "https://x.test/hook",
      "supersecret",
      ["all"],
    );
  });

  it("accepts and normalizes explicit topics", async () => {
    const res = await request(app())
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${tokenFor(ME)}`)
      .send({
        publicKey: ME,
        url: "https://x.test/hook",
        secret: "supersecret",
        topics: ["payment.received", "payment.received", "stream.claimed"],
      });

    expect(res.status).toBe(201);
    expect(webhookService.registerWebhook).toHaveBeenCalledWith(
      ME,
      "https://x.test/hook",
      "supersecret",
      ["payment.received", "stream.claimed"],
    );
  });

  it("collapses all with other topics to all", async () => {
    const res = await request(app())
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${tokenFor(ME)}`)
      .send({
        publicKey: ME,
        url: "https://x.test/hook",
        secret: "supersecret",
        topics: ["all", "payment.received"],
      });

    expect(res.status).toBe(201);
    expect(webhookService.registerWebhook).toHaveBeenCalledWith(
      ME,
      "https://x.test/hook",
      "supersecret",
      ["all"],
    );
  });

  it("rejects unsupported topics with a descriptive 400", async () => {
    const res = await request(app())
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${tokenFor(ME)}`)
      .send({
        publicKey: ME,
        url: "https://x.test/hook",
        secret: "supersecret",
        topics: ["unknown.event"],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid webhook topic/i);
  });
});

// ─── GET /api/webhooks/:publicKey (authenticated) ──────────────────────────────

describe("GET /api/webhooks/:publicKey", () => {
  it("returns subscribed topics for own account", async () => {
    mockStore.set("1", {
      id: "1",
      publicKey: ME,
      url: "https://x.test/hook",
      secret: "enc-secret",
      topics: ["payment.received"],
      createdAt: new Date().toISOString(),
    });

    const res = await request(app())
      .get(`/api/webhooks/${ME}`)
      .set("Authorization", `Bearer ${tokenFor(ME)}`);
    // The route uses getWebhooksByPublicKey, not the in-memory store,
    // and the ownership check uses the :publicKey param (not DB lookup).
    // getWebhooksByPublicKey mock returns filtered results from store.
    expect(res.status).toBe(200);
    expect(res.body.webhooks).toHaveLength(1);
    expect(res.body.webhooks[0].topics).toEqual(["payment.received"]);
  });
});

// ─── GET /api/webhooks/:publicKey/failures (authenticated) ─────────────────────

describe("GET /api/webhooks/:publicKey/failures", () => {
  it("returns dead deliveries for the own account", async () => {
    webhookService.getDeadDeliveries.mockReturnValue([
      {
        id: "del-1",
        webhook_id: "1",
        event_type: "payment.received",
        status: "dead",
        attempts: 5,
      },
    ]);

    const res = await request(app())
      .get(`/api/webhooks/${ME}/failures`)
      .set("Authorization", `Bearer ${tokenFor(ME)}`);
    expect(res.status).toBe(200);
    expect(res.body.failures).toHaveLength(1);
    expect(res.body.failures[0].status).toBe("dead");
  });

  it("rejects when trying to access another account's failures", async () => {
    const res = await request(app())
      .get(`/api/webhooks/${OTHER}/failures`)
      .set("Authorization", `Bearer ${tokenFor(ME)}`);
    expect(res.status).toBe(403);
  });
});

// ─── POST /api/webhooks/:publicKey/retry (authenticated) ───────────────────────

describe("POST /api/webhooks/:publicKey/retry", () => {
  it("resets dead deliveries for own account", async () => {
    webhookService.retryDeadDeliveries.mockReturnValue({ reset: 3 });

    const res = await request(app())
      .post(`/api/webhooks/${ME}/retry`)
      .set("Authorization", `Bearer ${tokenFor(ME)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reset).toBe(3);
    expect(webhookService.retryDeadDeliveries).toHaveBeenCalledWith(ME);
  });
});

// ─── DELETE /api/webhooks/:id (authenticated) ──────────────────────────────────

describe("DELETE /api/webhooks/:id", () => {
  beforeEach(() => {
    mockStore.set("1", {
      id: "1",
      publicKey: ME,
      url: "https://x.test/h",
      secret: "enc-secret",
      topics: ["all"],
      createdAt: new Date().toISOString(),
    });
  });

  it("deletes an own webhook", async () => {
    webhookService.deleteWebhook.mockReturnValue(true);

    const res = await request(app())
      .delete("/api/webhooks/1")
      .set("Authorization", `Bearer ${tokenFor(ME)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 when the webhook does not exist", async () => {
    webhookService.deleteWebhook.mockReturnValue(false);

    const res = await request(app())
      .delete("/api/webhooks/nonexistent")
      .set("Authorization", `Bearer ${tokenFor(ME)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("RES_NOT_FOUND");
  });
});