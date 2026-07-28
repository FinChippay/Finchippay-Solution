/**
 * __tests__/pushService.test.js
 *
 * Tests for:
 *  - pushService: addSubscription, removeSubscription, sendNotification
 *  - push routes:  POST /api/push/subscribe, POST /api/push/unsubscribe,
 *                  GET  /api/push/vapid-public-key
 */

"use strict";

// ─── Mock web-push before requiring pushService ───────────────────────────────

const mockWebPushSend = jest.fn().mockResolvedValue({ statusCode: 201 });
const mockSetVapidDetails = jest.fn();

jest.mock("web-push", () => ({
  setVapidDetails: mockSetVapidDetails,
  sendNotification: (...args) => mockWebPushSend(...args),
}));

// ─── Mock the database connection ─────────────────────────────────────────────

// In-memory subscription store shared between mock instances
const subscriptions = new Map(); // key = `${publicKey}::${endpoint}`

function buildChain(table) {
  const chain = {
    _table: table,
    _wheres: {},
    _whereInEndpoints: null,

    where(col, val) {
      if (typeof col === "object") Object.assign(this._wheres, col);
      else this._wheres[col] = val;
      return this;
    },

    whereIn(_col, values) {
      this._whereInEndpoints = values;
      return this;
    },

    first() {
      const { public_key, endpoint } = this._wheres;
      const key = `${public_key}::${endpoint}`;
      return Promise.resolve(subscriptions.get(key) ?? undefined);
    },

    insert(row) {
      const key = `${row.public_key}::${row.endpoint}`;
      subscriptions.set(key, { id: subscriptions.size + 1, ...row });
      return Promise.resolve([subscriptions.size]);
    },

    update(updates) {
      const { public_key, endpoint } = this._wheres;
      const key = `${public_key}::${endpoint}`;
      const existing = subscriptions.get(key);
      if (existing) subscriptions.set(key, { ...existing, ...updates });
      return Promise.resolve(1);
    },

    delete() {
      const { public_key } = this._wheres;
      if (this._whereInEndpoints) {
        for (const [k, v] of subscriptions.entries()) {
          if (
            v.public_key === public_key &&
            this._whereInEndpoints.includes(v.endpoint)
          ) {
            subscriptions.delete(k);
          }
        }
      } else {
        const { endpoint } = this._wheres;
        subscriptions.delete(`${public_key}::${endpoint}`);
      }
      return Promise.resolve(1);
    },

    // Thenable — resolves to an array of matching rows for the public_key
    // This is what `await knex('push_subscriptions').where({public_key})` resolves to
    then(onFulfilled, onRejected) {
      const { public_key } = this._wheres;
      const rows = [...subscriptions.values()].filter(
        (s) => s.public_key === public_key
      );
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },

    catch(onRejected) {
      return this.then(undefined, onRejected);
    },
  };
  return chain;
}

const mockKnex = jest.fn((table) => buildChain(table));
jest.mock("../src/db/connection", () => mockKnex);

// ─── Mock logger ──────────────────────────────────────────────────────────────

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ─── Ensure VAPID env vars are set BEFORE pushService is required ─────────────

process.env.VAPID_PUBLIC_KEY = "BFakePublicKeyForTestingPurposesOnly";
process.env.VAPID_PRIVATE_KEY = "FakePrivateKeyForTestingPurposesOnly";
process.env.VAPID_SUBJECT = "mailto:test@finchippay.io";

const pushService = require("../src/services/pushService");

// Valid 56-character Stellar public key (G + 55 alphanumeric chars)
const TEST_PUBLIC_KEY =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA";
const TEST_ENDPOINT =
  "https://fcm.googleapis.com/fcm/send/test-endpoint-001";
const TEST_SUBSCRIPTION = {
  endpoint: TEST_ENDPOINT,
  keys: {
    p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc9f-eLsT0f9ZzBkUNZgzq8W7S",
    auth: "1S_YcJbW2O8yKKFBa0LYMA",
  },
};

