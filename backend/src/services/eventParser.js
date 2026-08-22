/**
 * backend/src/services/eventParser.js
 * Soroban Contract Event Parser
 *
 * Parses raw Soroban RPC events into structured rows for the contract_events
 * table. Since the contract migrated from `env.events().publish()` tuples to
 * typed `#[contractevent]` structs, every event now has the shape:
 *
 *   topic[0] = the event struct's snake_case name (e.g. "tip_sent")
 *   data     = a Soroban Map keyed by the event's field names
 *              (e.g. { from, to, amount, ledger, memo })
 *
 * The parser transparently decodes base64 SCVal XDR when the RPC returns it,
 * extracts the participant addresses (from/to) and the primary amount from the
 * named data fields, and stores the full decoded payload for querying.
 *
 * Event types emitted by the contract (see contracts/finchippay-contract/src/events.rs):
 *   init, admin_transfer, paused, unpaused, pauser_set, admin_signers_set,
 *   upgraded, ttl_bumped, admin_action_proposed, admin_action_approved,
 *   rescue_tokens, fee_collector_set, swap_fee_set, swap, tip_sent,
 *   receipt_minted, escrow_created, escrow_claim_partial, escrow_claimed,
 *   escrow_cancelled, disputable_escrow_created, dispute_raised,
 *   dispute_resolved, arbitrator_added, arbitrator_removed, stream_opened,
 *   stream_claimed, stream_topped_up, stream_close, stream_closed,
 *   stream_reject, stream_transfer, multisig_created, multisig_approved,
 *   multisig_executed, multisig_timeout, multisig_cancelled, batch_sent,
 *   batch_sent_multi, vesting_create, vesting_claim, vesting_revoke,
 *   airdrop_created, airdrop_claimed, airdrop_cancelled, yield_escrow_create,
 *   yield_escrow_claim, yield_escrow_cancelled,
 *   emergency_withdrawal_initiated, emergency_withdrawal_approved,
 *   emergency_withdrawal_executed, emergency_withdrawal_cancelled
 */

"use strict";

/**
 * Event type → participant field mapping for typed `#[contractevent]` events.
 * Each entry names the *data* field that holds the "from" / "to" address and
 * the primary "amount" value for that event type.
 */
const EVENT_PARTICIPANT_MAP = {
  init: { from: "admin" },
  admin_transfer: { to: "new_admin" },
  pauser_set: { to: "pauser" },
  tip_sent: { from: "from", to: "to", amount: "amount" },
  receipt_minted: { from: "payer" },
  escrow_created: { from: "from", to: "to", amount: "amount" },
  escrow_claim_partial: { to: "to", amount: "claim_amount" },
  escrow_claimed: { to: "recipient", amount: "amount" },
  escrow_cancelled: { from: "from", amount: "amount" },
  disputable_escrow_created: { to: "arbitrator" },
  dispute_raised: { from: "raised_by" },
  dispute_resolved: { to: "to", amount: "amount" },
  arbitrator_added: { to: "arbitrator" },
  arbitrator_removed: { from: "arbitrator" },
  stream_opened: { from: "payer", to: "recipient", amount: "deposit" },
  stream_claimed: { to: "recipient", amount: "amount" },
  stream_topped_up: { from: "payer", amount: "amount" },
  stream_close: { from: "payer", amount: "refund" },
  stream_closed: { amount: "refund" },
  stream_reject: { to: "recipient", amount: "refund" },
  stream_transfer: { from: "from", to: "to" },
  multisig_created: { from: "proposer", to: "recipient", amount: "amount" },
  multisig_approved: { from: "approver" },
  multisig_executed: { to: "recipient", amount: "amount" },
  multisig_timeout: { from: "proposer", amount: "amount" },
  multisig_cancelled: { from: "proposer", amount: "amount" },
  batch_sent: { from: "sender", amount: "total_amount" },
  batch_sent_multi: { from: "sender", amount: "total_amount" },
  vesting_create: { from: "from", to: "beneficiary", amount: "amount" },
  vesting_claim: { to: "beneficiary", amount: "amount" },
  vesting_revoke: { from: "funder", amount: "amount" },
  airdrop_created: { from: "funder", amount: "total_amount" },
  airdrop_claimed: { to: "recipient", amount: "amount" },
  airdrop_cancelled: { from: "funder", amount: "amount" },
  yield_escrow_create: { from: "from", to: "to", amount: "amount" },
  yield_escrow_claim: { to: "to", amount: "amount" },
  yield_escrow_cancelled: { from: "from", amount: "amount" },
  emergency_withdrawal_initiated: { from: "initiator", amount: "amount" },
  emergency_withdrawal_approved: { from: "signer" },
  emergency_withdrawal_executed: { to: "to", amount: "amount" },
  emergency_withdrawal_cancelled: { from: "admin", amount: "amount" },
  admin_action_proposed: { from: "proposer" },
  admin_action_approved: { from: "approver" },
  rescue_tokens: { to: "to", amount: "amount" },
  fee_collector_set: { to: "collector" },
  swap: { from: "caller", amount: "amount_in" },
};

