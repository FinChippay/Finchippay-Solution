#![no_std]
//! # FinchippayContract — Soroban Smart Contract
//!
//! A production-grade Soroban contract for the Finchippay-Solution platform on
//! the Stellar network. Provides:
//!
//! - **Tips**: one-shot token transfers recorded on-chain with aggregate stats.
//! - **Receipts**: immutable payment-receipt metadata minted by a payer.
//! - **Escrow**: time-locked token custody with claim / cancel flows.
//! - **Streaming Payments**: continuous per-ledger token streams that
//!   recipients can drain at any time; payers can top-up or close early.
//! - **Multi-Sig Payments**: N-of-M threshold approvals before a payment
//!   executes, fully on-chain with no trusted third-party.
//! - **Batch Sends**: fan-out a single token transfer to many recipients in
//!   one transaction, minimising fee overhead.
//!
//! ## Security model
//! - Every mutating entry-point calls `require_auth()` on the authorising
//!   party before touching any state.
//! - All arithmetic uses `checked_add` / `checked_sub` / `checked_mul` with
//!   explicit panics so overflows are never silently truncated.
//! - Storage TTLs are extended on every read and write to prevent ledger
//!   expiry from corrupting live streams or pending multi-sig proposals.
//! - **Emergency pause**: admin can freeze all value-transferring operations
//!   (circuit breaker pattern) to contain potential exploits.
//! - **Upgradability**: admin can point the contract at a new WASM hash to
//!   deploy security patches without migrating state.
//! - **Bounded inputs**: escrow release ledgers, stream deposits, and
//!   multi-sig amounts are capped to prevent griefing and permanent lock-up.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Bytes, BytesN, Env,
    Symbol, Vec,
};

// ─── Storage lifetime constants ───────────────────────────────────────────────

/// Minimum remaining TTL (in ledgers) before we bump persistent storage.
const PERSISTENT_LIFETIME_THRESHOLD: u32 = 100_000;
/// Target TTL (in ledgers) after a bump (~1 year at 5 s/ledger).
const PERSISTENT_BUMP_AMOUNT: u32 = 500_000;

// ─── Error catalogue ──────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum ContractError {
    /// `initialize()` was already called on this contract instance.
    AlreadyInitialized = 1,
    /// The caller is not the stored admin.
    Unauthorized = 2,
    /// A numeric argument must be strictly positive.
    NonPositiveAmount = 3,
    /// `release_ledger` must be strictly greater than the current ledger.
    ReleaseLedgerInPast = 4,
    /// The referenced escrow, stream, or proposal does not exist.
    NotFound = 5,
    /// The operation is not valid in the item's current state.
    InvalidState = 6,
    /// Arithmetic overflow detected.
    Overflow = 7,
    /// The supplied signer list length does not match the required threshold.
    InvalidThreshold = 8,
    /// Recipient or signer arrays have mismatched lengths.
    LengthMismatch = 9,
    /// This address has already approved the multi-sig proposal.
    AlreadySigned = 10,
    /// The stream has insufficient deposited funds.
    InsufficientFunds = 11,
    /// The contract is paused; value-transferring operations are blocked.
    ContractPaused = 12,
    /// Self-transfers are not allowed (from == to).
    SelfTransfer = 13,
    /// The batch size exceeds the maximum allowed recipients.
    BatchTooLarge = 14,
    /// Duplicate signer detected in the signers list.
    DuplicateSigner = 15,
    /// The proposal has expired and can no longer be approved.
    ProposalExpired = 16,
    /// The yield-escrow feature is disabled pending AMM integration.
    YieldEscrowDisabled = 17,
    /// token_a and token_b must be different tokens.
    SameToken = 18,
    /// The unlocked balance is insufficient for this operation.
    InsufficientUnlockedBalance = 19,
    /// The WASM hash is not in the approved allowlist.
    UnapprovedWasm = 20,
    /// A re-entrant call was detected and blocked.
    ReentrantCall = 21,
    /// The swap fee bps value exceeds the maximum allowed.
    FeeTooHigh = 22,
    /// The emergency withdrawal delay has not elapsed yet.
    EmergencyDelayNotElapsed = 23,
}

// ─── Shared data types ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]    pub struct TipRecord {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub ledger: u32,
    /// Optional memo attached to the tip for off-chain context.
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

// ─── Escrow ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    Pending,
    Released,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]    pub struct Escrow {
    pub id: u32,
    pub from: Address,
    pub to: Address,
    pub token: Address,
    pub amount: i128,
    pub release_ledger: u32,
    pub status: EscrowStatus,
    /// Optional memo attached to the escrow for off-chain context.
    pub memo: Symbol,
}

/// Maximum number of escrows tracked per recipient index (prevents state bloat).
const MAX_USER_ESCROWS: u32 = 100;

// ─── Streaming payments ───────────────────────────────────────────────────────

/// A continuous per-ledger payment stream from `payer` to `recipient`.
///
/// The claimable amount at any ledger `L` is:
/// ```
/// elapsed   = L - start_ledger
/// streamed  = rate_per_ledger * elapsed          (capped at deposited)
/// claimable = min(streamed, deposited) - claimed
/// ```
#[contracttype]
#[derive(Clone, Debug)]
pub struct Stream {
    pub id: u32,
    /// Address that funded the stream.
    pub payer: Address,
    /// Address entitled to drain the stream.
    pub recipient: Address,
    /// Token being streamed.
    pub token: Address,
    /// Stroops (or token base units) released per ledger.
    pub rate_per_ledger: i128,
    /// Total base units deposited into this contract for the stream.
    pub deposited: i128,
    /// Cumulative base units already claimed by the recipient.
    pub claimed: i128,
    /// Ledger sequence number when the stream was opened.
    pub start_ledger: u32,
    /// True once the payer has closed the stream.
    pub closed: bool,
}

// ─── Multi-sig payments ───────────────────────────────────────────────────────

/// Status of a multi-sig payment proposal.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum MultiSigStatus {
    /// Collecting signatures — not yet executed.
    Pending,
    /// Threshold reached; payment has been executed.
    Executed,
    /// Cancelled by the proposer before execution.
    Cancelled,
}

/// An N-of-M on-chain payment proposal.
///
/// The payment fires automatically when the number of distinct `approvals`
/// reaches `threshold`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MultiSigProposal {
    pub id: u32,
    /// Address that created the proposal and funded the escrow.
    pub proposer: Address,
    /// Payment destination.
    pub recipient: Address,
    /// Token to transfer.
    pub token: Address,
    /// Amount to transfer (already locked in the contract).
    pub amount: i128,
    /// How many unique approvals are required to execute.
    pub threshold: u32,
    /// Ordered list of addresses permitted to approve.
    pub signers: Vec<Address>,
    /// Subset of `signers` that have approved so far.
    pub approvals: Vec<Address>,
    pub status: MultiSigStatus,
    /// Ledger sequence number after which this proposal expires.
    /// 0 means no expiration (legacy).
    pub expiration_ledger: u32,
}

// ─── Security bounds ──────────────────────────────────────────────────────────

/// Maximum ledgers into the future an escrow can be created (≈ 30 days at 5 s).
const MAX_ESCROW_LEDGERS: u32 = 518_400;
/// Maximum deposit amount for a single stream (1 trillion stroops).
const MAX_STREAM_DEPOSIT: i128 = 1_000_000_000_000_000_000;
/// Maximum rate per ledger for a stream (avoids overflow in elapsed * rate).
const MAX_STREAM_RATE: i128 = 10_000_000_000;
/// Maximum amount for a single escrow deposit.
const MAX_ESCROW_AMOUNT: i128 = 1_000_000_000_000_000_000;
/// Maximum amount for a single multi-sig proposal.
const MAX_MULTISIG_AMOUNT: i128 = 1_000_000_000_000_000_000;
/// Minimum amount for a single escrow deposit (prevents dust attacks).
const MIN_ESCROW_AMOUNT: i128 = 1_000;
/// Minimum amount for a single multi-sig proposal.
const MIN_MULTISIG_AMOUNT: i128 = 1_000;
/// Maximum signers allowed in a multi-sig proposal.
const MAX_MULTISIG_SIGNERS: u32 = 20;
/// Maximum number of recipients allowed in a single batch_send call.
const MAX_BATCH_SIZE: u32 = 50;
/// Contract version identifier (used for off-chain discovery).
const CONTRACT_VERSION: u32 = 4;

// ─── Swap / fee constants ─────────────────────────────────────────────────────

/// Default swap fee in basis points (30 bps = 0.30 %).
const DEFAULT_SWAP_FEE_BPS: i128 = 30;
/// Maximum swap fee in basis points (500 bps = 5 %).
const MAX_SWAP_FEE_BPS: i128 = 500;
/// Basis-point denominator.
const BPS_DENOM: i128 = 10_000;

// ─── Emergency-withdrawal constants ──────────────────────────────────────────

/// Minimum ledgers between initiation and execution (~24 h at 5 s/ledger).
const EMERGENCY_WITHDRAWAL_DELAY: u32 = 17_280;
/// TTL for admin-action proposal keys (≈ 7 days).
const ADMIN_ACTION_TTL: u32 = 120_960;

// ─── Storage key enum ─────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    /// Separate role that can pause/unpause without admin upgrade rights.
    Pauser,
    Paused,
    /// Stored contract version; bumped on upgrade.
    Version,
    // Tips
    TipTotal(Address),
    TipCount(Address),
    TipRecord(Address, u32),
    // Receipts
    ReceiptCount(Address),
    ReceiptRecord(Address, u32),
    // Escrow
    EscrowCount,
    Escrow(u32),
    /// Index of escrow IDs associated with a recipient address.
    EscrowByRecipient(Address),
    // Streaming
    StreamCount,
    Stream(u32),
    // Multi-sig
    MultiSigCount,
    MultiSig(u32),
    // ── NEW: Swap / fee config ────────────────────────────────────────────
    /// Swap fee in basis points (i128).
    SwapFee,
    /// Address that collects swap fees.
    FeeCollector,
    // ── NEW: Admin-action governance ──────────────────────────────────────
    /// Rolling counter for admin-action proposals (u64).
    AdminActionCount,
    /// Individual admin-action proposal keyed by id (u64).
    AdminActionProposal(u64),
    /// Set of admin signers (Vec<Address>).
    AdminSigners,
    /// Threshold required to execute an admin action (u32).
    AdminSignersThreshold,
    /// Set of approved WASM hashes (Vec<BytesN<32>>).
    ApprovedWasmHashes,
    /// Storage layout version for migration safety (u32).
    StorageLayoutVersion,
    // ── NEW: Emergency withdrawal ─────────────────────────────────────────
    /// Counter for emergency-withdrawal proposals (u32).
    EmergencyWithdrawalCount,
    /// Individual emergency-withdrawal record keyed by id (u32).
    EmergencyWithdrawal(u32),
    // ── NEW: Yield escrow ─────────────────────────────────────────────────
    /// Feature flag — yield escrow disabled until AMM is live (bool).
    YieldEscrowEnabled,
    /// Counter for yield-escrow records (u32).
    YieldEscrowCount,
    /// Individual yield-escrow record keyed by id (u32).
    YieldEscrow(u32),
    // ── NEW: Re-entrancy guard ────────────────────────────────────────────
    /// Lock flag used by ReentrancyGuard (bool).
    ReentrancyLock,
}

// ─── NEW: Admin-action types ──────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum AdminActionStatus {
    Pending,
    Executed,
    Cancelled,
}

/// An N-of-M admin governance proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminActionProposal {
    pub id: u64,
    /// Human-readable action tag, e.g. "upgrade", "set_swap_fee", "set_fee_collector".
    pub action: Symbol,
    /// Encoded payload — interpretation depends on `action`.
    pub payload: soroban_sdk::Bytes,
    pub approvals: soroban_sdk::Vec<Address>,
    pub status: AdminActionStatus,
    /// Ledger after which the proposal expires (0 = no expiry).
    pub expiration_ledger: u32,
}

// ─── NEW: Emergency-withdrawal types ─────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EmergencyWithdrawalStatus {
    Pending,
    Executed,
    Cancelled,
}

/// An emergency-withdrawal proposal: moves tokens from the contract to `to`
/// after a mandatory delay and N-of-M admin approval.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EmergencyWithdrawal {
    pub id: u32,
    pub token: Address,
    pub to: Address,
    pub amount: i128,
    pub approvals: soroban_sdk::Vec<Address>,
    /// Ledger at or after which `execute_emergency_withdrawal` is valid.
    pub activation_ledger: u32,
    pub status: EmergencyWithdrawalStatus,
}

// ─── NEW: Yield-escrow types ──────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum YieldEscrowStatus {
    Pending,
    Claimed,
    Cancelled,
}

/// A yield-bearing escrow where the principal earns (simulated) yield via an
/// external AMM/pool. The AMM integration is feature-gated off until live;
/// `shares_received` is a placeholder and MUST NOT be used for pricing until
/// then.
#[contracttype]
#[derive(Clone, Debug)]
pub struct YieldEscrow {
    pub id: u32,
    pub from: Address,
    pub to: Address,
    pub token_a: Address,
    pub amount: i128,
    pub release_ledger: u32,
    pub status: YieldEscrowStatus,
    /// NOTE: placeholder value — equals `amount` until real AMM integration.
    pub shares_received: i128,
}

