# finchippay-contract

Soroban smart contract for the **Finchippay-Solution** platform on Stellar.

## Overview

`FinchippayContract` is a production-grade Soroban contract written in Rust that provides the on-chain payment primitives for the Finchippay-Solution platform.

### Features

| Feature         | Functions                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tips**        | `send_tip`, `get_tip_total`, `get_tip_count`, `get_tip_record`                                                                                      |
| **Receipts**    | `mint_receipt`, `get_receipt`, `get_receipt_count`                                                                                                  |
| **Escrow**      | `create_escrow`, `claim_escrow`, `claim_escrow_partial`, `cancel_escrow`, `get_escrow`, `get_user_escrows`                                          |
| **Streaming**   | `open_stream`, `claim_stream`, `top_up_stream`, `close_stream`, `reject_stream`, `transfer_stream`, `get_stream`, `get_claimable`                   |
| **Multi-sig**   | `create_multisig`, `approve_multisig`, `cancel_multisig`, `timeout_multisig`, `get_multisig`                                                        |
| **Batch**       | `batch_send`                                                                                                                                        |
| **Admin**       | `initialize`, `transfer_admin`, `get_admin`, `pause`, `unpause`, `is_paused`, `set_pauser`, `get_pauser`, `upgrade`, `get_version`, `rescue_tokens` |
| **Diagnostics** | `get_contract_stats`, `get_escrow_count`, `get_stream_count`, `get_multisig_count`                                                                  |

## Streaming Payments

A stream releases tokens continuously per ledger. At ledger `L`:

```
elapsed   = L - start_ledger
streamed  = rate_per_ledger × elapsed   (capped at deposited)
claimable = min(streamed, deposited) - claimed
```

Recipients can call `claim_stream` at any time to drain accrued tokens. Payers can `top_up_stream` to extend the stream or `close_stream` to end it early (accrued tokens go to the recipient; remainder is refunded).

## Multi-Sig Payments

`create_multisig` locks funds and stores a list of allowed `signers` plus a `threshold` N. Each call to `approve_multisig` by a distinct signer appends to the approval list. When `approvals.len() >= threshold` the payment executes automatically in the same transaction — no separate execution call required.

## Security

- Every mutating entry-point calls `require_auth()` on the authorising address.
- All arithmetic uses `checked_add` / `checked_sub` / `checked_mul`; overflows panic rather than silently wrap.
- Storage TTLs are bumped on every read and write to prevent ledger expiry.
- `EscrowStatus`, `MultiSigStatus`, and `closed` fields prevent double-claim and double-cancel attacks.
- **RBAC**: A separate `pauser` role can freeze/unfreeze operations without admin upgrade rights via `set_pauser`.
- **Upgradability**: admin can call `upgrade(new_wasm_hash)` to deploy security patches without migrating state. Version is tracked and incremented on each upgrade.
- **Bounded inputs**:
  - Escrow release ledgers are capped at `MAX_ESCROW_LEDGERS` (~30 days).
  - Stream deposits are capped at `MAX_STREAM_DEPOSIT` with cumulative top-up enforcement.
  - Stream rates are capped at `MAX_STREAM_RATE` to prevent overflow.
  - Multi-sig proposals are capped at `MAX_MULTISIG_AMOUNT` and `MAX_MULTISIG_SIGNERS` (20).
- Escrow amounts are capped at `MAX_ESCROW_AMOUNT` and have a minimum of `MIN_ESCROW_AMOUNT` to prevent dust attacks.
- Multi-sig proposals have a minimum of `MIN_MULTISIG_AMOUNT` and can include an `expiration_ledger` to auto-expire abandoned proposals.
- Multi-sig signer lists are checked for duplicates at creation time.
- Self-transfers (from == to) are rejected for tips, escrows, streams, and multi-sig.
- Batch sends are limited to `MAX_BATCH_SIZE` (50) recipients and amounts are pre-validated for atomicity.
- All operational entry points require the contract to be initialized via `initialize()`.

## Build

```bash
# Requires Rust + wasm32v1-none target (soroban-sdk v27.0.0+)
rustup target add wasm32v1-none

cargo test
cargo build --release --target wasm32v1-none
```

The compiled WASM lands at:

```
target/wasm32v1-none/release/finchippay_contract.wasm
```

## Deploy to Stellar Testnet

```bash
bash ../../scripts/deploy-contract.sh
```

## Events emitted

