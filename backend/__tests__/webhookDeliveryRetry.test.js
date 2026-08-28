/* eslint-env jest */
/**
 * Exponential backoff retry, dead letter queue, delivery status query API.
 * Issue #494.
 */
"use strict";

process.env.WEBHOOK_ENCRYPTION_KEY =
  "aaabbbcccdddeeefff000111222333444555666777888999000aaabbbcccdddee";

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock("../src/services/metricsService", () => ({
  activeWebhookStreams: { set: jest.fn() },
  horizonRequestsTotal: { inc: jest.fn() },
}));
jest.mock("../src/config/tracing", () => ({
  getTracer: () => ({
    startSpan: () => ({
      setAttributes: jest.fn(),
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
    }),
  }),
}));
jest.mock("@opentelemetry/api", () => ({
  propagation: { inject: jest.fn() },
  context: { active: jest.fn() },
}));
jest.mock("../src/utils/correlationId", () => ({ getRequestIdHeader: () => ({}) }));
jest.mock("../src/utils/webhookSignature", () => ({ generateWebhookSignature: () => "sig" }));
jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      payments: () => ({ forAccount: () => ({ cursor: () => ({ stream: () => jest.fn() }) }) }),
    })),
  },
}));

const knex = require("../src/db/connection");
const webhookService = require("../src/services/webhookService");

const ACCOUNT = "GDLYRETRYTEST00000000000000000000000000000000000000000AAAA";

beforeEach(async () => {
  await knex("dead_letter_queue").del();
  await knex("webhook_deliveries").del();
  await knex("webhooks").del();
  global.fetch = jest.fn();
});

afterEach(async () => {
  await webhookService.closeAllStreams();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await knex.destroy();
});

describe("exponential backoff schedule", () => {
  it("exposes the 1min/5min/15min/1h/6h/24h schedule in seconds", () => {
    expect(webhookService.RETRY_INTERVALS_SECONDS).toEqual([60, 300, 900, 3600, 21600, 86400]);
  });

  it("defaults MAX_RETRIES to 6", () => {
    expect(webhookService.MAX_RETRIES).toBe(6);
  });
});

describe("dead letter queue on max retries", () => {
  it("writes a dead_letter_queue row after MAX_RETRIES failures", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 });
    const webhook = await webhookService.registerWebhook(ACCOUNT, "https://x.test/dlq", "s3cret");
    await webhookService.deliverWebhook(webhook, { hello: "world" }, "payment.received");

    let delivery = await knex("webhook_deliveries").where("webhook_id", webhook.id).first();
    // Drive it to the final attempt directly via repeated retry-queue processing.
    for (let i = 0; i < 6; i++) {
      await knex("webhook_deliveries")
        .where("id", delivery.id)
        .update({ next_retry_at: new Date(Date.now() - 1000).toISOString() });
      await webhookService.processRetryQueue();
      delivery = await knex("webhook_deliveries").where("id", delivery.id).first();
      if (delivery.status === "dead") break;
    }

    expect(delivery.status).toBe("dead");
    const dlqRow = await knex("dead_letter_queue").where("delivery_id", delivery.id).first();
    expect(dlqRow).toBeTruthy();
    expect(dlqRow.webhook_id).toBe(webhook.id);
    expect(dlqRow.final_error).toBeTruthy();
  });
});

describe("delivery status query API", () => {
  it("returns paginated delivery history for a public key", async () => {
    global.fetch.mockResolvedValue({ ok: true });
    const webhook = await webhookService.registerWebhook(ACCOUNT, "https://x.test/q", "s3cret2");
    await webhookService.deliverWebhook(webhook, { a: 1 }, "payment.received");
    await webhookService.deliverWebhook(webhook, { a: 2 }, "payment.received");

    const result = await webhookService.getDeliveries(ACCOUNT, { page: 1, limit: 10 });
    expect(result.deliveries.length).toBeGreaterThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
  });

  it("filters delivery history by status", async () => {
    global.fetch.mockResolvedValue({ ok: true });
    const webhook = await webhookService.registerWebhook(ACCOUNT, "https://x.test/q2", "s3cret3");
    await webhookService.deliverWebhook(webhook, { a: 1 }, "payment.received");

    const result = await webhookService.getDeliveries(ACCOUNT, { status: "delivered" });
    expect(result.deliveries.every((d) => d.status === "delivered")).toBe(true);
  });

  it("returns a single delivery with retry timeline fields", async () => {
    global.fetch.mockResolvedValue({ ok: true });
    const webhook = await webhookService.registerWebhook(ACCOUNT, "https://x.test/q3", "s3cret4");
    await webhookService.deliverWebhook(webhook, { a: 1 }, "payment.received");
    const list = await webhookService.getDeliveries(ACCOUNT, {});
    const target = list.deliveries[0];

    const detail = await webhookService.getDeliveryById(ACCOUNT, target.id);
    expect(detail).toBeTruthy();
    expect(detail.id).toBe(target.id);
    expect(detail).toHaveProperty("retry_attempts");
    expect(detail).toHaveProperty("delivery_priority");
  });

  it("returns null for a delivery id that doesn't belong to the public key", async () => {
    const detail = await webhookService.getDeliveryById(ACCOUNT, "nonexistent-id");
    expect(detail).toBeNull();
  });
});
