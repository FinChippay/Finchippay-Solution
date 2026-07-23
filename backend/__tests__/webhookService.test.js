/**
 * Webhook registry, signed delivery, retry logic, and dead letter queue.
 */
"use strict";

// Tracks the close-handles handed out by `.stream()` so tests can assert
// they were invoked by `closeAllStreams()` during graceful shutdown.
const mockStreamCloseHandles = [];

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      payments: () => ({
        forAccount: () => ({
          cursor: () => ({
            stream: () => {
              const close = jest.fn();
              mockStreamCloseHandles.push(close);
              return close;
            },
          }),
        }),
      }),
    })),
  },
}));

// Mock the database module
jest.mock("../src/db", () => {
  const deliveries = new Map();

  return {
    prepare: jest.fn((sql) => {
      const stmt = {
        run: jest.fn((...args) => {
          if (sql.includes("INSERT INTO webhook_deliveries")) {
            const [id, webhookId, eventType, payload] = args;
            deliveries.set(id, {
              id,
              webhook_id: webhookId,
              event_type: eventType,
              payload,
              status: "pending",
              attempts: 0,
              last_attempt_at: null,
              last_error: null,
              next_retry_at: null,
              created_at: new Date().toISOString(),
            });
            return { changes: 1 };
          }
          if (sql.includes("UPDATE webhook_deliveries") && sql.includes("SET status = 'delivered'")) {
            const [id] = args;
            const d = deliveries.get(id);
            if (d) d.status = "delivered";
            return { changes: 1 };
          }
          if (sql.includes("UPDATE webhook_deliveries") && sql.includes("SET attempts")) {
            const [errorMsg, nextRetryAt, maxRetries, id] = args;
            const d = deliveries.get(id);
            if (d) {
              d.attempts += 1;
              d.last_error = errorMsg;
              d.next_retry_at = nextRetryAt;
              if (d.attempts >= maxRetries) d.status = "dead";
            }
            return { changes: 1 };
          }
          if (sql.includes("UPDATE webhook_deliveries") && sql.includes("SET status = 'pending', attempts = 0")) {
            let count = 0;
            for (const [, d] of deliveries) {
              if (d.status === "dead") {
                d.status = "pending";
                d.attempts = 0;
                d.next_retry_at = null;
                count++;
              }
            }
            return { changes: count };
          }
          if (sql.includes("SELECT * FROM webhook_deliveries WHERE status = 'pending'")) {
            return [];
          }
          if (sql.includes("SELECT d.* FROM webhook_deliveries")) {
            return [];
          }
          if (sql.includes("SELECT * FROM webhook_deliveries WHERE id = ?")) {
            const [id] = args;
            return [deliveries.get(id)].filter(Boolean);
          }
          return { changes: 0 };
        }),
        all: jest.fn((...args) => {
          if (sql.includes("SELECT * FROM webhook_deliveries WHERE status = 'pending'")) {
            return [];
          }
          if (sql.includes("SELECT d.* FROM webhook_deliveries")) {
            return [];
          }
          return [];
        }),
      };
      return stmt;
    }),
    exec: jest.fn(),
  };
});

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
  context: { active: () => ({}) },
}));

jest.mock("../src/utils/correlationId", () => ({
  getRequestIdHeader: () => ({}),
}));

jest.mock("../src/utils/webhookSignature", () => ({
  generateWebhookSignature: jest.fn((payload, secret) => `sig-${secret}`),
  verifyWebhookSignature: jest.fn(),
}));

const webhookService = require("../src/services/webhookService");

const ACCOUNT_A = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const ACCOUNT_B = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";
const ACCOUNT_C = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ACCOUNT_D = "GCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const ACCOUNT_E = "GCEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";

describe("webhook registry", () => {
  it("registers and lists webhooks for an account", () => {
    const webhook = webhookService.registerWebhook(
      ACCOUNT_A,
      "https://x.test/hook",
      "supersecret"
    );

    const list = webhookService.getWebhooksByPublicKey(ACCOUNT_A);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("https://x.test/hook");
    expect(list[0].id).toBe(webhook.id);
  });

  it("scopes listing to the account and supports deletion", () => {
    const webhook = webhookService.registerWebhook(
      ACCOUNT_B,
      "https://x.test/a",
      "secret-aaa"
    );
    webhookService.registerWebhook(ACCOUNT_C, "https://x.test/b", "secret-bbb");

    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_B)).toHaveLength(1);
    expect(webhookService.deleteWebhook(webhook.id)).toBe(true);
    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_B)).toHaveLength(0);
  });
});

describe("signPayload", () => {
  it("uses the shared webhookSignature utility", () => {
    const sig = webhookService.signPayload("mysecret", { event: "test" });
    expect(sig).toBe("sig-mysecret");
  });
});

describe("closeAllStreams (graceful shutdown on SIGTERM/SIGINT)", () => {
  it("closes every active Horizon SSE stream so none leak past process exit", async () => {
    webhookService.registerWebhook(
      ACCOUNT_D,
      "https://x.test/shutdown",
      "secret-shutdown"
    );
    const closeHandle = mockStreamCloseHandles[mockStreamCloseHandles.length - 1];
    expect(closeHandle).not.toHaveBeenCalled();

    // Simulates what the process SIGTERM/SIGINT handler in server.js invokes.
    await webhookService.closeAllStreams();

    expect(closeHandle).toHaveBeenCalledTimes(1);
  });

  it("clears activeStreams so a later registration opens a fresh stream", async () => {
    webhookService.registerWebhook(ACCOUNT_E, "https://x.test/a", "secret-a");
    const firstCloseHandle = mockStreamCloseHandles[mockStreamCloseHandles.length - 1];

    await webhookService.closeAllStreams();

    webhookService.registerWebhook(ACCOUNT_E, "https://x.test/b", "secret-b");
    const secondCloseHandle = mockStreamCloseHandles[mockStreamCloseHandles.length - 1];

    expect(secondCloseHandle).not.toBe(firstCloseHandle);
    expect(firstCloseHandle).toHaveBeenCalledTimes(1);
  });

  it("resolves promptly when there are no in-flight deliveries", async () => {
    const start = Date.now();
    await webhookService.closeAllStreams(5000);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("retry worker", () => {
  it("starts and stops the retry worker", () => {
    webhookService.startRetryWorker();
    webhookService.stopRetryWorker();
  });

  it("does not start multiple workers", () => {
    webhookService.startRetryWorker();
    webhookService.startRetryWorker();
    webhookService.stopRetryWorker();
  });
});

describe("dead letter queue", () => {
  it("retrieves dead deliveries", () => {
    const deliveries = webhookService.getDeadDeliveries(ACCOUNT_A);
    expect(Array.isArray(deliveries)).toBe(true);
  });

  it("resets dead deliveries for retry", () => {
    const result = webhookService.retryDeadDeliveries(ACCOUNT_A);
    expect(result).toHaveProperty("reset");
  });
});