Events are defined as typed `#[contractevent]` structs in
[`src/events.rs`](src/events.rs). Each event's first topic is the struct's
snake-case name, and every field is emitted as a named entry in the event data
Map, so indexers and SDK clients can deserialize a schema-stable event.

| Struct (topic)                                                    | Fields                                                                                              | Emitted by                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------- |
| `Init` (`init`)                                                   | `admin`                                                                                             | `initialize`                    |
| `AdminTransfer` (`admin_transfer`)                                | `new_admin`                                                                                         | `transfer_admin`                |
| `Paused` (`paused`)                                               | —                                                                                                   | `pause` / admin action          |
| `Unpaused` (`unpaused`)                                           | —                                                                                                   | `unpause` / admin action        |
| `PauserSet` (`pauser_set`)                                        | `pauser`                                                                                            | `set_pauser`                    |
| `AdminSignersSet` (`admin_signers_set`)                           | `threshold`, `signer_count`                                                                         | `set_admin_signers`             |
| `Upgraded` (`upgraded`)                                           | `new_version`, `wasm_hash`, `layout_version`                                                        | `upgrade`                       |
| `TtlBumped` (`ttl_bumped`)                                        | `keys_bumped`, `class_index`, `key_index`                                                           | `bump_all_ttls`                 |
| `TipSent` (`tip_sent`)                                            | `from`, `to`, `amount`, `ledger`, `memo`                                                            | `send_tip`, `batch_send`        |
| `ReceiptMinted` (`receipt_minted`)                                | `payer`, `receipt_index`                                                                            | `mint_receipt`                  |
| `EscrowCreated` (`escrow_created`)                                | `escrow_id`, `from`, `to`, `amount`, `release_ledger`                                               | `create_escrow`                 |
| `EscrowClaimPartial` (`escrow_claim_partial`)                     | `escrow_id`, `to`, `claim_amount`, `remaining`                                                      | `claim_escrow_partial`          |
| `EscrowClaimed` (`escrow_claimed`)                                | `escrow_id`, `recipient`, `amount`                                                                  | `claim_escrow`                  |
| `EscrowCancelled` (`escrow_cancelled`)                            | `escrow_id`, `from`, `amount`                                                                       | `cancel_escrow`                 |
| `DisputableEscrowCreated` (`disputable_escrow_created`)           | `escrow_id`, `arbitrator`                                                                           | `create_disputable_escrow`      |
| `DisputeRaised` (`dispute_raised`)                                | `escrow_id`, `raised_by`                                                                            | `raise_dispute`                 |
| `DisputeResolved` (`dispute_resolved`)                            | `escrow_id`, `resolution`, `to`, `amount`                                                           | `resolve_dispute`               |
| `ArbitratorAdded` (`arbitrator_added`)                            | `arbitrator`                                                                                        | `add_arbitrator`                |
| `ArbitratorRemoved` (`arbitrator_removed`)                        | `arbitrator`                                                                                        | `remove_arbitrator`             |
| `StreamOpened` (`stream_opened`)                                  | `stream_id`, `payer`, `recipient`, `rate`, `deposit`                                                | `open_stream`                   |
| `StreamClaimed` (`stream_claimed`)                                | `stream_id`, `recipient`, `amount`                                                                  | `claim_stream`                  |
| `StreamToppedUp` (`stream_topped_up`)                             | `stream_id`, `payer`, `amount`, `deposited`                                                         | `top_up_stream`                 |
| `StreamClose` (`stream_close`)                                    | `stream_id`, `payer`, `refund`                                                                      | `close_stream`                  |
| `StreamClosed` (`stream_closed`)                                  | `stream_id`, `refund`, `claimable`                                                                  | `close_stream`                  |
| `StreamReject` (`stream_reject`)                                  | `stream_id`, `recipient`, `refund`                                                                  | `reject_stream`                 |
| `StreamTransfer` (`stream_transfer`)                              | `stream_id`, `from`, `to`                                                                           | `transfer_stream`               |
| `MultisigCreated` (`multisig_created`)                            | `proposal_id`, `proposer`, `recipient`, `amount`, `threshold`, `signers_count`, `expiration_ledger` | `create_multisig`               |
| `MultisigApproved` (`multisig_approved`)                          | `proposal_id`, `approver`, `count`, `threshold`                                                     | `approve_multisig`              |
| `MultisigExecuted` (`multisig_executed`)                          | `proposal_id`, `recipient`, `amount`                                                                | `approve_multisig` (auto)       |
| `MultisigTimeout` (`multisig_timeout`)                            | `proposal_id`, `proposer`, `amount`                                                                 | `timeout_multisig`              |
| `MultisigCancelled` (`multisig_cancelled`)                        | `proposal_id`, `proposer`, `amount`                                                                 | `cancel_multisig`               |
| `BatchSent` (`batch_sent`)                                        | `sender`, `recipient_count`, `total_amount`                                                         | `batch_send`                    |
| `BatchSentMulti` (`batch_sent_multi`)                             | `sender`, `recipient_count`, `total_amount`                                                         | `batch_send_multi`              |
| `VestingCreate` (`vesting_create`)                                | `vesting_id`, `from`, `beneficiary`, `amount`, `cliff_ledger`, `end_ledger`                         | `create_vesting`                |
| `VestingClaim` (`vesting_claim`)                                  | `vesting_id`, `beneficiary`, `amount`                                                               | `claim_vesting`                 |
| `VestingRevoke` (`vesting_revoke`)                                | `vesting_id`, `funder`, `amount`                                                                    | `revoke_vesting`                |
| `AirdropCreated` (`airdrop_created`)                              | `airdrop_id`, `funder`, `token`, `total_amount`                                                     | `create_airdrop`                |
| `AirdropClaimed` (`airdrop_claimed`)                              | `airdrop_id`, `recipient`, `amount`                                                                 | `claim_airdrop`                 |
| `AirdropCancelled` (`airdrop_cancelled`)                          | `airdrop_id`, `funder`, `amount`                                                                    | `cancel_airdrop`                |
| `YieldEscrowCreate` (`yield_escrow_create`)                       | `escrow_id`, `from`, `to`, `token`, `amount`, `shares`                                              | `create_yield_escrow`           |
| `YieldEscrowClaim` (`yield_escrow_claim`)                         | `escrow_id`, `to`, `amount`                                                                         | `claim_yield_escrow`            |
| `YieldEscrowCancelled` (`yield_escrow_cancelled`)                 | `escrow_id`, `from`, `amount`                                                                       | `cancel_yield_escrow`           |
| `EmergencyWithdrawalInitiated` (`emergency_withdrawal_initiated`) | `withdrawal_id`, `initiator`, `token`, `amount`, `activation_ledger`                                | `initiate_emergency_withdrawal` |
| `EmergencyWithdrawalApproved` (`emergency_withdrawal_approved`)   | `withdrawal_id`, `signer`, `count`, `threshold`                                                     | `approve_emergency_withdrawal`  |
| `EmergencyWithdrawalExecuted` (`emergency_withdrawal_executed`)   | `withdrawal_id`, `to`, `amount`                                                                     | `execute_emergency_withdrawal`  |
| `EmergencyWithdrawalCancelled` (`emergency_withdrawal_cancelled`) | `withdrawal_id`, `admin`, `amount`                                                                  | `cancel_emergency_withdrawal`   |
| `AdminActionProposed` (`admin_action_proposed`)                   | `proposal_id`, `action_type`, `proposer`                                                            | `propose_admin_action`          |
| `AdminActionApproved` (`admin_action_approved`)                   | `proposal_id`, `approver`, `count`, `threshold`                                                     | `approve_admin_action`          |
| `RescueTokens` (`rescue_tokens`)                                  | `token`, `amount`, `to`                                                                             | `rescue_tokens`                 |
| `FeeCollectorSet` (`fee_collector_set`)                           | `collector`                                                                                         | `set_fee_collector`             |
| `SwapFeeSet` (`swap_fee_set`)                                     | `fee_bps`                                                                                           | `set_swap_fee`                  |
| `Swap` (`swap`)                                                   | `caller`, `token_in`, `token_out`, `amount_in`, `amount_out`, `fee`                                 | swap entry points               |

## License

MIT

## Contract Event Migration (complete)

This contract emits events exclusively via the `#[contractevent]` macro. The
legacy `env.events().publish()` API is no longer used anywhere in the codebase,
and the `#[allow(deprecated)]` attribute has been removed from the contract
implementation block.

- Typed event structs live in [`src/events.rs`](src/events.rs) and are emitted
  via `env.events().publish_event(&Event { ... })`.
- The backend indexer (`backend/src/services/eventParser.js`) decodes the typed
  event format (topic symbol + named data Map).
- Event field layout is schema-enforced by the SDK, so adding or removing a
  field is a compile-time change rather than a silent indexer break.

### Tracking

- Issue: `#amm-integration` (yield_escrow.rs TODOs)
- Contract version in Cargo.toml and on-chain `get_version()` must stay in sync.
