/**
 * Webhook registry, signed delivery, retry logic, dead letter queue,
 * SQLite persistence, and graceful shutdown.
 */
"use strict";

// Tracks the close-handles handed out by `.stream()` so tests can assert
// they were invoked by `closeAllStreams()` during graceful shutdown.
const mockStreamCloseHandles = [];

// ─── Mock: Horizon SSE ────────────────────────────────────────────────────────
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

// ─── Mock: SQLite persistence layer ──────────────────────────────────────────
// Prefix the shared store with "mock" so Jest allows it inside the factory.
const mockDbStore = new Map();

jest.mock("../db/webhookDb", () => ({
  insertWebhook: jest.fn(({ id, publicKey, url, secretHash, createdAt }) => {
    mockDbStore.set(id, { id, publicKey, url, secretHash, createdAt, active: 1 });
  }),
  getByPublicKey: jest.fn((publicKey) =>
    Array.from(mockDbStore.values())
      .filter((r) => r.publicKey === publicKey && r.active === 1)
      .map(({ id, publicKey: pk, url, createdAt }) => ({ id, publicKey: pk, url, createdAt }))
  ),
  getAllActive: jest.fn(() =>
    Array.from(mockDbStore.values())
      .filter((r) => r.active === 1)
      .map(({ id, publicKey, url, secretHash, createdAt }) => ({
        id, publicKey, url, secretHash, createdAt,
      }))
  ),
  getById: jest.fn((id) => mockDbStore.get(id) ?? null),
  deactivate: jest.fn((id) => {
    const row = mockDbStore.get(id);
    if (!row || row.active === 0) return false;
    row.active = 0;
    return true;
  }),
  close: jest.fn(),
}));

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

// ─── Constants ────────────────────────────────────────────────────────────────
const ACCOUNT_A = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
const ACCOUNT_B = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";
const ACCOUNT_C = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ACCOUNT_D = "GCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const ACCOUNT_E = "GCEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockDbStore.clear();
  mockStreamCloseHandles.length = 0;
  jest.clearAllMocks();
});

const webhookService = require("../src/services/webhookService");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("webhook registry", () => {
  it("registers and lists webhooks for an account", () => {
    const webhook = webhookService.registerWebhook(
      ACCOUNT_A,
      "https://x.test/hook",
      "supersecret",
    );

    const list = webhookService.getWebhooksByPublicKey(ACCOUNT_A);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("https://x.test/hook");
    expect(list[0].publicKey).toBe(ACCOUNT_A);
    expect(webhook).not.toHaveProperty("secret");
  });

  it("persists the webhook to the database with a hashed secret", () => {
    const webhookDb = require("../db/webhookDb");
    webhookService.registerWebhook(ACCOUNT_A, "https://x.test/hook", "supersecret");

    expect(webhookDb.insertWebhook).toHaveBeenCalledTimes(1);
    const call = webhookDb.insertWebhook.mock.calls[0][0];
    expect(call.publicKey).toBe(ACCOUNT_A);
    expect(call.url).toBe("https://x.test/hook");
    expect(call.secretHash).toBeTruthy();
    expect(call.secretHash).not.toBe("supersecret");
  });

  it("scopes listing to the account and supports deletion", () => {
    const webhook = webhookService.registerWebhook(
      ACCOUNT_B,
      "https://x.test/a",
      "secret-aaa",
    );
    webhookService.registerWebhook(ACCOUNT_C, "https://x.test/b", "secret-bbb");

    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_B)).toHaveLength(1);

    const deleted = webhookService.deleteWebhook(webhook.id);
    expect(deleted).toBe(true);

    expect(webhookService.getWebhooksByPublicKey(ACCOUNT_B)).toHaveLength(0);
  });

  it("returns false when deleting a non-existent webhook", () => {
    expect(webhookService.deleteWebhook("nonexistent-id")).toBe(false);
  });
});

describe("webhook persistence — restoreWebhooks", () => {
  it("re-establishes monitoring for every unique public key in the DB", () => {
    mockDbStore.set("id-1", {
      id: "id-1",
      publicKey: ACCOUNT_A,
      url: "https://a.test/hook",
      secretHash: "hash-a",
      createdAt: new Date().toISOString(),
      active: 1,
    });
    mockDbStore.set("id-2", {
      id: "id-2",
      publicKey: ACCOUNT_B,
      url: "https://b.test/hook",
      secretHash: "hash-b",
      createdAt: new Date().toISOString(),
      active: 1,
    });
    // Second entry for ACCOUNT_A — same key, different URL
    mockDbStore.set("id-3", {
      id: "id-3",
      publicKey: ACCOUNT_A,
      url: "https://a2.test/hook",
      secretHash: "hash-a2",
      createdAt: new Date().toISOString(),
      active: 1,
    });

    const webhookDb = require("../db/webhookDb");
    const streams = webhookService.restoreWebhooks();

    // 2 unique public keys → 2 SSE streams started
    expect(streams).toBe(2);
    expect(webhookDb.getAllActive).toHaveBeenCalled();
  });

  it("returns 0 when the DB is empty", () => {
    const streams = webhookService.restoreWebhooks();
    expect(streams).toBe(0);
  });

  it("makes restored webhooks visible via getWebhooksByPublicKey", () => {
    mockDbStore.set("id-1", {
      id: "id-1",
      publicKey: ACCOUNT_A,
      url: "https://a.test/hook",
      secretHash: "hash-a",
      createdAt: new Date().toISOString(),
      active: 1,
    });

    webhookService.restoreWebhooks();

    const list = webhookService.getWebhooksByPublicKey(ACCOUNT_A);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("https://a.test/hook");
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
    webhookService.registerWebhook(ACCOUNT_D, "https://x.test/shutdown", "secret-shutdown");
    const closeHandle = mockStreamCloseHandles[mockStreamCloseHandles.length - 1];
    expect(closeHandle).not.toHaveBeenCalled();

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
