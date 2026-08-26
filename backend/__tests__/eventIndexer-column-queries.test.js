/* eslint-env jest */
/**
 * __tests__/eventIndexer-column-queries.test.js
 * Tests for issue #889 — participant queries use indexed exact-match columns
 * (from_addr / to_addr) instead of ILIKE on serialized JSON.
 *
 * Verifies:
 *  - Exact participant filtering returns only the user's events
 *  - A public key string appearing in a memo/payload does NOT produce false matches
 *  - queryEventsByPublicKey returns only events where the key is from_addr or to_addr
 *  - queryEventsByType returns only events matching both participant AND event type
 *  - getEventStats counts events only for the specified participant
 */

"use strict";

// Do NOT set DATABASE_URL — we test the in-memory fallback path
process.env.CONTRACT_ID = "TESTCONTRACT123456789012345678901234567890";

const eventIndexer = require("../src/services/eventIndexer");

// ─── Test data ───────────────────────────────────────────────────────────────

const ALICE = "GB2JLUHNVHL64FKADLJVH5TMUWTS6P5BS4Y3WJT6KU7FRXBFQM5PGGVV";
const BOB = "GABCDEFHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ12345";
const MEMO_TEXT = "Thanks for the tip!"; // does NOT contain a public key

// An event where ALICE sent a tip to BOB
const aliceToBobTip = {
  event_type: "tip",
  contract_id: "CDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
  ledger_sequence: 100,
  emitted_at: "2025-01-01T00:00:00Z",
  from_addr: ALICE,
  to_addr: BOB,
  payload: {
    from: ALICE,
    to: BOB,
    amount: "1000",
    memo: MEMO_TEXT,
  },
};

// An event where BOB sent a receipt to ALICE
const bobToAliceReceipt = {
  event_type: "receipt",
  contract_id: "CDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
  ledger_sequence: 101,
  emitted_at: "2025-01-01T00:00:01Z",
  from_addr: BOB,
  to_addr: ALICE,
  payload: {
    from: BOB,
    to: ALICE,
    amount: "500",
  },
};

// An event that is completely unrelated to ALICE or BOB
const unrelatedEvent = {
  event_type: "tip",
  contract_id: "CDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
  ledger_sequence: 99,
  emitted_at: "2025-01-01T00:00:00Z",
  from_addr: "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
  to_addr: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  payload: {
    from: "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    to: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
    amount: "999",
  },
};

// An event whose memo field contains ALICE's public key as a substring.
// This tests the false-positive scenario: ALICE should NOT appear in results
// for a query that searches by participant, because she is neither from_addr
// nor to_addr.
const memoContainsAliceKey = {
  event_type: "receipt",
  contract_id: "CDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
  ledger_sequence: 102,
  emitted_at: "2025-01-01T00:00:02Z",
  from_addr: "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
  to_addr: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  payload: {
    from: "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    to: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
    amount: "200",
    memo: `Payment forwarded from ${ALICE} via batch`,
  },
};

// An event where ALICE is the recipient (to_addr) only
const toAliceOnly = {
  event_type: "escrow_claim",
  contract_id: "CDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
  ledger_sequence: 103,
  emitted_at: "2025-01-01T00:00:03Z",
  from_addr: "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
  to_addr: ALICE,
  payload: {
    from: "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    to: ALICE,
    amount: "300",
  },
};

const ALL_EVENTS = [
  aliceToBobTip,
  bobToAliceReceipt,
  unrelatedEvent,
  memoContainsAliceKey,
  toAliceOnly,
];

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  eventIndexer._resetForTest();
  eventIndexer._seedForTest(ALL_EVENTS);
});

afterAll(() => {
  eventIndexer._resetForTest();
});

// ─── queryEventsByPublicKey ───────────────────────────────────────────────────

