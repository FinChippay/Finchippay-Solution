/* eslint-env jest */
/**
 * __tests__/webhookSubscriptionService.test.js
 *
 * Webhook topic-subscription semantics. The module previously tested a
 * `webhookSubscriptionService` that was consolidated into `webhookService`
 * + `webhookTopics`; this suite tests the surviving behavior: normalization,
 * defaults, secret redaction, and topic-gated delivery.
 */

"use strict";

const crypto = require("crypto");

// Mock the SDK / infra the service imports at load time.
jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      payments: () => ({
        forAccount: () => ({
          cursor: () => ({
            stream: () => jest.fn(),
          }),
        }),
      }),
    })),
  },
}));

const mockWebhooks = new Map();
const mockDeliveries = new Map();
const mockEvents = new Map();

function mockMakeBuilder(tableName) {
  const state = { wheres: [], onConflictCol: null, isCount: false, limit: null };

  function getStore() {
    if (tableName === "webhooks") return mockWebhooks;
    if (tableName === "webhook_deliveries") return mockDeliveries;
    return mockEvents;
  }

  function matchesRow(row) {
    return state.wheres.every(({ col, val }) => row[col] === val);
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
    andWhere(col, val) {
      state.wheres.push({ col, val });
      return builder;
    },
    orWhere() {
      return builder;
    },
    whereNull() {
      return builder;
    },
    whereIn() {
      return builder;
    },
    count() {
      state.isCount = true;
      return builder;
    },
    first() {
      const rows = Array.from(getStore().values()).filter(matchesRow);
      if (state.isCount) return Promise.resolve({ cnt: rows.length });
      return Promise.resolve(rows[0] || null);
    },
    select() {
      const rows = Array.from(getStore().values()).filter(matchesRow);
      return Promise.resolve(state.limit ? rows.slice(0, state.limit) : rows);
    },
    insert(row) {
      const p = Promise.resolve().then(() => {
        if (state.onConflictCol && row[state.onConflictCol] !== undefined) {
          const existing = Array.from(getStore().values()).some(
            (r) => r[state.onConflictCol] === row[state.onConflictCol],
          );
          if (existing) return [0];
        }
        getStore().set(row.id, { ...row });
        return [1];
      });
      p.onConflict = (col) => {
        state.onConflictCol = col;
        return { ignore: () => p.then((v) => (Array.isArray(v) ? v[0] : v)) };
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
      for (const [, row] of getStore()) {
        if (matchesRow(row)) {
          Object.assign(row, patch);
          count++;
        }
      }
      return Promise.resolve(count);
    },
    join() {
      const joined = {
        where: () => joined,
        andWhere: () => joined,
        orderBy: () => joined,
        limit: (n) => {
          state.limit = n;
          return joined;
        },
        select: () => Promise.resolve([]),
        groupBy: () => ({ select: () => ({ count: () => Promise.resolve([]) }) }),
        then: (resolve) => Promise.resolve([]).then(resolve),
      };
      return joined;
    },
    orderBy: () => builder,
    groupBy: () => builder,
    limit: (n) => {
      state.limit = n;
      return builder;
    },
  };

  return builder;
}

jest.mock("../src/db/connection", () => {
  const knexMock = jest.fn((tableName) => mockMakeBuilder(tableName));
  return knexMock;
});

jest.mock("../src/utils/encryption", () => ({
  encryptSecret: jest.fn((s) => `enc:${s}`),
  decryptSecret: jest.fn((s) => s.replace(/^enc:/, "")),
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

const webhookService = require("../src/services/webhookService");
const {
  SUPPORTED_WEBHOOK_TOPICS,
  normalizeTopics,
  serializeTopics,
  parseTopics,
  matchesWebhookTopic,
} = require("../src/services/webhookTopics");

const ACCOUNT = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

beforeEach(() => {
  mockWebhooks.clear();
  mockDeliveries.clear();
  mockEvents.clear();
  jest.clearAllMocks();
});

describe("webhook topic subscriptions", () => {
  it("persists normalized topics and returns them from registration", async () => {
    const webhook = await webhookService.registerWebhook(
      ACCOUNT,
      "https://x.test/hook",
      "supersecret",
      ["payment.received", "payment.sent"],
    );

    const [row] = Array.from(mockWebhooks.values());
    expect(parseTopics(row.topics)).toEqual(["payment.received", "payment.sent"]);
    expect(webhook.id).toBeTruthy();
  });

  it("defaults omitted topics to all", async () => {
    await webhookService.registerWebhook(ACCOUNT, "https://x.test/hook", "supersecret");

    const [row] = Array.from(mockWebhooks.values());
    expect(parseTopics(row.topics)).toEqual(["all"]);
  });

  it("lists subscribed topics without exposing the signing secret", async () => {
    await webhookService.registerWebhook(ACCOUNT, "https://x.test/hook", "supersecret", [
      "tip.received",
    ]);

    const list = await webhookService.getWebhooksByPublicKey(ACCOUNT);
    expect(list).toHaveLength(1);
    expect(parseTopics(list[0].topics)).toEqual(["tip.received"]);
    // Only the ciphertext blob is exposed, never the plaintext (WS7).
    expect(list[0].secret).not.toBe("supersecret");
  });

  it("filters a non-matching topic before invoking delivery", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    try {
      const webhook = await webhookService.registerWebhook(
        ACCOUNT,
        "https://x.test/hook",
        "supersecret",
        ["tip.received"],
      );
      // Only the ciphertext is in the cache; rebuild the delivery object the
      // way restoreWebhooks does so decrypt-at-delivery still works.
      const restored = {
        id: webhook.id,
        publicKey: ACCOUNT,
        url: "https://x.test/hook",
        secret: "enc:supersecret",
        topics: ["tip.received"],
      };

      await webhookService.deliverWebhook(
        restored,
        { event: "payment.received" },
        "payment.received",
      );

      // Topic-gated out: no delivery record created.
      expect(Array.from(mockDeliveries.values())).toHaveLength(0);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      delete global.fetch;
    }
  });

  it("delivers matching explicit and all subscriptions", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    try {
      const explicit = {
        id: crypto.randomUUID(),
        publicKey: ACCOUNT,
        url: "https://x.test/explicit",
        secret: "enc:supersecret",
        topics: ["tip.received"],
      };
      const all = {
        id: crypto.randomUUID(),
        publicKey: ACCOUNT,
        url: "https://x.test/all",
        secret: "enc:supersecret",
        topics: ["all"],
      };

      await webhookService.deliverWebhook(explicit, { event: "tip.received" }, "tip.received");
      await webhookService.deliverWebhook(all, { event: "tip.received" }, "tip.received");

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(Array.from(mockDeliveries.values())).toHaveLength(2);
    } finally {
      delete global.fetch;
    }
  });

  it("exposes the canonical supported topic list", () => {
    expect(SUPPORTED_WEBHOOK_TOPICS).toContain("payment.received");
    expect(SUPPORTED_WEBHOOK_TOPICS).toContain("all");
    expect(matchesWebhookTopic(["all"], "anything.else")).toBe(true);
    expect(matchesWebhookTopic(["payment.received"], "payment.sent")).toBe(false);
    expect(normalizeTopics(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(serializeTopics(["all"])).toBe('["all"]');
  });
});
