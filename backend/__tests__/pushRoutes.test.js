/* eslint-env jest */
/**
 * Push subscription HTTP routes.
 *
 * The ownership rule is the point of most of these cases: a push subscription
 * is a delivery channel for an account's payment activity, so the route must
 * take the owner from the SEP-10 token and never from the request body.
 */

"use strict";

jest.mock("../src/services/pushService", () => ({
  addSubscription: jest.fn(),
  removeSubscription: jest.fn(),
  listSubscriptions: jest.fn(),
  getPublicKey: jest.fn(),
  isPushEnabled: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const pushRoutes = require("../src/routes/push");
const pushService = require("../src/services/pushService");
const { JWT_SECRET } = require("../src/middleware/auth");

const ME = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const SOMEONE_ELSE = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";

const ENDPOINT = "https://push.example.com/device-1";
const SUBSCRIPTION = {
  endpoint: ENDPOINT,
  keys: { p256dh: "p256dh-key", auth: "auth-secret" },
};

function app() {
  const server = express();
  server.use(express.json());
  server.use("/api/push", pushRoutes);
  return server;
}

const tokenFor = (publicKey) => jwt.sign({ publicKey }, JWT_SECRET);
const auth = (publicKey) => `Bearer ${tokenFor(publicKey)}`;

beforeEach(() => {
  jest.clearAllMocks();
  pushService.addSubscription.mockResolvedValue({ created: true });
  pushService.removeSubscription.mockResolvedValue({ removed: 1 });
  pushService.listSubscriptions.mockResolvedValue([]);
  pushService.getPublicKey.mockReturnValue("test-public-key");
  pushService.isPushEnabled.mockReturnValue(true);
});

describe("GET /api/push/public-key", () => {
  it("returns the VAPID public key without authentication", async () => {
    const res = await request(app()).get("/api/push/public-key");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      publicKey: "test-public-key",
      enabled: true,
    });
  });

  it("reports disabled when the server has no keys", async () => {
    pushService.getPublicKey.mockReturnValue(null);
    pushService.isPushEnabled.mockReturnValue(false);

    const res = await request(app()).get("/api/push/public-key");

    expect(res.body.data).toEqual({ publicKey: null, enabled: false });
  });
});

describe("POST /api/push/subscribe", () => {
  it("stores the subscription for the authenticated account", async () => {
    const res = await request(app())
      .post("/api/push/subscribe")
      .set("Authorization", auth(ME))
      .send({ publicKey: ME, subscription: SUBSCRIPTION });

    expect(res.status).toBe(201);
    expect(pushService.addSubscription).toHaveBeenCalledWith(ME, SUBSCRIPTION);
  });

  it("takes the owner from the token, not the body", async () => {
    await request(app())
      .post("/api/push/subscribe")
      .set("Authorization", auth(ME))
      .send({ subscription: SUBSCRIPTION });

    expect(pushService.addSubscription).toHaveBeenCalledWith(ME, SUBSCRIPTION);
  });

  it("refuses to register a device against another account", async () => {
    const res = await request(app())
      .post("/api/push/subscribe")
      .set("Authorization", auth(ME))
      .send({ publicKey: SOMEONE_ELSE, subscription: SUBSCRIPTION });

    expect(res.status).toBe(403);
    expect(pushService.addSubscription).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const res = await request(app())
      .post("/api/push/subscribe")
      .send({ subscription: SUBSCRIPTION });

    expect(res.status).toBe(401);
    expect(pushService.addSubscription).not.toHaveBeenCalled();
  });

  it("returns 200 rather than 201 when the device was already known", async () => {
    pushService.addSubscription.mockResolvedValue({ created: false });

    const res = await request(app())
      .post("/api/push/subscribe")
      .set("Authorization", auth(ME))
      .send({ subscription: SUBSCRIPTION });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ created: false });
  });

  it.each([
    ["a missing subscription", {}],
    ["a non-HTTPS endpoint", { subscription: { ...SUBSCRIPTION, endpoint: "http://x.test/a" } }],
    ["missing keys", { subscription: { endpoint: ENDPOINT } }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await request(app())
      .post("/api/push/subscribe")
      .set("Authorization", auth(ME))
      .send(body);

    expect(res.status).toBe(400);
    expect(pushService.addSubscription).not.toHaveBeenCalled();
  });
});

describe("POST /api/push/unsubscribe", () => {
  it("removes the caller's subscription", async () => {
    const res = await request(app())
      .post("/api/push/unsubscribe")
      .set("Authorization", auth(ME))
      .send({ endpoint: ENDPOINT });

    expect(res.status).toBe(200);
    expect(pushService.removeSubscription).toHaveBeenCalledWith(ME, ENDPOINT);
  });

  it("succeeds when there was nothing to remove, so retries are safe", async () => {
    pushService.removeSubscription.mockResolvedValue({ removed: 0 });

    const res = await request(app())
      .post("/api/push/unsubscribe")
      .set("Authorization", auth(ME))
      .send({ endpoint: ENDPOINT });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ removed: 0 });
  });

  it("refuses to unsubscribe on behalf of another account", async () => {
    const res = await request(app())
      .post("/api/push/unsubscribe")
      .set("Authorization", auth(ME))
      .send({ publicKey: SOMEONE_ELSE, endpoint: ENDPOINT });

    expect(res.status).toBe(403);
    expect(pushService.removeSubscription).not.toHaveBeenCalled();
  });

  it("requires an endpoint", async () => {
    const res = await request(app())
      .post("/api/push/unsubscribe")
      .set("Authorization", auth(ME))
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("GET /api/push/subscriptions", () => {
  it("lists the caller's devices without exposing full endpoints", async () => {
    pushService.listSubscriptions.mockResolvedValue([
      {
        id: 1,
        endpoint: `${ENDPOINT}/a-very-long-opaque-token-that-should-not-be-returned`,
        created_at: "2026-01-01T00:00:00.000Z",
        last_used_at: null,
      },
    ]);

    const res = await request(app()).get("/api/push/subscriptions").set("Authorization", auth(ME));

    expect(res.status).toBe(200);
    expect(pushService.listSubscriptions).toHaveBeenCalledWith(ME);
    expect(res.body.data[0].endpointPreview).toHaveLength(41); // 40 chars + ellipsis
    expect(JSON.stringify(res.body)).not.toContain(
      "a-very-long-opaque-token-that-should-not-be-returned",
    );
  });

  it("requires authentication", async () => {
    const res = await request(app()).get("/api/push/subscriptions");
    expect(res.status).toBe(401);
  });
});
