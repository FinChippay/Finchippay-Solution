//! # Finchippay Contract — Typed Events
//!
//! Structured, schema-enforced events emitted by the contract. Every event is
//! a `#[contractevent]` struct: the struct's snake-case name becomes the first
//! topic, and every field becomes a named entry in the event data (a Soroban
//! `Map`). Indexers and generated SDK clients can deserialize these directly
//! instead of relying on ad-hoc `(Symbol, ...)` tuple layouts.
//!
//! ## Event Catalog
//!
//! | Struct (topic) | Fields | Description |
//! |---|---|---|
//! | `init` | admin address | Contract initialised |
//! | `admin_transfer` | new_admin address | Legacy admin pointer transferred |
//! | `admin_signers_set` | (threshold, signer_count) | Admin signer set updated |
//! | `paused` | () | Circuit breaker activated |
//! | `unpaused` | () | Circuit breaker deactivated |
//! | `pauser_set` | pauser address | Pauser role assigned |
//! | `upgraded` | (new_version, wasm_hash, layout_version) | Contract upgraded |
//! | `ttl_bumped` | (keys_bumped, class_index, key_index) | TTL sweep progress |
//! | `tip_sent` | (from, to, amount, ledger, memo) | Tip recorded |
//! | `receipt_minted` | (payer, receipt_index) | Payment receipt minted |
//! | `escrow_created` | (escrow_id, from, to, amount, release_ledger) | Escrow opened |
//! | `escrow_cancelled` | (escrow_id, from, amount) | Escrow cancelled |
//! | `disputable_escrow_created` | (escrow_id, arbitrator) | Disputable escrow created |
//! | `dispute_raised` | (escrow_id, raised_by) | Dispute flag set |
//! | `arbitrator_added` | arbitrator address | Arbitrator registered |
//! | `arbitrator_removed` | arbitrator address | Arbitrator removed |
//! | `stream_opened` | (stream_id, payer, recipient, rate, deposit) | Stream started |
//! | `stream_claimed` | (stream_id, recipient, amount) | Stream funds withdrawn |
//! | `stream_topped_up` | (stream_id, payer, amount, deposited) | Stream balance increased |
//! | `stream_closed` | (stream_id, refund, claimable) | Stream closed by payer |
//! | `multisig_created` | (proposal_id, proposer, recipient, amount, threshold, signers_count, expiration_ledger) | Multi-sig proposal created |
//! | `multisig_approved` | (proposal_id, approver, count, threshold) | Proposal approved |
//! | `multisig_cancelled` | (proposal_id, proposer, amount) | Multi-sig cancelled |
//! | `batch_sent` | (sender, recipient_count, total_amount) | Batch payment completed |
//! | `batch_sent_multi` | (sender, recipient_count, total_amount) | Multi-token batch completed |
//! | `vesting_create` | (vesting_id, from, beneficiary, amount, cliff_ledger, end_ledger) | Vesting schedule created |
//! | `vesting_claim` | (vesting_id, beneficiary, amount) | Vesting claimed |
//! | `vesting_revoke` | (vesting_id, funder, amount) | Vesting revoked |
//! | `emergency_withdrawal_initiated` | (withdrawal_id, initiator, token, amount, activation_ledger) | Emergency withdrawal requested |
//! | `emergency_withdrawal_approved` | (withdrawal_id, signer, count, threshold) | Emergency withdrawal approved |
//! | `emergency_withdrawal_executed` | (withdrawal_id, to, amount) | Funds rescued |
//! | `emergency_withdrawal_cancelled` | (withdrawal_id, admin, amount) | Emergency withdrawal cancelled |
//! | `admin_action_proposed` | (proposal_id, action_type, proposer) | Gov proposal created |
//! | `admin_action_approved` | (proposal_id, approver, count, threshold) | Gov action approved |
//! | `airdrop_created` | (airdrop_id, funder, token, total_amount) | Airdrop created |
//! | `airdrop_claimed` | (airdrop_id, recipient, amount) | Airdrop claimed |
//! | `airdrop_cancelled` | (airdrop_id, funder, amount) | Airdrop cancelled |
//! | `yield_escrow_create` | (escrow_id, from, to, token, amount, shares) | Yield escrow created |
//! | `yield_escrow_claim` | (escrow_id, to, amount) | Yield escrow claimed |
//! | `yield_escrow_cancelled` | (escrow_id, from, amount) | Yield escrow cancelled |
//! | `fee_collector_set` | collector address | Fee collector updated |
//! | `swap_fee_set` | fee_bps | Swap fee rate updated |
//! | `escrow_claimed` | (escrow_id, recipient, amount) | Escrow claimed |
//! | `escrow_claim_partial` | (escrow_id, to, claim_amount, remaining) | Partial escrow claim |
//! | `milestone_escrow_created` | (escrow_id, milestone_count) | Milestone escrow created |
//! | `milestone_approved` | (escrow_id, milestone_id) | Milestone approved |
//! | `milestone_claimed` | (escrow_id, milestone_id, amount) | Milestone claimed |
//! | `dispute_resolved` | (escrow_id, resolution, to, amount) | Dispute resolved |
//! | `stream_close` | (stream_id, payer, refund) | Stream close (old API) |
//! | `stream_reject` | (stream_id, recipient, refund) | Stream rejected |
//! | `stream_transfer` | (stream_id, from, to) | Stream transferred |
//! | `multisig_executed` | (proposal_id, recipient, amount) | Multi-sig executed |
//! | `multisig_timeout` | (proposal_id, proposer, amount) | Multi-sig timed out |
//! | `swap` | (caller, token_in, token_out, amount_in, actual_amount_in, amount_out, fee, path_len) | Swap executed |
//! | `balance_reconciled` | (token, old, new) | Admin resynced cached contract balance |
//! | `balance_drift_detected` | (token, cached, actual) | Cached vs actual balance drift surfaced |

use soroban_sdk::{contractevent, Address, BytesN, Symbol};

// ─── Admin & governance events ────────────────────────────────────────────

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

#[contractevent]
pub struct ArbitratorRemoved {
    pub arbitrator: Address,
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

#[contractevent]
pub struct MultisigApproved {
    pub proposal_id: u32,
    pub approver: Address,
    pub count: u32,
    pub threshold: u32,
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

// ─── Vesting events ───────────────────────────────────────────────────────

#[contractevent]
pub struct VestingCreate {
    pub vesting_id: u32,
    pub from: Address,
    pub beneficiary: Address,
    pub amount: i128,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
}

#[contractevent]
pub struct VestingClaim {
    pub vesting_id: u32,
    pub beneficiary: Address,
    pub amount: i128,
}

#[contractevent]
pub struct VestingRevoke {
    pub vesting_id: u32,
    pub funder: Address,
    pub amount: i128,
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