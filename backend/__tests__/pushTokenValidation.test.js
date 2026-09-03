/* eslint-env jest */
/**
 * pushService validation helpers — no database required.
 */

"use strict";

jest.mock("../src/db/connection", () => ({}));

const pushService = require("../src/services/pushService");

const P256DH =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib37y8aQjq0W6KXQ6f2p7vHqJVgKLqUqKsP5gWNh-TcZKWnZKpC5tV5Fw";
const AUTH = "tBHItJI5svbpez7KI4CCXg";

describe("isValidSubscription", () => {
  it("accepts a well-formed Web Push subscription", () => {
    expect(
      pushService.isValidSubscription({
        endpoint: "https://push.example.com/device-1",
        keys: { p256dh: P256DH, auth: AUTH },
      }),
    ).toBe(true);
  });

  it("rejects malformed subscriptions", () => {
    expect(
      pushService.isValidSubscription({
        endpoint: "http://push.example.com/device-1",
        keys: { p256dh: P256DH, auth: AUTH },
      }),
    ).toBe(false);
    expect(
      pushService.isValidSubscription({
        endpoint: "https://push.example.com/device-1",
        keys: { p256dh: "short", auth: AUTH },
      }),
    ).toBe(false);
  });
});

describe("isValidDeviceToken", () => {
  const apnsToken = "a".repeat(64);
  const fcmToken = `fcm_${"A".repeat(140)}`;

  it("accepts a valid APNs token", () => {
    expect(pushService.isValidDeviceToken(apnsToken, "apns")).toBe(true);
  });

  it("accepts a valid FCM token", () => {
    expect(pushService.isValidDeviceToken(fcmToken, "fcm")).toBe(true);
  });

  it("rejects malformed native tokens", () => {
    expect(pushService.isValidDeviceToken("not-a-real-token")).toBe(false);
    expect(pushService.isValidDeviceToken("x".repeat(63), "apns")).toBe(false);
    expect(pushService.isValidDeviceToken("x".repeat(139), "fcm")).toBe(false);
  });
});
