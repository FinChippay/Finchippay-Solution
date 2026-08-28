"use strict";

const nock = require("nock");
const { parseEvent } = require("../src/services/eventParser");

const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const TEST_CONTRACT_ID = "CDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ123456";

function event(id, ledger = 5) {
  return {
    type: "contract",
    ledger,
    ledgerClosedAt: "2026-08-25T12:00:00.000Z",
    contractId: TEST_CONTRACT_ID,
    id,
    pagingToken: `token-${id}`,
    txHash: `${String(id).replace(/[^a-f0-9]/gi, "a").padEnd(64, "a").slice(0, 64)}`,
    topic: ["tip", "GFROM", "GTO"],
    data: { amount: "100" },
  };
}

function loadIndexer({ databaseUrl, pool } = {}) {
  jest.resetModules();
  process.env.SOROBAN_RPC_URL = SOROBAN_RPC_URL;
  process.env.CONTRACT_ID = TEST_CONTRACT_ID;

  if (databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
    jest.doMock("pg", () => ({
      Pool: jest.fn(() => pool),
    }));
  } else {
    delete process.env.DATABASE_URL;
    jest.dontMock("pg");
  }

  jest.doMock("../src/services/pushNotifier", () => ({
    notifyContractEvents: jest.fn(),
  }));

  return require("../src/services/eventIndexer");
}

function mockRpc(method, result, bodyPredicate = () => true) {
  return nock(SOROBAN_RPC_URL)
    .post("/", (body) => body.method === method && bodyPredicate(body))
    .reply(200, {
      jsonrpc: "2.0",
      id: 1,
      result,
    });
}

