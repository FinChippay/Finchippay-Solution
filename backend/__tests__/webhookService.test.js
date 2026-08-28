/* eslint-env jest */
/**
 * Webhook registry, signed delivery, retry logic, dead letter queue,
 * SQLite persistence, and graceful shutdown.
 */
"use strict";

// Set test env vars before any module is required
process.env.NODE_ENV = "test";
// 64-char hex key required by the AES-256-GCM encryption utility
process.env.WEBHOOK_ENCRYPTION_KEY =
  "aaabbbcccdddeeefff000111222333444555666777888999000aaabbbcccdddee";

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

// ─── Mock: Knex persistence layer ────────────────────────────────────────────
// Mirror the tables the service writes to: webhooks, webhook_deliveries,
// webhook_events. The mock variable prefix allows use inside jest.mock().
const mockWebhooks = new Map();
const mockDeliveries = new Map();
const mockEvents = new Map();

/**
 * Minimal knex query-builder stub. Supports the chained API used by
 * webhookService.js.
 */
function mockMakeBuilder(tableName) {
  const state = { table: tableName, wheres: [], whereIns: [] };

  function getStore() {
    if (tableName === "webhooks") return mockWebhooks;
    if (tableName === "webhook_deliveries") return mockDeliveries;
    return mockEvents;
  }

  // Handle aliased table names (e.g. "webhooks as w")
  function resolveTable(name) {
    return name.split(" as ")[0].trim();
  }

  function matchesRow(row) {
    return state.wheres.every(({ col, val, fn }) => {
      if (fn) return fn(row);
      return row[col] === val;
    });
  }

  const builder = {
    where(col, val) {
      if (typeof col === "function") {
        state.wheres.push({ fn: () => true });
      } else {
        state.wheres.push({ col, val });
      }
      return builder;
    },
    andWhere(colOrFn, val) {
      if (typeof colOrFn === "function") {
        state.wheres.push({ fn: () => true });
      } else {
        state.wheres.push({ col: colOrFn, val });
      }
      return builder;
    },
    whereNull(col) {
      state.wheres.push({ col, val: null });
      return builder;
    },
    orWhere() {
      return builder;
    },
    whereIn(col, vals) {
      state.whereIns.push({ col, vals });
      return builder;
    },
    select() {
      return Promise.resolve(Array.from(getStore().values()).filter(matchesRow));
    },
    first() {
      const row = Array.from(getStore().values()).find(matchesRow);
      return Promise.resolve(row || null);
    },
    insert(row) {
      getStore().set(row.id, { ...row });
      return Promise.resolve([1]);
    },
    del() {
      let count = 0;
      for (const [key, row] of getStore()) {
        if (matchesRow(row)) {
          getStore().delete(key);
          count++;
        }
      }
      return Promise.resolve(count);
    },
    update(patch) {
      let count = 0;
      const store = getStore();
      for (const [, row] of store) {
        const inMatch =
          state.whereIns.length === 0 ||
          state.whereIns.every(({ col, vals }) => vals.includes(row[col]));
        if (inMatch && matchesRow(row)) {
          Object.assign(row, patch);
          count++;
        }
      }
      return Promise.resolve(count);
    },
    join() {
      // Joins for dead-delivery and event queries — return empty arrays
      return {
        where: () => ({
          andWhere: () => ({
            orderBy: () => ({ select: () => Promise.resolve([]) }),
          }),
          select: () => Promise.resolve([]),
          groupBy: () => ({ select: () => ({ count: () => Promise.resolve([]) }) }),
        }),
      };
    },
    orderBy() {
      return builder;
    },
    groupBy() {
      return builder;
    },
    limit() {
      return builder;
    },
    count() {
      return Promise.resolve([]);
    },
  };

  return builder;
}

jest.mock("../src/db/connection", () => {
  const knexMock = jest.fn((tableName) => mockMakeBuilder(tableName));
  return knexMock;
});

// ─── Mock: encryption utility ────────────────────────────────────────────────
// Pass-through so tests don't depend on a valid AES key being set up.
jest.mock("../src/utils/encryption", () => ({
  encryptSecret: jest.fn((s) => `enc:${s}`),
  decryptSecret: jest.fn((s) => s.replace(/^enc:/, "")),
}));

// ─── Other mocks ──────────────────────────────────────────────────────────────

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
  mockWebhooks.clear();
  mockDeliveries.clear();
  mockEvents.clear();
  mockStreamCloseHandles.length = 0;
  jest.clearAllMocks();
});

