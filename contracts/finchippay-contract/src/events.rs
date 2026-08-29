//! # Finchippay Contract — Event Constants
//!
//! Centralized event symbols used for off-chain indexing and monitoring.
//! All events emitted by the contract are documented here and are the **single
//! source of truth**: every publish site routes through the `Events::*` helpers
//! below, `backend/src/services/eventParser.js` mirrors this catalog, and a
//! catalog-parity test (see `tests/event_catalog.rs` and the backend
//! `eventParser.parity.test.js`) enforces `catalog == emitted == parsed`.
//!
//! ## Topic × payload contract
//!
//! Each topic is emitted with exactly **one** payload shape, and that shape is
//! documented in the table below. This is what lets an indexer parse events
//! without guessing. In particular the tip family is canonicalized to a single
//! topic, `tip_sent`, published with payload `(amount, memo)` from *every*
//! tip-minting path (`send_tip`, `batch_send`, `batch_send_multi`), so there is
//! never one topic carrying two shapes. `batch_sent` additionally reports the
//! completed overall batch.
//!
//! ## Event Catalog
//!
//! Airdrop, vesting, multi-sig and tip topics are all registered here. The
//! `ContractError`-free set below is emitted by `src/contract.rs` and its
//! sibling modules:
//!
//! | Topic | Payload | Description |
//! |---|---|---|
//! | `init` | admin address | Contract initialised |
//! | `admin_transfer` | new_admin address | Legacy admin pointer transferred |
//! | `admin_signers_set` | (threshold, signer_count) | Admin signer set updated |
//! | `paused` | () | Circuit breaker activated |
//! | `unpaused` | () | Circuit breaker deactivated |
//! | `pauser_set` | pauser address | Pauser role assigned |
//! | `upgraded` | (new_version, wasm_hash, layout_version) | Contract upgraded |
//! | `ttl_bumped` | (keys_bumped, class_index, key_index) | TTL sweep progress |
//! | `tip_sent` | (amount, memo) | Single tip recorded (topic carries `from`, `to`) |
//! | `receipt_minted` | (payer, receipt_index) | Payment receipt minted |
//! | `escrow_created` | (id, from, to, amount, release_ledger) | Escrow opened |
//! | `escrow_released` | (id, recipient) | Escrow claimed |
//! | `escrow_cancelled` | (id, from) | Escrow cancelled by sender |
//! | `escrow_disputed` | (id, raised_by) | Dispute flag set |
//! | `stream_opened` | (id, payer, recipient, rate) | Stream started |
//! | `stream_claimed` | (id, amount) | Stream funds withdrawn |
//! | `stream_topped_up` | (id, amount) | Stream balance increased |
//! | `stream_closed` | (id) | Stream closed by payer |
//! | `multisig_created` | (id, proposer, recipient, amount, threshold) | Multi-sig proposal created |
//! | `multisig_approved` | (id, signer, count, threshold) | Proposal approved |
//! | `multisig_executed` | (id, recipient, amount) | Payment executed |
//! | `multisig_timeout` | (id, proposer, amount) | Proposal expired and refunded |
//! | `multisig_cancelled` | (id, proposer, amount) | Proposal cancelled by proposer |
//! | `airdrop_created` | (id, funder, token, total_amount) | Airdrop pool created |
//! | `airdrop_claimed` | (id, recipient, amount) | Airdrop claim paid out |
//! | `airdrop_cancelled` | (id, funder, unclaimed) | Airdrop cancelled and refunded |
//! | `vesting_created` | (id, funder, beneficiary, amount, cliff_ledger, end_ledger) | Vesting schedule created |
//! | `vesting_claimed` | (id, beneficiary, amount) | Vesting claim paid out |
//! | `vesting_revoked` | (id, funder, unclaimed) | Vesting schedule revoked |
//! | `batch_sent` | (from, recipient_count, total_amount) | Batch payment completed |
//! | `batch_sent_multi` | (from, recipient_count, total_amount) | Multi-token batch completed |
//! | `emergency_withdrawal_initiated` | (id, initiator) | Emergency withdrawal requested |
//! | `emergency_withdrawal_approve` | (id, signer, count, threshold) | Emergency withdrawal approved |
//! | `emergency_withdrawal_executed` | (id, to, amount) | Funds rescued |
//! | `emergency_withdrawal_cancelled` | (id, admin, amount) | Emergency withdrawal voided |
//! | `admin_action_proposed` | (id, action_type, proposer) | Gov proposal created |
//! | `admin_action_approved` | (id, approver, count, threshold) | Gov action approved |
//! | `balance_reconciled` | (token, old, new) | Admin resynced cached contract balance |
//! | `balance_drift_detected` | (token, cached, actual) | Cached vs actual balance drift surfaced |
//! | `swap` | (requested_in, actual_in, amount_out, fee, path_len) | Contract-reserve swap settled |

