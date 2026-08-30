/* eslint-env jest */
/**
 * pushService: subscription storage and Web Push delivery.
 *
 * Runs against the migrated SQLite test database (jest.globalSetup.js), so the
 * push_subscriptions schema from migration 009 is exercised for real. Only
 * web-push itself is mocked — there is no push service to talk to in CI.
 */

"use strict";

const mockSendNotification = jest.fn();
const mockSetVapidDetails = jest.fn();

jest.mock("web-push", () => ({
  sendNotification: (...args) => mockSendNotification(...args),
  setVapidDetails: (...args) => mockSetVapidDetails(...args),
}));

const knex = require("../src/db/connection");
const pushService = require("../src/services/pushService");

const ALICE = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const BOB = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";

const P256DH =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib37y8aQjq0W6KXQ6f2p7vHqJVgKLqUqKsP5gWNh-TcZKWnZKpC5tV5Fw";
const AUTH = "tBHItJI5svbpez7KI4CCXg";

const subscription = (endpoint) => ({
  endpoint,
  keys: { p256dh: P256DH, auth: AUTH },
});

/** A VAPID pair that only has to be well-formed enough for the mock. */
function withVapidKeys() {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  pushService.resetVapidConfigForTests();
}

function withoutVapidKeys() {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  pushService.resetVapidConfigForTests();
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockSendNotification.mockResolvedValue({ statusCode: 201 });
  await knex("push_subscriptions").del();
  await knex("push_tokens").del();
  withVapidKeys();
});

afterAll(async () => {
  await knex.destroy();
});

describe("addSubscription", () => {
  it("stores a new subscription", async () => {
    const result = await pushService.addSubscription(
      ALICE,
      subscription("https://push.example.com/alice-1"),
    );

    expect(result).toEqual({ created: true });

    const rows = await knex("push_subscriptions").where({ public_key: ALICE });
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe("https://push.example.com/alice-1");
  });

  it("updates keys instead of duplicating when the endpoint is already known", async () => {
    const endpoint = "https://push.example.com/alice-1";
    await pushService.addSubscription(ALICE, subscription(endpoint));

    const result = await pushService.addSubscription(ALICE, {
      endpoint,
      keys: {
        p256dh:
          "BEl62iUYgUivxIkv69yViEuiBIa-Ib37y8aQjq0W6KXQ6f2p7vHqJVgKLqUqKsP5gWNh-TcZKWnZKpC5tV5Fz",
        auth: "tBHItJI5svbpez7KI4CCXh",
      },
    });

    expect(result).toEqual({ created: false });

    const rows = await knex("push_subscriptions").where({ endpoint });
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe(
      "BEl62iUYgUivxIkv69yViEuiBIa-Ib37y8aQjq0W6KXQ6f2p7vHqJVgKLqUqKsP5gWNh-TcZKWnZKpC5tV5Fz",
    );
  });

  it("reassigns a shared device endpoint to the newest account", async () => {
    const endpoint = "https://push.example.com/shared-device";
    await pushService.addSubscription(ALICE, subscription(endpoint));
    await pushService.addSubscription(BOB, subscription(endpoint));

    const rows = await knex("push_subscriptions").where({ endpoint });
    expect(rows).toHaveLength(1);
    expect(rows[0].public_key).toBe(BOB);
  });

  it.each([
    ["no endpoint", { keys: { p256dh: P256DH, auth: AUTH } }],
    ["a non-HTTPS endpoint", { endpoint: "http://x.test", keys: { p256dh: P256DH, auth: AUTH } }],
    ["no keys", { endpoint: "https://push.example.com/x" }],
    [
      "a short p256dh key",
      { endpoint: "https://push.example.com/x", keys: { p256dh: "short", auth: AUTH } },
    ],
    [
      "invalid auth charset",
      { endpoint: "https://push.example.com/x", keys: { p256dh: P256DH, auth: "bad+key!!!" } },
    ],
  ])("rejects a subscription with %s", async (_label, bad) => {
    await expect(pushService.addSubscription(ALICE, bad)).rejects.toMatchObject({
      status: 400,
      message: /valid push subscription/i,
    });
  });

  it("enforces the per-account device cap", async () => {
    for (let i = 0; i < pushService.MAX_DEVICES_PER_ACCOUNT; i++) {
      await pushService.addSubscription(ALICE, subscription(`https://push.example.com/alice-${i}`));
    }

    await expect(
      pushService.addSubscription(ALICE, subscription("https://push.example.com/alice-overflow")),
    ).rejects.toMatchObject({
      status: 400,
      message: /maximum of 10 devices/i,
    });
  });

  it("allows refreshing an existing endpoint even when at the device cap", async () => {
    for (let i = 0; i < pushService.MAX_DEVICES_PER_ACCOUNT; i++) {
      await pushService.addSubscription(ALICE, subscription(`https://push.example.com/alice-${i}`));
    }

    const endpoint = "https://push.example.com/alice-0";
    await expect(
      pushService.addSubscription(ALICE, {
        endpoint,
        keys: {
          p256dh:
            "BEl62iUYgUivxIkv69yViEuiBIa-Ib37y8aQjq0W6KXQ6f2p7vHqJVgKLqUqKsP5gWNh-TcZKWnZKpC5tV5Fz",
          auth: "tBHItJI5svbpez7KI4CCXh",
        },
      }),
    ).resolves.toEqual({ created: false });
  });

  it("requires a public key", async () => {
    await expect(
      pushService.addSubscription("", subscription("https://push.example.com/x")),
    ).rejects.toThrow(/publicKey is required/i);
  });
});

