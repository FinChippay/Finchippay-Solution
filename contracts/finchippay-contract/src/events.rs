//! # Finchippay Contract — Typed Events
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

use soroban_sdk::{contractevent, Address, BytesN, Symbol};

/// Event symbols generated lazily per-environment for gas efficiency.
/// Callers should use the functions below rather than constructing Symbols
/// inline. This module is the single source of truth for event topic names;
/// publishing anywhere else, or instructing a different topic, is a bug
/// (see `tests/event_catalog.rs`).
pub struct Events;

#[contractevent]
pub struct Init {
    pub admin: Address,
}

#[contractevent]
pub struct AdminTransfer {
    pub new_admin: Address,
}

#[contractevent]
pub struct AdminSignersSet {
    pub threshold: u32,
    pub signer_count: u32,
}

#[contractevent]
pub struct Paused {}

#[contractevent]
pub struct Unpaused {}

#[contractevent]
pub struct PauserSet {
    pub pauser: Address,
}

#[contractevent]
pub struct Upgraded {
    pub new_version: u32,
    pub wasm_hash: BytesN<32>,
    pub layout_version: u32,
}

#[contractevent]
pub struct AdminActionProposed {
    pub proposal_id: u64,
    pub action_type: Symbol,
    pub proposer: Address,
}

#[contractevent]
pub struct AdminActionApproved {
    pub proposal_id: u64,
    pub approver: Address,
    pub count: u32,
    pub threshold: u32,
}

#[contractevent]
pub struct FeeCollectorSet {
    pub collector: Address,
}

#[contractevent]
pub struct SwapFeeSet {
    pub fee_bps: u32,
}

// ─── TTL sweep event ──────────────────────────────────────────────────────

#[contractevent]
pub struct TtlBumped {
    pub keys_bumped: u32,
    pub class_index: u32,
    pub key_index: u32,
}

// ─── Tip & receipt events ─────────────────────────────────────────────────

#[contractevent]
pub struct TipSent {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub ledger: u32,
    pub memo: Symbol,
}

#[contractevent]
pub struct ReceiptMinted {
    pub payer: Address,
    pub receipt_index: u32,
}

// ─── Escrow events ────────────────────────────────────────────────────────

#[contractevent]
pub struct EscrowCreated {
    pub escrow_id: u32,
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub release_ledger: u32,
}

#[contractevent]
pub struct EscrowCancelled {
    pub escrow_id: u32,
    pub from: Address,
    pub amount: i128,
}

#[contractevent]
pub struct DisputableEscrowCreated {
    pub escrow_id: u32,
    pub arbitrator: Address,
}

#[contractevent]
pub struct DisputeRaised {
    pub escrow_id: u32,
    pub raised_by: Address,
}

#[contractevent]
pub struct ArbitratorAdded {
    pub arbitrator: Address,
}

    /// Single-tip topic. Payload is always `(amount, memo)` and the topic also
    /// carries the `from` and `to` addresses. Emitted from every tip-minting
    /// path with the identical shape.
    pub fn tip_sent(env: &soroban_sdk::Env) -> Symbol {
        Symbol::new(env, "tip_sent")
    }

// ─── Streaming payment events ─────────────────────────────────────────────

#[contractevent]
pub struct StreamOpened {
    pub stream_id: u32,
    pub payer: Address,
    pub recipient: Address,
    pub rate: i128,
    pub deposit: i128,
}

