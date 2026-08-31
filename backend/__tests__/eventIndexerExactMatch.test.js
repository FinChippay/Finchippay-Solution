"use strict";

/**
 * WS4 — exact-match participant queries.
 *
 * queryEventsByPublicKey / queryEventsByType / getEventStats must match
 * participants against the indexed from_addr / to_addr columns with equality
 * (not `payload::text ILIKE`, which is a full scan AND returns false
 * positives when the key appears anywhere in the JSON, e.g. inside a memo).
 */

const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const TEST_CONTRACT_ID = "CDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ123456";

function loadIndexer({ pool } = {}) {
  jest.resetModules();
  process.env.SOROBAN_RPC_URL = SOROBAN_RPC_URL;
  process.env.CONTRACT_ID = TEST_CONTRACT_ID;
  process.env.DATABASE_URL = "postgres://test";

  jest.doMock("pg", () => ({
    Pool: jest.fn(() => pool),
  }));

  jest.doMock("../src/services/pushNotifier", () => ({
    notifyContractEvents: jest.fn(),
  }));

  return require("../src/services/eventIndexer");
}

describe("eventIndexer exact-match participant queries (WS4)", () => {
  afterEach(() => {
    jest.dontMock("pg");
    delete process.env.DATABASE_URL;
  });

  const ACCOUNT = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";
  const ROW = {
    id: 1,
    event_type: "tip",
    contract_id: TEST_CONTRACT_ID,
    ledger_sequence: 10,
    emitted_at: "2026-08-25T12:00:00.000Z",
    from_addr: ACCOUNT,
    to_addr: null,
    amount_raw: "100",
    payload: { memo: ACCOUNT }, // key also appears in payload — must NOT match by ILIKE semantics
    created_at: "2026-08-25T12:00:00.000Z",
  };

  it("queryEventsByPublicKey uses equality on from_addr/to_addr, not payload ILIKE", async () => {
    const calls = [];
    const pool = {
      on: jest.fn(),
      query: jest.fn(async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes("COUNT")) {
          return { rows: [{ total: "1" }] };
        }
        return { rows: [ROW] };
      }),
      end: jest.fn(async () => {}),
    };
    const indexer = loadIndexer({ pool });

    const { events, total } = await indexer.queryEventsByPublicKey(ACCOUNT, { limit: 20 });

    expect(total).toBe(1);
    expect(events).toHaveLength(1);
    const sql = calls.map((c) => c.sql).join("\n");
    expect(sql).not.toContain("ILIKE");
    expect(sql).toContain("(from_addr = $1 OR to_addr = $1)");
    // Exact-match: the param is the raw key, no % wildcards.
    expect(calls[0].params[0]).toBe(ACCOUNT);
    expect(calls[0].params[0]).not.toContain("%");
  });

  it("queryEventsByType adds the event_type predicate to the exact-match clause", async () => {
    const calls = [];
    const pool = {
      on: jest.fn(),
      query: jest.fn(async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes("COUNT")) {
          return { rows: [{ total: "1" }] };
        }
        return { rows: [ROW] };
      }),
      end: jest.fn(async () => {}),
    };
    const indexer = loadIndexer({ pool });

    await indexer.queryEventsByType(ACCOUNT, "tip", { limit: 20 });

    const sql = calls.map((c) => c.sql).join("\n");
    expect(sql).not.toContain("ILIKE");
    expect(sql).toContain("(from_addr = $1 OR to_addr = $1) AND event_type = $2");
    // The first two params are the exact-match key and the event type; limit
    // and offset are appended after any optional `since`.
    expect(calls[0].params.slice(0, 2)).toEqual([ACCOUNT, "tip"]);
  });

  it("getEventStats groups exact matches by event_type", async () => {
    const calls = [];
    const pool = {
      on: jest.fn(),
      query: jest.fn(async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return { rows: [{ event_type: "tip", count: "3" }] };
      }),
      end: jest.fn(async () => {}),
    };
    const indexer = loadIndexer({ pool });

    const stats = await indexer.getEventStats(ACCOUNT);

    expect(stats).toEqual([{ event_type: "tip", count: "3" }]);
    const sql = calls[0].sql;
    expect(sql).not.toContain("ILIKE");
    expect(sql).toContain("(from_addr = $1 OR to_addr = $1)");
    expect(calls[0].params[0]).toBe(ACCOUNT);
  });
});
