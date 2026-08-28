/* eslint-env jest */
"use strict";

const webhookRows = [];
const mockCoreDeliverWebhook = jest.fn();
const mockCoreCloseAllStreams = jest.fn();
const mockCloseStream = jest.fn();

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      payments: () => ({
        forAccount: () => ({
          cursor: () => ({
            stream: () => mockCloseStream,
          }),
        }),
      }),
    })),
  },
}));

jest.mock("../src/services/webhookService", () => ({
  deliverWebhook: (...args) => mockCoreDeliverWebhook(...args),
  closeAllStreams: (...args) => mockCoreCloseAllStreams(...args),
  deleteWebhook: jest.fn(),
  signPayload: jest.fn(),
  getDeadDeliveries: jest.fn(),
  retryDeadDeliveries: jest.fn(),
  startRetryWorker: jest.fn(),
  stopRetryWorker: jest.fn(),
  getEvents: jest.fn(),
  getEventStats: jest.fn(),
}));

jest.mock("../src/db/connection", () =>
  jest.fn((table) => {
    if (table === "webhooks") {
      return {
        insert: jest.fn(async (row) => {
          webhookRows.push(row);
        }),
        where: jest.fn((column, value) => {
          const rows = webhookRows.filter((row) => row[column] === value);
          return {
            then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
            first: async () => rows[0],
          };
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  }),
);

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../src/services/metricsService", () => ({
  horizonRequestsTotal: { inc: jest.fn() },
  activeWebhookStreams: { set: jest.fn() },
}));

const service = require("../src/services/webhookSubscriptionService");

const ACCOUNT = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

beforeEach(() => {
  webhookRows.length = 0;
  jest.clearAllMocks();
});

afterAll(async () => {
  await service.closeAllStreams();
});

describe("webhook topic subscriptions", () => {
  it("persists normalized topics and returns them from registration", async () => {
    const registered = await service.registerWebhook(
      ACCOUNT,
      "https://example.test/webhook",
      "supersecret",
      ["payment.received", "payment.received", "stream.claimed"],
    );

    expect(registered.topics).toEqual(["payment.received", "stream.claimed"]);
    expect(JSON.parse(webhookRows[0].topics)).toEqual(["payment.received", "stream.claimed"]);
  });

  it("defaults omitted topics to all", async () => {
    const registered = await service.registerWebhook(
      ACCOUNT,
      "https://example.test/webhook",
      "supersecret",
    );

    expect(registered.topics).toEqual(["all"]);
    expect(JSON.parse(webhookRows[0].topics)).toEqual(["all"]);
  });

  it("lists subscribed topics without exposing the signing secret", async () => {
    await service.registerWebhook(ACCOUNT, "https://example.test/webhook", "supersecret", [
      "payment.received",
    ]);

    const hooks = await service.getWebhooksByPublicKey(ACCOUNT);

    expect(hooks).toHaveLength(1);
    expect(hooks[0].topics).toEqual(["payment.received"]);
    expect(hooks[0]).not.toHaveProperty("secret");
  });

  it("filters a non-matching topic before invoking delivery", async () => {
    const result = await service.deliverWebhook(
      {
        id: "hook-1",
        publicKey: ACCOUNT,
        url: "https://example.test/webhook",
        secret: "supersecret",
        topics: ["payment.received"],
      },
      { event: "stream.claimed" },
      "stream.claimed",
    );

    expect(result).toEqual({ delivered: false, reason: "topic_filtered" });
    expect(mockCoreDeliverWebhook).not.toHaveBeenCalled();
  });

  it("delivers matching explicit and all subscriptions", async () => {
    const explicit = {
      id: "hook-1",
      publicKey: ACCOUNT,
      url: "https://example.test/one",
      secret: "supersecret",
      topics: ["payment.received"],
    };
    const all = {
      ...explicit,
      id: "hook-2",
      url: "https://example.test/all",
      topics: ["all"],
    };

    await service.deliverWebhook(explicit, { event: "payment.received" }, "payment.received");
    await service.deliverWebhook(
      all,
      { event: "scheduled_transaction.pending_signature" },
      "scheduled_transaction.pending_signature",
    );

    expect(mockCoreDeliverWebhook).toHaveBeenCalledTimes(2);
    expect(mockCoreDeliverWebhook).toHaveBeenNthCalledWith(
      1,
      explicit,
      { event: "payment.received" },
      "payment.received",
    );
  });
});