#[contractevent]
pub struct StreamClaimed {
    pub stream_id: u32,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
pub struct StreamToppedUp {
    pub stream_id: u32,
    pub payer: Address,
    pub amount: i128,
    pub deposited: i128,
}

#[contractevent]
pub struct StreamClosed {
    pub stream_id: u32,
    pub refund: i128,
    pub claimable: i128,
}

// ─── Multi-sig events ─────────────────────────────────────────────────────

#[contractevent]
pub struct MultisigCreated {
    pub proposal_id: u32,
    pub proposer: Address,
    pub recipient: Address,
    pub amount: i128,
    pub threshold: u32,
    pub signers_count: u32,
    pub expiration_ledger: u32,
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

#[contractevent]
pub struct MultisigCancelled {
    pub proposal_id: u32,
    pub proposer: Address,
    pub amount: i128,
}

// ─── Batch send events ────────────────────────────────────────────────────

#[contractevent]
pub struct BatchSent {
    pub sender: Address,
    pub recipient_count: u32,
    pub total_amount: i128,
}

#[contractevent]
pub struct BatchSentMulti {
    pub sender: Address,
    pub recipient_count: u32,
    pub total_amount: i128,
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

// ─── Emergency withdrawal events ──────────────────────────────────────────

#[contractevent]
pub struct EmergencyWithdrawalInitiated {
    pub withdrawal_id: u32,
    pub initiator: Address,
    pub token: Address,
    pub amount: i128,
    pub activation_ledger: u32,
}

#[contractevent]
pub struct EmergencyWithdrawalApproved {
    pub withdrawal_id: u32,
    pub signer: Address,
    pub count: u32,
    pub threshold: u32,
}

#[contractevent]
pub struct EmergencyWithdrawalExecuted {
    pub withdrawal_id: u32,
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
pub struct EmergencyWithdrawalCancelled {
    pub withdrawal_id: u32,
    pub admin: Address,
    pub amount: i128,
}

// ─── Airdrop events ───────────────────────────────────────────────────────

#[contractevent]
pub struct AirdropCreated {
    pub airdrop_id: u32,
    pub funder: Address,
    pub token: Address,
    pub total_amount: i128,
}

#[contractevent]
pub struct AirdropClaimed {
    pub airdrop_id: u32,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
pub struct AirdropCancelled {
    pub airdrop_id: u32,
    pub funder: Address,
    pub amount: i128,
}

// ─── Remaining escrow events (claim, milestones, disputes) ───────────────

#[contractevent]
pub struct EscrowClaimed {
    pub escrow_id: u32,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
pub struct EscrowClaimPartial {
    pub escrow_id: u32,
    pub to: Address,
    pub claim_amount: i128,
    pub remaining: i128,
}

#[contractevent]
pub struct MilestoneEscrowCreated {
    pub escrow_id: u32,
    pub milestone_count: u32,
}

#[contractevent]
pub struct MilestoneApproved {
    pub escrow_id: u32,
    pub milestone_id: u32,
}

#[contractevent]
pub struct MilestoneClaimed {
    pub escrow_id: u32,
    pub milestone_id: u32,
    pub amount: i128,
}

#[contractevent]
pub struct DisputeResolved {
    pub escrow_id: u32,
    pub resolution: Symbol,
    pub to: Address,
    pub amount: i128,
}

// ─── Remaining stream events (close, reject, transfer) ────────────────────

#[contractevent]
pub struct StreamClose {
    pub stream_id: u32,
    pub payer: Address,
    pub refund: i128,
}

#[contractevent]
pub struct StreamReject {
    pub stream_id: u32,
    pub recipient: Address,
    pub refund: i128,
}

#[contractevent]
pub struct StreamTransfer {
    pub stream_id: u32,
    pub from: Address,
    pub to: Address,
}

// ─── Remaining multi-sig events (executed, timeout) ───────────────────────

#[contractevent]
pub struct MultisigExecuted {
    pub proposal_id: u32,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
pub struct MultisigTimeout {
    pub proposal_id: u32,
    pub proposer: Address,
    pub amount: i128,
}

// ─── Swap event ───────────────────────────────────────────────────────────

#[contractevent]
pub struct Swap {
    pub caller: Address,
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: i128,
    pub actual_amount_in: i128,
    pub amount_out: i128,
    pub fee: i128,
    pub path_len: u32,
}

// ─── Balance reconciliation events ────────────────────────────────────────

#[contractevent]
pub struct BalanceReconciled {
    pub token: Address,
    pub old: i128,
    pub new: i128,
}

#[contractevent]
pub struct BalanceDriftDetected {
    pub token: Address,
    pub cached: i128,
    pub actual: i128,
}

// ─── Yield escrow events ──────────────────────────────────────────────────

#[contractevent]
pub struct YieldEscrowCreate {
    pub escrow_id: u64,
    pub from: Address,
    pub to: Address,
    pub token: Address,
    pub amount: i128,
    pub shares: i128,
}

#[contractevent]
pub struct YieldEscrowClaim {
    pub escrow_id: u64,
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
pub struct YieldEscrowCancelled {
    pub escrow_id: u64,
    pub from: Address,
    pub amount: i128,
}