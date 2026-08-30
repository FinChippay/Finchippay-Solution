/* eslint-env jest */
/**
 * Webhook registry, signed delivery, retry logic, dead letter queue,
 * SQLite persistence, and graceful shutdown.
 */
"use strict";

const crypto = require("crypto");

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
  const state = {
    table: tableName,
    wheres: [],
    whereIns: [],
    isCount: false,
    funcs: [],
    onConflictCol: null,
  };

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
        state.funcs.push(col);
        state.wheres.push({ fn: (row) => state.funcs.every((f) => f(row)) });
      } else {
        state.wheres.push({ col, val });
      }
      return builder;
    },
    orWhere(fnOrCol, val) {
      // Mirror the simple (always-true) orWhere used by the service's deadline
      // query so it never crashes the chain.
      state.wheres.push({ fn: fnOrCol ? () => true : () => true });
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
      let rows = Array.from(getStore().values()).filter(matchesRow);
      if (state.isCount) {
        return Promise.resolve([{ cnt: rows.length }]);
      }
      return Promise.resolve(rows);
    },
    first() {
      const rows = Array.from(getStore().values()).filter(matchesRow);
      if (state.isCount) {
        return Promise.resolve({ cnt: rows.length });
      }
      return Promise.resolve(rows[0] || null);
    },
    insert(row) {
      // Resolve on the next microtask so `.onConflict().ignore()` can attach.
      const p = Promise.resolve().then(() => {
        if (state.onConflictCol && row[state.onConflictCol] !== undefined) {
          const existing = Array.from(getStore().values()).some(
            (r) => r[state.onConflictCol] === row[state.onConflictCol],
          );
          if (existing) return [0]; // unique conflict → nothing inserted
        }
        getStore().set(row.id, { ...row });
        return [1];
      });
      p.onConflict = (col) => {
        state.onConflictCol = col;
        return { ignore: () => p.then((cntOrArr) => cntOrArr[0] ?? cntOrArr) };
      };
      return p;
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
      // Joins for dead-delivery and event queries. Resolves webhook_events
      // rows joined with webhooks (so WS4 keyset tests can exercise the real
      // query chain), handling the `w.` / `e.` column prefixes.
      const resolveJoined = () => {
        const webhookRows = Array.from(mockWebhooks.values());
        return Array.from(mockEvents.values()).filter((ev) => {
          const wh = webhookRows.find((w) => w.id === ev.webhook_id);
          if (!wh) return false;
          return state.wheres.every(({ col, val }) => {
            if (col === "w.public_key") return wh.public_key === val;
            if (col === "w.id") return wh.id === val;
            return ev[col] === val;
          });
        });
      };
      const joined = {
        where(col, val) {
          if (typeof col === "function") {
            state.wheres.push({ fn: (row) => true });
          } else {
            state.wheres.push({ col, val });
          }
          return joined;
        },
        andWhere(colOrFn, val) {
          if (typeof colOrFn === "function") {
            state.wheres.push({ fn: () => true });
          } else {
            state.wheres.push({ col: colOrFn, val });
          }
          return joined;
        },
        orderBy() {
          return joined;
        },
        limit(n) {
          state.limit = n;
          return joined;
        },
        select() {
          return joined;
        },
        groupBy() {
          return { select: () => ({ count: () => Promise.resolve([]) }) };
        },
        // Real knex query builders are thenable; the service returns the
        // builder and relies on `await` to execute it. Mirror that here.
        then(resolve) {
          const rows = resolveJoined();
          return Promise.resolve(state.limit ? rows.slice(0, state.limit) : rows).then(resolve);
        },
      };
      return joined;
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
      state.isCount = true;
      return builder;
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

  it("keeps only the ciphertext in memory after registration (WS7)", async () => {
    await webhookService.registerWebhook(ACCOUNT_A, "https://x.test/hook", "supersecret");

    // The DB row stores ciphertext, never the plaintext.
    const [row] = Array.from(mockWebhooks.values());
    expect(row.secret).toBe("enc:supersecret");
    expect(row.secret).not.toBe("supersecret");

    // Delivery decrypts the ciphertext blob at send time and signs with the
    // plaintext — a restored webhook (ciphertext-only) delivers correctly.
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    try {
      const restored = { id: row.id, publicKey: ACCOUNT_A, url: row.url, secret: row.secret };
      await webhookService.deliverWebhook(
        restored,
        { event: "payment.received" },
        "payment.received",
      );
      const call = global.fetch.mock.calls[0];
      expect(call[1].headers["X-Webhook-Signature"]).toBe("sig-supersecret");
    } finally {
      delete global.fetch;
    }
  });

  it("lists webhooks with ciphertext secrets, never the plaintext (WS7)", async () => {
    await webhookService.registerWebhook(ACCOUNT_A, "https://x.test/hook", "supersecret");

    const list = await webhookService.getWebhooksByPublicKey(ACCOUNT_A);
    expect(list[0].secret).toBe("enc:supersecret");
    expect(list[0].secret).not.toBe("supersecret");
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

describe("webhook event idempotency (WS3)", () => {
  beforeAll(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterAll(() => {
    delete global.fetch;
  });

  it("delivering the same event twice creates one event and one delivery", async () => {
    const webhook = {
      id: "wh-idem-1",
      publicKey: ACCOUNT_A,
      url: "https://x.test/hook",
      secret: "enc:supersecret",
    };
    const payload = {
      event: "payment.received",
      publicKey: ACCOUNT_A,
      payment: { id: "op-1", amount: "1", asset: "XLM", from: ACCOUNT_B, to: ACCOUNT_A },
    };

    await webhookService.deliverWebhook(webhook, payload, "payment.received");
    await webhookService.deliverWebhook(webhook, payload, "payment.received");

    // Stable idempotency key ⇒ the second delivery dedupes at the event level.
    expect(Array.from(mockEvents.values())).toHaveLength(1);
    expect(Array.from(mockDeliveries.values())).toHaveLength(1);

    const events = Array.from(mockEvents.values());
    expect(events[0].idempotency_key).toBeTruthy();
    // No timestamp in the key ⇒ deterministic for the same (id, type, payload).
    const keys = events.map((e) => e.idempotency_key);
    expect(new Set(keys).size).toBe(1);
  });
});

describe("webhook events keyset pagination (WS4)", () => {
  function seedEvent(webhookId, created, id = crypto.randomUUID()) {
    mockEvents.set(id, {
      id,
      webhook_id: webhookId,
      event_type: "payment.received",
      payload: JSON.stringify({ event: "payment.received" }),
      idempotency_key: `key-${id}`,
      created_at: created,
    });
    return id;
  }

  it("returns only events for the caller's webhooks (joined by public key)", async () => {
    const whA = await webhookService.registerWebhook(
      ACCOUNT_A,
      "https://x.test/hook",
      "supersecret",
    );
    const whB = await webhookService.registerWebhook(
      ACCOUNT_B,
      "https://y.test/hook",
      "supersecret",
    );
    seedEvent(whA.id, "2026-08-25T10:00:00.000Z");
    seedEvent(whB.id, "2026-08-25T11:00:00.000Z");

    const events = await webhookService.getEvents(ACCOUNT_A, { limit: 10 });

    expect(events).toHaveLength(1);
    expect(events[0].webhook_id).toBe(whA.id);
  });

  it("fetches limit + 1 rows so the caller can detect a next page without a second query", async () => {
    const wh = await webhookService.registerWebhook(
      ACCOUNT_A,
      "https://x.test/hook",
      "supersecret",
    );
    for (let i = 0; i < 4; i++) {
      seedEvent(wh.id, `2026-08-25T0${i}:00:00.000Z`, `ev-${i}`);
    }

    const events = await webhookService.getEvents(ACCOUNT_A, { limit: 3 });
    expect(events).toHaveLength(4); // limit + 1 (3 + 1)
  });

  it("accepts an opaque keyset cursor without error", async () => {
    const wh = await webhookService.registerWebhook(
      ACCOUNT_A,
      "https://x.test/hook",
      "supersecret",
    );
    seedEvent(wh.id, "2026-08-25T10:00:00.000Z", "ev-cursor");

    const cursor = Buffer.from(
      JSON.stringify({ created_at: "2026-08-25T10:00:00.000Z", id: "ev-cursor" }),
    ).toString("base64url");

    const events = await webhookService.getEvents(ACCOUNT_A, { limit: 10, cursor });
    expect(Array.isArray(events)).toBe(true);
  });

  it("ignores a malformed cursor instead of crashing the query", async () => {
    const wh = await webhookService.registerWebhook(
      ACCOUNT_A,
      "https://x.test/hook",
      "supersecret",
    );
    seedEvent(wh.id, "2026-08-25T10:00:00.000Z", "ev-ok");

    const events = await webhookService.getEvents(ACCOUNT_A, { limit: 10, cursor: "not-json!!!" });
    expect(Array.isArray(events)).toBe(true);
    expect(events).toHaveLength(1);
  });
});
