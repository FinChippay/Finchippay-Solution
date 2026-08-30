/**
 * backend/src/services/eventParser.js
 * Soroban Contract Event Parser
 *
 * Parses raw Soroban RPC events into structured rows for the contract_events
 * table. Extracts participant addresses (from/to), amounts, and maps event
 * types to known schemas for FinchippayContract.
 *
 * Event types emitted by the contract (canonical catalog in
 * contracts/finchippay-contract/src/events.rs — keep these in sync):
 *   init, admin_transfer, paused, unpaused, pauser_set, upgraded,
 *   rescue_tokens, tip_sent, batch_sent, receipt, escrow_create,
 *   escrow_claim_partial, escrow_claim, escrow_cancelled, stream_open,
 *   stream_claim, stream_topped_up, stream_close, stream_reject,
 *   stream_transfer, multisig_created, multisig_approved,
 *   multisig_executed, multisig_timeout, multisig_cancelled,
 *   airdrop_created, airdrop_claimed, airdrop_cancelled,
 *   vesting_created, vesting_claimed, vesting_revoked
 *
 * NOTE: the tip family uses exactly ONE topic — `tip_sent` — with payload
 * `(amount, memo)`, identical for `send_tip`, `batch_send` and
 * `batch_send_multi`. There is no bare `tip` topic any longer.
 */

"use strict";

/**
 * Maps of event types to their known address field names.
 * When parsing, we extract these fields from the payload and populate
 * from_addr / to_addr on the row.
 */
const EVENT_PARTICIPANT_MAP = {
  tip_sent: { from: "from", to: "to" },
  receipt: { from: "from", to: "to" },
  escrow_create: { from: "from", to: "to" },
  escrow_claim: { from: "from", to: "to" },
  escrow_claim_partial: { from: "from", to: "to" },
  escrow_cancelled: { from: "from", to: "to" },
  stream_open: { from: "payer", to: "recipient" },
  stream_claim: { from: "stream_id", to: "recipient" },
  stream_topped_up: { from: "payer", to: "recipient" },
  stream_close: { from: "stream_id", to: null },
  stream_reject: { from: "stream_id", to: null },
  stream_transfer: { from: "from", to: "to" },
  multisig_created: { from: "proposer", to: null },
  multisig_approved: { from: "signer", to: null },
  multisig_executed: { from: "proposer", to: "recipient" },
  multisig_timeout: { from: null, to: null },
  multisig_cancelled: { from: null, to: null },
  airdrop_created: { from: "funder", to: null },
  airdrop_claimed: { from: null, to: "recipient" },
  airdrop_cancelled: { from: "funder", to: null },
  vesting_created: { from: "funder", to: "beneficiary" },
  vesting_claimed: { from: "vesting_id", to: "beneficiary" },
  vesting_revoked: { from: "funder", to: null },
  admin_transfer: { from: "old_admin", to: "new_admin" },
  rescue_tokens: { from: "admin", to: "to" },
};

/**
 * Parse a raw Soroban event into our standard DB row shape.
 *
 * @param {object} raw - Raw Soroban RPC event object
 * @returns {object} Parsed event row ready for contract_events table
 */
function parseEvent(raw) {
  const topics = raw.topic ?? [];
  const data = raw.data;

  // Extract event type: first topic is typically a Symbol
  let eventType = "unknown";
  if (topics.length > 0) {
    const first = topics[0];
    if (typeof first === "string") {
      eventType = first;
    } else if (first && typeof first === "object") {
      eventType = first.symbol || first.str || first.value || String(first) || "unknown";
    }
  }

  eventType = String(eventType)
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 64);

  // Extract participant addresses based on known event schemas
  let fromAddr = null;
  let toAddr = null;
  let amountRaw = null;

  const schema = EVENT_PARTICIPANT_MAP[eventType] || {};

  // Parse SCVal objects to extract addresses and amounts
  const parseScVal = (val) => {
    if (!val) return null;
    if (typeof val === "string") return val;
    if (val && typeof val === "object") {
      return (
        val.address || val.symbol || val.str || val.scv_symbol || val.value || String(val) || null
      );
    }
    return null;
  };

  // Try extracting from known topic positions (topic[1] and topic[2])
  // Soroban events often have: topic[0] = event name, topic[1] = from, topic[2] = to
  if (topics.length >= 2 && schema.from) {
    fromAddr = parseScVal(topics[1]);
  }
  if (topics.length >= 3 && schema.to) {
    toAddr = parseScVal(topics[2]);
  }

  // Try extracting amount from data or topics
  if (data && typeof data === "object") {
    amountRaw = String(data.amount || data.i128 || data.u64 || data.u128 || "");
  }

  const payload = {
    id: raw.id ?? null,
    topics: topics,
    data: data ?? null,
    eventId: raw.id ?? null,
    pagingToken: raw.pagingToken ?? null,
    txHash: raw.txHash ?? null,
  };

  return {
    event_type: eventType,
    contract_id: raw.contractId || "",
    ledger_sequence: raw.ledger ?? 0,
    emitted_at: raw.ledgerClosedAt
      ? new Date(raw.ledgerClosedAt).toISOString()
      : new Date().toISOString(),
    from_addr: fromAddr,
    to_addr: toAddr,
    amount_raw: amountRaw,
    payload,
  };
}

module.exports = {
  parseEvent,
  EVENT_PARTICIPANT_MAP,
};