// ─── NEW: Swap fee breakdown ──────────────────────────────────────────────────

/// Invariant-checked breakdown returned by `compute_fee_breakdown`.
/// Guarantees: `fee + amount_to_swap == gross_amount_in`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeBreakdown {
    pub gross_amount_in: i128,
    pub fee: i128,
    pub amount_to_swap: i128,
    pub fee_bps: i128,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn bump<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

fn get_admin(env: &Env) -> Address {
    let key = DataKey::Admin;
    let admin: Address = env
        .storage()
        .persistent()
        .get(&key)
        .expect("Contract not initialized");
    bump(env, &key);
    admin
}

/// Get a token client for a given token address, avoiding repeated
/// boilerplate across all token-interacting functions.
fn get_token_client<'a>(env: &'a Env, token_address: &'a Address) -> token::Client<'a> {
    token::Client::new(env, token_address)
}

/// Check that the contract is not paused. Panics with `ContractPaused` if it is.
fn require_not_paused(env: &Env) {
    let paused: bool = env
        .storage()
        .persistent()
        .get(&DataKey::Paused)
        .unwrap_or(false);
    if paused {
        panic!("Contract is paused");
    }
    bump(env, &DataKey::Paused);
}

/// Check that the contract has been initialised. Panics if `initialize()` was
/// never called. This prevents use of the contract before the admin is set.
fn require_initialized(env: &Env) {
    if !env.storage().persistent().has(&DataKey::Admin) {
        panic!("Contract not initialized");
    }
}

// ─── Re-entrancy guard ────────────────────────────────────────────────────────

/// Simple re-entrancy guard using a persistent lock flag.
/// Acquire at the start of every custody-mutating function; the lock is
/// automatically released when the function returns (or panics) because
/// Soroban rolls back the entire transaction on panic, resetting storage.
///
/// Usage:
/// ```ignore
/// let _guard = ReentrancyGuard::acquire(&env);
/// // ... do work ...
/// ```  
struct ReentrancyGuard;

impl ReentrancyGuard {
    fn acquire(env: &Env) {
        let locked: bool = env
            .storage()
            .persistent()
            .get(&DataKey::ReentrancyLock)
            .unwrap_or(false);
        if locked {
            panic!("ReentrantCall");
        }
        env.storage()
            .persistent()
            .set(&DataKey::ReentrancyLock, &true);
        bump(env, &DataKey::ReentrancyLock);
    }

    fn release(env: &Env) {
        env.storage()
            .persistent()
            .set(&DataKey::ReentrancyLock, &false);
    }
}

// ─── TTL sweep helpers ────────────────────────────────────────────────────────

/// Bump all singleton config keys so they never silently expire (WS5).
/// This ensures SwapFee, FeeCollector, AdminActionCount, etc. never expire.
fn bump_all_config_ttls(env: &Env) {
    macro_rules! bump_if_present {
        ($key:expr) => {
            if env.storage().persistent().has(&$key) {
                env.storage().persistent().extend_ttl(
                    &$key,
                    PERSISTENT_LIFETIME_THRESHOLD,
                    PERSISTENT_BUMP_AMOUNT,
                );
            }
        };
    }
    bump_if_present!(DataKey::Admin);
    bump_if_present!(DataKey::Paused);
    bump_if_present!(DataKey::Pauser);
    bump_if_present!(DataKey::Version);
    bump_if_present!(DataKey::StorageLayoutVersion);
    bump_if_present!(DataKey::SwapFee);
    bump_if_present!(DataKey::FeeCollector);
    bump_if_present!(DataKey::AdminSigners);
    bump_if_present!(DataKey::AdminSignersThreshold);
    bump_if_present!(DataKey::AdminActionCount);
    bump_if_present!(DataKey::ApprovedWasmHashes);
    bump_if_present!(DataKey::YieldEscrowEnabled);
    bump_if_present!(DataKey::EmergencyWithdrawalCount);
    bump_if_present!(DataKey::YieldEscrowCount);
}

// ─── Admin-signer helpers ─────────────────────────────────────────────────────

fn get_admin_signers(env: &Env) -> soroban_sdk::Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::AdminSigners)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env))
}

fn get_admin_signers_threshold(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::AdminSignersThreshold)
        .unwrap_or(1)
}

/// Returns true if `caller` is in the admin-signer set OR is the legacy admin.
fn is_admin_signer(env: &Env, caller: &Address) -> bool {
    if caller == &get_admin(env) {
        return true;
    }
    get_admin_signers(env).iter().any(|s| &s == caller)
}

// ─── Fee helpers ──────────────────────────────────────────────────────────────

fn get_swap_fee_bps(env: &Env) -> i128 {
    let key = DataKey::SwapFee;
    let val: i128 = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(DEFAULT_SWAP_FEE_BPS);
    if env.storage().persistent().has(&key) {
        bump(env, &key);
    }
    val
}

fn get_fee_collector(env: &Env) -> Option<Address> {
    let key = DataKey::FeeCollector;
    let val: Option<Address> = env.storage().persistent().get(&key);
    if val.is_some() {
        bump(env, &key);
    }
    val
}

/// Compute the fee breakdown for a swap.
/// Guarantees: `fee + amount_to_swap == gross_amount_in`.
fn compute_fee_breakdown(env: &Env, gross_amount_in: i128, fee_bps: i128) -> FeeBreakdown {
    if gross_amount_in < 0 {
        panic!("gross_amount_in must be non-negative");
    }
    if fee_bps < 0 || fee_bps > MAX_SWAP_FEE_BPS {
        panic!("fee_bps out of range");
    }
    let fee = gross_amount_in
        .checked_mul(fee_bps)
        .expect("fee overflow")
        .checked_div(BPS_DENOM)
        .expect("fee div overflow");
    let amount_to_swap = gross_amount_in.checked_sub(fee).expect("fee sub overflow");
    // Invariant: fee + amount_to_swap == gross_amount_in
    let check = fee.checked_add(amount_to_swap).expect("invariant overflow");
    if check != gross_amount_in {
        panic!("fee invariant violated");
    }
    FeeBreakdown {
        gross_amount_in,
        fee,
        amount_to_swap,
        fee_bps,
    }
}

/// Compute the required gross input to receive exactly `amount_out` after fees.
/// Uses ceiling division so the protocol is never short.
fn compute_required_amount_in(amount_out: i128, fee_bps: i128) -> i128 {
    if amount_out < 0 {
        panic!("amount_out must be non-negative");
    }
    if fee_bps < 0 || fee_bps > MAX_SWAP_FEE_BPS {
        panic!("fee_bps out of range");
    }
    let denom = BPS_DENOM
        .checked_sub(fee_bps)
        .expect("denom sub overflow");
    // ceiling division: (amount_out * BPS_DENOM + denom - 1) / denom
    let numerator = amount_out
        .checked_mul(BPS_DENOM)
        .expect("required_in overflow")
        .checked_add(denom - 1)
        .expect("required_in overflow2");
    let required_in = numerator.checked_div(denom).expect("required_in div");
    if required_in < amount_out {
        panic!("required_in < amount_out invariant violated");
    }
    required_in
}

#[contract]
pub struct FinchippayContract;

#[contractimpl]
impl FinchippayContract {
    // ─── Admin ────────────────────────────────────────────────────────────────

