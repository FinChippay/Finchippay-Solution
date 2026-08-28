/* eslint-env jest */
/**
 * Native device-token registration via notifications routes.
 */

"use strict";

jest.mock("../src/db/connection", () => ({}));
jest.mock("../src/services/notificationService", () => ({}));
jest.mock("../src/services/pushService", () => ({
  registerDeviceToken: jest.fn(),
}));

jest.mock("../src/middleware/rateLimit", () => {
  const actual = jest.requireActual("../src/middleware/rateLimit");
  return {
    ...actual,
    sensitiveLimiter: (req, res, next) => next(),
  };
});

const express = require("express");
const request = require("supertest");

const pushService = require("../src/services/pushService");
const notificationRoutes = require("../src/routes/notifications");

const PUBLIC_KEY = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const FCM_TOKEN = `fcm_${"A".repeat(140)}`;

function app() {
  const server = express();
  server.use(express.json());
  server.use("/api/notifications", notificationRoutes);
  return server;
}

beforeEach(() => {
  jest.clearAllMocks();
  pushService.registerDeviceToken.mockResolvedValue({ created: true, provider: "fcm" });
});

describe("POST /api/notifications/:publicKey/device-token", () => {
  it("registers a valid device token", async () => {
    const res = await request(app())
      .post(`/api/notifications/${PUBLIC_KEY}/device-token`)
      .send({ token: FCM_TOKEN, provider: "fcm" });

    expect(res.status).toBe(201);
    expect(pushService.registerDeviceToken).toHaveBeenCalledWith(PUBLIC_KEY, FCM_TOKEN, "fcm");
  });

  it("rejects a malformed device token with 400", async () => {
    const err = new Error("Invalid device token format");
    err.status = 400;
    pushService.registerDeviceToken.mockRejectedValue(err);

    const res = await request(app())
      .post(`/api/notifications/${PUBLIC_KEY}/device-token`)
      .send({ token: "not-valid", provider: "fcm" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid device token/i);
  });

  it("returns 400 when the account is at the device cap", async () => {
    const err = new Error("Maximum of 10 devices per account");
    err.status = 400;
    pushService.registerDeviceToken.mockRejectedValue(err);

    const res = await request(app())
      .post(`/api/notifications/${PUBLIC_KEY}/device-token`)
      .send({ token: FCM_TOKEN });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum of 10 devices/i);
  });
});