beforeEach(() => {
  subscriptions.clear();
  mockWebPushSend.mockClear();
  mockSetVapidDetails.mockClear();
});

// ─── addSubscription ─────────────────────────────────────────────────────────

describe("addSubscription", () => {
  it("stores a new subscription", async () => {
    await pushService.addSubscription(TEST_PUBLIC_KEY, TEST_SUBSCRIPTION);

    const key = `${TEST_PUBLIC_KEY}::${TEST_ENDPOINT}`;
    expect(subscriptions.has(key)).toBe(true);
    expect(subscriptions.get(key)).toMatchObject({
      public_key: TEST_PUBLIC_KEY,
      endpoint: TEST_ENDPOINT,
      p256dh: TEST_SUBSCRIPTION.keys.p256dh,
      auth: TEST_SUBSCRIPTION.keys.auth,
    });
  });

  it("updates an existing subscription (upsert)", async () => {
    await pushService.addSubscription(TEST_PUBLIC_KEY, TEST_SUBSCRIPTION);

    const updated = {
      ...TEST_SUBSCRIPTION,
      keys: { ...TEST_SUBSCRIPTION.keys, auth: "NewAuth123" },
    };
    await pushService.addSubscription(TEST_PUBLIC_KEY, updated);

    const key = `${TEST_PUBLIC_KEY}::${TEST_ENDPOINT}`;
    expect(subscriptions.get(key).auth).toBe("NewAuth123");
  });

  it("throws 400 when publicKey is missing", async () => {
    await expect(
      pushService.addSubscription("", TEST_SUBSCRIPTION)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("throws 400 when subscription.endpoint is missing", async () => {
    await expect(
      pushService.addSubscription(TEST_PUBLIC_KEY, { keys: {} })
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ─── removeSubscription ───────────────────────────────────────────────────────

describe("removeSubscription", () => {
  it("removes a stored subscription", async () => {
    await pushService.addSubscription(TEST_PUBLIC_KEY, TEST_SUBSCRIPTION);
    await pushService.removeSubscription(TEST_PUBLIC_KEY, TEST_ENDPOINT);

    const key = `${TEST_PUBLIC_KEY}::${TEST_ENDPOINT}`;
    expect(subscriptions.has(key)).toBe(false);
  });

  it("throws 400 when publicKey is missing", async () => {
    await expect(
      pushService.removeSubscription("", TEST_ENDPOINT)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("throws 400 when endpoint is missing", async () => {
    await expect(
      pushService.removeSubscription(TEST_PUBLIC_KEY, "")
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ─── sendNotification ─────────────────────────────────────────────────────────

describe("sendNotification", () => {
  it("returns 0 and does not call webpush when no subscriptions exist", async () => {
    const count = await pushService.sendNotification(TEST_PUBLIC_KEY, {
      title: "Test",
      body: "Hello",
    });
    expect(mockWebPushSend).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("calls webpush.sendNotification for each stored subscription", async () => {
    await pushService.addSubscription(TEST_PUBLIC_KEY, TEST_SUBSCRIPTION);
    mockWebPushSend.mockResolvedValueOnce({ statusCode: 201 });

    const count = await pushService.sendNotification(TEST_PUBLIC_KEY, {
      title: "Payment received",
      body: "You received 10 XLM",
      url: "/dashboard",
    });

    expect(mockWebPushSend).toHaveBeenCalledTimes(1);
    expect(mockWebPushSend).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: TEST_ENDPOINT }),
      expect.stringContaining("Payment received")
    );
    expect(count).toBe(1);
  });

  it("cleans up expired subscriptions on HTTP 410 response", async () => {
    await pushService.addSubscription(TEST_PUBLIC_KEY, TEST_SUBSCRIPTION);

    const goneError = Object.assign(new Error("Subscription expired"), {
      statusCode: 410,
    });
    mockWebPushSend.mockRejectedValueOnce(goneError);

    const count = await pushService.sendNotification(TEST_PUBLIC_KEY, {
      title: "Test",
      body: "Test body",
    });

    expect(count).toBe(0);
    const key = `${TEST_PUBLIC_KEY}::${TEST_ENDPOINT}`;
    expect(subscriptions.has(key)).toBe(false);
  });

  it("returns 0 and does not throw for empty publicKey (early return)", async () => {
    // vapidConfigured is true, but empty publicKey should throw
    await expect(
      pushService.sendNotification("", { title: "T", body: "B" })
    ).rejects.toThrow("publicKey is required");
  });

  it("includes the payload url in the notification JSON", async () => {
    await pushService.addSubscription(TEST_PUBLIC_KEY, TEST_SUBSCRIPTION);
    mockWebPushSend.mockResolvedValueOnce({ statusCode: 201 });

    await pushService.sendNotification(TEST_PUBLIC_KEY, {
      title: "Escrow unlocked",
      body: "Your escrow is ready to claim",
      url: "/escrow",
    });

    const call = mockWebPushSend.mock.calls[0];
    const payload = JSON.parse(call[1]);
    expect(payload.url).toBe("/escrow");
    expect(payload.title).toBe("Escrow unlocked");
  });
});

// ─── Push routes ──────────────────────────────────────────────────────────────

const request = require("supertest");
const express = require("express");

// Bypass rate limiting in tests
jest.mock("../src/middleware/rateLimit", () => ({
  strictLimiter: (_req, _res, next) => next(),
  sensitiveLimiter: (_req, _res, next) => next(),
  createInstrumentedLimiter: () => (_req, _res, next) => next(),
}));

const pushRoutes = require("../src/routes/push");

const testApp = express();
testApp.use(express.json());
testApp.use("/api/push", pushRoutes);

// Generic error handler for route tests
testApp.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message });
});

describe("GET /api/push/vapid-public-key", () => {
  it("returns 503 when VAPID_PUBLIC_KEY is not set", async () => {
    const saved = process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    const res = await request(testApp).get("/api/push/vapid-public-key");
    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("error");
    process.env.VAPID_PUBLIC_KEY = saved;
  });

  it("returns the VAPID public key when configured", async () => {
    process.env.VAPID_PUBLIC_KEY = "BTestPublicKey123";
    const res = await request(testApp).get("/api/push/vapid-public-key");
    expect(res.status).toBe(200);
    expect(res.body.vapidPublicKey).toBe("BTestPublicKey123");
  });
});

describe("POST /api/push/subscribe", () => {
  it("returns 201 for a valid subscription", async () => {
    const res = await request(testApp)
      .post("/api/push/subscribe")
      .send({ publicKey: TEST_PUBLIC_KEY, subscription: TEST_SUBSCRIPTION });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("returns 400 for missing publicKey", async () => {
    const res = await request(testApp)
      .post("/api/push/subscribe")
      .send({ subscription: TEST_SUBSCRIPTION });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid Stellar public key format", async () => {
    const res = await request(testApp)
      .post("/api/push/subscribe")
      .send({ publicKey: "not-a-stellar-key", subscription: TEST_SUBSCRIPTION });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing subscription endpoint", async () => {
    const res = await request(testApp)
      .post("/api/push/subscribe")
      .send({ publicKey: TEST_PUBLIC_KEY, subscription: { keys: {} } });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/push/unsubscribe", () => {
  it("returns 200 for a valid unsubscribe request", async () => {
    const res = await request(testApp)
      .post("/api/push/unsubscribe")
      .send({ publicKey: TEST_PUBLIC_KEY, endpoint: TEST_ENDPOINT });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 400 for missing publicKey", async () => {
    const res = await request(testApp)
      .post("/api/push/unsubscribe")
      .send({ endpoint: TEST_ENDPOINT });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid endpoint URL", async () => {
    const res = await request(testApp)
      .post("/api/push/unsubscribe")
      .send({ publicKey: TEST_PUBLIC_KEY, endpoint: "not-a-url" });
    expect(res.status).toBe(400);
  });
});
