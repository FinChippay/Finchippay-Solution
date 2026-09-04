"use strict";
jest.mock("../src/db/connection", () => {
  const builder = {
    where: jest.fn().mockReturnThis(),
    count: jest.fn().mockReturnThis(),
    first: jest.fn(),
    insert: jest.fn().mockResolvedValue([1]),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    whereIn: jest.fn().mockReturnThis(),
  };
  const knexFn = jest.fn(() => builder);
  knexFn.fn = { now: () => new Date().toISOString() };
  return knexFn;
});
jest.mock("../src/services/emailTrackingService", () => ({
  generateEmailId: () => "test-email-id",
  trackingPixelUrl: () => "https://example.com/pixel",
  isSuppressed: jest.fn().mockResolvedValue(false),
  recordEvent: jest.fn().mockResolvedValue(),
}));
jest.mock("../src/services/emailVerificationService", () => ({}));
jest.mock("../src/services/emailRenderer", () => ({
  render: () => ({ subject: "Test", html: "<p>test</p>", text: "test" }),
}));

const notificationService = require("../src/services/notificationService");
const knex = require("../src/db/connection");

describe("notificationService rate limiting", () => {
  beforeEach(() => {
    knex().first.mockReset();
    knex().first.mockResolvedValue({ cnt: 0 });
  });

  test("queueEmail drops and increments metric when over rate limit", async () => {
    knex().first.mockResolvedValueOnce({ cnt: 10 });
    const result = await notificationService.queueEmail("test@example.com", "payment_received", {});
    expect(result.rateLimited).toBe(true);
    expect(result.emailId).toBeNull();
  });

  test("queueEmail proceeds when under rate limit", async () => {
    knex().first.mockResolvedValueOnce({ cnt: 2 });
    const result = await notificationService.queueEmail("test2@example.com", "payment_received", {
      amount: "10",
      asset: "XLM",
    });
    expect(result.emailId).toBeTruthy();
  });
});
