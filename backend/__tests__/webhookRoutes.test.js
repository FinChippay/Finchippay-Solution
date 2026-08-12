/* eslint-env jest */
/**
 * Webhook registration HTTP routes.
 */
"use strict";

jest.mock("../src/services/webhookSubscriptionService", () => {
  const store = new Map();
  let nextId = 1;
  const deadDeliveries = [];

  return {
    registerWebhook: jest.fn((publicKey, url, secret, topics = ["all"]) => {
      const webhook = {
        id: String(nextId++),
        publicKey,
        url,
        secret,
        topics,
        createdAt: new Date().toISOString(),
      };
      store.set(webhook.id, webhook);
      return webhook;
    }),
    getWebhooksByPublicKey: jest.fn((publicKey) =>
      Array.from(store.values()).filter((w) => w.publicKey === publicKey),
    ),
    deleteWebhook: jest.fn((id) => store.delete(id)),
    restoreWebhooks: jest.fn(() => 0),
    getDeadDeliveries: jest.fn((publicKey) =>
      deadDeliveries.filter((d) => d.publicKey === publicKey),
    ),
    retryDeadDeliveries: jest.fn((publicKey) => {
      const count = deadDeliveries.filter((d) => d.publicKey === publicKey).length;
      return { reset: count };
    }),
    getEvents: jest.fn(() => []),
    replayEvents: jest.fn(() => ({ replayed: 0 })),
    getEventStats: jest.fn(() => []),
  };
});

const express = require("express");
const request = require("supertest");
const webhookRoutes = require("../src/routes/webhooks");
const webhookService = require("../src/services/webhookSubscriptionService");

const ME = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

function app() {
  const server = express();
  server.use(express.json());
  server.use("/api/webhooks", webhookRoutes);
  return server;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/webhooks", () => {
  it("requires publicKey, url, and secret", async () => {
    const res = await request(app()).post("/api/webhooks").send({ url: "https://x.test/h" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("defaults omitted topics to all", async () => {
    const res = await request(app()).post("/api/webhooks").send({
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

describe("GET /api/webhooks/:publicKey", () => {
  it("returns subscribed topics", async () => {
    webhookService.getWebhooksByPublicKey.mockReturnValue([
      {
        id: "1",
        publicKey: ME,
        url: "https://x.test/hook",
        topics: ["payment.received"],
      },
    ]);

    const res = await request(app()).get(`/api/webhooks/${ME}`);
    expect(res.status).toBe(200);
    expect(res.body.webhooks).toHaveLength(1);
    expect(res.body.webhooks[0].topics).toEqual(["payment.received"]);
  });
});

describe("GET /api/webhooks/:publicKey/failures", () => {
  it("returns dead deliveries for the account", async () => {
    webhookService.getDeadDeliveries.mockReturnValue([
      {
        id: "del-1",
        webhook_id: "1",
        event_type: "payment.received",
        status: "dead",
        attempts: 5,
      },
    ]);

    const res = await request(app()).get(`/api/webhooks/${ME}/failures`);
    expect(res.status).toBe(200);
    expect(res.body.failures).toHaveLength(1);
    expect(res.body.failures[0].status).toBe("dead");
  });

  it("validates public key format", async () => {
    const res = await request(app()).get("/api/webhooks/invalid/failures");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/webhooks/:publicKey/retry", () => {
  it("resets dead deliveries for retry", async () => {
    webhookService.retryDeadDeliveries.mockReturnValue({ reset: 3 });

    const res = await request(app()).post(`/api/webhooks/${ME}/retry`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reset).toBe(3);
    expect(webhookService.retryDeadDeliveries).toHaveBeenCalledWith(ME);
  });

  it("validates public key format", async () => {
    const res = await request(app()).post("/api/webhooks/invalid/retry");
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/webhooks/:id", () => {
  it("deletes an existing webhook", async () => {
    webhookService.deleteWebhook.mockReturnValue(true);

    const res = await request(app()).delete("/api/webhooks/1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 when the webhook does not exist", async () => {
    webhookService.deleteWebhook.mockReturnValue(false);

    const res = await request(app()).delete("/api/webhooks/missing");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("RES_NOT_FOUND");
  });
});
