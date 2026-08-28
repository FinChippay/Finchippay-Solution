//! # Finchippay Contract — Event Constants
//!
//! Centralized event symbols used for off-chain indexing and monitoring.
//! All events emitted by the contract are documented here to facilitate
//! indexer integration and monitoring dashboards.
//!
//! ## Event Catalog
//!
//! | Event | Payload | Description |
//! |---|---|---|
//! | `init` | admin address | Contract initialised |
//! | `admin_transfer` | new_admin address | Legacy admin pointer transferred |
//! | `admin_signers_set` | (threshold, signer_count) | Admin signer set updated |
//! | `paused` | () | Circuit breaker activated |
//! | `unpaused` | () | Circuit breaker deactivated |
//! | `pauser_set` | pauser address | Pauser role assigned |
//! | `upgraded` | (new_version, wasm_hash, layout_version) | Contract upgraded |
//! | `ttl_bumped` | (keys_bumped, class_index, key_index) | TTL sweep progress |
//! | `tip_sent` | (from, to, amount_ledger) | Tip recorded |
//! | `receipt_minted` | (payer, receipt_index) | Payment receipt minted |
//! | `escrow_created` | (id, from, to, amount, release_ledger) | Escrow opened |
//! | `escrow_released` | (id, recipient) | Escrow claimed |
//! | `escrow_cancelled` | (id, from) | Escrow cancelled by sender |
//! | `escrow_disputed` | (id, raised_by) | Dispute flag set |
//! | `stream_opened` | (id, payer, recipient, rate) | Stream started |
//! | `stream_claimed` | (id, amount) | Stream funds withdrawn |
//! | `stream_topped_up` | (id, amount) | Stream balance increased |
//! | `stream_closed` | (id) | Stream closed by payer |
//! | `multisig_created` | (id, proposer, threshold) | Multi-sig proposal created |
//! | `multisig_approved` | (id, approver, count, threshold) | Proposal approved |
//! | `multisig_executed` | (id, recipient, amount) | Payment executed |
//! | `batch_sent` | (sender, recipient_count) | Batch payment completed |
//! | `emergency_withdrawal_initiated` | (id, initiator) | Emergency withdrawal requested |
//! | `emergency_withdrawal_executed` | (id, to, amount) | Funds rescued |
//! | `admin_action_proposed` | (id, action_type, proposer) | Gov proposal created |
//! | `admin_action_approved` | (id, approver, count, threshold) | Gov action approved |
//! | `balance_reconciled` | (token, old, new) | Admin resynced cached contract balance |
//! | `balance_drift_detected` | (token, cached, actual) | Cached vs actual balance drift surfaced |
//! | `swap` | (requested_in, actual_in, amount_out, fee, path_len) | Contract-reserve swap settled |

use soroban_sdk::Symbol;

/// Event symbols generated lazily per-environment for gas efficiency.
/// Callers should use the functions below rather than constructing Symbols
/// inline.
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

    pub fn multisig_created(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "multisig_created")
    }

    pub fn multisig_approved(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "multisig_approved")
    }

    pub fn batch_sent(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "batch_sent")
    }

    pub fn emergency_withdrawal_initiated(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "emergency_withdrawal_initiated")
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
