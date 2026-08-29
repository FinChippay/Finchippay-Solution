/**
 * Event parser tests — issue #945 workstream 4 (backend side).
 *
 * The contract's canonical event catalog lives in
 * `contracts/finchippay-contract/src/events.rs`. This suite pins the
 * catalog == emitted == parsed invariant on the backend: every airdrop,
 * vesting, multi-sig and tip topic the contract emits must be recognized by
 * `eventParser.js` with a consistent `event_type`, and the tip family must
 * resolve to the single `tip_sent` topic (no bare `tip` with two payload
 * shapes).
 */
"use strict";

const { parseEvent, EVENT_PARTICIPANT_MAP } = require("../src/services/eventParser.js");

const eventWithTopic = (topic) => ({
  topic,
  data: null,
  contractId: "CCW67TSZV3SSS2HXMBQ52NVF3FB25GQ2G6E3BGLZ52B7W7TKG4E7SML2",
});

describe("eventParser contract-event parity (issue #945 WS4)", () => {
  it("maps tip_sent participants from the topic and keeps one topic", () => {
    const ev = parseEvent(eventWithTopic(["tip_sent", "G_FROM", "G_TO"]));
    expect(ev.event_type).toBe("tip_sent");
    expect(ev.from_addr).toBe("G_FROM");
    expect(ev.to_addr).toBe("G_TO");
  });

  it("no longer emits a bare `tip` topic", () => {
    // The old single-shape-vs-tuple anomaly was replaced by canonical tip_sent.
    expect(EVENT_PARTICIPANT_MAP.tip).toBeUndefined();
    expect(EVENT_PARTICIPANT_MAP.tip_sent).toBeDefined();
  });

  it("recognizes all three airdrop events", () => {
    for (const name of ["airdrop_created", "airdrop_claimed", "airdrop_cancelled"]) {
      const ev = parseEvent(eventWithTopic([name]));
      expect(ev.event_type).toBe(name);
    }
  });

  it("recognizes the canonical vesting events", () => {
    for (const name of ["vesting_created", "vesting_claimed", "vesting_revoked"]) {
      const ev = parseEvent(eventWithTopic([name]));
      expect(ev.event_type).toBe(name);
    }
  });

  it("recognizes the canonical multisig events", () => {
    const names = [
      "multisig_created",
      "multisig_approved",
      "multisig_executed",
      "multisig_timeout",
      "multisig_cancelled",
    ];
    for (const name of names) {
      const ev = parseEvent(eventWithTopic([name]));
      expect(ev.event_type).toBe(name);
    }
  });

  it("parses the batch_sent completion event", () => {
    const ev = parseEvent(eventWithTopic(["batch_sent"]));
    expect(ev.event_type).toBe("batch_sent");
  });
});