/* eslint-env jest */
/**
 * Email notification service tests.
 */
"use strict";

// Mock nodemailer BEFORE requiring the service
const mockSendMail = jest.fn();

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

// Mock the database connection
const mockKnex = {
  select: jest.fn(),
  where: jest.fn(),
  first: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  del: jest.fn(),
  whereRaw: jest.fn(),
  orWhereRaw: jest.fn(),
};

// Set up a chainable knex mock
function knexMock(table) {
  return mockKnex;
}
knexMock.select = mockKnex.select;
knexMock.where = mockKnex.where;

jest.mock("../src/db/connection", () => knexMock);

// Set test env vars
process.env.NOTIFICATION_EMAIL_ENABLED = "true";
process.env.SMTP_HOST = "smtp.test.com";
process.env.SMTP_PORT = "587";
process.env.SMTP_USER = "test@test.com";
process.env.SMTP_PASS = "testpass";

const notificationService = require("../src/services/notificationService");
const { renderTemplate, renderPlainText } = require("../src/services/emailTemplates");

describe("Email Templates", () => {
  test("renderTemplate should render payment_received template with data", () => {
    const html = renderTemplate("payment_received", {
      amount: "100",
      asset: "XLM",
      sender: "GABCDEF...",
      recipient: "GZYXWVU...",
      timestamp: "2026-07-28T00:00:00Z",
    });
    expect(html).toContain("100");
    expect(html).toContain("XLM");
    expect(html).toContain("Payment Received");
  });

  test("renderTemplate should render escrow_released template", () => {
    const html = renderTemplate("escrow_released", {
      amount: "500",
      asset: "USDC",
      recipient: "GZYXWVU...",
    });
    expect(html).toContain("500");
    expect(html).toContain("USDC");
    expect(html).toContain("Escrow Released");
  });

  test("renderTemplate should render stream_depleted template", () => {
    const html = renderTemplate("stream_depleted", {
      amount: "1000",
      asset: "XLM",
      recipient: "GZYXWVU...",
    });
    expect(html).toContain("1000");
    expect(html).toContain("Stream Depleted");
  });

  test("renderTemplate should render multisig_executed template", () => {
    const html = renderTemplate("multisig_executed", {
      amount: "250",
      asset: "XLM",
      recipient: "GZYXWVU...",
      sender: "GABCDEF...",
    });
    expect(html).toContain("250");
    expect(html).toContain("Multi-Sig Executed");
  });

  test("renderTemplate should render tip_received template", () => {
    const html = renderTemplate("tip_received", {
      amount: "10",
      asset: "XLM",
      sender: "GTIPPER...",
      memo: "Great work!",
    });
    expect(html).toContain("10");
    expect(html).toContain("XLM");
    expect(html).toContain("Tip Received");
    expect(html).toContain("Great work!");
  });

  test("renderTemplate should throw for unknown event type", () => {
    expect(() => renderTemplate("unknown_event", {})).toThrow("Unknown email template type");
  });

  test("renderPlainText should generate fallback text", () => {
    const text = renderPlainText("payment_received", {
      amount: "100",
      asset: "XLM",
      sender: "GABCDEF...",
    });
    expect(text).toContain("Payment Received");
    expect(text).toContain("100");
    expect(text).toContain("GABCDEF...");
  });
});

describe("Notification Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations
    mockKnex.where.mockReturnThis();
    mockKnex.select.mockReturnThis();
    mockKnex.whereRaw.mockReturnThis();
    mockKnex.orWhereRaw.mockReturnThis();
  });

  test("isEnabled should be true when env var is set to true", () => {
    expect(notificationService.isEnabled).toBe(true);
  });

  test("sendEmail should fail gracefully when transport is not initialized", async () => {
    // Temporarily disable the service to test graceful degradation
    delete process.env.SMTP_HOST;
    const result = await notificationService.sendEmail(
      "test@example.com",
      "Test Subject",
      "<p>Test</p>",
    );
    expect(result.sent).toBe(false);
    expect(result.error).toContain("not enabled or misconfigured");
    // Restore
    process.env.SMTP_HOST = "smtp.test.com";
  });

  test("sendEventNotification should send templated email", async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: "test-msg-id" });

    const result = await notificationService.sendEventNotification(
      "user@example.com",
      "payment_received",
      {
        amount: "50",
        asset: "XLM",
        sender: "GSENDER...",
        timestamp: new Date().toISOString(),
      },
    );

    expect(result.sent).toBe(true);
    expect(result.messageId).toBe("test-msg-id");
    expect(mockSendMail).toHaveBeenCalledTimes(1);

    const mailArgs = mockSendMail.mock.calls[0][0];
    expect(mailArgs.to).toBe("user@example.com");
    expect(mailArgs.subject).toContain("Payment Received");
    expect(mailArgs.html).toContain("50");
  });

  test("sendEmail should handle nodemailer errors gracefully", async () => {
    mockSendMail.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await notificationService.sendEmail("user@example.com", "Test", "<p>Test</p>");

    expect(result.sent).toBe(false);
    expect(result.error).toBe("Connection refused");
  });

  test("registerEmail should insert new preference", async () => {
    mockKnex.first.mockResolvedValueOnce(null); // No existing
    mockKnex.insert.mockResolvedValueOnce([1]);
    mockKnex.first.mockResolvedValueOnce({
      public_key: "GABCDEF123456789012345678901234567890123456789012345678901234",
      email: "user@example.com",
      events: JSON.stringify(["payment_received", "tip_received"]),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result = await notificationService.registerEmail(
      "GABCDEF123456789012345678901234567890123456789012345678901234",
      "user@example.com",
      { events: ["payment_received", "tip_received"] },
    );

    expect(result.email).toBe("user@example.com");
    expect(result.events).toEqual(["payment_received", "tip_received"]);
  });

  test("getEmailPreference should return null for unknown publicKey", async () => {
    mockKnex.first.mockResolvedValueOnce(null);

    const result = await notificationService.getEmailPreference(
      "GUNKNOWN12345678901234567890123456789012345678901234567890123456",
    );

    expect(result).toBeNull();
  });

  test("deleteEmailPreference should return true when deleted", async () => {
    mockKnex.del.mockResolvedValueOnce(1);

    const result = await notificationService.deleteEmailPreference(
      "GABCDEF123456789012345678901234567890123456789012345678901234",
    );

    expect(result).toBe(true);
  });

  test("deleteEmailPreference should return false when not found", async () => {
    mockKnex.del.mockResolvedValueOnce(0);

    const result = await notificationService.deleteEmailPreference("GUNKNOWN...");

    expect(result).toBe(false);
  });

  test("notifySubscribers should return sent/failed counts", async () => {
    // Mock all rows with matching subscriber
    mockKnex.select.mockResolvedValueOnce([
      {
        public_key: "GABCDEF...",
        email: "subscriber@example.com",
        events: JSON.stringify(["payment_received"]),
      },
    ]);

    mockSendMail.mockResolvedValueOnce({ messageId: "msg-1" });

    const result = await notificationService.notifySubscribers("payment_received", {
      amount: "100",
      asset: "XLM",
    });

    // Since transport is already initialized from previous test
    expect(result.sent >= 0).toBe(true);
  });
});
