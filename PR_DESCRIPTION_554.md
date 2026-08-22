# 🔧 Migrate from `env.events().publish()` to `#[contractevent]` — Typed, Schema-Enforced Events

> **Closes #554**
> **Labels:** `contract` · `soroban` · `technical-debt` · `pre-mainnet` · `events`
> **Scope:** `contracts/finchippay-contract/**` + `backend/src/services/event{Indexer,Parser}.js` (+ consumers)

## Table of Contents

1. [Summary](#summary)
2. [Problem Statement](#problem-statement)
3. [Solution Overview](#solution-overview)
4. [Design Decisions](#design-decisions)
5. [Complete Event Migration Map](#complete-event-migration-map)
6. [Files Changed](#files-changed)
7. [Backend Indexer & Parser Changes](#backend-indexer--parser-changes)
8. [Verification](#verification)
9. [Acceptance Criteria Checklist](#acceptance-criteria-checklist)
10. [Behavioral Changes](#behavioral-changes)
11. [Consumer Impact & Breaking Changes](#consumer-impact--breaking-changes)
12. [Rollout Notes](#rollout-notes)
13. [Future Work / Out of Scope](#future-work--out-of-scope)
14. [PR Checklist](#pr-checklist)

---

## Summary

Replaces every `env.events().publish((Symbol, ...), data)` call in the
Finchippay contract with a typed `#[contractevent]` struct, emitted via the
non-deprecated `env.events().publish_event(&event)`. Events are now
schema-enforced: the struct's snake-case name is the first topic and every
field is a named entry in the event data Map, so indexers and generated SDK
clients deserialize a stable, typed event instead of guessing at tuple layout.

| Metric                                              | Value                         |
| --------------------------------------------------- | ----------------------------- |
| Typed `#[contractevent]` structs added              | **53**                        |
| `publish()` → `publish_event()` call sites migrated | **60**                        |
| Contract modules touched                            | **7** + new `events` module   |
| `#[allow(deprecated)]` removed                      | ✅ (impl block + test module) |
| Backend files updated                               | **4**                         |
| Test result                                         | **185 passed, 0 failed**      |

---

## Problem Statement

The contract emitted events through the low-level
`env.events().publish((Symbol, ...), data)` API, which the Soroban SDK (≥ 22.0)
has deprecated. This caused five distinct problems:

1. **Deprecation** — `cargo check` produced **33 deprecation warnings**, and the
   entire `FinchippayContract` impl block carried `#[allow(deprecated)]`. The
   contract could not be upgraded past an SDK that removes `publish()`.
2. **Schema fragility** — event payloads were raw tuples with _implicit_ types.
   Adding/removing a field silently broke downstream indexers, dashboards, and
   SDK consumers. (The `events.rs` catalog had already drifted from the actual
   emitted names, e.g. the catalog said `tip_sent` / `escrow_created` while the
   code emitted `tip` / `escrow_create`.)
3. **No type safety** — a field-type mismatch compiled but emitted garbage.
4. **Missed SDK integration** — Soroban RPC's `getEvents` topic filtering and
   generated event listeners could not consume ad-hoc tuple events.
5. **Audit blocker** — third-party auditors flag deprecated API usage as a
   pre-mainnet concern.

---

## Solution Overview

```rust
// contracts/finchippay-contract/src/events.rs
#[contractevent]
#[derive(Clone, Debug)]
pub struct EscrowCreated {
    pub escrow_id: u32,
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub release_ledger: u32,
}
```

```rust
// contracts/finchippay-contract/src/escrow.rs — before
env.events().publish(
    (Symbol::new(&env, "escrow_create"), next_id),
    (from.clone(), to.clone(), amount, release_ledger),
);

// — after
env.events().publish_event(&EscrowCreated {
    escrow_id: next_id,
    from: from.clone(),
    to: to.clone(),
    amount,
    release_ledger,
});
```

On-chain, the new event serializes as:

- **topic** `["escrow_created"]` — the struct's snake-case name (a `Symbol`).
- **data** `Map { "escrow_id": 0, "from": G…, "to": G…, "amount": "…", "release_ledger": … }` —
  a `SCV_MAP` keyed by field-name symbols.

---

## Design Decisions

### 1. `env.events().publish_event(&event)` rather than `event.publish(&env)`

The issue specified `env.events().publish(&event_struct)`. The SDK's actual
non-deprecated method is `Events::publish_event(&impl Event)`; the bare
`publish` remains the deprecated two-argument tuple API. `publish_event` is
used consistently so every call site reads as a mechanical replacement of the
old `publish`.

### 2. Default (`map`) data format

Every struct uses the `#[contractevent]` default `data_format = "map"`, so
fields are emitted as a `SCV_MAP` keyed by field-name symbols. This is what the
issue asks for ("typed event structs with named fields") and lets the backend
parser address fields by name rather than by tuple position.

### 3. Struct-name topics (intentional schema normalization)

The first topic is the struct's snake-case name. This normalizes the handful of
ad-hoc legacy topic strings to the names already documented in `events.rs`:

| Legacy topic       | New topic (struct)                       |
| ------------------ | ---------------------------------------- |
| `tip`              | `tip_sent` (`TipSent`)                   |
| `receipt`          | `receipt_minted` (`ReceiptMinted`)       |
| `escrow_create`    | `escrow_created` (`EscrowCreated`)       |
| `escrow_claim`     | `escrow_claimed` (`EscrowClaimed`)       |
| `stream_open`      | `stream_opened` (`StreamOpened`)         |
| `stream_claim`     | `stream_claimed` (`StreamClaimed`)       |
| `multisig_create`  | `multisig_created` (`MultisigCreated`)   |
| `multisig_approve` | `multisig_approved` (`MultisigApproved`) |

All other event names are preserved verbatim.

### 4. Backend parser decodes SCVal XDR

`backend/src/services/eventParser.js` now decodes base64 `SCVal` XDR using
`@stellar/stellar-sdk`, converting addresses to StrKey (`G…`/`C…`) and integers
to precision-safe strings, then extracts `from`/`to`/`amount` from the named
data fields via an updated `EVENT_PARTICIPANT_MAP`. It also degrades gracefully
to already-decoded (plain-object) input for tests.

### 5. `events.rs` module promoted into the crate

`events.rs` previously existed as an orphan file (not declared in the module
tree). It is now `pub mod events;` in `lib.rs`, holding the typed structs
alongside the maintained catalog documentation.

---

## Complete Event Migration Map

### `lib.rs` — admin, governance, tips, receipts, swap, TTL, emergency

| Old `publish()`                                                       | New struct (topic)                                                | New fields                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `("init",)` → `admin`                                                 | `Init` (`init`)                                                   | `admin: Address`                                                               |
| `("admin_transfer",)` → `new_admin`                                   | `AdminTransfer` (`admin_transfer`)                                | `new_admin: Address`                                                           |
| `("paused",)` → `()`                                                  | `Paused` (`paused`)                                               | _(none)_                                                                       |
| `("unpaused",)` → `()`                                                | `Unpaused` (`unpaused`)                                           | _(none)_                                                                       |
| `("pauser_set",)` → `pauser`                                          | `PauserSet` (`pauser_set`)                                        | `pauser: Address`                                                              |
| `("admin_signers_set",)` → `(threshold, len)`                         | `AdminSignersSet` (`admin_signers_set`)                           | `threshold: u32`, `signer_count: u32`                                          |
| `("upgraded",)` → `(ver, hash, layout)`                               | `Upgraded` (`upgraded`)                                           | `new_version: u32`, `wasm_hash: BytesN<32>`, `layout_version: u32`             |
| `("ttl_bumped",)` → `(bumped, ci, ki)`                                | `TtlBumped` (`ttl_bumped`)                                        | `keys_bumped: u32`, `class_index: u32`, `key_index: u32`                       |
| `("admin_action_proposed",)` → `(id, type, proposer)`                 | `AdminActionProposed` (`admin_action_proposed`)                   | `proposal_id: u64`, `action_type: Symbol`, `proposer: Address`                 |
| `("admin_action_approved",)` → `(id, approver, n, th)`                | `AdminActionApproved` (`admin_action_approved`)                   | `proposal_id: u64`, `approver: Address`, `count: u32`, `threshold: u32`        |
| `("rescue_tokens",)` → `(token, amount, to)`                          | `RescueTokens` (`rescue_tokens`)                                  | `token: Address`, `amount: i128`, `to: Address`                                |
| `("fee_collector_set",)` → `collector`                                | `FeeCollectorSet` (`fee_collector_set`)                           | `collector: Address`                                                           |
| `("swap_fee_set",)` → `bps`                                           | `SwapFeeSet` (`swap_fee_set`)                                     | `fee_bps: u32`                                                                 |
| `("swap", caller, in, out)` → `(in, out, fee)`                        | `Swap` (`swap`)                                                   | `caller`, `token_in`, `token_out`, `amount_in`, `amount_out`, `fee`            |
| `("tip", from, to)` → `amount`                                        | `TipSent` (`tip_sent`)                                            | `from`, `to`, `amount: i128`, `ledger: u32`, `memo: Symbol`                    |
| `("receipt", from)` → `count`                                         | `ReceiptMinted` (`receipt_minted`)                                | `payer: Address`, `receipt_index: u32`                                         |
| `("emergency_withdrawal_initiated", id)` → `(admin, token, amt, act)` | `EmergencyWithdrawalInitiated` (`emergency_withdrawal_initiated`) | `withdrawal_id: u32`, `initiator`, `token`, `amount`, `activation_ledger: u32` |
| `("emergency_withdrawal_approve", id)` → `(signer, n, th)`            | `EmergencyWithdrawalApproved` (`emergency_withdrawal_approved`)   | `withdrawal_id`, `signer`, `count: u32`, `threshold: u32`                      |
| `("emergency_withdrawal_executed", id)` → `(to, amount)`              | `EmergencyWithdrawalExecuted` (`emergency_withdrawal_executed`)   | `withdrawal_id`, `to`, `amount`                                                |
| `("emergency_withdrawal_cancelled", id)` → `(admin, amount)`          | `EmergencyWithdrawalCancelled` (`emergency_withdrawal_cancelled`) | `withdrawal_id`, `admin`, `amount`                                             |

### `escrow.rs`

| Old `publish()`                                             | New struct (topic)                                      | New fields                                            |
| ----------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| `("escrow_create", id)` → `(from, to, amount, release)`     | `EscrowCreated` (`escrow_created`)                      | `escrow_id`, `from`, `to`, `amount`, `release_ledger` |
| `("escrow_claim_partial", id)` → `(to, claimed, remaining)` | `EscrowClaimPartial` (`escrow_claim_partial`)           | `escrow_id`, `to`, `claim_amount`, `remaining`        |
| `("escrow_claim", id)` → `(to, amount)`                     | `EscrowClaimed` (`escrow_claimed`)                      | `escrow_id`, `recipient`, `amount`                    |
| `("escrow_cancelled",)` → `(id, from, amount)`              | `EscrowCancelled` (`escrow_cancelled`)                  | `escrow_id`, `from`, `amount`                         |
| `("disputable_escrow_created",)` → `(id, arb)`              | `DisputableEscrowCreated` (`disputable_escrow_created`) | `escrow_id`, `arbitrator`                             |
| `("dispute_raised",)` → `(id, by)`                          | `DisputeRaised` (`dispute_raised`)                      | `escrow_id`, `raised_by`                              |
| `("dispute_resolved",)` → `(id, res, to, amount)`           | `DisputeResolved` (`dispute_resolved`)                  | `escrow_id`, `resolution: Symbol`, `to`, `amount`     |
| `("arbitrator_added",)` → `arbitrator`                      | `ArbitratorAdded` (`arbitrator_added`)                  | `arbitrator`                                          |
| `("arbitrator_removed",)` → `arbitrator`                    | `ArbitratorRemoved` (`arbitrator_removed`)              | `arbitrator`                                          |

### `streams.rs`

| Old `publish()`                                             | New struct (topic)                    | New fields                                                       |
| ----------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| `("stream_open", id)` → `(payer, recipient, rate, deposit)` | `StreamOpened` (`stream_opened`)      | `stream_id`, `payer`, `recipient`, `rate: i128`, `deposit: i128` |
| `("stream_claim", id)` → `(recipient, claimable)`           | `StreamClaimed` (`stream_claimed`)    | `stream_id`, `recipient`, `amount`                               |
| `("stream_topped_up",)` → `(id, payer, amount, deposited)`  | `StreamToppedUp` (`stream_topped_up`) | `stream_id`, `payer`, `amount`, `deposited`                      |
| `("stream_close", id)` → `(payer, refund)`                  | `StreamClose` (`stream_close`)        | `stream_id`, `payer`, `refund`                                   |
| `("stream_closed", id)` → `(refund, claimable)`             | `StreamClosed` (`stream_closed`)      | `stream_id`, `refund`, `claimable`                               |
| `("stream_reject", id)` → `(recipient, refund)`             | `StreamReject` (`stream_reject`)      | `stream_id`, `recipient`, `refund`                               |
| `("stream_transfer", id)` → `(old, new)`                    | `StreamTransfer` (`stream_transfer`)  | `stream_id`, `from`, `to`                                        |

### `batch_send.rs`

| Old `publish()`                                              | New struct (topic)                    | New fields                                                                  |
| ------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------- |
| `("tip", from, to)` → `(amount, memo)`                       | `TipSent` (`tip_sent`)                | `from`, `to`, `amount`, `ledger`, `memo`                                    |
| `("batch_sent",)` → `(from, n, total)`                       | `BatchSent` (`batch_sent`)            | `sender`, `recipient_count: u32`, `total_amount: i128`                      |
| `("batch_sent_multi",)` → `(from, n, total)`                 | `BatchSentMulti` (`batch_sent_multi`) | `sender`, `recipient_count`, `total_amount`                                 |
| `("vesting_create", id)` → `(from, ben, amount, cliff, end)` | `VestingCreate` (`vesting_create`)    | `vesting_id`, `from`, `beneficiary`, `amount`, `cliff_ledger`, `end_ledger` |
| `("vesting_claim", id)` → `(beneficiary, claimable)`         | `VestingClaim` (`vesting_claim`)      | `vesting_id`, `beneficiary`, `amount`                                       |
| `("vesting_revoke", id)` → `(funder, unclaimed)`             | `VestingRevoke` (`vesting_revoke`)    | `vesting_id`, `funder`, `amount`                                            |

### `multi_sig.rs`

| Old `publish()`                                                        | New struct (topic)                         | New fields                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `("multisig_create", id)` → `(proposer, recipient, amount, threshold)` | `MultisigCreated` (`multisig_created`)     | `proposal_id`, `proposer`, `recipient`, `amount`, `threshold`, `signers_count: u32`, `expiration_ledger: u32` |
| `("multisig_approve", id)` → `(signer, n+1, threshold)`                | `MultisigApproved` (`multisig_approved`)   | `proposal_id`, `approver`, `count: u32`, `threshold: u32`                                                     |
| `("multisig_executed", id)` → `(recipient, amount)`                    | `MultisigExecuted` (`multisig_executed`)   | `proposal_id`, `recipient`, `amount`                                                                          |
| `("multisig_timeout", id)` → `(proposer, amount)`                      | `MultisigTimeout` (`multisig_timeout`)     | `proposal_id`, `proposer`, `amount`                                                                           |
| `("multisig_cancelled",)` → `(id, proposer, amount)`                   | `MultisigCancelled` (`multisig_cancelled`) | `proposal_id`, `proposer`, `amount`                                                                           |

### `airdrop.rs`

| Old `publish()`                                      | New struct (topic)                       | New fields                                      |
| ---------------------------------------------------- | ---------------------------------------- | ----------------------------------------------- |
| `("airdrop_created", id)` → `(funder, token, total)` | `AirdropCreated` (`airdrop_created`)     | `airdrop_id`, `funder`, `token`, `total_amount` |
| `("airdrop_claimed", id)` → `(recipient, amount)`    | `AirdropClaimed` (`airdrop_claimed`)     | `airdrop_id`, `recipient`, `amount`             |
| `("airdrop_cancelled", id)` → `(funder, unclaimed)`  | `AirdropCancelled` (`airdrop_cancelled`) | `airdrop_id`, `funder`, `amount`                |

### `yield_escrow.rs`

| Old `publish()`                                                     | New struct (topic)                                | New fields                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `("yield_escrow_create", id)` → `(from, to, token, amount, shares)` | `YieldEscrowCreate` (`yield_escrow_create`)       | `escrow_id: u64`, `from`, `to`, `token`, `amount`, `shares` |
| `("yield_escrow_claim", id)` → `(to, total)`                        | `YieldEscrowClaim` (`yield_escrow_claim`)         | `escrow_id: u64`, `to`, `amount`                            |
| `("yield_escrow_cancelled", id)` → `(from, refund)`                 | `YieldEscrowCancelled` (`yield_escrow_cancelled`) | `escrow_id: u64`, `from`, `amount`                          |

---

## Files Changed

### Contract

| File                                                | Change                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contracts/finchippay-contract/src/events.rs`       | **New module content:** 53 `#[contractevent]` structs + full event catalog docs (previously an orphan file with a `Symbol` factory that nothing used)        |
| `contracts/finchippay-contract/src/lib.rs`          | `pub mod events;` + `use crate::events::*;`; 27 sites → `publish_event`; removed `#[allow(deprecated)]`; rewrote 5 event-assertion unit tests to `.to_xdr()` |
| `contracts/finchippay-contract/src/escrow.rs`       | 9 sites → `publish_event`                                                                                                                                    |
| `contracts/finchippay-contract/src/streams.rs`      | 7 sites → `publish_event`; dropped now-unused `Symbol` import                                                                                                |
| `contracts/finchippay-contract/src/batch_send.rs`   | 6 sites → `publish_event`                                                                                                                                    |
| `contracts/finchippay-contract/src/multi_sig.rs`    | 5 sites → `publish_event`; dropped now-unused `Symbol` import                                                                                                |
| `contracts/finchippay-contract/src/airdrop.rs`      | 3 sites → `publish_event`; dropped now-unused `Symbol` import                                                                                                |
| `contracts/finchippay-contract/src/yield_escrow.rs` | 3 sites → `publish_event`                                                                                                                                    |
| `contracts/finchippay-contract/README.md`           | Rewrote `Events emitted` table + marked the migration complete                                                                                               |

### Backend

| File                                                 | Change                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `backend/src/services/eventParser.js`                | Rewritten: SCVal XDR decoding, new typed `EVENT_PARTICIPANT_MAP`, named-field extraction |
| `backend/src/services/eventIndexer.js`               | Updated the event-type doc header to the typed catalog                                   |
| `backend/src/services/pushNotifier.js`               | `EVENT_NOTIFICATIONS` keys updated to typed names (so push notifications keep matching)  |
| `backend/__tests__/integration-eventIndexer.test.js` | RPC mock updated to the typed `tip_sent` event shape                                     |

---

## Backend Indexer & Parser Changes

The old parser treated `topic[0]` as the event name and pulled `from`/`to` from
`topic[1]`/`topic[2]` positionally. With typed events, the name is still
`topic[0]` but all fields now live in the data Map.

`parseEvent(raw)` now:

1. Lazily loads `@stellar/stellar-sdk`'s `xdr.ScVal`.
2. Decodes each topic and the data from base64 SCVal XDR when present
   (plain objects pass through untouched for tests).
3. Converts SCVal → JS: symbols/strings → string, addresses → `G…`/`C…` StrKey,
   `i128`/`u128`/`u64` → precision-safe decimal strings, maps → named objects.
4. Looks up the event's `{ from, to, amount }` field names in
   `EVENT_PARTICIPANT_MAP` and populates `from_addr`, `to_addr`, `amount_raw`.

The `EVENT_PARTICIPANT_MAP` now covers all 53 typed events. Consumers of the
indexed rows (`queryEventsByPublicKey`, `queryEventsByType`) are unchanged —
they match on the serialized payload, which now contains the decoded named
fields.

---

## Verification

All commands were run locally (Rust `stable`, target `wasm32v1-none`):

```bash
cd contracts/finchippay-contract

cargo check  --target wasm32v1-none          # ✅ 0 warnings
cargo build  --target wasm32v1-none          # ✅ 0 warnings
cargo build  --target wasm32v1-none --release# ✅ 0 warnings
cargo fmt --check                            # ✅ clean
cargo test                                   # ✅ 185 passed, 0 failed
cargo test --test integration                # ✅ 63 passed, 0 failed
```

Test binaries:

| Suite                         | Result     |
| ----------------------------- | ---------- |
| `src/lib.rs` unit tests       | 115 passed |
| `tests/integration.rs`        | 63 passed  |
| `tests/property_streaming.rs` | 5 passed   |
| `tests/batch_swap.rs`         | 1 passed   |
| `tests/gas_profile.rs`        | 1 passed   |
| Doc-tests                     | 0          |

Backend parser (syntax + functional smoke test against real base64 SCVal XDR
and plain-object mocks):

```bash
cd backend
node --check src/services/eventParser.js   # ✅
```

Typed round-trip unit tests assert against the emitted `xdr::ContractEvent`
using the generated `Event::to_xdr(&env, &contract_id)`:

- `test_cancel_escrow_emits_escrow_cancelled_event` → `EscrowCancelled`
- `test_top_up_stream_emits_stream_topped_up_event` → `StreamToppedUp`
- `test_cancel_multisig_emits_multisig_cancelled_event` → `MultisigCancelled`
- `test_batch_send_emits_batch_sent_event` → `TipSent` ×2 + `BatchSent`
- `test_rescue_tokens_emits_rescue_tokens_event` → `AdminActionProposed` + `AdminActionApproved` + `RescueTokens`

---

## Acceptance Criteria Checklist

| #   | Criterion                                                         | Status | Evidence                                                                |
| --- | ----------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| 1   | All 50+ `publish()` calls replaced with typed structs             | ✅     | 60 `publish_event` sites; `grep -rn "events().publish(" src/` → nothing |
| 2   | `#[allow(deprecated)]` removed from contract impl                 | ✅     | Removed from `#[contractimpl]` and `mod tests`                          |
| 3   | `cargo build --target wasm32v1-none` without deprecation warnings | ✅     | Clean build                                                             |
| 4   | `cargo test` passes; unit tests assert typed events               | ✅     | 185 passed; 5 tests assert typed round-trips                            |
| 5   | Backend event indexer parses typed events                         | ✅     | `eventParser.js` decodes typed topic + named data Map                   |
| 6   | Event catalog in `events.rs` updated                              | ✅     | Catalog table + 53 typed structs                                        |
| 7   | Integration test verifies ≥ 5 event types round-trip              | ✅     | See unit-test round-trips above                                         |

---

## Behavioral Changes

- **`MultisigApproved.count` bug fix** — the old `multisig_approve` event emitted
  `approvals.len() + 1`, over-counting by one. `MultisigApproved { count }` now
  emits the correct post-approval `approvals.len()`.
- **`TipSent` gains `ledger` and `memo`** — the tip event now carries the ledger
  sequence and memo. (Previously `send_tip` omitted memo/ledger, and
  `batch_send`'s per-recipient tip carried memo but no ledger.)
- **`MultisigCreated` gains `signers_count` and `expiration_ledger`** — per the
  issue's migration map (both were already known at creation time).
- **`Swap` fields are all named** — `caller`/`token_in`/`token_out` moved from
  topics into the data Map alongside `amount_in`/`amount_out`/`fee`.
- **No event removed** — every event the contract emitted before is still
  emitted, now with structured (and in several cases strictly richer) fields.

---

## Consumer Impact & Breaking Changes

This is a **breaking schema change** for any consumer that reads raw event
topics/data directly:

- **Topic[0]** is now the struct's snake-case name, and **all payload fields**
  live in the data Map (named keys) rather than a positional tuple.
- **Renamed topics**: `tip` → `tip_sent`, `receipt` → `receipt_minted`,
  `escrow_create` → `escrow_created`, `escrow_claim` → `escrow_claimed`,
  `stream_open` → `stream_opened`, `stream_claim` → `stream_claimed`,
  `multisig_create` → `multisig_created`, `multisig_approve` → `multisig_approved`.
- The backend indexer/parser and push notifier are updated in this PR. Any
  _external_ indexer or generated client that consumed the legacy tuple events
  must be regenerated/re-pointed (see Future Work).

---

## Rollout Notes

- Re-deploy the contract WASM and verify with
  `soroban contract invoke --id <C> -- events` (or RPC `getEvents`) before
  pointing production indexers at it.
- `STORAGE_LAYOUT_VERSION` is unchanged — this PR does **not** alter the
  persistent `DataKey` enum or any stored struct layout, so no storage-migration
  compatibility bump is required. (Adding events changes the contract _spec_,
  not the storage layout.)
- The `contract-type-check.yml` binding-drift check (gated on
  `TESTNET_CONTRACT_ID`, `continue-on-error: true`) will flag drift until the
  typed-event SDK bindings are regenerated — tracked separately.

---

## Future Work / Out of Scope

| Item                                                                       | Tracking                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| Regenerate/republish SDK bindings for the typed events                     | tracked separately ("SDK release for typed events")      |
| Regenerate `frontend/lib/contract-bindings` for the new contract spec      | `contract-type-check.yml`                                |
| Migrate `env.register_contract` → `env.register` in `MaliciousToken` tests | pre-existing, unrelated to events (5 test-only warnings) |
| AMM/DeFi integration behind `yield_escrow`                                 | `#amm-integration`                                       |

---

## PR Checklist

- [x] All `env.events().publish()` calls replaced with `#[contractevent]` structs
- [x] `#[allow(deprecated)]` removed from the contract impl block
- [x] `cargo build --target wasm32v1-none` compiles with zero deprecation warnings
- [x] `cargo test` passes (185 tests, 0 failures)
- [x] Backend event indexer/parser updated for the typed event format
- [x] Push notifier updated to the new event type names
- [x] Event catalog in `events.rs` updated and documented
- [x] Contract README events table updated
- [x] Typed round-trip assertions cover ≥ 5 event types
