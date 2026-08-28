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

const subscription = (endpoint) => ({
  endpoint,
  keys: { p256dh: "p256dh-key", auth: "auth-secret" },
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
      keys: { p256dh: "rotated-key", auth: "rotated-secret" },
    });

    expect(result).toEqual({ created: false });

    const rows = await knex("push_subscriptions").where({ endpoint });
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe("rotated-key");
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
    ["no endpoint", { keys: { p256dh: "a", auth: "b" } }],
    ["a non-HTTPS endpoint", { endpoint: "http://x.test", keys: { p256dh: "a", auth: "b" } }],
    ["no keys", { endpoint: "https://push.example.com/x" }],
  ])("rejects a subscription with %s", async (_label, bad) => {
    await expect(pushService.addSubscription(ALICE, bad)).rejects.toThrow(
      /valid push subscription/i,
    );
  });

  it("requires a public key", async () => {
    await expect(
      pushService.addSubscription("", subscription("https://push.example.com/x")),
    ).rejects.toThrow(/publicKey is required/i);
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