describe("queryEventsByPublicKey — exact column match (issue #889)", () => {
  it("returns only events where ALICE is from_addr or to_addr", async () => {
    const { events, total } = await eventIndexer.queryEventsByPublicKey(ALICE);

    // ALICE appears in: aliceToBobTip (from), bobToAliceReceipt (to),
    // toAliceOnly (to). NOT in unrelatedEvent or memoContainsAliceKey.
    expect(total).toBe(3);
    const ids = events.map((e) => e.ledger_sequence);
    expect(ids).toContain(100); // aliceToBobTip
    expect(ids).toContain(101); // bobToAliceReceipt
    expect(ids).toContain(103); // toAliceOnly
    expect(ids).not.toContain(99); // unrelatedEvent
    expect(ids).not.toContain(102); // memoContainsAliceKey
  });

  it("does NOT return events where ALICE only appears in a memo/payload field", async () => {
    const { events } = await eventIndexer.queryEventsByPublicKey(ALICE);
    const ledgerSequences = events.map((e) => e.ledger_sequence);
    // The event at ledger 102 has ALICE's key in the memo — must not match
    expect(ledgerSequences).not.toContain(102);
  });

  it("returns events for BOB as well", async () => {
    const { events, total } = await eventIndexer.queryEventsByPublicKey(BOB);

    // BOB appears in: aliceToBobTip (to), bobToAliceReceipt (from)
    expect(total).toBe(2);
    const ids = events.map((e) => e.ledger_sequence);
    expect(ids).toContain(100); // aliceToBobTip
    expect(ids).toContain(101); // bobToAliceReceipt
  });

  it("returns empty for a completely unknown public key", async () => {
    const UNKNOWN = "G123456789012345678901234567890123456789012345678901234";
    const { events, total } = await eventIndexer.queryEventsByPublicKey(UNKNOWN);
    expect(total).toBe(0);
    expect(events).toEqual([]);
  });

  it("returns events in descending ledger order", async () => {
    const { events } = await eventIndexer.queryEventsByPublicKey(ALICE);
    const ledgers = events.map((e) => e.ledger_sequence);
    // Should be descending: 103, 101, 100
    expect(ledgers).toEqual([103, 101, 100]);
  });
});

// ─── queryEventsByType ────────────────────────────────────────────────────────

describe("queryEventsByType — exact column match (issue #889)", () => {
  it("returns only tip events where ALICE is a participant", async () => {
    const { events, total } = await eventIndexer.queryEventsByType(ALICE, "tip");

    // Only aliceToBobTip matches: event_type=tip AND ALICE is participant
    expect(total).toBe(1);
    expect(events[0].ledger_sequence).toBe(100);
  });

  it("returns only receipt events where ALICE is a participant", async () => {
    const { events, total } = await eventIndexer.queryEventsByType(ALICE, "receipt");

    // Only bobToAliceReceipt matches (ALICE is to_addr)
    expect(total).toBe(1);
    expect(events[0].ledger_sequence).toBe(101);
  });

  it("does NOT return receipt events where ALICE appears only in a memo", async () => {
    const { events } = await eventIndexer.queryEventsByType(ALICE, "receipt");
    const ledgers = events.map((e) => e.ledger_sequence);
    // ledger 102 (memoContainsAliceKey) should NOT appear
    expect(ledgers).not.toContain(102);
  });

  it("returns 0 for an event type ALICE has no events for", async () => {
    const { events, total } = await eventIndexer.queryEventsByType(ALICE, "stream_open");
    expect(total).toBe(0);
    expect(events).toEqual([]);
  });
});

// ─── getEventStats ────────────────────────────────────────────────────────────

describe("getEventStats — exact column match (issue #889)", () => {
  it("returns correct breakdown for ALICE", async () => {
    const stats = await eventIndexer.getEventStats(ALICE);
    const map = Object.fromEntries(stats.map((s) => [s.event_type, s.count]));

    // ALICE is participant in: tip(1), receipt(1), escrow_claim(1)
    expect(map.tip).toBe(1);
    expect(map.receipt).toBe(1);
    expect(map.escrow_claim).toBe(1);
    // Not in unrelatedEvent or memoContainsAliceKey
    expect(Object.values(map).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("does NOT count events where the key only appears in a memo", async () => {
    const stats = await eventIndexer.getEventStats(ALICE);
    const totalEvents = stats.reduce((sum, s) => sum + s.count, 0);
    // There are 5 total events, but only 3 involve ALICE as participant.
    // The memo-containing event (ledger 102) must not inflate the count.
    expect(totalEvents).toBe(3);
  });

  it("returns correct breakdown for BOB", async () => {
    const stats = await eventIndexer.getEventStats(BOB);
    const map = Object.fromEntries(stats.map((s) => [s.event_type, s.count]));

    // BOB is participant in: tip(1), receipt(1)
    expect(map.tip).toBe(1);
    expect(map.receipt).toBe(1);
    expect(Object.values(map).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("returns empty array for unknown public key", async () => {
    const UNKNOWN = "G123456789012345678901234567890123456789012345678901234";
    const stats = await eventIndexer.getEventStats(UNKNOWN);
    expect(stats).toEqual([]);
  });
});
