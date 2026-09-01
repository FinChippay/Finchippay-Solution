/**
 * backend/src/services/eventParser.js
 * Soroban Contract Event Parser
 *
 * Parses raw Soroban RPC events into structured rows for the contract_events
 * table. Since the contract migrated from `env.events().publish()` tuples to
 * typed `#[contractevent]` structs, every event now has the shape:
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
 * Event type → participant field mapping for typed `#[contractevent]` events.
 * Each entry names the *data* field that holds the "from" / "to" address and
 * the primary "amount" value for that event type.
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
