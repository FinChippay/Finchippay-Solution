//! # Finchippay Contract — Data Types & Errors
//!
//! This module contains all shared data types for the Finchippay smart contract.
//! It is organized to keep the main contract implementation lean and focused.
//!
//! ## Module Organization
//! - `types.rs` (this file) — shared types, enums, and error definitions
//! - `storage.rs` — storage helpers (TTL bumps, balance tracking)
//! - `events.rs` — event constants for off-chain indexing
//! - `lib.rs` — contract impl (admin, tips, escrow, streams, multi-sig, batch)

use soroban_sdk::{contracterror, contracttype, token, Address, BytesN, Env, Symbol, Val, Vec};

// ─── Error catalogue ──────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum ContractError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    NonPositiveAmount = 3,
    ReleaseLedgerInPast = 4,
    NotFound = 5,
    InvalidState = 6,
    Overflow = 7,
    InvalidThreshold = 8,
    LengthMismatch = 9,
    AlreadySigned = 10,
    InsufficientFunds = 11,
    ContractPaused = 12,
    SelfTransfer = 13,
    BatchTooLarge = 14,
    DuplicateSigner = 15,
    ProposalExpired = 16,
    TransferFailed = 17,
    IndexFull = 18,
    EmergencyWithdrawalNotReady = 19,
    NotAdminSigner = 20,
    InvalidPath = 21,
    SlippageExceeded = 22,
    ExcessiveAmountIn = 23,
    InvalidFeeBps = 24,
    StalePath = 29,
}

// ─── Shared data types ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct TipRecord {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub ledger: u32,
    pub memo: Symbol,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ReceiptMetadata {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub memo: Symbol,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeEstimate {
    pub cpu_instructions: u64,
    pub ledger_read_bytes: u32,
    pub ledger_write_bytes: u32,
    pub estimated_stroops: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ReceiptProof {
    pub receipt_index: u32,
    pub payer: Address,
    pub expected_amount: i128,
    pub expected_memo: Symbol,
}

// ─── Escrow ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    Pending,
    Released,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    pub id: u32,
    pub from: Address,
    pub to: Address,
    pub token: Address,
    pub amount: i128,
    pub release_ledger: u32,
    pub status: EscrowStatus,
    pub memo: Symbol,
    pub arbitrator: Option<Address>,
    pub disputed: bool,
    pub dispute_raised_by: Option<Address>,
    pub dispute_raised_at: u32,
}

// ─── Streaming payments ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Stream {
    pub id: u32,
    pub payer: Address,
    pub recipient: Address,
    pub token: Address,
    pub rate_per_ledger: i128,
    pub deposited: i128,
    pub claimed: i128,
    pub start_ledger: u32,
    pub closed: bool,
    pub paused_at_ledger: u32,
    pub total_paused_duration: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VestingSchedule {
    pub id: u32,
    pub funder: Address,
    pub token: Address,
    pub beneficiary: Address,
    pub total_amount: i128,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
    pub claimed: i128,
    pub revoked: bool,
}

// ─── Multi-sig payments ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum MultiSigStatus {
    Pending,
    Executed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MultiSigProposal {
    pub id: u32,
    pub proposer: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub threshold: u32,
    pub signers: Vec<Address>,
    pub approvals: Vec<Address>,
    pub status: MultiSigStatus,
    pub expiration_ledger: u32,
}

// ─── Emergency withdrawal ─────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EmergencyWithdrawalStatus {
    Pending,
    Executed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EmergencyWithdrawal {
    pub id: u32,
    pub initiator: Address,
    pub token: Address,
    pub amount: i128,
    pub to: Address,
    pub initiated_at_ledger: u32,
    pub activation_ledger: u32,
    pub approvals: Vec<Address>,
    pub threshold: u32,
    pub status: EmergencyWithdrawalStatus,
}

// ─── Admin governance ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum AdminAction {
    Pause,
    Unpause,
    SetPauser(Address),
    Upgrade(BytesN<32>, u32),
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminActionProposal {
    pub id: u32,
    pub proposer: Address,
    pub action: AdminAction,
    pub approvals: Vec<Address>,
    pub executed: bool,
}

// ─── Batch swap helper types ─────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct SwapItem {
    pub token: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TokenTotal {
    pub token: Address,
    pub total: i128,
}

// ─── Storage TTL classes ─────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TtlClass {
    Config,
    Receipts,
    Escrows,
    Streams,
    MultiSig,
    Vesting,
    Emergency,
}