describe("eventIndexer cursor reliability", () => {
  afterEach(() => {
    nock.cleanAll();
    jest.dontMock("pg");
    delete process.env.DATABASE_URL;
  });

  it("loads the cursor from indexer_state instead of MAX(contract_events.ledger_sequence)", async () => {
    const queries = [];
    const pool = {
      on: jest.fn(),
      query: jest.fn(async (sql) => {
        queries.push(sql);
        if (String(sql).includes("SELECT last_processed_ledger")) {
          return {
            rows: [
              {
                last_processed_ledger: 42,
                last_processed_tx_id: "tx-42",
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
      end: jest.fn(async () => {}),
    };
    const indexer = loadIndexer({ databaseUrl: "postgres://test", pool });

    await expect(indexer._internals.loadCursor()).resolves.toBe(42);

    expect(queries.join("\n")).toContain("indexer_state");
    expect(queries.join("\n")).not.toContain("MAX(ledger_sequence)");
    expect(indexer._internals.getCursorForTest()).toMatchObject({
      lastProcessedLedger: 42,
      lastProcessedTxId: "tx-42",
    });
  });

  it("follows getEvents pagination cursors until exhausted", async () => {
    const pageBodies = [];
    mockRpc(
      "getEvents",
      { events: [event("a1", 10)], cursor: "cursor-1" },
      (body) => {
        pageBodies.push(body);
        return body.params.startLedger === 10 && body.params.endLedger === 13;
      },
    );
    mockRpc(
      "getEvents",
      { events: [event("b2", 11)], cursor: null },
      (body) => {
        pageBodies.push(body);
        return body.params.pagination.cursor === "cursor-1" && body.params.startLedger === undefined;
      },
    );
    const indexer = loadIndexer();

    const events = await indexer._internals.getEvents(10, 13);

    expect(events).toHaveLength(2);
    expect(events.map((ev) => ev.id)).toEqual(["a1", "b2"]);
    expect(pageBodies[1].params.endLedger).toBeUndefined();
  });

  it("counts ON CONFLICT DO NOTHING rows as conflicts, not inserts", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    };
    const pool = {
      on: jest.fn(),
      connect: jest.fn(async () => client),
      end: jest.fn(async () => {}),
    };
    const indexer = loadIndexer({ databaseUrl: "postgres://test", pool });

    const summary = await indexer._internals.storeEvents([
      {
        event_type: "tip",
        contract_id: TEST_CONTRACT_ID,
        ledger_sequence: 5,
        emitted_at: "2026-08-25T12:00:00.000Z",
        payload: { eventId: "a" },
      },
      {
        event_type: "tip",
        contract_id: TEST_CONTRACT_ID,
        ledger_sequence: 5,
        emitted_at: "2026-08-25T12:00:00.000Z",
        payload: { eventId: "b" },
      },
    ]);

    expect(summary).toEqual({ inserted: 1, conflicts: 1, errors: 0 });
    expect(client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("stores the RPC event id in payload.id for the deduplication index", () => {
    expect(parseEvent(event("dedupe-id", 7)).payload).toMatchObject({
      id: "dedupe-id",
      eventId: "dedupe-id",
    });
  });

  it("does not advance the watermark when a conflict occurs in the range", async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({}),
      release: jest.fn(),
    };
    const pool = {
      on: jest.fn(),
      connect: jest.fn(async () => client),
      query: jest.fn(async () => ({ rows: [], rowCount: 1 })),
      end: jest.fn(async () => {}),
    };
    mockRpc("getLatestLedger", { sequence: 5 });
    mockRpc("getEvents", { events: [event("conflict", 5)], cursor: null });
    const indexer = loadIndexer({ databaseUrl: "postgres://test", pool });

    await indexer._internals.pollOnce();

    expect(indexer._internals.getCursorForTest().lastProcessedLedger).toBe(0);
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining("last_processed_ledger = EXCLUDED"), expect.any(Array));
  });

  it("advances the PostgreSQL cursor in the same transaction as a clean batch", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    };
    const pool = {
      on: jest.fn(),
      connect: jest.fn(async () => client),
      query: jest.fn(async () => ({ rows: [], rowCount: 1 })),
      end: jest.fn(async () => {}),
    };
    mockRpc("getLatestLedger", { sequence: 5 });
    mockRpc("getEvents", { events: [event("clean", 5)], cursor: null });
    const indexer = loadIndexer({ databaseUrl: "postgres://test", pool });

    await indexer._internals.pollOnce();

    const calls = client.query.mock.calls.map(([sql]) => String(sql));
    const cursorCall = calls.findIndex((sql) => sql.includes("indexer_state"));
    const commitCall = calls.findIndex((sql) => sql === "COMMIT");

    expect(cursorCall).toBeGreaterThan(-1);
    expect(commitCall).toBeGreaterThan(cursorCall);
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining("indexer_state"), expect.any(Array));
    expect(indexer._internals.getCursorForTest().lastProcessedLedger).toBe(5);
  });

  it("advances the cursor after a fully paged empty PostgreSQL range", async () => {
    const pool = {
      on: jest.fn(),
      query: jest.fn(async () => ({ rows: [], rowCount: 1 })),
      end: jest.fn(async () => {}),
    };
    mockRpc("getLatestLedger", { sequence: 6 });
    mockRpc("getEvents", { events: [], cursor: "empty-next" });
    mockRpc("getEvents", { events: [], cursor: null }, (body) => {
      return body.params.pagination.cursor === "empty-next";
    });
    const indexer = loadIndexer({ databaseUrl: "postgres://test", pool });

    await indexer._internals.pollOnce();

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("indexer_state"), [
      "contract_events",
      6,
      null,
    ]);
    expect(indexer._internals.getCursorForTest().lastProcessedLedger).toBe(6);
  });

  it("does not advance the watermark when an insert error rolls back the batch", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("insert failed"))
        .mockResolvedValueOnce({}),
      release: jest.fn(),
    };
    const pool = {
      on: jest.fn(),
      connect: jest.fn(async () => client),
      query: jest.fn(async () => ({ rows: [], rowCount: 1 })),
      end: jest.fn(async () => {}),
    };
    mockRpc("getLatestLedger", { sequence: 5 });
    mockRpc("getEvents", { events: [event("bad", 5)], cursor: null });
    const indexer = loadIndexer({ databaseUrl: "postgres://test", pool });

    await indexer._internals.pollOnce();

    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(indexer._internals.getCursorForTest().lastProcessedLedger).toBe(0);
  });

  it("advances after a clean multi-page range, including an empty first page", async () => {
    mockRpc("getLatestLedger", { sequence: 8 });
    mockRpc("getEvents", { events: [], cursor: "next-page" });
    mockRpc("getEvents", { events: [event("late", 8)], cursor: null }, (body) => {
      return body.params.pagination.cursor === "next-page";
    });
    const indexer = loadIndexer();

    await indexer._internals.pollOnce();

    expect(indexer._internals.getCursorForTest().lastProcessedLedger).toBe(8);
  });
});