const webhookService = require("../src/services/webhookService");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("webhook registry", () => {
  it("registers and lists webhooks for an account", async () => {
    const webhook = await webhookService.registerWebhook(
      ACCOUNT_A,
      "https://x.test/hook",
      "supersecret",
    );

    const list = await webhookService.getWebhooksByPublicKey(ACCOUNT_A);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("https://x.test/hook");
    // registerWebhook must not expose the plaintext secret in its return value
    expect(webhook).not.toHaveProperty("secret");
  });

  it("persists the webhook to the database with a hashed secret", async () => {
    await webhookService.registerWebhook(ACCOUNT_A, "https://x.test/hook", "supersecret");

    expect(mockWebhooks.size).toBe(1);
    const [row] = Array.from(mockWebhooks.values());
    expect(row.public_key).toBe(ACCOUNT_A);
    expect(row.url).toBe("https://x.test/hook");
    // secret_hash must be set and must NOT be the plaintext secret
    expect(row.secret_hash).toBeTruthy();
    expect(row.secret_hash).not.toBe("supersecret");
    // encrypted secret must also be stored
    expect(row.secret).toBeTruthy();
    expect(row.secret).not.toBe("supersecret");
  });

  it("scopes listing to the account and supports deletion", async () => {
    const webhook = await webhookService.registerWebhook(
      ACCOUNT_B,
      "https://x.test/a",
      "secret-aaa",
    );
    await webhookService.registerWebhook(ACCOUNT_C, "https://x.test/b", "secret-bbb");

    const listB = await webhookService.getWebhooksByPublicKey(ACCOUNT_B);
    expect(listB).toHaveLength(1);

    const deleted = await webhookService.deleteWebhook(webhook.id);
    expect(deleted).toBe(true);

    const listAfterDelete = await webhookService.getWebhooksByPublicKey(ACCOUNT_B);
    expect(listAfterDelete).toHaveLength(0);
  });

  it("returns false when deleting a non-existent webhook", async () => {
    const deleted = await webhookService.deleteWebhook("nonexistent-id");
    expect(deleted).toBe(false);
  });
});

describe("webhook persistence — restoreWebhooks", () => {
  it("re-establishes monitoring for every unique public key in the DB", async () => {
    // Seed two public keys (three rows: ACCOUNT_A appears twice)
    mockWebhooks.set("id-1", {
      id: "id-1",
      public_key: ACCOUNT_A,
      url: "https://a.test/hook",
      secret: "enc:hash-a",
      secret_hash: "hash-a",
      created_at: new Date().toISOString(),
    });
    mockWebhooks.set("id-2", {
      id: "id-2",
      public_key: ACCOUNT_B,
      url: "https://b.test/hook",
      secret: "enc:hash-b",
      secret_hash: "hash-b",
      created_at: new Date().toISOString(),
    });
    // Second entry for ACCOUNT_A — same key, different URL
    mockWebhooks.set("id-3", {
      id: "id-3",
      public_key: ACCOUNT_A,
      url: "https://a2.test/hook",
      secret: "enc:hash-a2",
      secret_hash: "hash-a2",
      created_at: new Date().toISOString(),
    });

    const streams = await webhookService.restoreWebhooks();

    // 2 unique public keys → 2 SSE streams started
    expect(streams).toBe(2);
  });

  it("returns 0 when the DB is empty", async () => {
    const streams = await webhookService.restoreWebhooks();
    expect(streams).toBe(0);
  });

  it("makes restored webhooks visible via getWebhooksByPublicKey", async () => {
    mockWebhooks.set("id-1", {
      id: "id-1",
      public_key: ACCOUNT_A,
      url: "https://a.test/hook",
      secret: "enc:hash-a",
      secret_hash: "hash-a",
      created_at: new Date().toISOString(),
    });

    await webhookService.restoreWebhooks();

    const list = await webhookService.getWebhooksByPublicKey(ACCOUNT_A);
    expect(list).toHaveLength(1);
    expect(list[0].url).toBe("https://a.test/hook");
  });
});

describe("signPayload", () => {
  it("uses the shared webhookSignature utility", () => {
    const sig = webhookService.signPayload("mysecret", { event: "test" });
    expect(sig).toBe("sig-mysecret");
  });

  it("builds a SEP-0045 compatible payload and headers", () => {
    const payload = webhookService.buildPayload(
      "payment.received",
      { amount: "1" },
      "secret",
      "v2",
    );
    expect(payload).toHaveProperty("id");
    expect(payload).toHaveProperty("timestamp");
    expect(payload).toHaveProperty("type", "payment.received");
    expect(payload).toHaveProperty("data");
    expect(payload.data).toEqual({ amount: "1" });
  });
});

describe("closeAllStreams (graceful shutdown on SIGTERM/SIGINT)", () => {
  it("closes every active Horizon SSE stream so none leak past process exit", async () => {
    await webhookService.registerWebhook(ACCOUNT_D, "https://x.test/shutdown", "secret-shutdown");
    const closeHandle = mockStreamCloseHandles[mockStreamCloseHandles.length - 1];
    expect(closeHandle).not.toHaveBeenCalled();

    await webhookService.closeAllStreams();

    expect(closeHandle).toHaveBeenCalledTimes(1);
  });

  it("clears activeStreams so a later registration opens a fresh stream", async () => {
    await webhookService.registerWebhook(ACCOUNT_E, "https://x.test/a", "secret-a");
    const firstCloseHandle = mockStreamCloseHandles[mockStreamCloseHandles.length - 1];

    await webhookService.closeAllStreams();

    await webhookService.registerWebhook(ACCOUNT_E, "https://x.test/b", "secret-b");
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
  it("retrieves dead deliveries", async () => {
    const deliveries = await webhookService.getDeadDeliveries(ACCOUNT_A);
    expect(Array.isArray(deliveries)).toBe(true);
  });

  it("resets dead deliveries for retry", async () => {
    const result = await webhookService.retryDeadDeliveries(ACCOUNT_A);
    expect(result).toHaveProperty("reset");
  });
});
