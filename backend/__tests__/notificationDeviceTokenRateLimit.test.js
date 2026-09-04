/* eslint-env jest */
/**
 * Verifies POST /api/notifications/:publicKey/device-token is rate-limited.
 */

"use strict";

jest.mock("../src/db/connection", () => ({}));
jest.mock("../src/services/notificationService", () => ({}));
jest.mock("../src/services/pushService", () => ({
  registerDeviceToken: jest.fn().mockResolvedValue({ created: true, provider: "fcm" }),
}));

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
  };
});

// The device-token route is JWT-gated (WS1); authenticate as the route's owner.
jest.mock("../src/middleware/auth", () => ({
  verifyJWT: (req, res, next) => {
    req.user = { publicKey: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA" };
    next();
  },
}));

const express = require("express");
const request = require("supertest");

const PUBLIC_KEY = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const FCM_TOKEN = `fcm_${"A".repeat(140)}`;

function app() {
  const server = express();
  server.use(express.json());
  const notificationRoutes = require("../src/routes/notifications");
  server.use("/api/notifications", notificationRoutes);
  return server;
}

describe("POST /api/notifications/:publicKey/device-token rate limiting", () => {
  it("returns 429 after exceeding sensitiveLimiter", async () => {
    const server = app();

    const first = await request(server)
      .post(`/api/notifications/${PUBLIC_KEY}/device-token`)
      .send({ token: FCM_TOKEN });
    const second = await request(server)
      .post(`/api/notifications/${PUBLIC_KEY}/device-token`)
      .send({ token: FCM_TOKEN });
    const third = await request(server)
      .post(`/api/notifications/${PUBLIC_KEY}/device-token`)
      .send({ token: FCM_TOKEN });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(429);
  });
});