// ─── SCVal decoding (lazily loaded to keep this module dependency-light) ─────

let sdkCache = null;

/**
 * Lazily load the Stellar SDK XDR helpers used to decode SCVal values.
 * Returns `null` when the SDK is unavailable so callers can degrade to
 * passing through already-decoded (plain) event values.
 */
function loadSdk() {
  if (sdkCache === null) {
    try {
      // eslint-disable-next-line global-require
      const { xdr, StrKey } = require("@stellar/stellar-sdk");
      sdkCache = { xdr, StrKey };
    } catch (err) {
      sdkCache = undefined;
    }
  }
  return sdkCache;
}

/**
 * Convert a decoded `xdr.ScVal` into a plain JavaScript value:
 *  - symbols/strings → string
 *  - addresses → Stellar StrKey (G…/C…)
 *  - integers → string (preserves i128/u128 precision)
 *  - vec → array, map → object keyed by field name
 */
function scValToJs(scVal, sdk) {
  const kind = scVal.switch().name;
  switch (kind) {
    case "scvSymbol":
      return scVal.sym().toString();
    case "scvString":
      return scVal.str().toString();
    case "scvBool":
      return scVal.b();
    case "scvVoid":
      return null;
    case "scvU32":
      return String(scVal.u32());
    case "scvI32":
      return String(scVal.i32());
    case "scvU64":
      return scVal.u64().toString();
    case "scvI64":
      return scVal.i64().toString();
    case "scvU128": {
      const parts = scVal.u128();
      return ((BigInt(parts.hi().toString()) << 64n) | BigInt(parts.lo().toString())).toString();
    }
    case "scvI128": {
      const parts = scVal.i128();
      const raw = (BigInt(parts.hi().toString()) << 64n) | BigInt(parts.lo().toString());
      const signed = raw >= 1n << 127n ? raw - (1n << 128n) : raw;
      return signed.toString();
    }
    case "scvAddress": {
      const addr = scVal.address();
      if (addr.switch().name === "scAddressTypeAccount") {
        return sdk.StrKey.encodeEd25519PublicKey(addr.accountId().ed25519());
      }
      if (addr.switch().name === "scAddressTypeContract") {
        return sdk.StrKey.encodeContract(addr.contractId());
      }
      return addr.toString();
    }
    case "scvBytes":
      return Buffer.from(scVal.bytes()).toString("hex");
    case "scvVec":
      return scVal.vec().map((v) => scValToJs(v, sdk));
    case "scvMap": {
      const obj = {};
      for (const entry of scVal.map()) {
        obj[scValToJs(entry.key(), sdk)] = scValToJs(entry.val(), sdk);
      }
      return obj;
    }
    default:
      return scVal.toString();
  }
}

/**
 * Decode a single event value (topic entry or data). Strings are assumed to be
 * base64-encoded SCVal XDR and decoded when possible; anything else is passed
 * through unchanged so the parser also works with already-decoded values
 * (e.g. test mocks).
 */
function decodeValue(value, sdk) {
  if (typeof value !== "string" || !sdk) {
    return value;
  }
  try {
    return scValToJs(sdk.xdr.ScVal.fromXDR(value, "base64"), sdk);
  } catch {
    return value;
  }
}

// ─── Event parsing ───────────────────────────────────────────────────────────

/**
 * Parse a raw Soroban event into our standard DB row shape.
 *
 * @param {object} raw - Raw Soroban RPC event object
 * @returns {object} Parsed event row ready for contract_events table
 */
function parseEvent(raw) {
  const sdk = loadSdk();
  const topics = (raw.topic ?? []).map((t) => decodeValue(t, sdk));
  const data = decodeValue(raw.data, sdk);

  // The first topic is the event struct's snake_case name (a Symbol).
  let eventType = "unknown";
  const first = topics[0];
  if (typeof first === "string") {
    eventType = first;
  } else if (first && typeof first === "object") {
    eventType = first.symbol || first.str || first.value || String(first) || "unknown";
  }

  eventType = String(eventType)
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 64);

  // Typed events carry their fields in the data Map.
  const fields = data && typeof data === "object" && !Array.isArray(data) ? data : {};

  const schema = EVENT_PARTICIPANT_MAP[eventType] || {};
  const fromAddr = schema.from && fields[schema.from] != null ? String(fields[schema.from]) : null;
  const toAddr = schema.to && fields[schema.to] != null ? String(fields[schema.to]) : null;

  let amountRaw =
    schema.amount && fields[schema.amount] != null ? String(fields[schema.amount]) : null;
  if (amountRaw == null && data && typeof data === "object" && !Array.isArray(data)) {
    // Fallback for unknown event types that still expose a numeric amount.
    const candidate = data.amount ?? data.i128 ?? data.u64 ?? data.u128;
    amountRaw = candidate != null ? String(candidate) : null;
  }

  const payload = {
    topics,
    data: data ?? null,
    eventId: raw.id ?? null,
    pagingToken: raw.pagingToken ?? null,
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
