/* eslint-env jest */
/**
 * Verifies POST /api/push/subscribe is protected by sensitiveLimiter.
 */

"use strict";

jest.mock("../src/services/pushService", () => ({
  addSubscription: jest.fn().mockResolvedValue({ created: true }),
  removeSubscription: jest.fn(),
  listSubscriptions: jest.fn(),
  getPublicKey: jest.fn(),
  isPushEnabled: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const { JWT_SECRET } = require("../src/middleware/auth");

const ME = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const P256DH =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib37y8aQjq0W6KXQ6f2p7vHqJVgKLqUqKsP5gWNh-TcZKWnZKpC5tV5Fw";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const SUBSCRIPTION = {
  endpoint: "https://push.example.com/device-1",
  keys: { p256dh: P256DH, auth: AUTH },
};

jest.mock("../src/middleware/rateLimit", () => {
  const actual = jest.requireActual("../src/middleware/rateLimit");
  const testSensitiveLimiter = actual.createInstrumentedLimiter(
    {
      windowMs: 60_000,
      limit: 2,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: "RATE_LIMITED_SENSITIVE" } },
    },
    "sensitive",
  );

  return {
    ...actual,
    sensitiveLimiter: testSensitiveLimiter,
    strictLimiter: (req, res, next) => next(),
  };
});

function app() {
  jest.resetModules();
  const server = express();
  server.use(express.json());
  const pushRoutes = require("../src/routes/push");
  server.use("/api/push", pushRoutes);
  return server;
}

const auth = (publicKey) =>
  `Bearer ${jwt.sign({ publicKey }, JWT_SECRET)}`;

describe("POST /api/push/subscribe rate limiting", () => {
  it("returns 429 after exceeding sensitiveLimiter", async () => {
    const server = app();

    const first = await request(server)
      .post("/api/push/subscribe")
      .set("Authorization", auth(ME))
      .send({ subscription: SUBSCRIPTION });
    const second = await request(server)
      .post("/api/push/subscribe")
      .set("Authorization", auth(ME))
      .send({ subscription: SUBSCRIPTION });
    const third = await request(server)
      .post("/api/push/subscribe")
      .set("Authorization", auth(ME))
      .send({ subscription: SUBSCRIPTION });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(429);
  });
});