describe("registerDeviceToken", () => {
  const fcmToken = `fcm_${"A".repeat(140)}`;
  const apnsToken = "a".repeat(64);

  it("stores a new native device token", async () => {
    const result = await pushService.registerDeviceToken(ALICE, fcmToken, "fcm");

    expect(result).toEqual({ created: true, provider: "fcm" });
    const rows = await knex("push_tokens").where({ public_key: ALICE });
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(fcmToken);
  });

  it("rejects malformed device tokens", async () => {
    await expect(pushService.registerDeviceToken(ALICE, "bad-token", "fcm")).rejects.toMatchObject({
      status: 400,
      message: /invalid device token/i,
    });
  });

  it("enforces the per-account device cap for native tokens", async () => {
    for (let i = 0; i < pushService.MAX_DEVICES_PER_ACCOUNT; i++) {
      await pushService.registerDeviceToken(ALICE, `fcm_${"B".repeat(140)}${i}`, "fcm");
    }

    await expect(
      pushService.registerDeviceToken(ALICE, `fcm_${"C".repeat(140)}overflow`, "fcm"),
    ).rejects.toMatchObject({
      status: 400,
      message: /maximum of 10 devices/i,
    });
  });

  it("auto-detects APNs tokens when provider is omitted", async () => {
    const result = await pushService.registerDeviceToken(ALICE, apnsToken);

    expect(result).toEqual({ created: true, provider: "apns" });
  });
});

describe("removeSubscription", () => {
  it("removes the caller's own subscription", async () => {
    const endpoint = "https://push.example.com/alice-1";
    await pushService.addSubscription(ALICE, subscription(endpoint));

    expect(await pushService.removeSubscription(ALICE, endpoint)).toEqual({
      removed: 1,
    });
    expect(await knex("push_subscriptions").where({ endpoint })).toHaveLength(0);
  });

  it("will not remove another account's subscription", async () => {
    const endpoint = "https://push.example.com/alice-1";
    await pushService.addSubscription(ALICE, subscription(endpoint));

    expect(await pushService.removeSubscription(BOB, endpoint)).toEqual({
      removed: 0,
    });
    expect(await knex("push_subscriptions").where({ endpoint })).toHaveLength(1);
  });
});