use soroban_sdk::Symbol;

/// Event symbols generated lazily per-environment for gas efficiency.
/// Callers should use the functions below rather than constructing Symbols
/// inline. This module is the single source of truth for event topic names;
/// publishing anywhere else, or instructing a different topic, is a bug
/// (see `tests/event_catalog.rs`).
pub struct Events;

impl Events {
    pub fn init(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "init")
    }

    pub fn admin_transfer(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "admin_transfer")
    }

    pub fn admin_signers_set(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "admin_signers_set")
    }

    pub fn paused(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "paused")
    }

    pub fn unpaused(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "unpaused")
    }

    pub fn pauser_set(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "pauser_set")
    }

    pub fn upgraded(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "upgraded")
    }

    pub fn ttl_bumped(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "ttl_bumped")
    }

    /// Single-tip topic. Payload is always `(amount, memo)` and the topic also
    /// carries the `from` and `to` addresses. Emitted from every tip-minting
    /// path with the identical shape.
    pub fn tip_sent(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "tip_sent")
    }

    pub fn receipt_minted(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "receipt_minted")
    }

    pub fn escrow_created(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "escrow_created")
    }

    pub fn escrow_released(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "escrow_released")
    }

    pub fn escrow_cancelled(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "escrow_cancelled")
    }

    pub fn escrow_disputed(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "escrow_disputed")
    }

    pub fn stream_opened(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "stream_opened")
    }

    pub fn stream_claimed(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "stream_claimed")
    }

    pub fn stream_topped_up(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "stream_topped_up")
    }

    pub fn stream_closed(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "stream_closed")
    }

    pub fn multisig_created(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "multisig_created")
    }

    pub fn multisig_approved(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "multisig_approved")
    }

    pub fn multisig_executed(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "multisig_executed")
    }

    pub fn multisig_timeout(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "multisig_timeout")
    }

    pub fn multisig_cancelled(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "multisig_cancelled")
    }

    pub fn airdrop_created(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "airdrop_created")
    }

    pub fn airdrop_claimed(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "airdrop_claimed")
    }

    pub fn airdrop_cancelled(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "airdrop_cancelled")
    }

    pub fn vesting_created(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "vesting_created")
    }

    pub fn vesting_claimed(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "vesting_claimed")
    }

    pub fn vesting_revoked(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "vesting_revoked")
    }

    pub fn batch_sent(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "batch_sent")
    }

    pub fn batch_sent_multi(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "batch_sent_multi")
    }

    pub fn emergency_withdrawal_initiated(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "emergency_withdrawal_initiated")
    }

    pub fn emergency_withdrawal_approve(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "emergency_withdrawal_approve")
    }

    pub fn emergency_withdrawal_executed(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "emergency_withdrawal_executed")
    }

    pub fn emergency_withdrawal_cancelled(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "emergency_withdrawal_cancelled")
    }

    pub fn admin_action_proposed(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "admin_action_proposed")
    }

    pub fn admin_action_approved(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "admin_action_approved")
    }

    pub fn balance_reconciled(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "balance_reconciled")
    }

    pub fn balance_drift_detected(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "balance_drift_detected")
    }
}