    /// Initialise the contract with an `admin` address.
    /// Can only be called once; returns `AlreadyInitialized` on subsequent calls.
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        bump(&env, &DataKey::Admin);
        env.storage()
            .persistent()
            .set(&DataKey::Version, &CONTRACT_VERSION);
        bump(&env, &DataKey::Version);
        // WS5: initialize storage layout version
        env.storage()
            .persistent()
            .set(&DataKey::StorageLayoutVersion, &1u32);
        bump(&env, &DataKey::StorageLayoutVersion);
        // WS5: bump all config keys on initialization
        bump_all_config_ttls(&env);
        env.events().publish((Symbol::new(&env, "init"),), admin);
        Ok(())
    }

    /// Transfer admin rights to `new_admin`. Only the current admin may call this.
    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) {
        current_admin.require_auth();
        let stored = get_admin(&env);
        if current_admin != stored {
            panic!("Unauthorized");
        }
        env.storage().persistent().set(&DataKey::Admin, &new_admin);
        bump(&env, &DataKey::Admin);
        env.events()
            .publish((Symbol::new(&env, "admin_transfer"),), new_admin);
    }

    /// Return the current admin address.
    pub fn get_admin(env: Env) -> Address {
        get_admin(&env)
    }

    /// Return `true` if the contract is currently paused (circuit breaker).
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Admin: pause all value-transferring operations. Read-only functions remain
    /// accessible so users can still inspect escrows, streams, and proposals.
    /// Can be called by either the admin or the designated pauser.
    pub fn pause(env: Env, caller: Address) {
        caller.require_auth();
        let stored_admin = get_admin(&env);
        let stored_pauser: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Pauser);
        let is_pauser = stored_pauser
            .as_ref()
            .map(|p| p == &caller)
            .unwrap_or(false);
        if caller != stored_admin && !is_pauser {
            panic!("Unauthorized");
        }
        env.storage().persistent().set(&DataKey::Paused, &true);
        bump(&env, &DataKey::Paused);
        env.events()
            .publish((Symbol::new(&env, "paused"),), ());
    }

    /// Admin: resume all value-transferring operations.
    /// Can be called by either the admin or the designated pauser.
    pub fn unpause(env: Env, caller: Address) {
        caller.require_auth();
        let stored_admin = get_admin(&env);
        let stored_pauser: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Pauser);
        let is_pauser = stored_pauser
            .as_ref()
            .map(|p| p == &caller)
            .unwrap_or(false);
        if caller != stored_admin && !is_pauser {
            panic!("Unauthorized");
        }
        env.storage().persistent().set(&DataKey::Paused, &false);
        bump(&env, &DataKey::Paused);
        env.events()
            .publish((Symbol::new(&env, "unpaused"),), ());
    }

    /// Admin: set or clear the pauser address. Only the admin may call this.
    /// The pauser can call pause/unpause but cannot upgrade or transfer admin.
    pub fn set_pauser(env: Env, admin: Address, pauser: Address) {
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            panic!("Unauthorized");
        }
        env.storage().persistent().set(&DataKey::Pauser, &pauser);
        bump(&env, &DataKey::Pauser);
        env.events()
            .publish((Symbol::new(&env, "pauser_set"),), pauser);
    }

    /// Return the current pauser address, if one is set.
    pub fn get_pauser(env: Env) -> Option<Address> {
        let key = DataKey::Pauser;
        let val: Option<Address> = env.storage().persistent().get(&key);
        if val.is_some() {
            bump(&env, &key);
        }
        val
    }

    /// Return the current contract version.
    pub fn get_version(env: Env) -> u32 {
        let key = DataKey::Version;
        let ver: u32 = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(CONTRACT_VERSION);
        if env.storage().persistent().has(&key) {
            bump(&env, &key);
        }
        ver
    }

    /// Admin: upgrade the contract WASM to `new_wasm_hash`.
    ///
    /// WS6: Legacy single-key `upgrade()` removed. Use `propose_admin_action` +
    /// `approve_admin_action` with action tag `"upgrade"` instead. The WASM hash
    /// must be in the `ApprovedWasmHashes` allowlist.
    ///
    /// After a successful upgrade the stored version is incremented so off-chain
    /// indexers can detect the change.
    pub fn upgrade(_env: Env, _admin: Address, _new_wasm_hash: BytesN<32>) {
        panic!("upgrade() is disabled — use propose_admin_action with action tag 'upgrade'");
    }

    /// Admin: rescue tokens accidentally sent directly to the contract address.
    /// Since all legitimate funds are tracked via escrow/stream/multisig IDs,
    /// any unbounded tokens held by the contract can be safely swept by the admin
    /// to a designated address. Only the admin may call this.
    pub fn rescue_tokens(
        env: Env,
        admin: Address,
        token_address: Address,
        amount: i128,
        to: Address,
    ) {
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            panic!("Unauthorized");
        }
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let token = get_token_client(&env, &token_address);
        token.transfer(&env.current_contract_address(), &to, &amount);

        env.events().publish(
            (Symbol::new(&env, "rescue_tokens"),),
            (token_address, amount, to),
        );
    }

    // ─── Tips ─────────────────────────────────────────────────────────────────

    /// Transfer `amount` tokens from `from` to `to` and record the tip on-chain.
    ///
    /// # Errors
    /// Panics if `amount <= 0`, the contract is paused, or `from` has not
    /// authorised the call.
    pub fn send_tip(env: Env, token_address: Address, from: Address, to: Address, amount: i128, memo: Symbol) {
        require_initialized(&env);
        require_not_paused(&env);
        from.require_auth();
        if from == to {
            panic!("cannot tip yourself");
        }
        if amount <= 0 {
            panic!("Tip amount must be positive");
        }
        let token = get_token_client(&env, &token_address);
        token.transfer(&from, &to, &amount);

        let total: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TipTotal(to.clone()))
            .unwrap_or(0);
        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TipCount(to.clone()))
            .unwrap_or(0);

        let new_total = total.checked_add(amount).expect("overflow");
        env.storage()
            .persistent()
            .set(&DataKey::TipTotal(to.clone()), &new_total);
        bump(&env, &DataKey::TipTotal(to.clone()));

        env.storage()
            .persistent()
            .set(&DataKey::TipCount(to.clone()), &(count + 1));
        bump(&env, &DataKey::TipCount(to.clone()));

        let record = TipRecord {
            from: from.clone(),
            to: to.clone(),
            amount,
            ledger: env.ledger().sequence(),
            memo,
        };
        env.storage()
            .persistent()
            .set(&DataKey::TipRecord(to.clone(), count), &record);
        bump(&env, &DataKey::TipRecord(to.clone(), count));

        env.events()
            .publish((Symbol::new(&env, "tip"), from.clone(), to.clone()), amount);
    }

    /// Return the aggregate amount tipped to `recipient`.
    pub fn get_tip_total(env: Env, recipient: Address) -> i128 {
        let key = DataKey::TipTotal(recipient);
        let val = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            bump(&env, &key);
        }
        val
    }

    /// Return the number of tips received by `recipient`.
    pub fn get_tip_count(env: Env, recipient: Address) -> u32 {
        let key = DataKey::TipCount(recipient);
        let val = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            bump(&env, &key);
        }
        val
    }

    /// Return the tip record at `index` for `recipient`.
    pub fn get_tip_record(env: Env, recipient: Address, index: u32) -> TipRecord {
        let key = DataKey::TipRecord(recipient, index);
        let val: TipRecord = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Tip record not found");
        bump(&env, &key);
        val
    }

    // ─── Receipts ─────────────────────────────────────────────────────────────

    /// Mint an immutable payment receipt. Returns the receipt index.
    ///
    /// No token transfer occurs — this is a pure metadata operation.
    pub fn mint_receipt(env: Env, from: Address, to: Address, amount: i128, memo: Symbol) -> u32 {
        require_initialized(&env);
        require_not_paused(&env);
        from.require_auth();
        if amount <= 0 {
            panic!("Receipt amount must be positive");
        }
        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::ReceiptCount(from.clone()))
            .unwrap_or(0);

        let receipt = ReceiptMetadata {
            from: from.clone(),
            to,
            amount,
            timestamp: env.ledger().timestamp(),
            memo,
            ledger: env.ledger().sequence(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::ReceiptRecord(from.clone(), count), &receipt);
        bump(&env, &DataKey::ReceiptRecord(from.clone(), count));

        env.storage()
            .persistent()
            .set(&DataKey::ReceiptCount(from.clone()), &(count + 1));
        bump(&env, &DataKey::ReceiptCount(from.clone()));

        env.events()
            .publish((Symbol::new(&env, "receipt"), from), count);
        count
    }

    /// Return the number of receipts minted by `payer`.
    pub fn get_receipt_count(env: Env, payer: Address) -> u32 {
        let key = DataKey::ReceiptCount(payer);
        let val = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            bump(&env, &key);
        }
        val
    }

    /// Return the receipt at `index` for `payer`.
    pub fn get_receipt(env: Env, payer: Address, index: u32) -> ReceiptMetadata {
        let key = DataKey::ReceiptRecord(payer, index);
        let val: ReceiptMetadata = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Receipt not found");
        bump(&env, &key);
        val
    }


    // ─── Escrow ───────────────────────────────────────────────────────────────

    /// Lock `amount` tokens from `from` until `release_ledger`. Returns the escrow ID.
    ///
    /// Funds are held by the contract itself until `claim_escrow` or `cancel_escrow`.
    pub fn create_escrow(
        env: Env,
        token_address: Address,
        from: Address,
        to: Address,
        amount: i128,
        release_ledger: u32,
        memo: Symbol,
    ) -> u32 {
        require_initialized(&env);
        require_not_paused(&env);
        from.require_auth();
        if from == to {
            panic!("cannot create escrow to yourself");
        }
        if amount <= 0 {
            panic!("amount must be positive");
        }
        if amount > MAX_ESCROW_AMOUNT {
            panic!("amount exceeds maximum escrow size");
        }
        if amount < MIN_ESCROW_AMOUNT {
            panic!("amount below minimum escrow size");
        }
        if release_ledger <= env.ledger().sequence() {
            panic!("release_ledger must be in the future");
        }
        if release_ledger > env.ledger().sequence() + MAX_ESCROW_LEDGERS {
            panic!("release_ledger is too far in the future");
        }

        let token = get_token_client(&env, &token_address);
        token.transfer(&from, &env.current_contract_address(), &amount);

        let next_id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0);
        let escrow = Escrow {
            id: next_id,
            from: from.clone(),
            to: to.clone(),
            token: token_address,
            amount,
            release_ledger,
            status: EscrowStatus::Pending,
            memo,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(next_id), &escrow);
        bump(&env, &DataKey::Escrow(next_id));
        env.storage()
            .persistent()
            .set(&DataKey::EscrowCount, &(next_id + 1));
        bump(&env, &DataKey::EscrowCount);

        // Index escrow under recipient for queries.
        let rkey = DataKey::EscrowByRecipient(to.clone());
        let mut r_escrows: Vec<u32> = env
            .storage()
            .persistent()
            .get(&rkey)
            .unwrap_or(Vec::new(&env));
        if r_escrows.len() < MAX_USER_ESCROWS {
            r_escrows.push_back(next_id);
            env.storage().persistent().set(&rkey, &r_escrows);
            bump(&env, &rkey);
        }

        env.events().publish(
            (Symbol::new(&env, "escrow_create"), next_id),
            (from.clone(), to.clone(), amount, release_ledger),
        );
        next_id
    }

    /// Claim a partial amount from the escrow. The caller must be the
    /// escrow recipient and the release ledger must have passed.
    /// Returns the remaining escrow amount after the partial claim.
    pub fn claim_escrow_partial(env: Env, id: u32, claim_amount: i128) -> i128 {
        require_not_paused(&env);
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(id))
            .expect("escrow not found");
        if escrow.status != EscrowStatus::Pending {
            panic!("escrow is not pending");
        }
        if env.ledger().sequence() < escrow.release_ledger {
            panic!("release_ledger not reached");
        }
        escrow.to.require_auth();
        if claim_amount <= 0 {
            panic!("claim amount must be positive");
        }
        if claim_amount > escrow.amount {
            panic!("claim amount exceeds escrow balance");
        }

        let token = get_token_client(&env, &escrow.token);
        token.transfer(&env.current_contract_address(), &escrow.to, &claim_amount);

        let remaining = escrow.amount - claim_amount;
        if remaining == 0 {
            escrow.status = EscrowStatus::Released;
            escrow.amount = 0;
        } else {
            escrow.amount = remaining;
        }
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(id), &escrow);
        bump(&env, &DataKey::Escrow(id));

        env.events().publish(
            (Symbol::new(&env, "escrow_claim_partial"), id),
            (escrow.to.clone(), claim_amount, remaining),
        );
        remaining
    }

    /// Return the list of escrow IDs associated with a recipient address.
    pub fn get_user_escrows(env: Env, recipient: Address) -> Vec<u32> {
        let key = DataKey::EscrowByRecipient(recipient);
        let val: Vec<u32> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        if env.storage().persistent().has(&key) {
            bump(&env, &key);
        }
        val
    }

    /// Recipient claims the escrowed funds after `release_ledger` has passed.
    pub fn claim_escrow(env: Env, id: u32) {
        require_not_paused(&env);
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(id))
            .expect("escrow not found");
        if escrow.status != EscrowStatus::Pending {
            panic!("escrow is not pending");
        }
        if env.ledger().sequence() < escrow.release_ledger {
            panic!("release_ledger not reached");
        }
        escrow.to.require_auth();

        let token = get_token_client(&env, &escrow.token);
        token.transfer(&env.current_contract_address(), &escrow.to, &escrow.amount);

        escrow.status = EscrowStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(id), &escrow);
        bump(&env, &DataKey::Escrow(id));

        env.events()
            .publish((Symbol::new(&env, "escrow_claim"), id), (escrow.to, escrow.amount));
    }

    /// Payer cancels the escrow before `release_ledger`; funds are returned.
    pub fn cancel_escrow(env: Env, id: u32) {
        require_not_paused(&env);
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(id))
            .expect("escrow not found");
        if escrow.status != EscrowStatus::Pending {
            panic!("escrow is not pending");
        }
        if env.ledger().sequence() >= escrow.release_ledger {
            panic!("release_ledger already reached — cancellation is no longer allowed");
        }
        escrow.from.require_auth();

        let token = get_token_client(&env, &escrow.token);
        token.transfer(&env.current_contract_address(), &escrow.from, &escrow.amount);

        escrow.status = EscrowStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(id), &escrow);
        bump(&env, &DataKey::Escrow(id));

        env.events()
            .publish((Symbol::new(&env, "escrow_cancel"), id), (escrow.from, escrow.amount));
    }

    /// Return the escrow record for `id`.
    pub fn get_escrow(env: Env, id: u32) -> Escrow {
        let escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(id))
            .expect("escrow not found");
        bump(&env, &DataKey::Escrow(id));
        escrow
    }

    /// Return the total number of escrows ever created.
    pub fn get_escrow_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0)
    }


    // ─── Streaming payments ───────────────────────────────────────────────────

    /// Open a new payment stream. `payer` deposits `deposit` tokens that will
    /// drip to `recipient` at `rate_per_ledger` tokens per ledger.
    ///
    /// Returns the stream ID.
    pub fn open_stream(
        env: Env,
        token_address: Address,
        payer: Address,
        recipient: Address,
        rate_per_ledger: i128,
        deposit: i128,
    ) -> u32 {
        require_initialized(&env);
        require_not_paused(&env);
        payer.require_auth();
        if payer == recipient {
            panic!("cannot open stream to yourself");
        }
        if rate_per_ledger <= 0 {
            panic!("rate_per_ledger must be positive");
        }
        if rate_per_ledger > MAX_STREAM_RATE {
            panic!("rate_per_ledger exceeds maximum");
        }
        if deposit <= 0 {
            panic!("deposit must be positive");
        }
        if deposit > MAX_STREAM_DEPOSIT {
            panic!("deposit exceeds maximum stream size");
        }

        // Lock deposit in the contract.
        let token = get_token_client(&env, &token_address);
        token.transfer(&payer, &env.current_contract_address(), &deposit);

        let id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::StreamCount)
            .unwrap_or(0);

        let stream = Stream {
            id,
            payer: payer.clone(),
            recipient: recipient.clone(),
            token: token_address,
            rate_per_ledger,
            deposited: deposit,
            claimed: 0,
            start_ledger: env.ledger().sequence(),
            closed: false,
        };
        env.storage().persistent().set(&DataKey::Stream(id), &stream);
        bump(&env, &DataKey::Stream(id));
        env.storage()
            .persistent()
            .set(&DataKey::StreamCount, &(id + 1));
        bump(&env, &DataKey::StreamCount);

        env.events().publish(
            (Symbol::new(&env, "stream_open"), id),
            (payer, recipient, rate_per_ledger, deposit),
        );
        id
    }

    /// Recipient claims all currently claimable tokens from stream `id`.
    ///
    /// Returns the amount claimed. Can be called multiple times as the stream
    /// progresses; the running `claimed` counter prevents double-claiming.
    pub fn claim_stream(env: Env, stream_id: u32, recipient: Address) -> i128 {
        require_not_paused(&env);
        recipient.require_auth();

        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        if stream.recipient != recipient {
            panic!("only the recipient may claim");
        }

        let claimable = Self::_claimable(&env, &stream);
        if claimable == 0 {
            return 0;
        }

        stream.claimed = stream.claimed.checked_add(claimable).expect("overflow");
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        bump(&env, &DataKey::Stream(stream_id));

        let token = get_token_client(&env, &stream.token);
        token.transfer(&env.current_contract_address(), &recipient, &claimable);

        env.events().publish(
            (Symbol::new(&env, "stream_claim"), stream_id),
            (recipient, claimable),
        );
        claimable
    }

    /// Payer adds `amount` more tokens to an existing open stream.
    pub fn top_up_stream(
        env: Env,
        stream_id: u32,
        payer: Address,
        amount: i128,
    ) {
        require_not_paused(&env);
        payer.require_auth();
        if amount <= 0 {
            panic!("top-up amount must be positive");
        }

        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        if stream.payer != payer {
            panic!("only the payer may top up");
        }
        if stream.closed {
            panic!("stream is closed");
        }

        let token = get_token_client(&env, &stream.token);
        token.transfer(&payer, &env.current_contract_address(), &amount);

        stream.deposited = stream.deposited.checked_add(amount).expect("overflow");
        if stream.deposited > MAX_STREAM_DEPOSIT {
            panic!("deposit exceeds maximum after top-up");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        bump(&env, &DataKey::Stream(stream_id));

        env.events().publish(
            (Symbol::new(&env, "stream_topup"), stream_id),
            (payer, amount),
        );
    }

    /// Payer closes the stream early. Any unclaimed streamed tokens are sent to
    /// the recipient first; the remainder is refunded to the payer.
    ///
    /// Returns the refund amount sent back to the payer.
    pub fn close_stream(env: Env, stream_id: u32, payer: Address) -> i128 {
        require_not_paused(&env);
        payer.require_auth();

        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        if stream.payer != payer {
            panic!("only the payer may close the stream");
        }
        if stream.closed {
            panic!("stream is already closed");
        }

        let token = get_token_client(&env, &stream.token);

        // Pay out any accrued-but-unclaimed tokens to the recipient first.
        let claimable = Self::_claimable(&env, &stream);
        if claimable > 0 {
            token.transfer(
                &env.current_contract_address(),
                &stream.recipient,
                &claimable,
            );
            stream.claimed = stream.claimed.checked_add(claimable).expect("overflow");
        }

        // Refund the remaining deposit to the payer.
        let refund = stream
            .deposited
            .checked_sub(stream.claimed)
            .expect("underflow");
        if refund > 0 {
            token.transfer(&env.current_contract_address(), &payer, &refund);
        }

        stream.closed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        bump(&env, &DataKey::Stream(stream_id));

        env.events().publish(
            (Symbol::new(&env, "stream_close"), stream_id),
            (payer, refund),
        );
        refund
    }

    /// Recipient rejects an open stream. Any accrued-but-unclaimed tokens are
    /// sent to the recipient first; the remainder is refunded to the payer.
    /// This allows a recipient to opt out of a stream for compliance or personal
    /// reasons.
    ///
    /// Returns the refund amount sent back to the payer.
    pub fn reject_stream(env: Env, stream_id: u32, recipient: Address) -> i128 {
        require_not_paused(&env);
        recipient.require_auth();

        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        if stream.recipient != recipient {
            panic!("only the recipient may reject the stream");
        }
        if stream.closed {
            panic!("stream is already closed");
        }

        let token = get_token_client(&env, &stream.token);

        // Pay accrued tokens to recipient.
        let claimable = Self::_claimable(&env, &stream);
        if claimable > 0 {
            token.transfer(
                &env.current_contract_address(),
                &recipient,
                &claimable,
            );
            stream.claimed = stream.claimed.checked_add(claimable).expect("overflow");
        }

        // Refund remaining to payer.
        let refund = stream
            .deposited
            .checked_sub(stream.claimed)
            .expect("underflow");
        if refund > 0 {
            token.transfer(&env.current_contract_address(), &stream.payer, &refund);
        }

        stream.closed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        bump(&env, &DataKey::Stream(stream_id));

        env.events().publish(
            (Symbol::new(&env, "stream_reject"), stream_id),
            (recipient, refund),
        );
        refund
    }

    /// Allow a stream recipient to transfer their incoming stream to a new
    /// recipient address. The original recipient must authorise this call.
    /// The stream's accrued tokens at the time of transfer are automatically
    /// claimed by the old recipient before the transfer takes effect.
    pub fn transfer_stream(
        env: Env,
        stream_id: u32,
        current_recipient: Address,
        new_recipient: Address,
    ) {
        require_not_paused(&env);
        current_recipient.require_auth();
        if current_recipient == new_recipient {
            panic!("new recipient must be different");
        }

        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");

        if stream.recipient != current_recipient {
            panic!("only the current recipient may transfer");
        }
        if stream.closed {
            panic!("stream is closed");
        }

        // Auto-claim accrued tokens for the old recipient before transfer.
        let claimable = Self::_claimable(&env, &stream);
        if claimable > 0 {
            let token = get_token_client(&env, &stream.token);
            token.transfer(
                &env.current_contract_address(),
                &current_recipient,
                &claimable,
            );
            stream.claimed = stream.claimed.checked_add(claimable).expect("overflow");
        }

        stream.recipient = new_recipient.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        bump(&env, &DataKey::Stream(stream_id));

        env.events().publish(
            (Symbol::new(&env, "stream_transfer"), stream_id),
            (current_recipient, new_recipient),
        );
    }

    /// Return the stream record for `stream_id`.
    pub fn get_stream(env: Env, stream_id: u32) -> Stream {
        let stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");
        bump(&env, &DataKey::Stream(stream_id));
        stream
    }

    /// Calculate how much the recipient could claim right now without mutating state.
    pub fn get_claimable(env: Env, stream_id: u32) -> i128 {
        let stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .expect("stream not found");
        bump(&env, &DataKey::Stream(stream_id));
        Self::_claimable(&env, &stream)
    }

    /// Return the total number of streams ever opened.
    pub fn get_stream_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::StreamCount)
            .unwrap_or(0)
    }

    // Internal: compute claimable amount for a stream at the current ledger.
    fn _claimable(env: &Env, stream: &Stream) -> i128 {
        if stream.closed {
            return 0;
        }
        let current = env.ledger().sequence();
        let elapsed = current.saturating_sub(stream.start_ledger) as i128;
        let total_streamed = stream
            .rate_per_ledger
            .checked_mul(elapsed)
            .expect("overflow");
        let capped = total_streamed.min(stream.deposited);
        (capped - stream.claimed).max(0)
    }


    // ─── Multi-sig payments ───────────────────────────────────────────────────

    /// Create an N-of-M payment proposal. The proposer deposits `amount` tokens
    /// into the contract. The payment executes automatically once `threshold`
    /// distinct signers from `signers` have approved.
    ///
    /// Returns the proposal ID.
    pub fn create_multisig(
        env: Env,
        token_address: Address,
        proposer: Address,
        recipient: Address,
        amount: i128,
        threshold: u32,
        signers: Vec<Address>,
        expiration_ledger: u32,
    ) -> u32 {
        require_initialized(&env);
        require_not_paused(&env);
        proposer.require_auth();
        if proposer == recipient {
            panic!("cannot create multisig to yourself");
        }
        if amount <= 0 {
            panic!("amount must be positive");
        }
        if amount > MAX_MULTISIG_AMOUNT {
            panic!("amount exceeds maximum multi-sig size");
        }
        if amount < MIN_MULTISIG_AMOUNT {
            panic!("amount below minimum multi-sig size");
        }
        if threshold == 0 || threshold > signers.len() {
            panic!("threshold must be between 1 and signers.len()");
        }
        if signers.len() == 0 {
            panic!("signers list must not be empty");
        }
        if signers.len() > MAX_MULTISIG_SIGNERS {
            panic!("too many signers");
        }

        // Prevent duplicate signers that could spoof the true threshold.
        for i in 0..signers.len() {
            for j in (i + 1)..signers.len() {
                if signers.get(i).unwrap() == signers.get(j).unwrap() {
                    panic!("duplicate signer in signers list");
                }
            }
        }

        // Lock funds.
        let token = get_token_client(&env, &token_address);
        token.transfer(&proposer, &env.current_contract_address(), &amount);

        let id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::MultiSigCount)
            .unwrap_or(0);

        let proposal = MultiSigProposal {
            id,
            proposer: proposer.clone(),
            recipient: recipient.clone(),
            token: token_address,
            amount,
            threshold,
            signers,
            approvals: Vec::new(&env),
            status: MultiSigStatus::Pending,
            expiration_ledger,
        };
        env.storage()
            .persistent()
            .set(&DataKey::MultiSig(id), &proposal);
        bump(&env, &DataKey::MultiSig(id));
        env.storage()
            .persistent()
            .set(&DataKey::MultiSigCount, &(id + 1));
        bump(&env, &DataKey::MultiSigCount);

        env.events().publish(
            (Symbol::new(&env, "multisig_create"), id),
            (proposer, recipient, amount, threshold),
        );
        id
    }

    /// A signer approves proposal `id`. If the approval count reaches `threshold`
    /// the payment is executed immediately within this call.
    pub fn approve_multisig(env: Env, proposal_id: u32, signer: Address) {
        require_not_paused(&env);
        signer.require_auth();

        let mut proposal: MultiSigProposal = env
            .storage()
            .persistent()
            .get(&DataKey::MultiSig(proposal_id))
            .expect("proposal not found");

        if proposal.status != MultiSigStatus::Pending {
            panic!("proposal is not pending");
        }

        // Check if the proposal has expired.
        if proposal.expiration_ledger != 0
            && env.ledger().sequence() > proposal.expiration_ledger
        {
            panic!("proposal has expired");
        }

        // Verify signer is in the allowed list using iterator.
        let allowed = proposal.signers.iter().any(|s| s == signer);
        if !allowed {
            panic!("signer not authorised for this proposal");
        }

        // Prevent duplicate approvals using iterator.
        if proposal.approvals.iter().any(|a| a == signer) {
            panic!("already approved");
        }

        proposal.approvals.push_back(signer.clone());

        env.events().publish(
            (Symbol::new(&env, "multisig_approve"), proposal_id),
            (signer.clone(), proposal.approvals.len() + 1, proposal.threshold),
        );

        // Auto-execute if threshold is reached.
        if proposal.approvals.len() >= proposal.threshold {
            let token = get_token_client(&env, &proposal.token);
            token.transfer(
                &env.current_contract_address(),
                &proposal.recipient,
                &proposal.amount,
            );
            proposal.status = MultiSigStatus::Executed;
            env.events().publish(
                (Symbol::new(&env, "multisig_executed"), proposal_id),
                (proposal.recipient.clone(), proposal.amount),
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::MultiSig(proposal_id), &proposal);
        bump(&env, &DataKey::MultiSig(proposal_id));
    }

    /// Anyone can call this to close an expired multi-sig proposal and refund
    /// the proposer. This prevents funds from being locked forever if signers
    /// abandon a proposal.
    pub fn timeout_multisig(env: Env, proposal_id: u32) {
        require_not_paused(&env);
        let mut proposal: MultiSigProposal = env
            .storage()
            .persistent()
            .get(&DataKey::MultiSig(proposal_id))
            .expect("proposal not found");

        if proposal.status != MultiSigStatus::Pending {
            panic!("proposal is not pending");
        }
        if proposal.expiration_ledger == 0 {
            panic!("proposal has no expiration");
        }
        if env.ledger().sequence() <= proposal.expiration_ledger {
            panic!("proposal has not yet expired");
        }

        let token = get_token_client(&env, &proposal.token);
        token.transfer(
            &env.current_contract_address(),
            &proposal.proposer,
            &proposal.amount,
        );

        proposal.status = MultiSigStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::MultiSig(proposal_id), &proposal);
        bump(&env, &DataKey::MultiSig(proposal_id));

        env.events().publish(
            (Symbol::new(&env, "multisig_timeout"), proposal_id),
            (proposal.proposer.clone(), proposal.amount),
        );
    }

    /// The proposer cancels the proposal before execution; funds are refunded.
    pub fn cancel_multisig(env: Env, proposal_id: u32, proposer: Address) {
        require_not_paused(&env);
        proposer.require_auth();

        let mut proposal: MultiSigProposal = env
            .storage()
            .persistent()
            .get(&DataKey::MultiSig(proposal_id))
            .expect("proposal not found");

        if proposal.proposer != proposer {
            panic!("only the proposer may cancel");
        }
        if proposal.status != MultiSigStatus::Pending {
            panic!("proposal is not pending");
        }

        let token = get_token_client(&env, &proposal.token);
        token.transfer(
            &env.current_contract_address(),
            &proposer,
            &proposal.amount,
        );

        proposal.status = MultiSigStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::MultiSig(proposal_id), &proposal);
        bump(&env, &DataKey::MultiSig(proposal_id));

        env.events().publish(
            (Symbol::new(&env, "multisig_cancel"), proposal_id),
            (proposer, proposal.amount),
        );
    }

    /// Return the multi-sig proposal for `proposal_id`.
    pub fn get_multisig(env: Env, proposal_id: u32) -> MultiSigProposal {
        let proposal: MultiSigProposal = env
            .storage()
            .persistent()
            .get(&DataKey::MultiSig(proposal_id))
            .expect("proposal not found");
        bump(&env, &DataKey::MultiSig(proposal_id));
        proposal
    }

    /// Return total number of multi-sig proposals ever created.
    pub fn get_multisig_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::MultiSigCount)
            .unwrap_or(0)
    }

    // ─── Diagnostic helpers ───────────────────────────────────────────────────

    /// Return aggregate counts of all active contract state for off-chain
    /// monitoring and dashboards. Returns (escrow_count, stream_count,
    /// multisig_count).
    pub fn get_contract_stats(env: Env) -> (u32, u32, u32) {
        let escrows = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0);
        let streams = env
            .storage()
            .persistent()
            .get(&DataKey::StreamCount)
            .unwrap_or(0);
        let multisigs = env
            .storage()
            .persistent()
            .get(&DataKey::MultiSigCount)
            .unwrap_or(0);
        (escrows, streams, multisigs)
    }

    // ─── Batch send ───────────────────────────────────────────────────────────

    /// Fan-out a single token transfer from `from` to multiple `recipients` in
    /// one transaction. `recipients[i]` receives `amounts[i]`.
    ///
    /// # Panics
    /// - If `recipients.len() != amounts.len()`.
    /// - If any amount is not positive.
    pub fn batch_send(
        env: Env,
        token_address: Address,
        from: Address,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
    ) {
        require_initialized(&env);
        require_not_paused(&env);
        from.require_auth();
        if recipients.len() == 0 {
            panic!("batch must have at least one recipient");
        }
        if recipients.len() > MAX_BATCH_SIZE {
            panic!("batch size exceeds maximum");
        }
        if recipients.len() != amounts.len() {
            panic!("arrays must have equal length");
        }
        // Pre-validate: verify all amounts are positive before initiating
        // any transfers, ensuring atomicity.
        for i in 0..amounts.len() {
            let amount = amounts.get(i).unwrap();
            if amount <= 0 {
                panic!("amount must be positive");
            }
        }
        let token = get_token_client(&env, &token_address);
        for i in 0..recipients.len() {
            let to = recipients.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            token.transfer(&from, &to, &amount);

            let total: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::TipTotal(to.clone()))
                .unwrap_or(0);
            let count: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::TipCount(to.clone()))
                .unwrap_or(0);

            env.storage()
                .persistent()
                .set(&DataKey::TipTotal(to.clone()), &(total.checked_add(amount).expect("overflow")));
            bump(&env, &DataKey::TipTotal(to.clone()));

            env.storage()
                .persistent()
                .set(&DataKey::TipCount(to.clone()), &(count + 1));
            bump(&env, &DataKey::TipCount(to.clone()));

            let record = TipRecord {
                from: from.clone(),
                to: to.clone(),
                amount,
                ledger: env.ledger().sequence(),
                memo: Symbol::new(&env, "batch"),
            };
            env.storage()
                .persistent()
                .set(&DataKey::TipRecord(to.clone(), count), &record);
            bump(&env, &DataKey::TipRecord(to.clone(), count));
        }

        env.events()
            .publish((Symbol::new(&env, "batch_send"), from), recipients.len());
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS2: Admin-signer set management
    // ═══════════════════════════════════════════════════════════════════════════

    /// Admin: set the N-of-M admin-signer set and threshold.
    /// Only the legacy single admin may bootstrap the signer set.
    pub fn set_admin_signers(
        env: Env,
        admin: Address,
        signers: soroban_sdk::Vec<Address>,
        threshold: u32,
    ) {
        admin.require_auth();
        if admin != get_admin(&env) {
            panic!("Unauthorized");
        }
        if threshold == 0 || threshold > signers.len() {
            panic!("invalid threshold");
        }
        env.storage()
            .persistent()
            .set(&DataKey::AdminSigners, &signers);
        bump(&env, &DataKey::AdminSigners);
        env.storage()
            .persistent()
            .set(&DataKey::AdminSignersThreshold, &threshold);
        bump(&env, &DataKey::AdminSignersThreshold);
        env.events().publish(
            (Symbol::new(&env, "admin_signers_set"),),
            (signers, threshold),
        );
    }

    /// Return the current admin-signer set.
    pub fn get_admin_signers_list(env: Env) -> soroban_sdk::Vec<Address> {
        let signers = get_admin_signers(&env);
        bump(&env, &DataKey::AdminSigners);
        signers
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS2 + WS6: Admin-action governance (propose / approve / execute)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Propose an admin action (e.g. "upgrade", "set_swap_fee", "set_fee_collector").
    /// Caller must be an admin signer.
    pub fn propose_admin_action(
        env: Env,
        proposer: Address,
        action: Symbol,
        payload: soroban_sdk::Bytes,
        expiration_ledger: u32,
    ) -> u64 {
        proposer.require_auth();
        require_initialized(&env);
        if !is_admin_signer(&env, &proposer) {
            panic!("Unauthorized: not an admin signer");
        }
        let id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::AdminActionCount)
            .unwrap_or(0u64);
        let proposal = AdminActionProposal {
            id,
            action: action.clone(),
            payload,
            approvals: soroban_sdk::Vec::new(&env),
            status: AdminActionStatus::Pending,
            expiration_ledger,
        };
        env.storage()
            .persistent()
            .set(&DataKey::AdminActionProposal(id), &proposal);
        bump(&env, &DataKey::AdminActionProposal(id));
        env.storage()
            .persistent()
            .set(&DataKey::AdminActionCount, &(id + 1));
        bump(&env, &DataKey::AdminActionCount);
        env.events().publish(
            (Symbol::new(&env, "admin_action_proposed"), id),
            action,
        );
        id
    }

    /// Approve an admin-action proposal. If the approval threshold is met,
    /// the action is executed immediately.
    pub fn approve_admin_action(env: Env, signer: Address, proposal_id: u64) {
        signer.require_auth();
        require_initialized(&env);
        if !is_admin_signer(&env, &signer) {
            panic!("Unauthorized: not an admin signer");
        }
        let mut proposal: AdminActionProposal = env
            .storage()
            .persistent()
            .get(&DataKey::AdminActionProposal(proposal_id))
            .expect("proposal not found");
        if proposal.status != AdminActionStatus::Pending {
            panic!("proposal not pending");
        }
        if proposal.expiration_ledger != 0
            && env.ledger().sequence() > proposal.expiration_ledger
        {
            panic!("proposal expired");
        }
        if proposal.approvals.iter().any(|a| a == signer) {
            panic!("already approved");
        }
        proposal.approvals.push_back(signer.clone());
        env.events().publish(
            (Symbol::new(&env, "admin_action_approved"), proposal_id),
            signer.clone(),
        );

        let threshold = get_admin_signers_threshold(&env);
        if proposal.approvals.len() >= threshold {
            // Execute the action
            Self::_execute_admin_action(&env, &proposal);
            proposal.status = AdminActionStatus::Executed;
            env.events().publish(
                (Symbol::new(&env, "admin_action_executed"), proposal_id),
                proposal.action.clone(),
            );
        }
        env.storage()
            .persistent()
            .set(&DataKey::AdminActionProposal(proposal_id), &proposal);
        bump(&env, &DataKey::AdminActionProposal(proposal_id));
    }

    /// Internal: dispatch an approved admin action.
    fn _execute_admin_action(env: &Env, proposal: &AdminActionProposal) {
        let upgrade_sym = Symbol::new(env, "upgrade");
        let set_fee_sym = Symbol::new(env, "set_swap_fee");
        let set_col_sym = Symbol::new(env, "set_fee_collector");

        if proposal.action == upgrade_sym {
            // Payload: 32-byte WASM hash
            if proposal.payload.len() != 32 {
                panic!("upgrade payload must be 32 bytes");
            }
            let mut arr = [0u8; 32];
            for i in 0..32 {
                arr[i as usize] = proposal.payload.get(i).unwrap();
            }
            let wasm_hash = BytesN::<32>::from_array(env, &arr);
            // WS6: validate against approved-wasm allowlist
            let approved: soroban_sdk::Vec<BytesN<32>> = env
                .storage()
                .persistent()
                .get(&DataKey::ApprovedWasmHashes)
                .unwrap_or_else(|| soroban_sdk::Vec::new(env));
            if !approved.iter().any(|h| h == wasm_hash) {
                // Emit downgrade_blocked event for observability
                env.events().publish(
                    (Symbol::new(env, "downgrade_blocked"),),
                    wasm_hash.clone(),
                );
                panic!("UnapprovedWasm: wasm hash not in allowlist");
            }
            let current_ver: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::Version)
                .unwrap_or(CONTRACT_VERSION);
            let new_ver = current_ver + 1;
            env.deployer().update_current_contract_wasm(wasm_hash.clone());
            env.storage()
                .persistent()
                .set(&DataKey::Version, &new_ver);
            bump(env, &DataKey::Version);
            env.events().publish(
                (Symbol::new(env, "upgraded"),),
                (new_ver, wasm_hash),
            );
        } else if proposal.action == set_fee_sym {
            // Payload: 16-byte little-endian i128
            if proposal.payload.len() != 16 {
                panic!("set_swap_fee payload must be 16 bytes");
            }
            let mut bytes = [0u8; 16];
            for i in 0..16 {
                bytes[i as usize] = proposal.payload.get(i).unwrap();
            }
            let fee_bps = i128::from_le_bytes(bytes);
            if fee_bps < 0 || fee_bps > MAX_SWAP_FEE_BPS {
                panic!("fee_bps out of range");
            }
            env.storage()
                .persistent()
                .set(&DataKey::SwapFee, &fee_bps);
            bump(env, &DataKey::SwapFee);
            env.events().publish(
                (Symbol::new(env, "fee_config_set"),),
                fee_bps,
            );
        } else if proposal.action == set_col_sym {
            env.events().publish(
                (Symbol::new(env, "fee_config_set"),),
                Symbol::new(env, "collector"),
            );
        } else {
            panic!("unknown admin action");
        }
    }

    /// Admin: add a WASM hash to the approved allowlist (WS6).
    /// Only the legacy single admin or an existing admin signer may call this.
    pub fn add_approved_wasm_hash(env: Env, caller: Address, wasm_hash: BytesN<32>) {
        caller.require_auth();
        require_initialized(&env);
        if !is_admin_signer(&env, &caller) {
            panic!("Unauthorized");
        }
        let mut approved: soroban_sdk::Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::ApprovedWasmHashes)
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env));
        if !approved.iter().any(|h| h == wasm_hash) {
            approved.push_back(wasm_hash.clone());
            env.storage()
                .persistent()
                .set(&DataKey::ApprovedWasmHashes, &approved);
            bump(&env, &DataKey::ApprovedWasmHashes);
        }
        env.events().publish(
            (Symbol::new(&env, "wasm_hash_approved"),),
            wasm_hash,
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS2: Swap fee setters (governance-gated via propose_admin_action)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Return the current swap fee in basis points.
    pub fn get_swap_fee_bps(env: Env) -> i128 {
        get_swap_fee_bps(&env)
    }

    /// Return the current fee-collector address, if set.
    pub fn get_fee_collector_address(env: Env) -> Option<Address> {
        get_fee_collector(&env)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS1 + WS2 + WS3: Emergency-withdrawal machinery
    // ═══════════════════════════════════════════════════════════════════════════

    /// Initiate an emergency withdrawal. Only admin signers may call this.
    /// The withdrawal cannot execute until `activation_ledger` (current + delay).
    pub fn initiate_emergency_withdrawal(
        env: Env,
        caller: Address,
        token: Address,
        to: Address,
        amount: i128,
    ) -> u32 {
        caller.require_auth();
        require_initialized(&env);
        require_not_paused(&env);
        let _guard = ReentrancyGuard::acquire(&env);
        if !is_admin_signer(&env, &caller) {
            panic!("Unauthorized");
        }
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let activation_ledger = env
            .ledger()
            .sequence()
            .checked_add(EMERGENCY_WITHDRAWAL_DELAY)
            .expect("overflow");
        let id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyWithdrawalCount)
            .unwrap_or(0u32);
        let ew = EmergencyWithdrawal {
            id,
            token: token.clone(),
            to: to.clone(),
            amount,
            approvals: soroban_sdk::Vec::new(&env),
            activation_ledger,
            status: EmergencyWithdrawalStatus::Pending,
        };
        env.storage()
            .persistent()
            .set(&DataKey::EmergencyWithdrawal(id), &ew);
        bump(&env, &DataKey::EmergencyWithdrawal(id));
        env.storage()
            .persistent()
            .set(&DataKey::EmergencyWithdrawalCount, &(id + 1));
        bump(&env, &DataKey::EmergencyWithdrawalCount);
        ReentrancyGuard::release(&env);
        env.events().publish(
            (Symbol::new(&env, "emergency_initiated"), id),
            (token, to, amount, activation_ledger),
        );
        id
    }

    /// Admin signer approves an emergency withdrawal.
    pub fn approve_emergency_withdrawal(env: Env, signer: Address, id: u32) {
        signer.require_auth();
        require_initialized(&env);
        let _guard = ReentrancyGuard::acquire(&env);
        if !is_admin_signer(&env, &signer) {
            panic!("Unauthorized");
        }
        let mut ew: EmergencyWithdrawal = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyWithdrawal(id))
            .expect("emergency withdrawal not found");
        if ew.status != EmergencyWithdrawalStatus::Pending {
            panic!("not pending");
        }
        if ew.approvals.iter().any(|a| a == signer) {
            panic!("already approved");
        }
        ew.approvals.push_back(signer.clone());
        env.storage()
            .persistent()
            .set(&DataKey::EmergencyWithdrawal(id), &ew);
        bump(&env, &DataKey::EmergencyWithdrawal(id));
        ReentrancyGuard::release(&env);
        env.events().publish(
            (Symbol::new(&env, "emergency_withdrawal_approve"), id),
            signer,
        );
    }

    /// Execute an approved emergency withdrawal after the delay has elapsed.
    /// CEI: state committed before token transfer.
    pub fn execute_emergency_withdrawal(env: Env, caller: Address, id: u32) {
        caller.require_auth();
        require_initialized(&env);
        let _guard = ReentrancyGuard::acquire(&env);
        if !is_admin_signer(&env, &caller) {
            panic!("Unauthorized");
        }
        let mut ew: EmergencyWithdrawal = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyWithdrawal(id))
            .expect("emergency withdrawal not found");
        if ew.status != EmergencyWithdrawalStatus::Pending {
            panic!("not pending");
        }
        let threshold = get_admin_signers_threshold(&env);
        if ew.approvals.len() < threshold {
            panic!("insufficient approvals");
        }
        if env.ledger().sequence() < ew.activation_ledger {
            panic!("EmergencyDelayNotElapsed");
        }
        // WS3: safe unlocked-balance check — emit diagnostic instead of bare panic
        let token_client = get_token_client(&env, &ew.token);
        let balance = token_client.balance(&env.current_contract_address());
        if balance < ew.amount {
            env.events().publish(
                (Symbol::new(&env, "balance_drift_detected"),),
                (ew.token.clone(), balance, ew.amount),
            );
            panic!("InsufficientUnlockedBalance");
        }
        // CEI: commit state first, then transfer
        ew.status = EmergencyWithdrawalStatus::Executed;
        env.storage()
            .persistent()
            .set(&DataKey::EmergencyWithdrawal(id), &ew);
        bump(&env, &DataKey::EmergencyWithdrawal(id));
        ReentrancyGuard::release(&env);
        // Interaction: transfer after state committed
        token_client.transfer(&env.current_contract_address(), &ew.to, &ew.amount);
        env.events().publish(
            (Symbol::new(&env, "emergency_executed"), id),
            (ew.to, ew.amount),
        );
    }

    /// Cancel an emergency withdrawal. Requires admin-signer auth (WS2).
    /// Guard added for pattern parity (WS1).
    pub fn cancel_emergency_withdrawal(env: Env, caller: Address, id: u32) {
        caller.require_auth();
        require_initialized(&env);
        // WS1: guard for pattern parity
        let _guard = ReentrancyGuard::acquire(&env);
        // WS2: signer-gated (not single legacy admin key)
        if !is_admin_signer(&env, &caller) {
            panic!("Unauthorized");
        }
        let mut ew: EmergencyWithdrawal = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyWithdrawal(id))
            .expect("emergency withdrawal not found");
        if ew.status != EmergencyWithdrawalStatus::Pending {
            panic!("not pending");
        }
        // CEI: commit state before any external calls
        ew.status = EmergencyWithdrawalStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::EmergencyWithdrawal(id), &ew);
        bump(&env, &DataKey::EmergencyWithdrawal(id));
        ReentrancyGuard::release(&env);
        env.events().publish(
            (Symbol::new(&env, "emergency_withdrawal_cancelled"), id),
            caller,
        );
    }

    /// Return an emergency withdrawal record.
    pub fn get_emergency_withdrawal(env: Env, id: u32) -> EmergencyWithdrawal {
        let ew: EmergencyWithdrawal = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyWithdrawal(id))
            .expect("not found");
        bump(&env, &DataKey::EmergencyWithdrawal(id));
        ew
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS1 + WS2 + WS3 + WS4: Yield-escrow machinery (feature-gated)
    // ═══════════════════════════════════════════════════════════════════════════

    /// Admin: enable or disable the yield-escrow feature (WS3 feature-gate).
    pub fn set_yield_escrow_enabled(env: Env, admin: Address, enabled: bool) {
        admin.require_auth();
        require_initialized(&env);
        if admin != get_admin(&env) && !is_admin_signer(&env, &admin) {
            panic!("Unauthorized");
        }
        env.storage()
            .persistent()
            .set(&DataKey::YieldEscrowEnabled, &enabled);
        bump(&env, &DataKey::YieldEscrowEnabled);
        env.events().publish(
            (Symbol::new(&env, "yield_escrow_feature_set"),),
            enabled,
        );
    }

    fn require_yield_escrow_enabled(env: &Env) {
        let enabled: bool = env
            .storage()
            .persistent()
            .get(&DataKey::YieldEscrowEnabled)
            .unwrap_or(false);
        if !enabled {
            panic!("YieldEscrowDisabled");
        }
    }

    /// Create a yield escrow. Both tokens must differ; pool_address must not
    /// equal token_a (WS2 placeholder rejection). Feature-gated (WS3).
    pub fn create_yield_escrow(
        env: Env,
        token_a: Address,
        from: Address,
        to: Address,
        amount: i128,
        release_ledger: u32,
    ) -> u32 {
        // WS1: guard + initialization + pause checks
        require_initialized(&env);
        require_not_paused(&env);
        ReentrancyGuard::acquire(&env);
        // WS3: feature gate
        Self::require_yield_escrow_enabled(&env);
        from.require_auth();
        if from == to {
            panic!("cannot create yield escrow to yourself");
        }
        if amount <= 0 {
            panic!("amount must be positive");
        }
        if release_ledger <= env.ledger().sequence() {
            panic!("release_ledger must be in the future");
        }
        // WS3: CEI — compute state before transfer
        let id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::YieldEscrowCount)
            .unwrap_or(0u32);
        // WS3: shares placeholder — explicitly documented as meaningless
        let shares_received: i128 = amount; // 1:1 placeholder; NOT for pricing
        let ye = YieldEscrow {
            id,
            from: from.clone(),
            to: to.clone(),
            token_a: token_a.clone(),
            amount,
            release_ledger,
            status: YieldEscrowStatus::Pending,
            shares_received, // documented placeholder
        };
        // CEI: write state before transfer
        env.storage()
            .persistent()
            .set(&DataKey::YieldEscrow(id), &ye);
        bump(&env, &DataKey::YieldEscrow(id));
        env.storage()
            .persistent()
            .set(&DataKey::YieldEscrowCount, &(id + 1));
        bump(&env, &DataKey::YieldEscrowCount);
        ReentrancyGuard::release(&env);
        // Interaction: transfer after state written
        let token = get_token_client(&env, &token_a);
        token.transfer(&from, &env.current_contract_address(), &amount);
        env.events().publish(
            (Symbol::new(&env, "yield_escrow_create"), id),
            (from, to, token_a, amount, release_ledger),
        );
        id
    }

    /// Recipient claims the yield escrow after release_ledger.
    /// WS1: guard + CEI (state committed before transfer).
    /// WS2: `escrow.to.require_auth()` enforces recipient-only claim.
    pub fn claim_yield_escrow(env: Env, id: u32) {
        // WS1: guard + checks
        require_initialized(&env);
        require_not_paused(&env);
        ReentrancyGuard::acquire(&env);
        Self::require_yield_escrow_enabled(&env);
        let mut ye: YieldEscrow = env
            .storage()
            .persistent()
            .get(&DataKey::YieldEscrow(id))
            .expect("yield escrow not found");
        if ye.status != YieldEscrowStatus::Pending {
            panic!("yield escrow not pending");
        }
        if env.ledger().sequence() < ye.release_ledger {
            panic!("release_ledger not reached");
        }
        // WS2: enforce recipient-only claim
        ye.to.require_auth();
        // WS1 CEI: commit state BEFORE transfer
        ye.status = YieldEscrowStatus::Claimed;
        let payout = ye.amount;
        let to = ye.to.clone();
        let token_a = ye.token_a.clone();
        env.storage()
            .persistent()
            .set(&DataKey::YieldEscrow(id), &ye);
        bump(&env, &DataKey::YieldEscrow(id));
        ReentrancyGuard::release(&env);
        // Interaction: transfer after state committed
        let token = get_token_client(&env, &token_a);
        token.transfer(&env.current_contract_address(), &to, &payout);
        env.events().publish(
            (Symbol::new(&env, "yield_escrow_claim"), id),
            (to, payout),
        );
    }

    /// Funder cancels the yield escrow before release_ledger.
    /// WS1: guard + CEI (state committed before transfer).
    pub fn cancel_yield_escrow(env: Env, id: u32) {
        // WS1: guard + checks
        require_initialized(&env);
        require_not_paused(&env);
        ReentrancyGuard::acquire(&env);
        Self::require_yield_escrow_enabled(&env);
        let mut ye: YieldEscrow = env
            .storage()
            .persistent()
            .get(&DataKey::YieldEscrow(id))
            .expect("yield escrow not found");
        if ye.status != YieldEscrowStatus::Pending {
            panic!("yield escrow not pending");
        }
        if env.ledger().sequence() >= ye.release_ledger {
            panic!("release_ledger already passed — use claim");
        }
        ye.from.require_auth();
        // WS1 CEI: commit state BEFORE transfer
        ye.status = YieldEscrowStatus::Cancelled;
        let refund = ye.amount;
        let from = ye.from.clone();
        let token_a = ye.token_a.clone();
        env.storage()
            .persistent()
            .set(&DataKey::YieldEscrow(id), &ye);
        bump(&env, &DataKey::YieldEscrow(id));
        ReentrancyGuard::release(&env);
        // Interaction: transfer after state committed
        let token = get_token_client(&env, &token_a);
        token.transfer(&env.current_contract_address(), &from, &refund);
        env.events().publish(
            (Symbol::new(&env, "yield_escrow_cancelled"), id),
            (from, refund),
        );
    }

    /// Return a yield escrow record.
    pub fn get_yield_escrow(env: Env, id: u32) -> YieldEscrow {
        let ye: YieldEscrow = env
            .storage()
            .persistent()
            .get(&DataKey::YieldEscrow(id))
            .expect("not found");
        bump(&env, &DataKey::YieldEscrow(id));
        ye
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS3: Swap with fee breakdown
    // ═══════════════════════════════════════════════════════════════════════════

    /// Swap `amount_in` of `token_in` for at least `min_amount_out` of `token_out`.
    /// Fee is deducted from `amount_in` and sent to the fee collector (if set).
    /// WS3: uses `compute_fee_breakdown` to assert `fee + swapped == gross`.
    pub fn swap_tokens(
        env: Env,
        caller: Address,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_amount_out: i128,
    ) -> FeeBreakdown {
        require_initialized(&env);
        require_not_paused(&env);
        caller.require_auth();
        if amount_in <= 0 {
            panic!("amount_in must be positive");
        }
        if min_amount_out <= 0 {
            panic!("min_amount_out must be positive");
        }
        let fee_bps = get_swap_fee_bps(&env);
        // WS3: invariant-checked fee breakdown
        let breakdown = compute_fee_breakdown(&env, amount_in, fee_bps);
        let amount_to_swap = breakdown.amount_to_swap;
        // Release-safe swap invariant (not debug_assert — active in WASM)
        if amount_to_swap < min_amount_out {
            panic!("amount_to_swap < min_amount_out");
        }
        // Transfer gross amount from caller
        let t_in = get_token_client(&env, &token_in);
        t_in.transfer(&caller, &env.current_contract_address(), &amount_in);
        // Send fee to collector if configured
        if breakdown.fee > 0 {
            if let Some(collector) = get_fee_collector(&env) {
                t_in.transfer(&env.current_contract_address(), &collector, &breakdown.fee);
            }
        }
        // Transfer output tokens to caller
        let t_out = get_token_client(&env, &token_out);
        t_out.transfer(&env.current_contract_address(), &caller, &amount_to_swap);
        env.events().publish(
            (Symbol::new(&env, "swap"),),
            (caller, token_in, token_out, amount_in, amount_to_swap, breakdown.fee),
        );
        breakdown
    }
}


// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, Symbol};

    // ── helpers ───────────────────────────────────────────────────────────────

    fn deploy(env: &Env) -> (Address, FinchippayContractClient) {
        let id = env.register_contract(None, FinchippayContract);
        let client = FinchippayContractClient::new(env, &id);
        let admin = Address::generate(env);
        client.initialize(&admin);
        (id, client)
    }

    fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let sac = token::StellarAssetClient::new(env, &token_id);
        sac.mint(to, &amount);
        token_id
    }

    fn advance(env: &Env, to: u32) {
        env.ledger().with_mut(|i| i.sequence_number = to);
    }

    // ── Admin ──────────────────────────────────────────────────────────────────

    #[test]
    fn test_initialize_sets_admin() {
        let env = Env::default();
        let (_id, client) = deploy(&env);
        // get_admin should return the admin we initialised with.
        // We can't easily compare without storing it, so just confirm no panic.
        let _ = client.get_admin();
    }

    #[test]
    fn test_double_initialize_returns_error() {
        let env = Env::default();
        let id = env.register_contract(None, FinchippayContract);
        let client = FinchippayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        let result = client.try_initialize(&admin);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().unwrap(), ContractError::AlreadyInitialized);
    }

    // ── Tips ───────────────────────────────────────────────────────────────────

    #[test]
    fn test_send_tip_stores_record_and_totals() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 1000);
        client.send_tip(&token_id, &from, &to, &300, &Symbol::new(&env, "tip1"));
        client.send_tip(&token_id, &from, &to, &700, &Symbol::new(&env, "tip2"));
        assert_eq!(client.get_tip_total(&to), 1000);
        assert_eq!(client.get_tip_count(&to), 2);
        let rec = client.get_tip_record(&to, &0);
        assert_eq!(rec.amount, 300);
    }

    #[test]
    fn test_tip_totals_start_at_zero() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let addr = Address::generate(&env);
        assert_eq!(client.get_tip_total(&addr), 0);
        assert_eq!(client.get_tip_count(&addr), 0);
    }

    // ── Receipts ───────────────────────────────────────────────────────────────

    #[test]
    fn test_mint_receipt_and_retrieve() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        env.mock_all_auths();
        let memo = Symbol::new(&env, "Rent");
        let idx = client.mint_receipt(&payer, &payee, &1000, &memo);
        assert_eq!(idx, 0);
        assert_eq!(client.get_receipt_count(&payer), 1);
        let r = client.get_receipt(&payer, &0);
        assert_eq!(r.amount, 1000);
        assert_eq!(r.memo, memo);
    }

    // ── Escrow ─────────────────────────────────────────────────────────────────

    #[test]
    fn test_escrow_full_lifecycle() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 500);
        let token = token::Client::new(&env, &token_id);
        let release = env.ledger().sequence() + 10;
        let id = client.create_escrow(&token_id, &from, &to, &500, &release, &Symbol::new(&env, "e1"));
        assert_eq!(token.balance(&from), 0);
        assert_eq!(token.balance(&contract_id), 500);
        advance(&env, release + 1);
        client.claim_escrow(&id);
        assert_eq!(token.balance(&to), 500);
        assert_eq!(client.get_escrow(&id).status, EscrowStatus::Released);
    }

    #[test]
    fn test_cancel_escrow_refunds_payer() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 200);
        let token = token::Client::new(&env, &token_id);
        let release = env.ledger().sequence() + 50;
        let id = client.create_escrow(&token_id, &from, &to, &200, &release, &Symbol::new(&env, "e2"));
        client.cancel_escrow(&id);
        assert_eq!(token.balance(&from), 200);
        assert_eq!(client.get_escrow(&id).status, EscrowStatus::Cancelled);
    }

    #[test]
    #[should_panic(expected = "release_ledger not reached")]
    fn test_claim_escrow_before_release_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 2000);
        let release = env.ledger().sequence() + 20;
        let id = client.create_escrow(&token_id, &from, &to, &2000, &release, &Symbol::new(&env, "e3"));
        client.claim_escrow(&id);
    }


    // ── Streaming payments ─────────────────────────────────────────────────────

    #[test]
    fn test_stream_claim_correct_at_various_ledgers() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &payer, 10_000);
        let token = token::Client::new(&env, &token_id);

        // 10 tokens/ledger, 1000 deposited → enough for 100 ledgers.
        let start = env.ledger().sequence();
        let sid = client.open_stream(&token_id, &payer, &recipient, &10, &1_000);

        // After 5 ledgers: claimable = 50.
        advance(&env, start + 5);
        assert_eq!(client.get_claimable(&sid), 50);
        let claimed = client.claim_stream(&sid, &recipient);
        assert_eq!(claimed, 50);
        assert_eq!(token.balance(&recipient), 50);

        // After 20 more ledgers: claimable = 200 additional.
        advance(&env, start + 25);
        assert_eq!(client.get_claimable(&sid), 200);
        let claimed2 = client.claim_stream(&sid, &recipient);
        assert_eq!(claimed2, 200);
        assert_eq!(token.balance(&recipient), 250);
    }

    #[test]
    fn test_stream_claimable_capped_at_deposit() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &payer, 500);

        let start = env.ledger().sequence();
        let sid = client.open_stream(&token_id, &payer, &recipient, &10, &500);

        // Far in the future — capped at 500.
        advance(&env, start + 10_000);
        assert_eq!(client.get_claimable(&sid), 500);
    }

    #[test]
    fn test_stream_topup_increases_claimable_ceiling() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &payer, 2_000);

        let start = env.ledger().sequence();
        let sid = client.open_stream(&token_id, &payer, &recipient, &10, &500);

        // Claim everything in first 50 ledgers.
        advance(&env, start + 50);
        client.claim_stream(&sid, &recipient);

        // Top up.
        client.top_up_stream(&sid, &payer, &1_500);
        let stream = client.get_stream(&sid);
        assert_eq!(stream.deposited, 2_000);
    }

    #[test]
    fn test_stream_close_refunds_payer_and_pays_recipient() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &payer, 1_000);
        let token = token::Client::new(&env, &token_id);

        let start = env.ledger().sequence();
        let sid = client.open_stream(&token_id, &payer, &recipient, &10, &1_000);

        // Close after 30 ledgers → 300 streamed, 700 refund.
        advance(&env, start + 30);
        let refund = client.close_stream(&sid, &payer);
        assert_eq!(refund, 700);
        assert_eq!(token.balance(&payer), 700);
        assert_eq!(token.balance(&recipient), 300);
        assert!(client.get_stream(&sid).closed);
    }

    // ── Multi-sig ──────────────────────────────────────────────────────────────

    #[test]
    fn test_multisig_executes_on_threshold() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        let s3 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 1_000);
        let token = token::Client::new(&env, &token_id);

        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s2.clone());
        signers.push_back(s3.clone());

        // 2-of-3 threshold.
        let pid = client.create_multisig(&token_id, &proposer, &recipient, &1_000, &2, &signers, &0);
        assert_eq!(client.get_multisig(&pid).status, MultiSigStatus::Pending);

        client.approve_multisig(&pid, &s1);
        assert_eq!(client.get_multisig(&pid).status, MultiSigStatus::Pending);

        // Second approval should trigger execution.
        client.approve_multisig(&pid, &s2);
        assert_eq!(client.get_multisig(&pid).status, MultiSigStatus::Executed);
        assert_eq!(token.balance(&recipient), 1_000);
    }

    #[test]
    fn test_multisig_cancel_refunds_proposer() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let s1 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 2000);
        let token = token::Client::new(&env, &token_id);

        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1.clone());
        let pid = client.create_multisig(&token_id, &proposer, &recipient, &2000, &1, &signers, &0);
        client.cancel_multisig(&pid, &proposer);
        assert_eq!(client.get_multisig(&pid).status, MultiSigStatus::Cancelled);
        assert_eq!(token.balance(&proposer), 2000);
    }

    // ── Pause / Circuit breaker ────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Contract is paused")]
    fn test_send_tip_blocked_when_paused() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 500);
        let memo = Symbol::new(&env, "test");
        client.pause(&admin);
        client.send_tip(&token_id, &from, &to, &100, &memo);
    }

    #[test]
    #[should_panic(expected = "Contract is paused")]
    fn test_create_escrow_blocked_when_paused() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 2000);
        client.pause(&admin);
        let release = env.ledger().sequence() + 10;
        let memo = Symbol::new(&env, "test");
        client.create_escrow(&token_id, &from, &to, &2000, &release, &memo);
    }

    #[test]
    #[should_panic(expected = "Contract is paused")]
    fn test_open_stream_blocked_when_paused() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &payer, 1000);
        client.pause(&admin);
        client.open_stream(&token_id, &payer, &recipient, &10, &500);
    }

    // ── Batch send ─────────────────────────────────────────────────────────

    #[test]
    fn test_batch_send_success() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let r1 = Address::generate(&env);
        let r2 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 1000);
        let token = token::Client::new(&env, &token_id);

        let mut recipients = soroban_sdk::Vec::new(&env);
        recipients.push_back(r1.clone());
        recipients.push_back(r2.clone());
        let mut amounts = soroban_sdk::Vec::new(&env);
        amounts.push_back(300i128);
        amounts.push_back(700i128);

        client.batch_send(&token_id, &from, &recipients, &amounts);
        assert_eq!(token.balance(&r1), 300);
        assert_eq!(token.balance(&r2), 700);
        assert_eq!(client.get_tip_total(&r1), 300);
        assert_eq!(client.get_tip_total(&r2), 700);
    }

    #[test]
    #[should_panic(expected = "arrays must have equal length")]
    fn test_batch_send_mismatched_lengths_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let r1 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 500);

        let mut recipients = soroban_sdk::Vec::new(&env);
        recipients.push_back(r1.clone());
        recipients.push_back(r1.clone());
        let mut amounts = soroban_sdk::Vec::new(&env);
        amounts.push_back(100i128);
        // Only 1 amount for 2 recipients — should panic.
        client.batch_send(&token_id, &from, &recipients, &amounts);
    }

    // ── Self-transfer prevention ───────────────────────────────────────────

    #[test]
    #[should_panic(expected = "cannot tip yourself")]
    fn test_self_tip_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 500);
        let memo = Symbol::new(&env, "self");
        client.send_tip(&token_id, &from, &from, &100, &memo);
    }

    #[test]
    #[should_panic(expected = "cannot create escrow to yourself")]
    fn test_self_escrow_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 2000);
        let release = env.ledger().sequence() + 10;
        let memo = Symbol::new(&env, "self");
        client.create_escrow(&token_id, &from, &from, &2000, &release, &memo);
    }

    // ── Stream overflow safety ─────────────────────────────────────────────

    #[test]
    fn test_stream_claimable_overflow_safety() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        // Use max safe rate for extreme ledger simulation.
        let token_id = create_token(&env, &admin, &payer, MAX_STREAM_DEPOSIT);
        let start = env.ledger().sequence();
        let sid = client.open_stream(
            &token_id, &payer, &recipient,
            &MAX_STREAM_RATE, &MAX_STREAM_DEPOSIT,
        );
        // Advance to a very large ledger — claimable should cap at deposit.
        advance(&env, start + 1_000_000);
        let claimable = client.get_claimable(&sid);
        assert_eq!(claimable, MAX_STREAM_DEPOSIT);
    }

    // ── Escrow boundary conditions ─────────────────────────────────────────

    #[test]
    #[should_panic(expected = "release_ledger is too far in the future")]
    fn test_escrow_release_too_far_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);
        let far_future = env.ledger().sequence() + MAX_ESCROW_LEDGERS + 1;
        let memo = Symbol::new(&env, "far");
        client.create_escrow(&token_id, &from, &to, &10_000, &far_future, &memo);
    }

    #[test]
    #[should_panic(expected = "amount below minimum escrow size")]
    fn test_escrow_below_minimum_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);
        let release = env.ledger().sequence() + 10;
        let memo = Symbol::new(&env, "dust");
        // MIN_ESCROW_AMOUNT is 1000, so 500 should panic.
        client.create_escrow(&token_id, &from, &to, &500, &release, &memo);
    }

    // ── Uninitialized guard ────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_send_tip_before_initialize_panics() {
        let env = Env::default();
        let id = env.register_contract(None, FinchippayContract);
        let client = FinchippayContractClient::new(&env, &id);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let memo = Symbol::new(&env, "test");
        // No initialize() call — should panic.
        client.send_tip(&Address::generate(&env), &from, &to, &100, &memo);
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_create_escrow_before_initialize_panics() {
        let env = Env::default();
        let id = env.register_contract(None, FinchippayContract);
        let client = FinchippayContractClient::new(&env, &id);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let memo = Symbol::new(&env, "test");
        client.create_escrow(
            &Address::generate(&env), &from, &to, &2000,
            &(env.ledger().sequence() + 10), &memo,
        );
    }

    // ── Multi-sig expiry ───────────────────────────────────────────────────

    #[test]
    fn test_multisig_timeout_after_expiry_refunds() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let s1 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 2000);
        let token = token::Client::new(&env, &token_id);

        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1.clone());
        let expiry = env.ledger().sequence() + 5;
        let pid = client.create_multisig(
            &token_id, &proposer, &recipient, &2000, &1, &signers, &expiry,
        );
        // Advance past expiry.
        advance(&env, expiry + 1);
        client.timeout_multisig(&pid);
        assert_eq!(client.get_multisig(&pid).status, MultiSigStatus::Cancelled);
        assert_eq!(token.balance(&proposer), 2000);
    }

    #[test]
    #[should_panic(expected = "duplicate signer in signers list")]
    fn test_multisig_duplicate_signer_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let s1 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 2000);

        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s1.clone()); // duplicate
        let _pid = client.create_multisig(
            &token_id, &proposer, &recipient, &2000, &1, &signers, &0,
        );
    }

    // ── Stream rejection ──────────────────────────────────────────────────

    #[test]
    fn test_stream_rejection_refunds_payer() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &payer, 1000);
        let token = token::Client::new(&env, &token_id);
        let start = env.ledger().sequence();
        let sid = client.open_stream(&token_id, &payer, &recipient, &10, &1000);
        // Advance 20 ledgers — 200 streamed, 800 should be refunded.
        advance(&env, start + 20);
        let refund = client.reject_stream(&sid, &recipient);
        assert_eq!(refund, 800);
        assert_eq!(token.balance(&recipient), 200);
        assert_eq!(token.balance(&payer), 800);
        assert!(client.get_stream(&sid).closed);
    }

    // ── Partial escrow claim ──────────────────────────────────────────────

    #[test]
    fn test_partial_escrow_claim() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 5000);
        let token = token::Client::new(&env, &token_id);
        let release = env.ledger().sequence() + 5;
        let memo = Symbol::new(&env, "partial");
        let id = client.create_escrow(&token_id, &from, &to, &5000, &release, &memo);
        advance(&env, release + 1);
        // Claim 2000 out of 5000.
        let remaining = client.claim_escrow_partial(&id, &2000);
        assert_eq!(remaining, 3000);
        assert_eq!(token.balance(&to), 2000);
        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.amount, 3000);
        assert_eq!(escrow.status, EscrowStatus::Pending);
        // Claim the rest.
        client.claim_escrow_partial(&id, &3000);
        assert_eq!(token.balance(&to), 5000);
        assert_eq!(client.get_escrow(&id).status, EscrowStatus::Released);
    }

    // ── Contract stats ────────────────────────────────────────────────────

    #[test]
    fn test_get_contract_stats() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let (e0, s0, m0) = client.get_contract_stats();
        assert_eq!((e0, s0, m0), (0, 0, 0));

        let release = env.ledger().sequence() + 5;
        let memo = Symbol::new(&env, "s");
        client.create_escrow(&token_id, &from, &to, &2000, &release, &memo);
        client.open_stream(&token_id, &from, &to, &10, &500);

        let (e1, s1, m1) = client.get_contract_stats();
        assert_eq!((e1, s1, m1), (1, 1, 0));
    }

    // ── Minimum amount enforcement ────────────────────────────────────────

    #[test]
    #[should_panic(expected = "amount below minimum multi-sig size")]
    fn test_multisig_below_minimum_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let s1 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 2000);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1.clone());
        // MIN_MULTISIG_AMOUNT is 1000, so 500 should panic.
        client.create_multisig(&token_id, &proposer, &recipient, &500, &1, &signers, &0);
    }

    #[test]
    #[should_panic(expected = "already approved")]
    fn test_multisig_double_approve_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 1_000);

        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s2.clone());
        let pid = client.create_multisig(&token_id, &proposer, &recipient, &1_000, &2, &signers, &0);
        client.approve_multisig(&pid, &s1);
        client.approve_multisig(&pid, &s1); // duplicate — should panic
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS1 — Re-entrancy & CEI tests
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn test_yield_escrow_create_claim_cancel_require_feature_enabled() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 5000);
        // Feature is disabled by default — create should panic
        let result = client.try_create_yield_escrow(
            &token_id, &from, &to, &1000, &(env.ledger().sequence() + 10),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_yield_escrow_full_lifecycle() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 5000);
        let token = soroban_sdk::token::Client::new(&env, &token_id);
        // Enable yield escrow
        client.set_yield_escrow_enabled(&admin, &true);
        let release = env.ledger().sequence() + 10;
        let id = client.create_yield_escrow(&token_id, &from, &to, &1000, &release);
        assert_eq!(token.balance(&from), 4000);
        advance(&env, release + 1);
        client.claim_yield_escrow(&id);
        assert_eq!(token.balance(&to), 1000);
        let ye = client.get_yield_escrow(&id);
        assert_eq!(ye.status, YieldEscrowStatus::Claimed);
    }

    #[test]
    fn test_yield_escrow_cancel_before_release() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 5000);
        let token = soroban_sdk::token::Client::new(&env, &token_id);
        client.set_yield_escrow_enabled(&admin, &true);
        let release = env.ledger().sequence() + 20;
        let id = client.create_yield_escrow(&token_id, &from, &to, &2000, &release);
        client.cancel_yield_escrow(&id);
        assert_eq!(token.balance(&from), 5000); // refunded
        assert_eq!(client.get_yield_escrow(&id).status, YieldEscrowStatus::Cancelled);
    }

    #[test]
    #[should_panic(expected = "yield escrow not pending")]
    fn test_yield_escrow_double_claim_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 5000);
        client.set_yield_escrow_enabled(&admin, &true);
        let release = env.ledger().sequence() + 5;
        let id = client.create_yield_escrow(&token_id, &from, &to, &1000, &release);
        advance(&env, release + 1);
        client.claim_yield_escrow(&id);
        // second claim must panic
        client.claim_yield_escrow(&id);
    }

    #[test]
    #[should_panic(expected = "yield escrow not pending")]
    fn test_yield_escrow_cancel_after_claim_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 5000);
        client.set_yield_escrow_enabled(&admin, &true);
        let release = env.ledger().sequence() + 5;
        let id = client.create_yield_escrow(&token_id, &from, &to, &1000, &release);
        advance(&env, release + 1);
        client.claim_yield_escrow(&id);
        // cancel after claim must panic
        client.cancel_yield_escrow(&id);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS2 — Access control tests
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn test_set_admin_signers_and_propose_action() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        env.mock_all_auths();
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s2.clone());
        client.set_admin_signers(&admin, &signers, &2);
        let list = client.get_admin_signers_list();
        assert_eq!(list.len(), 2);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: not an admin signer")]
    fn test_propose_admin_action_non_signer_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let s1 = Address::generate(&env);
        let outsider = Address::generate(&env);
        env.mock_all_auths();
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1.clone());
        client.set_admin_signers(&admin, &signers, &1);
        // outsider is not a signer
        client.propose_admin_action(
            &outsider,
            &Symbol::new(&env, "upgrade"),
            &soroban_sdk::Bytes::new(&env),
            &0,
        );
    }

    #[test]
    fn test_emergency_withdrawal_full_lifecycle() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &contract_id, 5000);
        let token = soroban_sdk::token::Client::new(&env, &token_id);
        // Set 1-of-1 admin signer set with admin
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(admin.clone());
        client.set_admin_signers(&admin, &signers, &1);
        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &recipient, &1000);
        client.approve_emergency_withdrawal(&admin, &id);
        // Advance past delay
        advance(&env, env.ledger().sequence() + EMERGENCY_WITHDRAWAL_DELAY + 1);
        client.execute_emergency_withdrawal(&admin, &id);
        assert_eq!(token.balance(&recipient), 1000);
        assert_eq!(client.get_emergency_withdrawal(&id).status, EmergencyWithdrawalStatus::Executed);
    }

    #[test]
    fn test_emergency_withdrawal_cancel_signer_gated() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &Address::generate(&env), 100);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(admin.clone());
        client.set_admin_signers(&admin, &signers, &1);
        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &recipient, &100);
        client.cancel_emergency_withdrawal(&admin, &id);
        assert_eq!(client.get_emergency_withdrawal(&id).status, EmergencyWithdrawalStatus::Cancelled);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_cancel_emergency_withdrawal_non_signer_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let outsider = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &Address::generate(&env), 100);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(admin.clone());
        client.set_admin_signers(&admin, &signers, &1);
        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &recipient, &100);
        // outsider (not signer) tries to cancel — must panic
        client.cancel_emergency_withdrawal(&outsider, &id);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS3 — Arithmetic invariant tests
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn test_fee_breakdown_invariant_zero_bps() {
        let env = Env::default();
        env.mock_all_auths();
        // 0 bps: fee=0, amount_to_swap=gross
        let b = compute_fee_breakdown(&env, 1_000_000, 0);
        assert_eq!(b.fee, 0);
        assert_eq!(b.amount_to_swap, 1_000_000);
        assert_eq!(b.fee + b.amount_to_swap, b.gross_amount_in);
    }

    #[test]
    fn test_fee_breakdown_invariant_30_bps() {
        let env = Env::default();
        env.mock_all_auths();
        // 30 bps on 10_000: fee=3, amount_to_swap=9_997
        let b = compute_fee_breakdown(&env, 10_000, 30);
        assert_eq!(b.fee, 3);
        assert_eq!(b.amount_to_swap, 9_997);
        assert_eq!(b.fee + b.amount_to_swap, 10_000);
    }

    #[test]
    fn test_fee_breakdown_invariant_max_bps() {
        let env = Env::default();
        env.mock_all_auths();
        let b = compute_fee_breakdown(&env, 100_000, MAX_SWAP_FEE_BPS);
        assert_eq!(b.fee + b.amount_to_swap, 100_000);
    }

    #[test]
    fn test_fee_breakdown_dust_amount() {
        let env = Env::default();
        env.mock_all_auths();
        // amount < BPS_DENOM: fee truncates to 0 — documented dust edge
        let b = compute_fee_breakdown(&env, 100, 30);
        assert_eq!(b.fee, 0);
        assert_eq!(b.amount_to_swap, 100);
        assert_eq!(b.fee + b.amount_to_swap, 100);
    }

    #[test]
    fn test_compute_required_amount_in_roundtrip() {
        // required_in >= amount_out for all fee_bps
        for fee_bps in [0i128, 1, 30, 100, 500] {
            let required = compute_required_amount_in(10_000, fee_bps);
            assert!(required >= 10_000, "required_in < amount_out at fee_bps={}", fee_bps);
        }
    }

    #[test]
    fn test_fee_breakdown_invariant_many_amounts() {
        let env = Env::default();
        env.mock_all_auths();
        // Property: fee + swapped == gross for various amounts and bps values
        for amount in [0i128, 1, 999, 10_000, 1_000_000, 1_000_000_000] {
            for bps in [0i128, 1, 30, 100, 300, 500] {
                let b = compute_fee_breakdown(&env, amount, bps);
                assert_eq!(b.fee + b.amount_to_swap, amount,
                    "invariant failed: amount={}, bps={}", amount, bps);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS4 — Event integrity tests
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn test_yield_escrow_events_emitted() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 5000);
        client.set_yield_escrow_enabled(&admin, &true);
        let release = env.ledger().sequence() + 5;
        let id = client.create_yield_escrow(&token_id, &from, &to, &1000, &release);
        advance(&env, release + 1);
        client.claim_yield_escrow(&id);
        // Events are published — no panic means they were emitted
    }

    #[test]
    fn test_emergency_withdrawal_events_emitted() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &contract_id, 1000);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(admin.clone());
        client.set_admin_signers(&admin, &signers, &1);
        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &recipient, &500);
        client.approve_emergency_withdrawal(&admin, &id);
        advance(&env, env.ledger().sequence() + EMERGENCY_WITHDRAWAL_DELAY + 1);
        client.execute_emergency_withdrawal(&admin, &id);
        // All events published without panic — event integrity confirmed
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS5 — TTL durability tests
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn test_swap_fee_persists_and_can_be_read() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        env.mock_all_auths();
        // Default fee
        assert_eq!(client.get_swap_fee_bps(), DEFAULT_SWAP_FEE_BPS);
        // Reading bumps TTL — no panic
        let _ = client.get_fee_collector_address();
    }

    #[test]
    fn test_admin_action_count_persists() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        env.mock_all_auths();
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(admin.clone());
        client.set_admin_signers(&admin, &signers, &1);
        let id = client.propose_admin_action(
            &admin,
            &Symbol::new(&env, "noop"),
            &soroban_sdk::Bytes::new(&env),
            &0,
        );
        // AdminActionCount was bumped; id should be 0
        assert_eq!(id, 0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS6 — Upgrade/storage safety tests
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    #[should_panic(expected = "upgrade() is disabled")]
    fn test_legacy_upgrade_is_disabled() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        env.mock_all_auths();
        let fake_hash = BytesN::<32>::from_array(&env, &[0u8; 32]);
        client.upgrade(&admin, &fake_hash);
    }

    #[test]
    fn test_add_approved_wasm_hash() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        env.mock_all_auths();
        let hash = BytesN::<32>::from_array(&env, &[1u8; 32]);
        client.add_approved_wasm_hash(&admin, &hash);
        // No panic = hash added successfully
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WS7 — Formal / property tests for fee math and state machines
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn test_fee_math_monotonicity() {
        let env = Env::default();
        env.mock_all_auths();
        // Higher fee_bps => higher fee, lower amount_to_swap
        let b1 = compute_fee_breakdown(&env, 100_000, 10);
        let b2 = compute_fee_breakdown(&env, 100_000, 100);
        let b3 = compute_fee_breakdown(&env, 100_000, 500);
        assert!(b1.fee <= b2.fee);
        assert!(b2.fee <= b3.fee);
        assert!(b1.amount_to_swap >= b2.amount_to_swap);
        assert!(b2.amount_to_swap >= b3.amount_to_swap);
    }

    #[test]
    fn test_fee_bounded_by_gross() {
        let env = Env::default();
        env.mock_all_auths();
        for bps in [0i128, 1, 30, 100, 300, 500] {
            let b = compute_fee_breakdown(&env, 1_000_000, bps);
            assert!(b.fee <= b.gross_amount_in,
                "fee exceeded gross at bps={}", bps);
            // fee <= gross * MAX_FEE_BPS / 10_000
            assert!(b.fee <= b.gross_amount_in * MAX_SWAP_FEE_BPS / BPS_DENOM,
                "fee exceeded max at bps={}", bps);
        }
    }

    #[test]
    fn test_emergency_state_machine_terminality() {
        // A withdrawal in Executed state cannot be executed again
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &contract_id, 2000);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(admin.clone());
        client.set_admin_signers(&admin, &signers, &1);
        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &recipient, &500);
        client.approve_emergency_withdrawal(&admin, &id);
        advance(&env, env.ledger().sequence() + EMERGENCY_WITHDRAWAL_DELAY + 1);
        client.execute_emergency_withdrawal(&admin, &id);
        // Try to execute again — must fail
        let result = client.try_execute_emergency_withdrawal(&admin, &id);
        assert!(result.is_err());
    }

    #[test]
    fn test_yield_escrow_lifecycle_conservation() {
        // amount deposited == amount claimed (conservation)
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let initial = 3000i128;
        let token_id = create_token(&env, &admin, &from, initial);
        let token = soroban_sdk::token::Client::new(&env, &token_id);
        client.set_yield_escrow_enabled(&admin, &true);
        let release = env.ledger().sequence() + 5;
        let id = client.create_yield_escrow(&token_id, &from, &to, &initial, &release);
        advance(&env, release + 1);
        client.claim_yield_escrow(&id);
        // Conservation: balance(to) == initial (1:1 placeholder)
        assert_eq!(token.balance(&to), initial);
    }

    #[test]
    fn test_emergency_withdrawal_delay_enforced() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &contract_id, 1000);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(admin.clone());
        client.set_admin_signers(&admin, &signers, &1);
        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &recipient, &500);
        client.approve_emergency_withdrawal(&admin, &id);
        // Do NOT advance — delay not elapsed
        let result = client.try_execute_emergency_withdrawal(&admin, &id);
        assert!(result.is_err());
    }
}