describe("sendNotification", () => {
  it("sends to every device registered for the account", async () => {
    await pushService.addSubscription(ALICE, subscription("https://push.example.com/a1"));
    await pushService.addSubscription(ALICE, subscription("https://push.example.com/a2"));
    await pushService.addSubscription(BOB, subscription("https://push.example.com/b1"));

    const result = await pushService.sendNotification(ALICE, {
      title: "Payment received",
      body: "10 XLM",
      data: { url: "/dashboard" },
    });

    expect(result.sent).toBe(2);
    expect(mockSendNotification).toHaveBeenCalledTimes(2);
  });

  it("serialises title, body and data into the payload the service worker parses", async () => {
    await pushService.addSubscription(ALICE, subscription("https://push.example.com/a1"));

    await pushService.sendNotification(ALICE, {
      title: "Payment received",
      body: "10 XLM",
      data: { url: "/escrow" },
    });

    const [, payload] = mockSendNotification.mock.calls[0];
    expect(JSON.parse(payload)).toEqual({
      title: "Payment received",
      body: "10 XLM",
      url: "/escrow",
    });
  });

  it("prunes endpoints the push service reports as gone", async () => {
    await pushService.addSubscription(ALICE, subscription("https://push.example.com/dead"));
    await pushService.addSubscription(ALICE, subscription("https://push.example.com/live"));

    mockSendNotification.mockImplementation((sub) => {
      if (sub.endpoint.endsWith("/dead")) {
        const err = new Error("Gone");
        err.statusCode = 410;
        return Promise.reject(err);
      }
      return Promise.resolve({ statusCode: 201 });
    });

    const result = await pushService.sendNotification(ALICE, {
      title: "Payment received",
      body: "10 XLM",
    });

    expect(result).toMatchObject({ sent: 1, pruned: 1 });
    const remaining = await knex("push_subscriptions").where({
      public_key: ALICE,
    });
    expect(remaining.map((r) => r.endpoint)).toEqual(["https://push.example.com/live"]);
  });

  it("keeps subscriptions when the failure may be transient", async () => {
    await pushService.addSubscription(ALICE, subscription("https://push.example.com/a1"));

    mockSendNotification.mockRejectedValue(
      Object.assign(new Error("Too Many Requests"), { statusCode: 429 }),
    );

    const result = await pushService.sendNotification(ALICE, {
      title: "Payment received",
      body: "10 XLM",
    });

    expect(result).toMatchObject({ sent: 0, failed: 1, pruned: 0 });
    expect(await knex("push_subscriptions").where({ public_key: ALICE })).toHaveLength(1);
  });

  it("does not throw when a send fails, so callers can fire and forget", async () => {
    await pushService.addSubscription(ALICE, subscription("https://push.example.com/a1"));
    mockSendNotification.mockRejectedValue(new Error("network down"));

    await expect(
      pushService.sendNotification(ALICE, { title: "x", body: "y" }),
    ).resolves.toMatchObject({ failed: 1 });
  });

  it("reports no-subscriptions rather than sending", async () => {
    const result = await pushService.sendNotification(ALICE, {
      title: "x",
      body: "y",
    });

    expect(result.skipped).toBe("no-subscriptions");
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("is a no-op when VAPID keys are absent", async () => {
    await pushService.addSubscription(ALICE, subscription("https://push.example.com/a1"));
    withoutVapidKeys();

    const result = await pushService.sendNotification(ALICE, {
      title: "x",
      body: "y",
    });

    expect(result.skipped).toBe("vapid-not-configured");
    expect(mockSendNotification).not.toHaveBeenCalled();

    withVapidKeys();
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

describe("isPushEnabled / getPublicKey", () => {
  it("reports enabled and exposes the public key when configured", () => {
    expect(pushService.isPushEnabled()).toBe(true);
    expect(pushService.getPublicKey()).toBe("test-public-key");
  });

  it("reports disabled when only one half of the pair is set", () => {
    process.env.VAPID_PUBLIC_KEY = "only-public";
    delete process.env.VAPID_PRIVATE_KEY;
    pushService.resetVapidConfigForTests();

    expect(pushService.isPushEnabled()).toBe(false);

    withVapidKeys();
  });
});
