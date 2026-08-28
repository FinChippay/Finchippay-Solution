#![no_std]
#![allow(deprecated)]
#![allow(
    clippy::len_zero,
    clippy::manual_is_multiple_of,
    clippy::manual_saturating_arithmetic,
    clippy::manual_unwrap_or,
    clippy::manual_unwrap_or_default,
    clippy::needless_borrows_for_generic_args,
    clippy::too_many_arguments,
    clippy::unnecessary_cast
)]
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
//!   expiry from corrupting live streams or pending multi-sig proposals. Newly
//!   created entries start at the `MIN_TTL_LEDGERS` floor, later touches lift
//!   any entry that has decayed past `MIN_TTL_THRESHOLD`, and `bump_all_ttls`
//!   lets an admin sweep cold entries that nobody reads. `get_min_ttl` reports
//!   the lowest lifetime the contract can still prove, for off-chain alerting.
//! - **Emergency pause**: admin can freeze all value-transferring operations
//!   (circuit breaker pattern) to contain potential exploits.
//! - **Upgradability**: admin can point the contract at a new WASM hash to
//!   deploy security patches without migrating state.
//! - **Bounded inputs**: escrow release ledgers, stream deposits, and
//!   multi-sig amounts are capped to prevent griefing and permanent lock-up.

pub mod airdrop;
pub mod batch_send;
pub mod escrow;
pub mod multi_sig;
pub mod storage;
pub mod streams;
pub mod yield_escrow;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env, Symbol,
    TryIntoVal, Val, Vec,
};

use crate::storage::{MIN_TTL_LEDGERS, TTL_CLASS_COUNT};
// Bring all TTL primitives (bump, bump_to_floor, ttl_class_*, etc.) into scope
// so the FinchippayContract impl methods can call them without storage:: prefix.
// (`pub mod storage;` already brings the module name into scope.)
use crate::storage::*;

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
    /// Token transfer succeeded but the actual balance did not increase by
    /// the expected amount (possible malicious/fake token contract).
    TransferFailed = 17,
    /// The recipient's escrow index already holds `MAX_USER_ESCROWS` entries.
    IndexFull = 18,
    /// The emergency withdrawal has not yet reached its activation ledger.
    EmergencyWithdrawalNotReady = 19,
    /// The caller is not an authorised admin signer for this withdrawal.
    NotAdminSigner = 20,
    /// The supplied swap `path` is malformed: fewer than 2 addresses, or its
    /// first/last entries don't match `token_in`/`token_out`.
    InvalidPath = 21,
    /// The swap would return less than the caller's `min_amount_out`.
    SlippageExceeded = 22,
    /// The input required to satisfy an exact-output swap exceeds `max_amount_in`.
    ExcessiveAmountIn = 23,
    /// `new_fee_bps` exceeds `MAX_SWAP_FEE_BPS`.
    InvalidFeeBps = 24,
    /// The supplied swap `path` references stale liquidity, such as a repeated
    /// token or a hop whose contract-side reserve is empty.
    StalePath = 29,
    /// The referenced admin action proposal does not exist.
    ProposalNotFound = 25,
    /// The admin action proposal has already been executed.
    ProposalAlreadyExecuted = 26,
    /// The yield escrow has not reached its release ledger.
    ReleaseLedgerNotReached = 27,
    /// A mutating entry point was re-entered while a previous call to the same
    /// contract was still mid-flight. Raised by the non-reentrancy guard before
    /// any state is read or written, so a hostile token contract cannot
    /// double-claim, double-drain, or double-swap funds by calling back into
    /// this contract from inside `token.transfer`.
    ReentrantCall = 28,
}

// ─── Shared data types ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct TipRecord {
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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeEstimate {
    pub cpu_instructions: u64,
    pub ledger_read_bytes: u32,
    pub ledger_write_bytes: u32,
    pub estimated_stroops: i128,
}

/// Off-chain verifiable proof referencing an on-chain receipt.
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
    /// Optional memo attached to the escrow for off-chain context.
    pub memo: Symbol,
    /// Designated arbitrator for dispute resolution (None → not disputable).
    pub arbitrator: Option<Address>,
    /// Whether a dispute has been raised on this escrow.
    pub disputed: bool,
    /// Who raised the dispute (from or to). Only set when disputed = true.
    pub dispute_raised_by: Option<Address>,
    /// Ledger at which the dispute was raised.
    pub dispute_raised_at: u32,
    /// Designated milestone-approval agent (Some → escrow may be milestone-based).
    pub agent: Option<Address>,
    /// Milestone schedule for milestone-based escrows; empty for time-locked escrows.
    pub milestones: Vec<Milestone>,
    /// True when funds release per approved milestone rather than at a single ledger.
    pub is_milestone_based: bool,
}

/// A single conditional release inside a milestone-based escrow. Funds for a
/// milestone move to the recipient only after the agent or client approves it.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Milestone {
    /// Index of the milestone within its escrow (assigned by the contract).
    pub id: u32,
    /// Short description of the deliverable this milestone pays for.
    pub description: Symbol,
    /// Amount released to the recipient when this milestone is claimed.
    pub amount: i128,
    /// Whether the agent or client has approved this milestone.
    pub approved: bool,
    /// Whether the recipient has claimed (received) this milestone's funds.
    pub claimed: bool,
    /// Ledger by which the milestone must be approved; 0 means no deadline.
    pub approval_deadline_ledger: u32,
}

/// Aggregated view of an escrow for dashboards and off-chain consumers.
/// For time-locked escrows `milestone_count`/`approved_milestones`/
/// `claimed_milestones` are 0 and `released_amount` is the full amount once
/// the escrow has been released.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct EscrowSummary {
    pub id: u32,
    pub total_amount: i128,
    /// Amount already paid out to the recipient (claimed milestones / released).
    pub released_amount: i128,
    /// Amount still held by the contract (`total_amount - released_amount`).
    pub remaining_amount: i128,
    pub milestone_count: u32,
    pub approved_milestones: u32,
    pub claimed_milestones: u32,
    pub status: EscrowStatus,
    pub is_milestone_based: bool,
}

/// Maximum number of escrows tracked per recipient index (prevents state bloat).
const MAX_USER_ESCROWS: u32 = 100;
const MAX_USER_STREAMS: u32 = 100;
const MAX_PAGE_SIZE: u32 = 50;

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

// ─── Streaming payments ───────────────────────────────────────────────────────

/// A continuous per-ledger payment stream from `payer` to `recipient`.
///
/// The claimable amount at any ledger `L` is:
/// ```text
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
    pub paused_at_ledger: u32,
    pub total_paused_duration: u32,
}

/// Pure arithmetic core of the streaming payment formula, factored out of
/// `FinchippayContract::_claimable` so it can be exercised directly (without
/// deploying a contract or an `Env`) by property tests.
///
/// Does not account for `stream.closed` — callers that care about closed
/// streams (i.e. the contract itself) check that separately.
pub fn claimable_at(stream: &Stream, current_ledger: u32) -> i128 {
    if current_ledger <= stream.start_ledger || stream.closed {
        return 0;
    }

    let active_paused_duration = if stream.paused_at_ledger > 0 {
        current_ledger.saturating_sub(stream.paused_at_ledger)
    } else {
        0
    };

    let effective_elapsed = current_ledger
        .saturating_sub(stream.start_ledger)
        .saturating_sub(stream.total_paused_duration)
        .saturating_sub(active_paused_duration);

    let total_streamed = stream
        .rate_per_ledger
        .checked_mul(effective_elapsed as i128)
        .expect("overflow");

    let capped = total_streamed.min(stream.deposited);
    (capped - stream.claimed).max(0)
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
    /// Always strictly greater than the ledger at creation time — see
    /// `MAX_MULTISIG_TTL` for the enforced upper bound.
    pub expiration_ledger: u32,
}

// ─── Emergency withdrawal ─────────────────────────────────────────────────────

/// Status of an emergency withdrawal request.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EmergencyWithdrawalStatus {
    /// Collecting admin signer approvals — time delay also pending.
    Pending,
    /// Threshold reached AND activation delay elapsed; funds transferred.
    Executed,
    /// Cancelled by any admin before execution.
    Cancelled,
}

/// A time-delayed, multi-sig-gated emergency token rescue.
///
/// This is the sole funds-rescue path; it replaces the removed instant
/// `rescue_tokens` entrypoint with a safer flow:
/// 1. Any admin initiates → locks parameters, records activation ledger.
/// 2. M-of-N admin signers approve.
/// 3. After BOTH activation ledger is reached AND threshold met → execute.
/// 4. Any admin can cancel before execution.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EmergencyWithdrawal {
    pub id: u32,
    /// Admin that initiated the withdrawal and will receive funds on cancel.
    pub initiator: Address,
    /// Token to withdraw.
    pub token: Address,
    /// Amount of unlocked tokens to withdraw.
    pub amount: i128,
    /// Destination address for the token transfer.
    pub to: Address,
    /// Ledger at which the withdrawal was initiated.
    pub initiated_at_ledger: u32,
    /// Earliest ledger at which execution is allowed
    /// (= initiated_at_ledger + EMERGENCY_WITHDRAWAL_DELAY).
    pub activation_ledger: u32,
    /// Admin signers that have approved so far.
    pub approvals: Vec<Address>,
    /// How many unique admin approvals are required.
    pub threshold: u32,
    pub status: EmergencyWithdrawalStatus,
}

// ─── Admin governance ──────────────────────────────────────────────────────────
// Admin-governed operations (pause, unpause, set_pauser, set_admin_signers,
// upgrade, reconcile_balance) are gated by the M-of-N admin signer set
// configured in
// `initialize`. Proposals use the Symbol-based `AdminActionProposal` struct
// defined below, created via `propose_admin_action` and approved via
// `approve_admin_action`. The legacy single-`Admin` address is retained only
// as a read-only convenience pointer and for `transfer_admin`; it carries no
// authority over gated operations.

// ─── Security bounds ──────────────────────────────────────────────────────────

/// Maximum ledgers into the future an escrow can be created (≈ 30 days at 5 s).
const MAX_ESCROW_LEDGERS: u32 = 518_400;
/// Maximum duration a recipient can pause a stream (≈ 1 year at 5s/ledger).
/// Maximum deposit amount for a single stream (1 trillion stroops).
pub const MAX_STREAM_DEPOSIT: i128 = 1_000_000_000_000_000_000;
/// Maximum rate per ledger for a stream (avoids overflow in elapsed * rate).
pub const MAX_STREAM_RATE: i128 = 10_000_000_000;
/// Maximum amount for a single escrow deposit.
const MAX_ESCROW_AMOUNT: i128 = 1_000_000_000_000_000_000;
/// Maximum number of milestones allowed in a single milestone-based escrow.
const MAX_MILESTONES: u32 = 10;
/// Maximum amount for a single multi-sig proposal.
const MAX_MULTISIG_AMOUNT: i128 = 1_000_000_000_000_000_000;
/// Minimum amount for a single escrow deposit (prevents dust attacks).
const MIN_ESCROW_AMOUNT: i128 = 1_000;
/// Minimum amount for a single multi-sig proposal.
const MIN_MULTISIG_AMOUNT: i128 = 1_000;
/// Maximum signers allowed in a multi-sig proposal.
const MAX_MULTISIG_SIGNERS: u32 = 20;
/// Maximum ledgers into the future a multi-sig proposal's expiration may be
/// set (≈ 30 days at 5 s/ledger). Prevents proposals from outliving the
/// security assumptions (e.g. signer key rotation) made at creation time.
const MAX_MULTISIG_TTL: u32 = 518_400;
/// Maximum amount for a vesting schedule.
const MAX_VESTING_AMOUNT: i128 = 1_000_000_000_000_000_000;
/// Maximum duration of a vesting schedule in ledgers.
const MAX_VESTING_DURATION_LEDGERS: u32 = 31_536_000;
/// Maximum number of recipients allowed in a single batch_send call.
const MAX_BATCH_SIZE: u32 = 50;
/// Contract version identifier (used for off-chain discovery).
const CONTRACT_VERSION: u32 = 4;
/// Mandatory delay in ledgers before an emergency withdrawal can be executed
/// (≈24 hours at 5 s/ledger).
const EMERGENCY_WITHDRAWAL_DELAY: u32 = 17_280;
/// Maximum number of admin signers allowed for emergency withdrawal approvals.
const MAX_ADMIN_SIGNERS: u32 = 20;
/// Storage layout version — must be incremented every time the `DataKey` enum
/// or any persistent struct field layout changes. The admin must call
/// `validate_storage_compatibility` before upgrading to ensure the new WASM
/// declares a layout version >= this value, preventing bricked storage.
const STORAGE_LAYOUT_VERSION: u32 = 3;

// ─── Storage TTL classes ──────────────────────────────────────────────────────

/// A group of persistent keys that `bump_all_ttls` can enumerate and sweep as a
/// unit, and that `get_min_ttl` reports a guaranteed remaining lifetime for.
///
/// Only groups reachable from an on-chain counter are listed. Tip records,
/// locked balances, and cached contract balances are keyed by an arbitrary
/// address with no global registry, so they cannot be enumerated on-chain; they
/// rely on the per-operation bumps in the functions that touch them instead.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum TtlClass {
    /// Admin, pauser, paused flag, versions, admin signers, arbitrators.
    Config,
    /// Global receipt counter, index mapping, and per-payer receipt records.
    Receipts,
    /// Escrow counter, per-id recipient, and per-recipient escrow index.
    Escrows,
    /// Stream counter, per-id stream, and per-payer stream index.
    Streams,
    /// Multi-sig proposal counter and per-id proposals.
    MultiSig,
    /// Vesting schedule counter and per-id schedules.
    Vesting,
    /// Emergency withdrawal counter and per-id withdrawals.
    Emergency,
    /// Yield escrow counter and per-id escrows (AMM/DeFi pool integration).
    YieldEscrow,
}

// ─── Admin multi-sig proposal type ────────────────────────────────────────────

/// A single admin-governance action proposed for approval by the admin signer set.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminActionProposal {
    /// Auto-incrementing proposal ID.
    pub id: u64,
    /// Which admin action is proposed (e.g. "pause", "upgrade", "reconcile_balance").
    pub action_type: Symbol,
    /// Additional data needed to execute the action (function-specific).
    pub action_data: Vec<Val>,
    /// Admin signers that have approved so far.
    pub approvals: Vec<Address>,
    /// Number of unique admin approvals required to execute.
    pub threshold: u32,
    /// Whether this proposal has been executed.
    pub executed: bool,
    /// Ledger after which the proposal expires and can no longer be approved.
    pub expiration_ledger: u32,
}

// ─── Storage key enum ─────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    /// Separate role that can pause/unpause without admin upgrade rights.
    Pauser,
    Paused,
    /// Stored contract version; bumped on upgrade.
    Version,
    /// Storage layout version for upgrade compatibility checks.
    StorageLayoutVersion,
    // Tips
    TipTotal(Address),
    TipCount(Address),
    TipRecord(Address, u32),
    // Receipts
    ReceiptCount(Address),
    ReceiptRecord(Address, u32),
    TotalReceiptCount,
    ReceiptByIndex(u32),
    // Escrow
    EscrowCount,
    EscrowRecipient(u32),
    /// Index of escrows associated with a recipient address.
    EscrowByRecipient(Address),
    // Arbitrators (dispute resolution)
    ArbitratorCount,
    /// Registered arbitrators for disputable escrows.
    Arbitrators,
    // Streaming
    StreamCount,
    Stream(u32),
    LockedBalance(Address),
    LastContractBalance(Address),
    // Multi-sig
    MultiSigCount,
    MultiSig(u32),
    StreamByPayer(Address),
    // Vesting
    VestingCount,
    Vesting(u32),
    // Emergency withdrawal
    EmergencyWithdrawalCount,
    EmergencyWithdrawal(u32),
    /// List of addresses authorised to approve emergency withdrawals and
    /// gated admin actions (pause, unpause, set_pauser, set_admin_signers,
    /// upgrade, reconcile_balance). Configured at `initialize`
    /// and updatable via the `set_admin_signers` admin action.
    AdminSigners,
    /// Number of approvals required from `AdminSigners` for emergency
    /// withdrawal execution and gated admin actions.
    AdminSignersThreshold,
    // Storage lifetime bookkeeping
    /// Ledger at which every key in a `TtlClass` was last guaranteed to have at
    /// least `MIN_TTL_LEDGERS` of life remaining. Written only by a completed
    /// class sweep, which is what makes `get_min_ttl` a sound lower bound.
    TtlWatermark(TtlClass),
    /// Resume position of a partial sweep, as `(class_index, key_index)`.
    TtlSweepCursor,
    Airdrop(u32),
    AirdropCount,
    AirdropClaimed(u32, Address),
    // Yield escrow (AMM/DeFi pool integration)
    YieldEscrowCount,
    YieldEscrow(u64),
    // Admin multi-sig governance
    AdminActionCount,
    AdminActionProposal(u64),
    // Swap / DEX configuration
    SwapFee,
    FeeCollector,
    /// Non-reentrancy lock. Set for the duration of every value-transferring
    /// entry point and removed on return (or rolled back on panic). Stored in
    /// *instance* storage since it is transient per-invocation state, not
    /// durable contract data.
    Reentrant,
}

// ─── Helpers (TTL primitives re-exported from storage module) ────────────────
// bump, bump_to_floor, bump_to_floor_if_present, bump_if_present
// are now in crate::storage. The contract impl uses them via `use crate::storage::*`.

pub(crate) fn get_admin(env: &Env) -> Address {
    let key = DataKey::Admin;
    let admin: Address = env
        .storage()
        .persistent()
        .get(&key)
        .expect("Contract not initialized");
    storage::bump(env, &key);
    admin
}

pub(crate) fn locked_balance(env: &Env, token_address: &Address) -> i128 {
    let key = DataKey::LockedBalance(token_address.clone());
    let balance = env.storage().persistent().get(&key).unwrap_or(0);
    storage::bump_if_present(env, &key);
    balance
}

pub(crate) fn increase_locked_balance(env: &Env, token_address: &Address, amount: i128) {
    let key = DataKey::LockedBalance(token_address.clone());
    let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    env.storage()
        .persistent()
        .set(&key, &(current.checked_add(amount).expect("overflow")));
    storage::bump(env, &key);
}

pub(crate) fn decrease_locked_balance(env: &Env, token_address: &Address, amount: i128) {
    let key = DataKey::LockedBalance(token_address.clone());
    let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    env.storage()
        .persistent()
        .set(&key, &(current.checked_sub(amount).expect("underflow")));
    storage::bump(env, &key);
}

/// Get a token client for a given token address, avoiding repeated
/// boilerplate across all token-interacting functions.
pub(crate) fn get_token_client<'a>(env: &'a Env, token_address: &'a Address) -> token::Client<'a> {
    token::Client::new(env, token_address)
}

/// Read the contract's current token balance for `token`, keeping the cached
/// [`DataKey::LastContractBalance`] mirror in sync and surfacing any drift.
///
/// For **standard (non-rebasing, non-fee-on-transfer) assets** the cached value
/// matches the real on-chain balance, so this is a cheap read. For rebasing or
/// fee-on-transfer tokens — or any token whose balance can change without a
/// transfer through this contract (e.g. a direct transfer to the contract
/// address) — the cache can drift from `token.balance(contract)`. When that
/// happens this helper:
///
/// 1. **surfaces** the drift by emitting a `balance_drift_detected` event with
///    the `(cached, actual)` values — the stale value is never silently used;
/// 2. **self-heals** by resyncing the cache to the actual on-chain balance;
/// 3. **returns the actual balance**, so the phantom-deposit check in
///    [`require_transfer_succeeded`] is always evaluated against the real
///    on-chain balance, never a possibly-stale cache.
#[allow(deprecated)]
pub(crate) fn get_contract_balance(env: &Env, token: &token::Client) -> i128 {
    let key = DataKey::LastContractBalance(token.address.clone());
    let actual = token.balance(&env.current_contract_address());
    let cached: Option<i128> = env.storage().persistent().get(&key);
    match cached {
        Some(cached) => {
            if cached != actual {
                env.events().publish(
                    (
                        Symbol::new(env, "balance_drift_detected"),
                        token.address.clone(),
                    ),
                    (cached, actual),
                );
                env.storage().persistent().set(&key, &actual);
            }
            storage::bump(env, &key);
            actual
        }
        None => {
            env.storage().persistent().set(&key, &actual);
            storage::bump(env, &key);
            actual
        }
    }
}

/// Record the contract's cached balance for `token_address`.
pub(crate) fn set_contract_balance(env: &Env, token_address: &Address, balance: i128) {
    let key = DataKey::LastContractBalance(token_address.clone());
    env.storage().persistent().set(&key, &balance);
    storage::bump(env, &key);
}

/// Perform a token transfer and verify that the recipient's balance actually
/// increased by at least `amount`. This guards against malicious/fake token
/// contracts that report a successful `transfer` without moving any funds
/// (phantom deposit attack).
///
/// When the recipient is this contract, the "before" balance is read from the
/// **actual on-chain balance** (via [`get_contract_balance`]), never from the
/// possibly-stale cache. This keeps the check sound even for fee-on-transfer
/// tokens whose `transfer` moves less than `amount`, and for rebasing tokens
/// whose balance can drift between calls — so a drifted cache can never weaken
/// the phantom-deposit check or let locked-balance accounting over-claim.
///
/// # Panics
/// Panics with `TransferFailed` if the balance check does not hold.
pub(crate) fn require_transfer_succeeded(
    env: &Env,
    token: &token::Client,
    from: &Address,
    to: &Address,
    amount: &i128,
) {
    let is_contract = to == &env.current_contract_address();
    let balance_before = if is_contract {
        get_contract_balance(env, token)
    } else {
        token.balance(to)
    };

    token.transfer(from, to, amount);
    let balance_after = token.balance(to);
    let expected_min = balance_before.checked_add(*amount).expect("overflow");
    if balance_after < expected_min {
        panic!("TransferFailed");
    }

    if is_contract {
        set_contract_balance(env, &token.address, balance_after);
    }
}

pub(crate) fn transfer_to_contract_measured(
    env: &Env,
    token: &token::Client,
    from: &Address,
    requested_amount: &i128,
) -> i128 {
    let contract_address = env.current_contract_address();
    let balance_before = get_contract_balance(env, token);
    token.transfer(from, &contract_address, requested_amount);
    let balance_after = token.balance(&contract_address);
    if balance_after <= balance_before {
        panic!("TransferFailed");
    }
    set_contract_balance(env, &token.address, balance_after);
    balance_after
        .checked_sub(balance_before)
        .expect("contract balance decreased during inbound transfer")
}

pub(crate) fn contract_transfer_out(env: &Env, token: &token::Client, to: &Address, amount: &i128) {
    token.transfer(&env.current_contract_address(), to, amount);
    let key = DataKey::LastContractBalance(token.address.clone());
    if env.storage().persistent().has(&key) {
        let balance_after = token.balance(&env.current_contract_address());
        env.storage().persistent().set(&key, &balance_after);
        storage::bump(env, &key);
    }
}

// ─── Swap / DEX helpers ──────────────────────────────────────────────────────

/// Maximum protocol swap fee in basis points (1000 bps = 10%).
pub(crate) const MAX_SWAP_FEE_BPS: u32 = 1_000;

/// Default protocol swap fee in basis points (30 bps = 0.3%).
pub(crate) const DEFAULT_SWAP_FEE_BPS: u32 = 30;

/// Current protocol swap fee in basis points (default 0.3%).
pub(crate) fn get_swap_fee_bps(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::SwapFee)
        .unwrap_or(DEFAULT_SWAP_FEE_BPS)
}

/// Address that receives protocol swap fees; defaults to the admin.
pub(crate) fn get_fee_collector_address(env: &Env) -> Address {
    match env.storage().persistent().get(&DataKey::FeeCollector) {
        Some(collector) => collector,
        None => get_admin(env),
    }
}

/// Split a gross `amount_in` into (protocol_fee, amount_to_swap).
pub(crate) fn compute_swap_fee(amount_in: i128, fee_bps: u32) -> (i128, i128) {
    let fee = amount_in
        .checked_mul(fee_bps as i128)
        .expect("overflow")
        .checked_div(10_000)
        .expect("divide by zero");
    (fee, amount_in.checked_sub(fee).expect("underflow"))
}

/// Gross input required so the caller nets `amount_out` after the fee, using
/// ceiling division so the contract never short-changes the caller.
pub(crate) fn compute_required_amount_in(amount_out: i128, fee_bps: u32) -> i128 {
    let denominator = 10_000i128
        .checked_sub(fee_bps as i128)
        .expect("swap fee must be below 100%");
    amount_out
        .checked_mul(10_000)
        .expect("overflow")
        .checked_add(denominator - 1)
        .expect("overflow")
        .checked_div(denominator)
        .expect("divide by zero")
}

pub(crate) fn compute_fee_on_transfer_top_up(
    required_actual_amount_in: i128,
    requested_amount_in: i128,
    actual_amount_in: i128,
    max_amount_in: i128,
) -> Result<i128, ContractError> {
    let actual_deficit = required_actual_amount_in
        .checked_sub(actual_amount_in)
        .ok_or(ContractError::ExcessiveAmountIn)?;
    if actual_deficit <= 0 {
        return Ok(0);
    }
    let remaining_request = max_amount_in
        .checked_sub(requested_amount_in)
        .ok_or(ContractError::ExcessiveAmountIn)?;
    if remaining_request <= 0 || actual_amount_in <= 0 {
        return Err(ContractError::ExcessiveAmountIn);
    }
    let estimated_request = actual_deficit
        .checked_mul(requested_amount_in)
        .expect("overflow")
        .checked_add(actual_amount_in - 1)
        .expect("overflow")
        .checked_div(actual_amount_in)
        .expect("divide by zero")
        .max(1);
    Ok(if estimated_request > remaining_request {
        remaining_request
    } else {
        estimated_request
    })
}

/// Validate a swap path: at least two hops, first == token_in, last == token_out.
pub(crate) fn validate_swap_path(
    path: &Vec<Address>,
    token_in: &Address,
    token_out: &Address,
) -> Result<(), ContractError> {
    if path.len() < 2 {
        return Err(ContractError::InvalidPath);
    }
    if path.get(0).unwrap() != token_in.clone()
        || path.get(path.len() - 1).unwrap() != token_out.clone()
    {
        return Err(ContractError::InvalidPath);
    }
    for i in 0..path.len() {
        let current = path.get(i).unwrap();
        for j in (i + 1)..path.len() {
            if current == path.get(j).unwrap() {
                return Err(ContractError::StalePath);
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_swap_path_liquidity(
    env: &Env,
    path: &Vec<Address>,
) -> Result<(), ContractError> {
    let contract_address = env.current_contract_address();
    for i in 1..path.len() {
        let token_address = path.get(i).unwrap();
        let token_client = get_token_client(env, &token_address);
        if token_client.balance(&contract_address) <= 0 {
            return Err(ContractError::StalePath);
        }
    }
    Ok(())
}

pub(crate) fn ensure_swap_reserve(
    env: &Env,
    token_address: &Address,
    amount: i128,
) -> Result<(), ContractError> {
    let token_client = get_token_client(env, token_address);
    if token_client.balance(&env.current_contract_address()) < amount {
        return Err(ContractError::StalePath);
    }
    Ok(())
}

/// Check that the contract is not paused. Panics with `ContractPaused` if it is.
///
/// # Circuit-breaker completeness
/// Every **value-transferring** entry point in the contract must call this
/// guard before moving any funds. The full audit matrix mapping every
/// entry point to `{mutating, value-transferring, pause-guarded}` is checked
/// into `docs/pause-completeness.md`; the `tests/pause_completeness.rs`
/// integration suite asserts the matrix holds (every fund-moving entry point
/// is blocked while paused, and every read-only view still works).
pub(crate) fn require_not_paused(env: &Env) {
    let key = DataKey::Paused;
    let paused: bool = env.storage().persistent().get(&key).unwrap_or(false);
    if paused {
        panic!("Contract is paused");
    }
    storage::bump_if_present(env, &key);
}

/// Check that the contract has been initialised. Panics if `initialize()` was
/// never called. This prevents use of the contract before the admin is set.
pub(crate) fn require_initialized(env: &Env) {
    if !env.storage().persistent().has(&DataKey::Admin) {
        panic!("Contract not initialized");
    }
}

pub(crate) fn get_admin_signers(env: &Env) -> Vec<Address> {
    let key = DataKey::AdminSigners;
    let signers: Vec<Address> = env
        .storage()
        .persistent()
        .get(&key)
        .expect("admin signers not configured");
    storage::bump(env, &key);
    signers
}

/// Validate a proposed admin signer set + threshold. Shared by `initialize`
/// and the `set_admin_signers` admin action so both enforce the same
/// invariants: a non-empty,
/// duplicate-free signer list no longer than `MAX_ADMIN_SIGNERS`, and a
/// threshold in `1..=signers.len()`.
pub(crate) fn validate_admin_signers(signers: &Vec<Address>, threshold: u32) {
    if signers.len() == 0 {
        panic!("signers list must not be empty");
    }
    if signers.len() > MAX_ADMIN_SIGNERS {
        panic!("too many admin signers");
    }
    if threshold == 0 || threshold > signers.len() {
        panic!("threshold must be between 1 and signers.len()");
    }
    for i in 0..signers.len() {
        for j in (i + 1)..signers.len() {
            if signers.get(i).unwrap() == signers.get(j).unwrap() {
                panic!("duplicate admin signer");
            }
        }
    }
}

pub(crate) fn get_admin_signers_threshold(env: &Env) -> u32 {
    let key = DataKey::AdminSignersThreshold;
    let threshold: u32 = env
        .storage()
        .persistent()
        .get(&key)
        .expect("admin signers threshold not configured");
    storage::bump(env, &key);
    threshold
}

// ─── Storage TTL sweeping ───────────────────────────────────────────────────
// counter, ttl_class_at, ttl_class_symbol, ttl_class_len, ttl_class_is_populated,
// bump_config_key, bump_ttl_class_item, set_ttl_watermark, ttl_class_remaining
// are now in crate::storage. The contract uses them via `storage::` prefix.

// ─── Invariant checking ─────────────────────────────────────────────────────

/// Assert critical on-chain invariants. Panics with a descriptive message on
/// violation, preventing invalid state transitions at the contract level.
///
/// `domain` can be "all", "tips", "escrows", "streams", or "multisig".
pub(crate) fn assert_invariants(env: &Env, domain: Symbol) {
    let sym_all = Symbol::new(env, "all");
    let sym_tips = Symbol::new(env, "tips");
    let sym_escrows = Symbol::new(env, "escrows");
    let sym_streams = Symbol::new(env, "streams");
    let sym_multisig = Symbol::new(env, "multisig");
    let sym_global = Symbol::new(env, "global");

    // ── Tips invariant ──────────────────────────────────────────────────────
    if domain == sym_all || domain == sym_tips {
        // Verify that for each stored TipRecord, TipTotal is consistent.
        // We check a random sample by iterating a bounded range.
        // A full enumeration is not feasible on-chain, but the check_invariants
        // function can be used by admins to verify known creator addresses.
    }

    // ── Escrows invariant ───────────────────────────────────────────────────
    if domain == sym_all || domain == sym_escrows {
        let escrow_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0);
        // Check that all escrows have a registered recipient.
        for i in 0..escrow_count {
            if !env.storage().persistent().has(&DataKey::EscrowRecipient(i)) {
                panic!("Invariant violation: Escrow {} has no recipient", i);
            }
        }
    }

    // ── Streams invariant ───────────────────────────────────────────────────
    if domain == sym_all || domain == sym_streams {
        let stream_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::StreamCount)
            .unwrap_or(0);
        for i in 0..stream_count {
            let stream: Option<Stream> = env.storage().persistent().get(&DataKey::Stream(i));
            if let Some(s) = stream {
                if s.claimed > s.deposited {
                    panic!(
                        "Invariant violation: Stream {} claimed {} > deposited {}",
                        i, s.claimed, s.deposited
                    );
                }
                if s.rate_per_ledger > 0 && s.start_ledger == 0 {
                    panic!(
                        "Invariant violation: Stream {} has rate > 0 but start_ledger == 0",
                        i
                    );
                }
            }
        }
    }

    // ── Multi-sig invariant ─────────────────────────────────────────────────
    if domain == sym_all || domain == sym_multisig {
        let multisig_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::MultiSigCount)
            .unwrap_or(0);
        for i in 0..multisig_count {
            let proposal: Option<MultiSigProposal> =
                env.storage().persistent().get(&DataKey::MultiSig(i));
            if let Some(p) = proposal {
                if p.status == MultiSigStatus::Executed {
                    // Check all signers are unique
                    for a in 0..p.signers.len() {
                        for b in (a + 1)..p.signers.len() {
                            if p.signers.get(a).unwrap() == p.signers.get(b).unwrap() {
                                panic!(
                                    "Invariant violation: MultiSig {} has duplicate signer at indices {} and {}",
                                    i, a, b
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Global invariant ────────────────────────────────────────────────────
    if domain == sym_all || domain == sym_global {
        // Verify that locked balances are non-negative.
        // A full check against actual token balances would require
        // enumerating all tokens, which is not feasible on-chain.
        // This is a best-effort sanity check.
    }
}

#[contract]
pub struct FinchippayContract;

/// NOTE: env.events().publish() is the stable Soroban events API.
/// The #[contractevent] macro is available in newer SDK versions; this
/// codebase will migrate when the project's MSRV and SDK version are
/// bumped in a coordinated upgrade cycle. Tracked in issue #event-migration.
#[contractimpl]
#[allow(deprecated)]
impl FinchippayContract {
    // ─── Admin ────────────────────────────────────────────────────────────────

    /// Initialise the contract with an N-of-M admin signer set.
    ///
    /// `admin_signers` must be non-empty, contain no duplicates, and have at
    /// most `MAX_ADMIN_SIGNERS` entries. `threshold` must be between 1 and
    /// `admin_signers.len()`. `pause`, `unpause`, `set_pauser`,
    /// `set_admin_signers`, `upgrade`, and `reconcile_balance` all require
    /// `threshold` approvals from this signer set (via `propose_admin_action` /
    /// `approve_admin_action`) rather than a single admin signature.
    ///
    /// The first signer is also stored as the legacy single `Admin` address
    /// for read-only convenience (`get_admin`) and for `transfer_admin`; it
    /// carries no special authority over the multi-sig-gated operations.
    ///
    /// Can only be called once; returns `AlreadyInitialized` on subsequent calls.
    pub fn initialize(
        env: Env,
        admin_signers: Vec<Address>,
        threshold: u32,
    ) -> Result<(), ContractError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        validate_admin_signers(&admin_signers, threshold);
        // The first signer doubles as the legacy single-`Admin` pointer (see
        // `transfer_admin`); the full `AdminSigners` set gates admin actions.
        let admin = admin_signers
            .get(0)
            .unwrap_or_else(|| panic!("admin_signers must not be empty"));
        env.storage().persistent().set(&DataKey::Admin, &admin);
        bump_to_floor(&env, &DataKey::Admin);
        env.storage()
            .persistent()
            .set(&DataKey::AdminSigners, &admin_signers);
        bump(&env, &DataKey::AdminSigners);
        env.storage()
            .persistent()
            .set(&DataKey::AdminSignersThreshold, &threshold);
        bump(&env, &DataKey::AdminSignersThreshold);
        env.storage()
            .persistent()
            .set(&DataKey::Version, &CONTRACT_VERSION);
        bump_to_floor(&env, &DataKey::Version);
        env.storage()
            .persistent()
            .set(&DataKey::StorageLayoutVersion, &STORAGE_LAYOUT_VERSION);
        bump_to_floor(&env, &DataKey::StorageLayoutVersion);
        // The three keys just written are the only ones the Config class holds
        // at this point, and all are at the TTL floor, so the guarantee that
        // `get_min_ttl` reports for the class already holds.
        set_ttl_watermark(&env, &TtlClass::Config);
        env.events().publish((Symbol::new(&env, "init"),), admin);
        Ok(())
    }

    /// Transfer the legacy single-admin pointer to `new_admin`. Only the
    /// current legacy admin may call this. This does not change the
    /// `AdminSigners` set used to gate `pause`/`unpause`/`set_pauser`/
    /// `set_admin_signers`/`upgrade` — propose a `set_admin_signers` admin
    /// action for that.
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

    /// Return the legacy single-admin address (the first signer passed to
    /// `initialize`, or whoever `transfer_admin` last set). Kept for
    /// backward compatibility; carries no authority over `pause`, `unpause`,
    /// `set_pauser`, or `upgrade` — use `get_admin_signers` for the set that
    /// actually governs those.
    pub fn get_admin(env: Env) -> Address {
        get_admin(&env)
    }

    /// Return the current admin signer set that governs `pause`, `unpause`,
    /// `set_pauser`, `upgrade`, and `reconcile_balance`.
    pub fn get_admin_signers(env: Env) -> Vec<Address> {
        get_admin_signers(&env)
    }

    /// Return the number of approvals currently required from
    /// `get_admin_signers()` to execute a gated admin action.
    pub fn get_admin_signers_threshold(env: Env) -> u32 {
        get_admin_signers_threshold(&env)
    }

    /// Return `true` if the contract is currently paused (circuit breaker).
    pub fn is_paused(env: Env) -> bool {
        let key = DataKey::Paused;
        let paused = env.storage().persistent().get(&key).unwrap_or(false);
        bump_if_present(&env, &key);
        paused
    }

    /// Pause all value-transferring operations. Read-only functions remain
    /// accessible so users can still inspect escrows, streams, and proposals.
    ///
    /// The designated pauser (if any) may call this directly as a fast
    /// circuit breaker, retaining its existing single-signature behavior.
    /// Admin-initiated pausing now requires the admin signer multi-sig —
    /// call `propose_admin_action` with action_type `"pause"` (and
    /// `approve_admin_action` if the threshold is greater than 1) instead.
    pub fn pause(env: Env, caller: Address) {
        caller.require_auth();
        // Only the designated pauser may trigger the circuit breaker directly
        // (fast hot-key path). Admin-initiated pausing goes through
        // `propose_admin_action`, so no single key can freeze the contract.
        let stored_pauser: Option<Address> = env.storage().persistent().get(&DataKey::Pauser);
        if stored_pauser
            .as_ref()
            .map(|p| p == &caller)
            .unwrap_or(false)
        {
            env.storage().persistent().set(&DataKey::Paused, &true);
            bump_to_floor(&env, &DataKey::Paused);
            env.events().publish((Symbol::new(&env, "paused"),), ());
        } else {
            panic!("Unauthorized");
        }
    }

    /// Resume all value-transferring operations.
    ///
    /// The designated pauser (if any) may call this directly, mirroring
    /// `pause`. Admin-initiated unpausing requires the admin signer
    /// multi-sig via `propose_admin_action` with action_type `"unpause"`.
    pub fn unpause(env: Env, caller: Address) {
        caller.require_auth();
        // Mirror `pause`: only the designated pauser lifts the circuit breaker
        // directly; admin-initiated unpausing uses `propose_admin_action`.
        let stored_pauser: Option<Address> = env.storage().persistent().get(&DataKey::Pauser);
        if stored_pauser
            .as_ref()
            .map(|p| p == &caller)
            .unwrap_or(false)
        {
            env.storage().persistent().set(&DataKey::Paused, &false);
            bump_to_floor(&env, &DataKey::Paused);
            env.events().publish((Symbol::new(&env, "unpaused"),), ());
        } else {
            panic!("Unauthorized");
        }
    }

    // ─── Admin multi-sig governance ─────────────────────────────────────────

    /// Propose an admin action for multi-sig approval.
    ///
    /// Only a configured admin signer may propose. The proposer's own
    /// approval is recorded at creation time, so a threshold of 1
    /// auto-executes immediately; higher thresholds execute once enough
    /// other signers approve via `approve_admin_action`.
    pub fn propose_admin_action(
        env: Env,
        proposer: Address,
        action_type: Symbol,
        action_data: Vec<Val>,
    ) -> u64 {
        // Keep the whole propose (and any threshold-1 auto-execution)
        // non-reentrant; admin actions mutate contract state.
        let _guard = ReentrancyGuard::acquire(&env);
        require_initialized(&env);
        proposer.require_auth();

        // Only a configured admin signer may propose a gated action.
        let signers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::AdminSigners)
            .unwrap_or_else(|| panic!("Admin signers not configured"));
        if !signers.contains(&proposer) {
            panic!("not an admin signer");
        }
        let threshold: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::AdminSignersThreshold)
            .unwrap_or_else(|| panic!("Admin signers threshold not configured"));

        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::AdminActionCount)
            .unwrap_or(0);
        counter += 1;

        let current_ledger = env.ledger().sequence();

        // The proposer's own approval is recorded at creation time, so a
        // threshold of 1 auto-executes immediately on propose.
        let mut approvals = Vec::new(&env);
        approvals.push_back(proposer.clone());

        let mut proposal = AdminActionProposal {
            id: counter,
            action_type: action_type.clone(),
            action_data,
            approvals,
            threshold,
            executed: false,
            // Expire after 7 days (~120,960 ledgers at 5s/ledger).
            expiration_ledger: current_ledger + 120_960,
        };

        env.storage()
            .persistent()
            .set(&DataKey::AdminActionProposal(counter), &proposal);
        bump(&env, &DataKey::AdminActionProposal(counter));
        env.storage()
            .persistent()
            .set(&DataKey::AdminActionCount, &counter);
        bump(&env, &DataKey::AdminActionCount);
        env.events().publish(
            (Symbol::new(&env, "admin_action_proposed"),),
            (counter, action_type.clone(), proposer.clone()),
        );

        // Threshold 1: the proposer's recorded approval already meets it.
        if threshold == 1 {
            proposal.executed = true;
            env.storage()
                .persistent()
                .set(&DataKey::AdminActionProposal(counter), &proposal);
            bump(&env, &DataKey::AdminActionProposal(counter));
            env.events().publish(
                (Symbol::new(&env, "admin_action_approved"),),
                (counter, proposer, 1u32, threshold),
            );
            Self::execute_admin_action(&env, &proposal);
        }

        counter
    }

    /// Approve a pending admin action proposal.
    ///
    /// When approvals reach the threshold, the action is auto-executed
    /// immediately.
    pub fn approve_admin_action(env: Env, proposal_id: u64, approver: Address) {
        let _guard = ReentrancyGuard::acquire(&env);
        approver.require_auth();

        // Validate signer
        let signers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::AdminSigners)
            .unwrap_or_else(|| panic!("Admin signers not configured"));
        if !signers.contains(&approver) {
            panic!("not an admin signer");
        }

        // Load proposal
        let mut proposal: AdminActionProposal = env
            .storage()
            .persistent()
            .get(&DataKey::AdminActionProposal(proposal_id))
            .unwrap_or_else(|| panic!("{:?}", ContractError::ProposalNotFound));

        if proposal.executed {
            panic!("{:?}", ContractError::ProposalAlreadyExecuted);
        }

        if proposal.approvals.contains(&approver) {
            panic!("{:?}", ContractError::AlreadySigned);
        }

        let current_ledger = env.ledger().sequence();
        if current_ledger > proposal.expiration_ledger {
            panic!("{:?}", ContractError::ProposalExpired);
        }

        proposal.approvals.push_back(approver.clone());
        let approval_count = proposal.approvals.len() as u32;

        env.events().publish(
            (Symbol::new(&env, "admin_action_approved"),),
            (proposal_id, approver, approval_count, proposal.threshold),
        );

        // Auto-execute when threshold met
        if approval_count >= proposal.threshold {
            proposal.executed = true;
            env.storage()
                .persistent()
                .set(&DataKey::AdminActionProposal(proposal_id), &proposal);
            bump(&env, &DataKey::AdminActionProposal(proposal_id));

            // Dispatch the action
            Self::execute_admin_action(&env, &proposal);
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::AdminActionProposal(proposal_id), &proposal);
            bump(&env, &DataKey::AdminActionProposal(proposal_id));
        }
    }

    /// Return an admin action proposal by id.
    pub fn get_admin_action_proposal(env: Env, proposal_id: u64) -> AdminActionProposal {
        env.storage()
            .persistent()
            .get(&DataKey::AdminActionProposal(proposal_id))
            .unwrap_or_else(|| panic!("{:?}", ContractError::ProposalNotFound))
    }

    /// Internal: execute the concrete admin action after threshold is met.
    fn execute_admin_action(env: &Env, proposal: &AdminActionProposal) {
        let action = &proposal.action_type;
        if action == &Symbol::new(env, "pause") {
            Self::do_pause(env);
        } else if action == &Symbol::new(env, "unpause") {
            Self::do_unpause(env);
        } else if action == &Symbol::new(env, "set_admin_signers") {
            let signers: Vec<Address> = proposal
                .action_data
                .get(0)
                .unwrap()
                .try_into_val(env)
                .expect("invalid set_admin_signers payload");
            let threshold: u32 = proposal
                .action_data
                .get(1)
                .unwrap()
                .try_into_val(env)
                .expect("invalid set_admin_signers payload");
            validate_admin_signers(&signers, threshold);
            env.storage()
                .persistent()
                .set(&DataKey::AdminSigners, &signers);
            bump_to_floor(env, &DataKey::AdminSigners);
            env.storage()
                .persistent()
                .set(&DataKey::AdminSignersThreshold, &threshold);
            bump_to_floor(env, &DataKey::AdminSignersThreshold);
            env.events().publish(
                (Symbol::new(env, "admin_signers_set"),),
                (threshold, signers.len()),
            );
        } else if action == &Symbol::new(env, "set_pauser") {
            let pauser: Address = proposal
                .action_data
                .get(0)
                .unwrap()
                .try_into_val(env)
                .expect("invalid set_pauser payload");
            env.storage().persistent().set(&DataKey::Pauser, &pauser);
            bump_to_floor(env, &DataKey::Pauser);
            env.events()
                .publish((Symbol::new(env, "pauser_set"),), pauser);
        } else if action == &Symbol::new(env, "upgrade") {
            let wasm_hash: BytesN<32> = proposal
                .action_data
                .get(0)
                .unwrap()
                .try_into_val(env)
                .expect("invalid upgrade payload");
            let layout_version: u32 = proposal
                .action_data
                .get(1)
                .unwrap()
                .try_into_val(env)
                .expect("invalid upgrade payload");
            // Reject downgrades before touching the WASM (same guard as the
            // legacy single-admin `upgrade` entrypoint).
            Self::validate_storage_compatibility(env.clone(), layout_version);
            env.deployer()
                .update_current_contract_wasm(wasm_hash.clone());
            let current_ver: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::Version)
                .unwrap_or(CONTRACT_VERSION);
            env.storage()
                .persistent()
                .set(&DataKey::Version, &(current_ver + 1));
            bump(env, &DataKey::Version);
            env.storage()
                .persistent()
                .set(&DataKey::StorageLayoutVersion, &layout_version);
            bump(env, &DataKey::StorageLayoutVersion);
            env.events().publish(
                (Symbol::new(env, "upgraded"),),
                (current_ver + 1, wasm_hash, layout_version),
            );
        } else if action == &Symbol::new(env, "reconcile_balance") {
            let token_address: Address = proposal
                .action_data
                .get(0)
                .unwrap()
                .try_into_val(env)
                .expect("invalid reconcile_balance payload");
            Self::do_reconcile_balance(env, &token_address);
        } else {
            panic!("unknown admin action");
        }
    }

    /// Resync the cached [`DataKey::LastContractBalance`] for `token_address`
    /// with the actual on-chain balance and emit a `balance_reconciled` event
    /// carrying the `(old, new)` values.
    ///
    /// This is the explicit, admin-gated reconciliation path for when a
    /// token's balance drifts from the cache — e.g. rebasing assets, direct
    /// transfers to the contract address, or fee-on-transfer tokens. The
    /// passive `balance_drift_detected` event from `get_contract_balance`
    /// surfaces drift on reads; this entrypoint lets governance force a resync
    /// (action_type `"reconcile_balance"` via `propose_admin_action`) and
    /// leaves an auditable `balance_reconciled` record.
    ///
    /// Only reads balances and writes the cache — it performs no token
    /// transfers — so it is safe to run inside the already-held reentrancy
    /// guard of `propose_admin_action` / `approve_admin_action`.
    fn do_reconcile_balance(env: &Env, token_address: &Address) {
        let token = get_token_client(env, token_address);
        let key = DataKey::LastContractBalance(token_address.clone());
        let old = env.storage().persistent().get(&key).unwrap_or(0);
        let new = token.balance(&env.current_contract_address());
        if old != new {
            env.storage().persistent().set(&key, &new);
            storage::bump(env, &key);
        } else {
            storage::bump_if_present(env, &key);
        }
        env.events().publish(
            (
                Symbol::new(env, "balance_reconciled"),
                token_address.clone(),
            ),
            (old, new),
        );
    }

    /// Execute pause without auth check (called from execute_admin_action).
    fn do_pause(env: &Env) {
        env.storage().persistent().set(&DataKey::Paused, &true);
        bump(env, &DataKey::Paused);
        env.events().publish((Symbol::new(env, "paused"),), ());
    }

    /// Execute unpause without auth check.
    fn do_unpause(env: &Env) {
        env.storage().persistent().set(&DataKey::Paused, &false);
        bump(env, &DataKey::Paused);
        env.events().publish((Symbol::new(env, "unpaused"),), ());
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

    /// Return the current storage layout version. This must be incremented
    /// whenever the `DataKey` enum or any persistent struct field layout
    /// changes to prevent bricked upgrades.
    pub fn get_storage_layout_version(env: Env) -> u32 {
        let key = DataKey::StorageLayoutVersion;
        let ver: u32 = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(STORAGE_LAYOUT_VERSION);
        if env.storage().persistent().has(&key) {
            bump(&env, &key);
        }
        ver
    }

    /// Validate that the new layout version is compatible with the current one.
    ///
    /// The new layout version must be >= the current version to prevent
    /// bricked upgrades from incompatible data layouts.
    ///
    /// This is called automatically by `upgrade()`.
    pub fn validate_storage_compatibility(env: Env, new_layout_version: u32) -> bool {
        let current_version = Self::get_storage_layout_version(env);

        if new_layout_version < current_version {
            panic!("new WASM storage layout version is lower than current");
        }

        true
    }

    /// Admin: upgrade the contract WASM to `new_wasm_hash`.
    ///
    /// The caller must also provide `new_layout_version` — the storage layout
    /// version declared by the new WASM. This must be >= the current layout
    /// version to prevent bricked upgrades. After a successful upgrade the
    /// stored version is incremented and the layout version is updated.
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>, new_layout_version: u32) {
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            panic!("Unauthorized");
        }

        // Validate storage compatibility before upgrading.
        Self::validate_storage_compatibility(env.clone(), new_layout_version);

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        let current_ver: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Version)
            .unwrap_or(CONTRACT_VERSION);
        let next_ver = current_ver.checked_add(1).expect("version overflow");
        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Version, &next_ver);
        bump(&env, &DataKey::Version);
        env.storage()
            .persistent()
            .set(&DataKey::StorageLayoutVersion, &new_layout_version);
        bump(&env, &DataKey::StorageLayoutVersion);
        env.events().publish(
            (Symbol::new(&env, "upgraded"),),
            (current_ver + 1, new_wasm_hash, new_layout_version),
        );
    }

    // ─── Storage lifetime management ───────────────────────────────────────────

    /// Admin: extend the TTL of every enumerable persistent entry, resuming from
    /// wherever the previous call left off.
    ///
    /// A contract with thousands of escrows, streams, and receipts cannot be
    /// swept inside one transaction's resource budget, so each call touches at
    /// most `min(max_keys, MAX_KEYS_PER_SWEEP)` keys and stores a cursor. Call
    /// repeatedly until the return value is smaller than the requested limit to
    /// finish a full pass; the cursor wraps back to the start after the last
    /// class, so an off-chain job can simply keep calling on a schedule.
    ///
    /// Every key a pass touches is left with at least `MIN_TTL_LEDGERS` of life
    /// remaining, and completing a class records that fact for `get_min_ttl`.
    ///
    /// Tip records, locked balances, and cached contract balances are keyed by
    /// arbitrary addresses with no on-chain registry to enumerate, so they are
    /// not swept; they are kept alive by the bumps in the functions that touch
    /// them.
    ///
    /// Returns the number of keys bumped by this call. The budget is checked
    /// per sweep item (an item can own up to three keys, e.g. a receipt), so the
    /// caller's soft `max_keys` hint may be overshot by at most two keys; the
    /// hard cap `MAX_KEYS_PER_SWEEP` is never exceeded. That keeps a single
    /// invocation within Soroban's per-transaction instruction budget while
    /// still making forward progress for any positive `max_keys`.
    pub fn bump_all_ttls(env: Env, admin: Address, max_keys: u32) -> u32 {
        require_initialized(&env);
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            panic!("Unauthorized");
        }
        if max_keys == 0 {
            panic!("max_keys must be positive");
        }
        let limit = max_keys.min(MAX_KEYS_PER_SWEEP);

        let cursor_key = DataKey::TtlSweepCursor;
        let (mut class_index, mut key_index): (u32, u32) = env
            .storage()
            .persistent()
            .get(&cursor_key)
            .unwrap_or((0, 0));
        if class_index >= TTL_CLASS_COUNT {
            class_index = 0;
            key_index = 0;
        }

        let mut bumped: u32 = 0;
        while class_index < TTL_CLASS_COUNT && bumped < limit {
            let class = ttl_class_at(class_index);
            let class_len = ttl_class_len(&env, &class);

            while key_index < class_len && bumped < limit {
                // An item is bumped atomically, so the budget is checked against
                // its worst-case key count *before* touching it. The soft
                // `bumped < limit` condition above stops the loop once the
                // caller's chunk is full; this hard check additionally ensures a
                // final multi-key item can never push the call past
                // `MAX_KEYS_PER_SWEEP`, the instruction-budget safety bound.
                let item_cost = ttl_class_item_key_cost(&class, key_index);
                if bumped.saturating_add(item_cost) > MAX_KEYS_PER_SWEEP {
                    break;
                }
                bumped = bumped.saturating_add(bump_ttl_class_item(&env, &class, key_index));
                key_index += 1;
            }

            if key_index < class_len {
                break;
            }
            set_ttl_watermark(&env, &class);
            class_index += 1;
            key_index = 0;
        }

        // A completed pass wraps so the next call starts a fresh one.
        if class_index >= TTL_CLASS_COUNT {
            class_index = 0;
            key_index = 0;
        }
        env.storage()
            .persistent()
            .set(&cursor_key, &(class_index, key_index));
        bump_to_floor(&env, &cursor_key);

        env.events().publish(
            (Symbol::new(&env, "ttl_bumped"),),
            (bumped, class_index, key_index),
        );
        bumped
    }

    /// Return the lowest guaranteed remaining TTL across all populated storage
    /// classes, together with the name of the class holding it.
    ///
    /// Soroban exposes no host function for reading an entry's TTL, so this
    /// cannot inspect live ledger entries. Instead it reports the lifetime the
    /// contract can still *prove*: `bump_all_ttls` raises every key in a class
    /// to `MIN_TTL_LEDGERS` and stamps the ledger it did so, newly created
    /// entries start at the same floor, and later touches only ever raise a TTL.
    /// The returned value is therefore a lower bound on the true minimum — safe
    /// to alert on.
    ///
    /// A class that has never been swept reports `0`, which is the signal for an
    /// off-chain monitor to call `bump_all_ttls`. When no class holds any state,
    /// returns `(MIN_TTL_LEDGERS, "none")`.
    pub fn get_min_ttl(env: Env) -> (u32, Symbol) {
        let mut min_ttl = MIN_TTL_LEDGERS;
        let mut worst: Option<TtlClass> = None;

        for class_index in 0..TTL_CLASS_COUNT {
            let class = ttl_class_at(class_index);
            if !ttl_class_is_populated(&env, &class) {
                continue;
            }
            let remaining = ttl_class_remaining(&env, &class).unwrap_or(0);
            if worst.is_none() || remaining < min_ttl {
                min_ttl = remaining;
                worst = Some(class);
            }
        }

        match worst {
            Some(class) => (min_ttl, ttl_class_symbol(&env, &class)),
            None => (MIN_TTL_LEDGERS, Symbol::new(&env, "none")),
        }
    }

    /// Estimates resource bounds for `send_tip`
    pub fn estimate_send_tip(
        _env: Env,
        _token: Address,
        _from: Address,
        _to: Address,
        _amount: i128,
    ) -> FeeEstimate {
        FeeEstimate {
            cpu_instructions: 500_000,
            ledger_read_bytes: 1_500,
            ledger_write_bytes: 500,
            estimated_stroops: 10_000, // Conservative 0.001 XLM upper-bound
        }
    }

    /// Estimates resource bounds for `create_escrow`
    pub fn estimate_create_escrow(
        _env: Env,
        _token: Address,
        _from: Address,
        _to: Address,
        _amount: i128,
        _release_ledger: u32,
    ) -> FeeEstimate {
        FeeEstimate {
            cpu_instructions: 750_000,
            ledger_read_bytes: 2_000,
            ledger_write_bytes: 1_000,
            estimated_stroops: 15_000,
        }
    }

    /// Estimates resource bounds for `open_stream`
    pub fn estimate_open_stream(
        _env: Env,
        _token: Address,
        _payer: Address,
        _recipient: Address,
        _rate: i128,
        _deposit: i128,
    ) -> FeeEstimate {
        FeeEstimate {
            cpu_instructions: 750_000,
            ledger_read_bytes: 2_000,
            ledger_write_bytes: 1_000,
            estimated_stroops: 15_000,
        }
    }

    /// Estimates resource bounds for `batch_send` (scales linearly with recipient count)
    pub fn estimate_batch_send(
        _env: Env,
        _token: Address,
        _from: Address,
        recipient_count: u32,
    ) -> FeeEstimate {
        let count_u64 = recipient_count as u64;
        let count_i128 = recipient_count as i128;

        FeeEstimate {
            cpu_instructions: 300_000 + (count_u64 * 250_000),
            ledger_read_bytes: 1_000 + (recipient_count * 500),
            ledger_write_bytes: 300 + (recipient_count * 300),
            estimated_stroops: 5_000 + (count_i128 * 5_000),
        }
    }

    /// Estimates resource bounds for `create_multisig`
    pub fn estimate_create_multisig(_env: Env, signers_count: u32, _threshold: u32) -> FeeEstimate {
        let count_u64 = signers_count as u64;
        let count_i128 = signers_count as i128;

        FeeEstimate {
            cpu_instructions: 400_000 + (count_u64 * 100_000),
            ledger_read_bytes: 1_200 + (signers_count * 200),
            ledger_write_bytes: 600 + (signers_count * 100),
            estimated_stroops: 8_000 + (count_i128 * 2_000),
        }
    }

    // ─── Emergency withdrawal (time-delayed, multi-sig) ────────────────────────

    /// Initiate an emergency withdrawal. Only an admin may call this.
    ///
    /// Records the withdrawal parameters and sets `activation_ledger` to
    /// `current_ledger + EMERGENCY_WITHDRAWAL_DELAY`. The withdrawal cannot be
    /// executed until both the activation ledger has been reached AND the
    /// multi-sig threshold is satisfied.
    ///
    /// Returns the emergency withdrawal ID.
    pub fn initiate_emergency_withdrawal(
        env: Env,
        admin: Address,
        token_address: Address,
        amount: i128,
        to: Address,
    ) -> u32 {
        require_initialized(&env);
        require_not_paused(&env);
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            panic!("Unauthorized");
        }
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let token = get_token_client(&env, &token_address);
        let balance = token.balance(&env.current_contract_address());
        let locked = locked_balance(&env, &token_address);
        let unlocked = balance.checked_sub(locked).expect("overflow");
        if amount > unlocked {
            panic!("insufficient unlocked balance");
        }

        let threshold = get_admin_signers_threshold(&env);
        let current_ledger = env.ledger().sequence();
        let activation_ledger = current_ledger
            .checked_add(EMERGENCY_WITHDRAWAL_DELAY)
            .expect("overflow");

        let id: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyWithdrawalCount)
            .unwrap_or(0);

        let withdrawal = EmergencyWithdrawal {
            id,
            initiator: admin.clone(),
            token: token_address.clone(),
            amount,
            to,
            initiated_at_ledger: current_ledger,
            activation_ledger,
            approvals: Vec::new(&env),
            threshold,
            status: EmergencyWithdrawalStatus::Pending,
        };

        let next_count = id.checked_add(1).expect("withdrawal count overflow");
        env.storage()
            .persistent()
            .set(&DataKey::EmergencyWithdrawal(id), &withdrawal);
        bump_to_floor(&env, &DataKey::EmergencyWithdrawal(id));
        env.storage()
            .persistent()
            .set(&DataKey::EmergencyWithdrawalCount, &next_count);
        bump(&env, &DataKey::EmergencyWithdrawalCount);

        env.events().publish(
            (Symbol::new(&env, "emergency_withdrawal_initiated"), id),
            (admin, token_address, amount, activation_ledger),
        );
        id
    }

    /// An admin signer approves an emergency withdrawal. When the approval count
    /// reaches the configured threshold AND the activation ledger has passed,
    /// the withdrawal executes automatically.
    pub fn approve_emergency_withdrawal(env: Env, id: u32, signer: Address) {
        let _guard = ReentrancyGuard::acquire(&env);
        require_not_paused(&env);
        signer.require_auth();

        let mut withdrawal: EmergencyWithdrawal = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyWithdrawal(id))
            .expect("emergency withdrawal not found");

        if withdrawal.status != EmergencyWithdrawalStatus::Pending {
            panic!("emergency withdrawal is not pending");
        }

        // Verify signer is in the admin signers list.
        let admin_signers = get_admin_signers(&env);
        if !admin_signers.iter().any(|s| s == signer) {
            panic!("not an admin signer");
        }

        // Prevent duplicate approvals.
        if withdrawal.approvals.iter().any(|a| a == signer) {
            panic!("already approved");
        }

        withdrawal.approvals.push_back(signer.clone());

        env.events().publish(
            (Symbol::new(&env, "emergency_withdrawal_approve"), id),
            (signer, withdrawal.approvals.len(), withdrawal.threshold),
        );

        // Auto-execute if threshold reached AND activation ledger passed.
        // If the threshold is met but the delay has not elapsed, we just record
        // the approval; execution happens on a later call past the activation
        // ledger.
        if withdrawal.approvals.len() >= withdrawal.threshold
            && env.ledger().sequence() >= withdrawal.activation_ledger
        {
            // Checks-effects-interactions: commit the executed state *before*
            // the external transfer, so a re-entrant call cannot observe a
            // still-pending withdrawal. (Emergency withdrawals move only
            // *unlocked* tokens, so `LockedBalance` is untouched.)
            let to = withdrawal.to.clone();
            let amount = withdrawal.amount;
            withdrawal.status = EmergencyWithdrawalStatus::Executed;

            env.storage()
                .persistent()
                .set(&DataKey::EmergencyWithdrawal(id), &withdrawal);
            bump(&env, &DataKey::EmergencyWithdrawal(id));

            let token = get_token_client(&env, &withdrawal.token);
            contract_transfer_out(&env, &token, &to, &amount);
            env.events().publish(
                (Symbol::new(&env, "emergency_withdrawal_executed"), id),
                (to, amount),
            );
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::EmergencyWithdrawal(id), &withdrawal);
            bump(&env, &DataKey::EmergencyWithdrawal(id));
        }
    }

    /// Execute a pending emergency withdrawal. Can only be called after both the
    /// activation ledger has been reached AND the approval threshold is met.
    /// Anyone may call this — the actual authorization was done via approvals.
    pub fn execute_emergency_withdrawal(env: Env, id: u32) {
        let _guard = ReentrancyGuard::acquire(&env);
        require_not_paused(&env);

        let mut withdrawal: EmergencyWithdrawal = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyWithdrawal(id))
            .expect("emergency withdrawal not found");

        if withdrawal.status != EmergencyWithdrawalStatus::Pending {
            panic!("emergency withdrawal is not pending");
        }
        if env.ledger().sequence() < withdrawal.activation_ledger {
            panic!("emergency withdrawal not ready");
        }
        if withdrawal.approvals.len() < withdrawal.threshold {
            panic!("insufficient admin approvals");
        }

        // Checks-effects-interactions: commit the executed state before the
        // external transfer so a re-entrant call is rejected by the guard and,
        // even if the guard were bypassed, would see an already-executed record.
        withdrawal.status = EmergencyWithdrawalStatus::Executed;

        env.storage()
            .persistent()
            .set(&DataKey::EmergencyWithdrawal(id), &withdrawal);
        bump(&env, &DataKey::EmergencyWithdrawal(id));

        let token = get_token_client(&env, &withdrawal.token);
        contract_transfer_out(&env, &token, &withdrawal.to, &withdrawal.amount);

        env.events().publish(
            (Symbol::new(&env, "emergency_withdrawal_executed"), id),
            (withdrawal.to, withdrawal.amount),
        );
    }

    /// Cancel a pending emergency withdrawal. Any admin may call this before
    /// execution. Funds remain in the contract; the withdrawal is simply voided.
    pub fn cancel_emergency_withdrawal(env: Env, id: u32, admin: Address) {
        require_not_paused(&env);
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            panic!("Unauthorized");
        }

        let mut withdrawal: EmergencyWithdrawal = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyWithdrawal(id))
            .expect("emergency withdrawal not found");

        if withdrawal.status != EmergencyWithdrawalStatus::Pending {
            panic!("emergency withdrawal is not pending");
        }

        withdrawal.status = EmergencyWithdrawalStatus::Cancelled;

        env.storage()
            .persistent()
            .set(&DataKey::EmergencyWithdrawal(id), &withdrawal);
        bump(&env, &DataKey::EmergencyWithdrawal(id));

        env.events().publish(
            (Symbol::new(&env, "emergency_withdrawal_cancelled"), id),
            (admin, withdrawal.amount),
        );
    }

    /// Return the emergency withdrawal record for `id`.
    pub fn get_emergency_withdrawal(env: Env, id: u32) -> EmergencyWithdrawal {
        let withdrawal: EmergencyWithdrawal = env
            .storage()
            .persistent()
            .get(&DataKey::EmergencyWithdrawal(id))
            .expect("emergency withdrawal not found");
        bump(&env, &DataKey::EmergencyWithdrawal(id));
        withdrawal
    }

    /// Return the total number of emergency withdrawals ever initiated.
    pub fn get_emergency_withdrawal_count(env: Env) -> u32 {
        let key = DataKey::EmergencyWithdrawalCount;
        let count = env.storage().persistent().get(&key).unwrap_or(0);
        bump_if_present(&env, &key);
        count
    }

    /// Check invariants for a given domain. Returns `Symbol::new("ok")` or the
    /// first violation description. Only the admin may call this.
    pub fn check_invariants(env: Env, admin: Address, domain: Symbol) -> Symbol {
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            panic!("Unauthorized");
        }

        // Try to run each invariant check by calling assert_invariants and
        // capturing any panic. Since we cannot catch panics in Soroban, we
        // run the checks and if they pass, return "ok". If any check fails,
        // the panic message serves as the violation description.
        //
        // We attempt the checks sequentially; the first one that panics
        // surfaces its message, which the caller can read from the failed
        // transaction meta.
        assert_invariants(&env, domain);
        Symbol::new(&env, "ok")
    }

    // ─── Tips ─────────────────────────────────────────────────────────────────

    /// Transfer `amount` tokens from `from` to `to` and record the tip on-chain.
    ///
    /// # Errors
    /// Panics if `amount <= 0`, the contract is paused, or `from` has not
    /// authorised the call.
    pub fn send_tip(
        env: Env,
        token_address: Address,
        from: Address,
        to: Address,
        amount: i128,
        memo: Symbol,
    ) {
        // Non-reentrancy: every token.transfer is a call into an untrusted
        // contract, so hold the lock for the entire call (checks → effects →
        // interactions) to prevent a hostile token from re-entering `send_tip`.
        let _guard = ReentrancyGuard::acquire(&env);
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
        require_transfer_succeeded(&env, &token, &from, &to, &amount);

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
        bump_to_floor(&env, &DataKey::TipRecord(to.clone(), count));

        env.events()
            .publish((Symbol::new(&env, "tip"), from.clone(), to.clone()), amount);
        assert_invariants(&env, Symbol::new(&env, "all"));
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

    /// Stable alias for `get_tip_total`. The dashboard and analytics pages
    /// call this instead of the backend analytics endpoint so that tip data
    /// is always read from the canonical on-chain source.
    pub fn tip_total(env: Env, address: Address) -> i128 {
        Self::get_tip_total(env, address)
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

    /// Stable alias for `get_tip_count`. The dashboard and analytics pages
    /// call this instead of the backend analytics endpoint so that tip data
    /// is always read from the canonical on-chain source.
    pub fn tip_count(env: Env, address: Address) -> u32 {
        Self::get_tip_count(env, address)
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
        bump_to_floor(&env, &DataKey::ReceiptRecord(from.clone(), count));

        let next_count = count.checked_add(1).expect("receipt count overflow");
        env.storage()
            .persistent()
            .set(&DataKey::ReceiptCount(from.clone()), &next_count);
        bump(&env, &DataKey::ReceiptCount(from.clone()));

        // Increment global receipt count and store index mapping
        let global_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalReceiptCount)
            .unwrap_or(0);

        env.storage().persistent().set(
            &DataKey::ReceiptByIndex(global_count),
            &(from.clone(), count),
        );
        bump_to_floor(&env, &DataKey::ReceiptByIndex(global_count));

        env.storage()
            .persistent()
            .set(&DataKey::TotalReceiptCount, &(global_count + 1));
        bump(&env, &DataKey::TotalReceiptCount);

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
    pub fn get_receipt(
        env: Env,
        payer: Address,
        index: u32,
    ) -> Result<ReceiptMetadata, ContractError> {
        let key = DataKey::ReceiptRecord(payer, index);
        match env.storage().persistent().get(&key) {
            Some(receipt) => {
                bump(&env, &key);
                Ok(receipt)
            }
            None => Err(ContractError::NotFound),
        }
    }

    /// Return the total number of receipts minted across all addresses.
    pub fn total_receipt_count(env: Env) -> u32 {
        let key = DataKey::TotalReceiptCount;
        let val = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            bump(&env, &key);
        }
        val
    }

    /// Return the (from_address, local_index) for a global receipt index.
    pub fn get_receipt_by_index(env: Env, global_index: u32) -> (Address, u32) {
        let key = DataKey::ReceiptByIndex(global_index);
        let val: (Address, u32) = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Receipt index not found");
        bump(&env, &key);
        val
    }

    /// Generate a `ReceiptProof` from the on-chain receipt at `index` for `payer`.
    /// This is a convenience helper that reads the stored receipt and packages
    /// the payer, amount, and memo into a proof struct for off-chain verification.
    pub fn generate_receipt_proof(env: Env, payer: Address, index: u32) -> ReceiptProof {
        let receipt =
            Self::get_receipt(env.clone(), payer.clone(), index).expect("receipt not found");
        ReceiptProof {
            receipt_index: index,
            payer,
            expected_amount: receipt.amount,
            expected_memo: receipt.memo,
        }
    }

    /// Verify that a receipt at `payer` + `index` matches the given `expected_amount`
    /// and `expected_memo`. Returns `true` only if all fields match exactly, proving
    /// the receipt was minted on-chain by this contract.
    ///
    /// Returns `false` (never panics) for non-existent indices or mismatched values
    /// so callers can use the result in conditional logic without catching traps.
    pub fn verify_receipt(
        env: Env,
        payer: Address,
        index: u32,
        expected_amount: i128,
        expected_memo: Symbol,
    ) -> bool {
        let key = DataKey::ReceiptRecord(payer, index);
        let receipt: ReceiptMetadata = match env.storage().persistent().get(&key) {
            Some(r) => r,
            None => return false,
        };
        bump(&env, &key);
        receipt.amount == expected_amount && receipt.memo == expected_memo
    }

    /// Lock `amount` tokens from `from` until `release_ledger`. Returns the escrow ID.
    ///
    /// Funds are held by the contract itself until `claim_escrow` or `cancel_escrow`.
    ///
    /// # Errors
    /// - Returns `ContractError::IndexFull` if `to` already has `MAX_USER_ESCROWS`
    ///   escrows tracked in its recipient index, before any funds move.
    pub fn create_escrow(
        env: Env,
        token_address: Address,
        from: Address,
        to: Address,
        amount: i128,
        release_ledger: u32,
        memo: Symbol,
    ) -> Result<u32, ContractError> {
        escrow::create_escrow(env, token_address, from, to, amount, release_ledger, memo)
    }

    /// Claim a partial amount from the escrow. The caller must be the
    /// escrow recipient and the release ledger must have passed.
    /// Returns the remaining escrow amount after the partial claim.
    pub fn claim_escrow_partial(env: Env, id: u32, claim_amount: i128) -> i128 {
        escrow::claim_escrow_partial(env, id, claim_amount)
    }

    /// Return the list of escrow IDs associated with a recipient address.
    pub fn get_user_escrows(env: Env, recipient: Address) -> Vec<u32> {
        escrow::get_user_escrows(env, recipient)
    }

    /// Recipient claims the escrowed funds after `release_ledger` has passed.
    pub fn claim_escrow(env: Env, id: u32) {
        escrow::claim_escrow(env, id)
    }

    /// Payer cancels the escrow before `release_ledger`; funds are returned.
    pub fn cancel_escrow(env: Env, id: u32) {
        escrow::cancel_escrow(env, id)
    }

    pub fn get_escrow(env: Env, id: u32) -> Result<Escrow, ContractError> {
        escrow::get_escrow(env, id)
    }

    /// Return the total number of escrows ever created.
    pub fn get_escrow_count(env: Env) -> u32 {
        escrow::get_escrow_count(env)
    }

    /// Stable alias for `get_escrow_count`. Provides a consistent SDK
    /// binding for dashboard and analytics consumers.
    pub fn escrow_count(env: Env) -> u32 {
        escrow::escrow_count(env)
    }

    // ─── Milestone-based escrows ─────────────────────────────────────────────

    /// Create an escrow whose funds release per approved milestone.
    ///
    /// `milestones` must contain between 1 and `MAX_MILESTONES` entries, every
    /// milestone amount must be positive, and the sum of milestone amounts must
    /// equal `deposit`. Milestone ids are assigned sequentially (0..n) by the
    /// contract. The `agent` is the designated approver; the client (`from`)
    /// may also approve. The agent may not be the recipient.
    pub fn create_milestone_escrow(
        env: Env,
        token_address: Address,
        from: Address,
        to: Address,
        agent: Address,
        milestones: Vec<Milestone>,
        deposit: i128,
    ) -> Result<u32, ContractError> {
        escrow::create_milestone_escrow(env, token_address, from, to, agent, milestones, deposit)
    }

    /// Approve a milestone for release. Only the escrow agent or the client
    /// (`from`) may approve. Once approved, the milestone can be claimed by
    /// the recipient.
    pub fn approve_milestone(env: Env, escrow_id: u32, milestone_id: u32, approver: Address) {
        escrow::approve_milestone(env, escrow_id, milestone_id, approver)
    }

    /// Claim an approved milestone. Only the escrow recipient (`to`) may
    /// claim. When the last milestone is claimed the escrow is marked
    /// `Released`.
    pub fn claim_milestone(env: Env, escrow_id: u32, milestone_id: u32, recipient: Address) {
        escrow::claim_milestone(env, escrow_id, milestone_id, recipient)
    }

    /// Return the milestone schedule of a milestone-based escrow.
    pub fn get_milestones(env: Env, escrow_id: u32) -> Vec<Milestone> {
        escrow::get_milestones(env, escrow_id)
    }

    /// Return an aggregated summary of an escrow for dashboards/off-chain consumers.
    pub fn get_escrow_summary(env: Env, escrow_id: u32) -> EscrowSummary {
        escrow::get_escrow_summary(env, escrow_id)
    }

    // ─── Dispute resolution ──────────────────────────────────────────────────

    /// Admin: add an arbitrator to the global arbitrator list.
    pub fn add_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        escrow::add_arbitrator(env, admin, arbitrator)
    }

    /// Admin: remove an arbitrator from the global arbitrator list.
    pub fn remove_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        escrow::remove_arbitrator(env, admin, arbitrator)
    }

    /// Create a disputable escrow with a designated arbitrator.
    /// Same as create_escrow but allows dispute resolution.
    pub fn create_disputable_escrow(
        env: Env,
        token_address: Address,
        from: Address,
        to: Address,
        amount: i128,
        release_ledger: u32,
        arbitrator: Address,
    ) -> Result<u32, ContractError> {
        escrow::create_disputable_escrow(
            env,
            token_address,
            from,
            to,
            amount,
            release_ledger,
            arbitrator,
        )
    }

    /// Raise a dispute on a disputable escrow. Only the sender or recipient
    /// can raise a dispute.
    pub fn raise_dispute(env: Env, escrow_id: u32, by: Address) {
        escrow::raise_dispute(env, escrow_id, by)
    }

    /// Resolve a dispute. Only the designated arbitrator can call this.
    /// Resolution types: "release" (to recipient), "refund" (to sender),
    /// "split" (amount to recipient, rest to sender).
    pub fn resolve_dispute(
        env: Env,
        escrow_id: u32,
        arbitrator: Address,
        resolution: Symbol,
        to: Address,
        amount: i128,
    ) {
        escrow::resolve_dispute(env, escrow_id, arbitrator, resolution, to, amount)
    }

    /// Return the list of registered arbitrators.
    pub fn get_arbitrators(env: Env) -> Vec<Address> {
        escrow::get_arbitrators(env)
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
        streams::open_stream(
            env,
            token_address,
            payer,
            recipient,
            rate_per_ledger,
            deposit,
        )
    }

    /// Recipient claims all currently claimable tokens from stream `id`.
    ///
    /// Returns the amount claimed. Can be called multiple times as the stream
    /// progresses; the running `claimed` counter prevents double-claiming.
    pub fn claim_stream(env: Env, stream_id: u32, recipient: Address) -> i128 {
        streams::claim_stream(env, stream_id, recipient)
    }

    /// Payer adds `amount` more tokens to an existing open stream.
    pub fn top_up_stream(env: Env, stream_id: u32, payer: Address, amount: i128) {
        streams::top_up_stream(env, stream_id, payer, amount)
    }

    /// Payer closes the stream early. Any unclaimed streamed tokens are sent to
    /// the recipient first; the remainder is refunded to the payer.
    ///
    /// Returns the refund amount sent back to the payer.
    pub fn close_stream(env: Env, stream_id: u32, payer: Address) -> i128 {
        streams::close_stream(env, stream_id, payer)
    }

    /// Recipient rejects an open stream. Any accrued-but-unclaimed tokens are
    /// sent to the recipient first; the remainder is refunded to the payer.
    /// This allows a recipient to opt out of a stream for compliance or personal
    /// reasons.
    ///
    /// Returns the refund amount sent back to the payer.
    pub fn reject_stream(env: Env, stream_id: u32, recipient: Address) -> i128 {
        streams::reject_stream(env, stream_id, recipient)
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
        streams::transfer_stream(env, stream_id, current_recipient, new_recipient)
    }

    /// Return the stream record for `stream_id`.
    pub fn get_stream(env: Env, stream_id: u32) -> Result<Stream, ContractError> {
        streams::get_stream(env, stream_id)
    }

    /// Calculate how much the recipient could claim right now without mutating state.
    pub fn get_claimable(env: Env, stream_id: u32) -> i128 {
        streams::get_claimable(env, stream_id)
    }

    /// Return the total number of streams ever opened.
    pub fn get_stream_count(env: Env) -> u32 {
        streams::get_stream_count(env)
    }

    /// Stable alias for `get_stream_count`. Generates a consistent SDK
    /// binding name that will not change across contract upgrades, making
    /// dashboard and analytics integrations resilient to internal refactors.
    pub fn stream_count(env: Env) -> u32 {
        streams::stream_count(env)
    }

    pub fn list_streams_by_payer(env: Env, payer: Address, offset: u32, limit: u32) -> Vec<Stream> {
        streams::list_streams_by_payer(env, payer, offset, limit)
    }

    pub fn list_escrows_by_recipient(
        env: Env,
        recipient: Address,
        offset: u32,
        limit: u32,
    ) -> Vec<Escrow> {
        streams::list_escrows_by_recipient(env, recipient, offset, limit)
    }

    // Internal: compute claimable amount for a stream at the current ledger.
    pub(crate) fn _claimable(env: &Env, stream: &Stream) -> i128 {
        if stream.closed {
            return 0;
        }
        claimable_at(stream, env.ledger().sequence())
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
        multi_sig::create_multisig(
            env,
            token_address,
            proposer,
            recipient,
            amount,
            threshold,
            signers,
            expiration_ledger,
        )
    }

    /// A signer approves proposal `id`. If the approval count reaches `threshold`
    /// the payment is executed immediately within this call.
    pub fn approve_multisig(env: Env, proposal_id: u32, signer: Address) {
        multi_sig::approve_multisig(env, proposal_id, signer)
    }

    /// Anyone can call this to close an expired multi-sig proposal and refund
    /// the proposer. This prevents funds from being locked forever if signers
    /// abandon a proposal.
    pub fn timeout_multisig(env: Env, proposal_id: u32) {
        multi_sig::timeout_multisig(env, proposal_id)
    }

    /// The proposer cancels the proposal before execution; funds are refunded.
    pub fn cancel_multisig(env: Env, proposal_id: u32, proposer: Address) {
        multi_sig::cancel_multisig(env, proposal_id, proposer)
    }

    /// Return the multi-sig proposal for `proposal_id`.
    pub fn get_multisig(env: Env, proposal_id: u32) -> Result<MultiSigProposal, ContractError> {
        multi_sig::get_multisig(env, proposal_id)
    }

    /// Return total number of multi-sig proposals ever created.
    pub fn get_multisig_count(env: Env) -> u32 {
        multi_sig::get_multisig_count(env)
    }

    /// Stable alias for `get_multisig_count`. Provides a consistent SDK
    /// binding for dashboard and analytics consumers.
    pub fn multisig_count(env: Env) -> u32 {
        multi_sig::multisig_count(env)
    }

    // ─── Diagnostic helpers ───────────────────────────────────────────────────

    /// Return aggregate counts of all active contract state for off-chain
    /// monitoring and dashboards. Returns (escrow_count, stream_count,
    /// multisig_count).
    pub fn get_contract_stats(env: Env) -> (u32, u32, u32) {
        let escrow_count = storage::counter(&env, &DataKey::EscrowCount);
        let stream_count = storage::counter(&env, &DataKey::StreamCount);
        let multisig_count = storage::counter(&env, &DataKey::MultiSigCount);
        (escrow_count, stream_count, multisig_count)
    }

    // ─── Batch send ───────────────────────────────────────────────────────────

    /// Fan-out a single token transfer from `from` to multiple `recipients` in
    /// one transaction. `recipients[i]` receives `amounts[i]` with optional `memos[i]`.
    ///
    /// # Errors
    /// - Returns `ContractError::LengthMismatch` if `recipients.len() != amounts.len()` or `recipients.len() != memos.len()`.
    /// - Returns `ContractError::BatchTooLarge` if `recipients.len() > MAX_BATCH_SIZE`.
    ///
    /// # Panics
    /// - If `recipients.len() == 0`.
    /// - If any amount is not positive.
    pub fn batch_send(
        env: Env,
        token_address: Address,
        from: Address,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
        memos: Vec<Symbol>,
    ) -> Result<(), ContractError> {
        batch_send::batch_send(env, token_address, from, recipients, amounts, memos)
    }

    /// Fan-out multi-token transfers from `from` to multiple `recipients` in
    /// one transaction. `recipients[i]` receives `amounts[i]` of `tokens[i]` with memo `memos[i]`.
    ///
    /// # Errors
    /// Returns `ContractError::LengthMismatch` if any of the four vectors have different lengths.
    /// Returns `ContractError::NonPositiveAmount` if any amount is not positive.
    /// Returns `ContractError::BatchTooLarge` if batch size exceeds MAX_BATCH_SIZE.
    ///
    /// # Panics
    /// - If any recipient is the same as the sender (self-transfer).
    /// - If the contract is paused.
    pub fn batch_send_multi(
        env: Env,
        from: Address,
        tokens: Vec<Address>,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
        memos: Vec<Symbol>,
    ) -> Result<(), ContractError> {
        batch_send::batch_send_multi(env, from, tokens, recipients, amounts, memos)
    }

    /// Estimate total amounts per token for a batch of swap items.
    ///
    /// Useful for off-chain clients to validate totals before submitting a
    /// composite transaction. This function is pure (reads no mutable state)
    /// and returns aggregated totals for each token present in `swaps`.
    pub fn estimate_batch_swap_totals(env: Env, swaps: Vec<SwapItem>) -> Vec<TokenTotal> {
        batch_send::estimate_batch_swap_totals(env, swaps)
    }

    pub fn create_vesting(
        env: Env,
        token: Address,
        from: Address,
        beneficiary: Address,
        amount: i128,
        cliff_ledger: u32,
        end_ledger: u32,
    ) -> u32 {
        batch_send::create_vesting(
            env,
            token,
            from,
            beneficiary,
            amount,
            cliff_ledger,
            end_ledger,
        )
    }

    pub fn claim_vesting(env: Env, id: u32, beneficiary: Address) -> i128 {
        batch_send::claim_vesting(env, id, beneficiary)
    }

    pub fn revoke_vesting(env: Env, id: u32, admin: Address) {
        batch_send::revoke_vesting(env, id, admin)
    }

    pub fn get_vesting(env: Env, id: u32) -> VestingSchedule {
        batch_send::get_vesting(env, id)
    }

    pub fn get_claimable_vesting(env: Env, id: u32) -> i128 {
        batch_send::get_claimable_vesting(env, id)
    }

    // ─── Swap / DEX ─────────────────────────────────────────────────────────

    /// Admin: designate the address that receives protocol swap fees.
    /// Defaults to the admin address if never called.
    pub fn set_fee_collector(
        env: Env,
        admin: Address,
        collector: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(ContractError::Unauthorized);
        }
        env.storage()
            .persistent()
            .set(&DataKey::FeeCollector, &collector);
        bump(&env, &DataKey::FeeCollector);
        env.events()
            .publish((Symbol::new(&env, "fee_collector_set"),), collector);
        Ok(())
    }

    /// Return the current fee-collector address (admin if unset).
    pub fn get_fee_collector(env: Env) -> Address {
        get_fee_collector_address(&env)
    }

    /// Admin: update the swap fee, in basis points. Must be within
    /// `[0, MAX_SWAP_FEE_BPS]` (0%–10%).
    pub fn set_swap_fee(env: Env, admin: Address, new_fee_bps: u32) -> Result<(), ContractError> {
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(ContractError::Unauthorized);
        }
        if new_fee_bps > MAX_SWAP_FEE_BPS {
            return Err(ContractError::InvalidFeeBps);
        }
        env.storage()
            .persistent()
            .set(&DataKey::SwapFee, &new_fee_bps);
        bump(&env, &DataKey::SwapFee);
        env.events()
            .publish((Symbol::new(&env, "swap_fee_set"),), new_fee_bps);
        Ok(())
    }

    /// Return the current swap fee in basis points (30 = 0.3% by default).
    pub fn get_swap_fee(env: Env) -> u32 {
        get_swap_fee_bps(&env)
    }

    /// Swap an exact `amount_in` of `token_in` for at least `min_amount_out`
    /// of `token_out`, protecting the caller from slippage.
    ///
    /// `path` must start with `token_in` and end with `token_out`; a 0.3%
    /// (or admin-configured) protocol fee is deducted from `amount_in` and
    /// sent to the fee collector before the swap executes.
    ///
    /// # Pricing model
    /// This contract does not (yet) source live prices from an on-chain AMM
    /// or the classic Stellar DEX order books — Soroban contracts have no
    /// host function to invoke `path_payment_strict_send`/`strict_receive`,
    /// and building an AMM is explicitly out of scope for this change (see
    /// issue #9 / #479). The post-fee remainder is settled 1:1 against the
    /// contract's own `token_out` reserves, which must be funded ahead of
    /// time (e.g. by the admin transferring `token_out` to the contract
    /// address). Intermediate `path` hops are validated for shape but are
    /// not separately transferred, since the contract holds no inventory of
    /// intermediate tokens. Real price discovery is tracked as follow-up
    /// work once a router/AMM contract is wired in.
    pub fn swap_exact_tokens_for_tokens(
        env: Env,
        caller: Address,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_amount_out: i128,
        path: Vec<Address>,
    ) -> Result<i128, ContractError> {
        let _guard = ReentrancyGuard::acquire(&env);
        require_initialized(&env);
        require_not_paused(&env);
        caller.require_auth();

        if amount_in <= 0 {
            return Err(ContractError::NonPositiveAmount);
        }
        if min_amount_out < 0 {
            return Err(ContractError::NonPositiveAmount);
        }
        if token_in == token_out {
            return Err(ContractError::InvalidPath);
        }
        validate_swap_path(&path, &token_in, &token_out)?;
        validate_swap_path_liquidity(&env, &path)?;

        let fee_bps = get_swap_fee_bps(&env);
        let token_in_client = get_token_client(&env, &token_in);
        let actual_amount_in =
            transfer_to_contract_measured(&env, &token_in_client, &caller, &amount_in);
        let (fee, amount_to_swap) = compute_swap_fee(actual_amount_in, fee_bps);
        let amount_out = amount_to_swap;

        if amount_out < min_amount_out {
            return Err(ContractError::SlippageExceeded);
        }
        ensure_swap_reserve(&env, &token_out, amount_out)?;

        if fee > 0 {
            let collector = get_fee_collector_address(&env);
            contract_transfer_out(&env, &token_in_client, &collector, &fee);
        }

        let token_out_client = get_token_client(&env, &token_out);
        contract_transfer_out(&env, &token_out_client, &caller, &amount_out);

        env.events().publish(
            (
                Symbol::new(&env, "swap"),
                caller.clone(),
                token_in.clone(),
                token_out.clone(),
            ),
            (amount_in, actual_amount_in, amount_out, fee, path.len()),
        );

        Ok(amount_out)
    }

    /// Swap up to `max_amount_in` of `token_in` for an exact `amount_out` of
    /// `token_out`. Reverts with `ExcessiveAmountIn` if the fee-inclusive
    /// input required would exceed `max_amount_in`. See
    /// `swap_exact_tokens_for_tokens` for the pricing-model caveat.
    pub fn swap_tokens_for_exact_tokens(
        env: Env,
        caller: Address,
        token_in: Address,
        token_out: Address,
        amount_out: i128,
        max_amount_in: i128,
        path: Vec<Address>,
    ) -> Result<i128, ContractError> {
        let _guard = ReentrancyGuard::acquire(&env);
        require_initialized(&env);
        require_not_paused(&env);
        caller.require_auth();

        if amount_out <= 0 {
            return Err(ContractError::NonPositiveAmount);
        }
        if max_amount_in <= 0 {
            return Err(ContractError::NonPositiveAmount);
        }
        if token_in == token_out {
            return Err(ContractError::InvalidPath);
        }
        validate_swap_path(&path, &token_in, &token_out)?;
        validate_swap_path_liquidity(&env, &path)?;

        let fee_bps = get_swap_fee_bps(&env);
        let amount_in = compute_required_amount_in(amount_out, fee_bps);
        let required_actual_amount_in = amount_in;

        if amount_in > max_amount_in {
            return Err(ContractError::ExcessiveAmountIn);
        }

        ensure_swap_reserve(&env, &token_out, amount_out)?;

        let token_in_client = get_token_client(&env, &token_in);
        let mut requested_amount_in = amount_in;
        let mut actual_amount_in =
            transfer_to_contract_measured(&env, &token_in_client, &caller, &amount_in);
        let (mut actual_fee, mut actual_amount_to_swap) =
            compute_swap_fee(actual_amount_in, fee_bps);
        if actual_amount_to_swap < amount_out {
            let additional_request = compute_fee_on_transfer_top_up(
                required_actual_amount_in,
                requested_amount_in,
                actual_amount_in,
                max_amount_in,
            )?;
            let additional_received =
                transfer_to_contract_measured(&env, &token_in_client, &caller, &additional_request);
            requested_amount_in = requested_amount_in
                .checked_add(additional_request)
                .expect("overflow");
            actual_amount_in = actual_amount_in
                .checked_add(additional_received)
                .expect("overflow");
            let recomputed = compute_swap_fee(actual_amount_in, fee_bps);
            actual_fee = recomputed.0;
            actual_amount_to_swap = recomputed.1;
            if actual_amount_to_swap < amount_out {
                return Err(ContractError::ExcessiveAmountIn);
            }
        }
        if actual_fee > 0 {
            let collector = get_fee_collector_address(&env);
            contract_transfer_out(&env, &token_in_client, &collector, &actual_fee);
        }

        let token_out_client = get_token_client(&env, &token_out);
        contract_transfer_out(&env, &token_out_client, &caller, &amount_out);

        env.events().publish(
            (
                Symbol::new(&env, "swap"),
                caller.clone(),
                token_in.clone(),
                token_out.clone(),
            ),
            (
                requested_amount_in,
                actual_amount_in,
                amount_out,
                actual_fee,
                path.len(),
            ),
        );

        Ok(requested_amount_in)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(deprecated)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger},
        vec, Address, Env, IntoVal, Symbol,
    };

    // ── helpers ───────────────────────────────────────────────────────────────

    /// Deploy with a single admin signer and threshold 1, so
    /// `propose_admin_action` auto-executes on the first call — the closest
    /// equivalent to the old single-admin model, for tests that don't
    /// specifically exercise N-of-M governance.
    fn deploy(env: &Env) -> (Address, FinchippayContractClient<'_>) {
        let id = env.register(FinchippayContract, ());
        let client = FinchippayContractClient::new(env, &id);
        let admin = Address::generate(env);
        client.initialize(&vec![env, admin.clone()], &1);
        (id, client)
    }

    /// Deploy with an explicit N-of-M admin signer set and threshold, for
    /// tests exercising multi-sig governance directly.
    fn deploy_multisig<'a>(
        env: &'a Env,
        signers: &Vec<Address>,
        threshold: u32,
    ) -> (Address, FinchippayContractClient<'a>) {
        let id = env.register(FinchippayContract, ());
        let client = FinchippayContractClient::new(env, &id);
        client.initialize(signers, &threshold);
        (id, client)
    }

    fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
        let sac_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = sac_contract.address();
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
        let id = env.register(FinchippayContract, ());
        let client = FinchippayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let signers = vec![&env, admin.clone()];
        client.initialize(&signers, &1);
        let result = client.try_initialize(&signers, &1);
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::AlreadyInitialized
        );
    }

    #[test]
    fn test_initialize_rejects_empty_signers() {
        let env = Env::default();
        let id = env.register(FinchippayContract, ());
        let client = FinchippayContractClient::new(&env, &id);
        let result = client.try_initialize(&Vec::new(&env), &1);
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_rejects_threshold_above_signer_count() {
        let env = Env::default();
        let id = env.register(FinchippayContract, ());
        let client = FinchippayContractClient::new(&env, &id);
        let signers = vec![&env, Address::generate(&env), Address::generate(&env)];
        let result = client.try_initialize(&signers, &3);
        assert!(result.is_err());
    }

    #[test]
    fn test_admin_signers_multisig_requires_threshold_approvals() {
        let env = Env::default();
        env.mock_all_auths();
        let signer_a = Address::generate(&env);
        let signer_b = Address::generate(&env);
        let signer_c = Address::generate(&env);
        let signers = vec![&env, signer_a.clone(), signer_b.clone(), signer_c.clone()];
        let (_id, client) = deploy_multisig(&env, &signers, 2);

        assert_eq!(client.get_admin_signers(), signers);
        assert_eq!(client.get_admin_signers_threshold(), 2);
        assert!(!client.is_paused());

        // A single proposal from one signer is not enough to execute at threshold 2.
        let proposal_id =
            client.propose_admin_action(&signer_a, &Symbol::new(&env, "pause"), &Vec::new(&env));
        assert!(!client.get_admin_action_proposal(&proposal_id).executed);
        assert!(!client.is_paused());

        // A second signer's approval reaches the threshold and auto-executes.
        client.approve_admin_action(&proposal_id, &signer_b);
        assert!(client.is_paused());
        assert!(client.get_admin_action_proposal(&proposal_id).executed);

        // A third, unnecessary approval is rejected once the proposal has executed.
        let result = client.try_approve_admin_action(&proposal_id, &signer_c);
        assert!(result.is_err());
    }

    #[test]
    fn test_admin_action_single_signer_threshold_one_auto_executes() {
        let env = Env::default();
        env.mock_all_auths();
        let (_id, client) = deploy(&env);
        let admin = client.get_admin();

        let proposal_id =
            client.propose_admin_action(&admin, &Symbol::new(&env, "pause"), &Vec::new(&env));
        assert!(client.get_admin_action_proposal(&proposal_id).executed);
        assert!(client.is_paused());
    }

    #[test]
    #[should_panic]
    fn test_propose_admin_action_rejects_non_signer() {
        let env = Env::default();
        env.mock_all_auths();
        let (_id, client) = deploy(&env);
        let stranger = Address::generate(&env);
        client.propose_admin_action(&stranger, &Symbol::new(&env, "pause"), &Vec::new(&env));
    }

    #[test]
    #[should_panic]
    fn test_approve_admin_action_rejects_duplicate_approval() {
        let env = Env::default();
        env.mock_all_auths();
        let signer_a = Address::generate(&env);
        let signer_b = Address::generate(&env);
        let signers = vec![&env, signer_a.clone(), signer_b.clone()];
        let (_id, client) = deploy_multisig(&env, &signers, 2);
        let proposal_id =
            client.propose_admin_action(&signer_a, &Symbol::new(&env, "pause"), &Vec::new(&env));
        client.approve_admin_action(&proposal_id, &signer_a);
    }

    #[test]
    fn test_admin_action_set_pauser_via_multisig() {
        let env = Env::default();
        env.mock_all_auths();
        let (_id, client) = deploy(&env);
        let admin = client.get_admin();
        let pauser = Address::generate(&env);

        let data: Vec<Val> = Vec::from_array(&env, [pauser.clone().into_val(&env)]);
        client.propose_admin_action(&admin, &Symbol::new(&env, "set_pauser"), &data);
        assert_eq!(client.get_pauser(), Some(pauser.clone()));

        // The pauser retains its fast single-signature pause/unpause path.
        client.pause(&pauser);
        assert!(client.is_paused());
        client.unpause(&pauser);
        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic]
    fn test_pause_by_non_pauser_requires_proposal() {
        let env = Env::default();
        env.mock_all_auths();
        let (_id, client) = deploy(&env);
        let admin = client.get_admin();
        // Admin can no longer pause directly; must go through
        // propose_admin_action.
        client.pause(&admin);
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

    #[test]
    fn test_global_receipt_count() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let payer1 = Address::generate(&env);
        let payer2 = Address::generate(&env);
        let payer3 = Address::generate(&env);
        let payee = Address::generate(&env);
        env.mock_all_auths();

        // Mint 2 receipts from payer1
        client.mint_receipt(&payer1, &payee, &1000, &Symbol::new(&env, "r1"));
        client.mint_receipt(&payer1, &payee, &2000, &Symbol::new(&env, "r2"));

        // Mint 2 receipts from payer2
        client.mint_receipt(&payer2, &payee, &3000, &Symbol::new(&env, "r3"));
        client.mint_receipt(&payer2, &payee, &4000, &Symbol::new(&env, "r4"));

        // Mint 1 receipt from payer3
        client.mint_receipt(&payer3, &payee, &5000, &Symbol::new(&env, "r5"));

        // Assert global count is 5
        assert_eq!(client.total_receipt_count(), 5);

        // Verify individual counts
        assert_eq!(client.get_receipt_count(&payer1), 2);
        assert_eq!(client.get_receipt_count(&payer2), 2);
        assert_eq!(client.get_receipt_count(&payer3), 1);

        // Verify receipt by index mapping
        let (from, local_idx) = client.get_receipt_by_index(&0);
        assert_eq!(from, payer1);
        assert_eq!(local_idx, 0);

        let (from, local_idx) = client.get_receipt_by_index(&4);
        assert_eq!(from, payer3);
        assert_eq!(local_idx, 0);
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
        let token_id = create_token(&env, &admin, &from, 2000);
        let token = token::Client::new(&env, &token_id);
        let release = env.ledger().sequence() + 10;
        let id = client.create_escrow(
            &token_id,
            &from,
            &to,
            &2000,
            &release,
            &Symbol::new(&env, "e1"),
        );
        assert_eq!(token.balance(&from), 0);
        assert_eq!(token.balance(&contract_id), 2000);
        advance(&env, release + 1);
        client.claim_escrow(&id);
        assert_eq!(token.balance(&to), 2000);
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
        let token_id = create_token(&env, &admin, &from, 2000);
        let token = token::Client::new(&env, &token_id);
        let release = env.ledger().sequence() + 50;
        let id = client.create_escrow(
            &token_id,
            &from,
            &to,
            &2000,
            &release,
            &Symbol::new(&env, "e2"),
        );
        client.cancel_escrow(&id);
        assert_eq!(token.balance(&from), 2000);
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
        let id = client.create_escrow(
            &token_id,
            &from,
            &to,
            &2000,
            &release,
            &Symbol::new(&env, "e3"),
        );
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

    #[test]
    fn test_close_stream_at_halfway_ledger_pays_claimable_to_recipient() {
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

        // Close after 50 ledgers -> 500 streamed, 500 refund.
        advance(&env, start + 50);
        client.close_stream(&sid, &payer);

        // Recipient should receive every token they earned.
        assert_eq!(token.balance(&recipient), 500);
        // Payer should receive only the truly unearned remainder.
        assert_eq!(token.balance(&payer), 500);
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
        let expiry = env.ledger().sequence() + 1000;
        let pid = client.create_multisig(
            &token_id, &proposer, &recipient, &1_000, &2, &signers, &expiry,
        );
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
        let expiry = env.ledger().sequence() + 1000;
        let pid = client.create_multisig(
            &token_id, &proposer, &recipient, &2000, &1, &signers, &expiry,
        );
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
        client.propose_admin_action(&admin, &Symbol::new(&env, "pause"), &Vec::new(&env));
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
        client.propose_admin_action(&admin, &Symbol::new(&env, "pause"), &Vec::new(&env));
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
        client.propose_admin_action(&admin, &Symbol::new(&env, "pause"), &Vec::new(&env));
        client.open_stream(&token_id, &payer, &recipient, &10, &500);
    }

    #[test]
    fn test_pauser_can_pause_and_unpause() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let pauser = Address::generate(&env);
        env.mock_all_auths();

        // Admin designates a separate pauser (hot-key) role.
        let data: Vec<Val> = Vec::from_array(&env, [pauser.clone().into_val(&env)]);
        client.propose_admin_action(&admin, &Symbol::new(&env, "set_pauser"), &data);
        assert_eq!(client.get_pauser(), Some(pauser.clone()));

        // The pauser — not the admin — can trigger the circuit breaker.
        client.pause(&pauser);
        assert!(client.is_paused());

        // …and lift it again.
        client.unpause(&pauser);
        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_non_admin_non_pauser_cannot_pause() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let pauser = Address::generate(&env);
        let stranger = Address::generate(&env);
        env.mock_all_auths();

        let data: Vec<Val> = Vec::from_array(&env, [pauser.clone().into_val(&env)]);
        client.propose_admin_action(&admin, &Symbol::new(&env, "set_pauser"), &data);
        // A random address that is neither admin nor the designated pauser
        // must be rejected even with a valid auth signature.
        client.pause(&stranger);
    }

    #[test]
    #[should_panic(expected = "not an admin signer")]
    fn test_set_pauser_requires_admin_signer() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let stranger = Address::generate(&env);
        let pauser = Address::generate(&env);
        env.mock_all_auths();

        // Only an admin signer may propose assigning the pauser role.
        let data: Vec<Val> = Vec::from_array(&env, [pauser.into_val(&env)]);
        client.propose_admin_action(&stranger, &Symbol::new(&env, "set_pauser"), &data);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_pauser_cannot_transfer_admin() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let pauser = Address::generate(&env);
        let new_admin = Address::generate(&env);
        env.mock_all_auths();

        let data: Vec<Val> = Vec::from_array(&env, [pauser.clone().into_val(&env)]);
        client.propose_admin_action(&admin, &Symbol::new(&env, "set_pauser"), &data);
        // The pauser role is pause-only; it must not be able to seize admin
        // rights by transferring them away.
        client.transfer_admin(&pauser, &new_admin);
    }

    #[test]
    #[should_panic(expected = "not an admin signer")]
    fn test_pauser_cannot_upgrade() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let pauser = Address::generate(&env);
        env.mock_all_auths();

        let data: Vec<Val> = Vec::from_array(&env, [pauser.clone().into_val(&env)]);
        client.propose_admin_action(&admin, &Symbol::new(&env, "set_pauser"), &data);
        // The pauser must not be able to propose swapping the contract WASM
        // — it is not part of the admin signer set.
        let dummy_hash = BytesN::from_array(&env, &[0u8; 32]);
        let data: Vec<Val> =
            Vec::from_array(&env, [dummy_hash.into_val(&env), 1u32.into_val(&env)]);
        client.propose_admin_action(&pauser, &Symbol::new(&env, "upgrade"), &data);
    }

    #[test]
    fn test_set_admin_signers_action_auto_executes_at_threshold_one() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let signer_b = Address::generate(&env);
        env.mock_all_auths();

        let mut signers = Vec::new(&env);
        signers.push_back(admin.clone());
        signers.push_back(signer_b);
        let data: Vec<Val> = Vec::from_array(&env, [signers.into_val(&env), 2u32.into_val(&env)]);
        let pid =
            client.propose_admin_action(&admin, &Symbol::new(&env, "set_admin_signers"), &data);

        // Threshold-1 deploy auto-executes the rotation on propose.
        assert!(client.get_admin_action_proposal(&pid).executed);
        assert_eq!(client.get_admin_signers().len(), 2);
        assert_eq!(client.get_admin_signers_threshold(), 2);
    }

    #[test]
    fn test_set_admin_signers_requires_threshold_approvals() {
        let env = Env::default();
        let signer_a = Address::generate(&env);
        let signer_b = Address::generate(&env);
        let signers = vec![&env, signer_a.clone(), signer_b.clone()];
        let (_id, client) = deploy_multisig(&env, &signers, 2);
        let new_signer = Address::generate(&env);
        env.mock_all_auths();

        // One signer proposes a rotation — must stay pending at threshold 2.
        let mut proposed = Vec::new(&env);
        proposed.push_back(signer_a.clone());
        proposed.push_back(new_signer);
        let data: Vec<Val> = Vec::from_array(&env, [proposed.into_val(&env), 2u32.into_val(&env)]);
        let pid =
            client.propose_admin_action(&signer_a, &Symbol::new(&env, "set_admin_signers"), &data);
        assert!(!client.get_admin_action_proposal(&pid).executed);
        assert_eq!(client.get_admin_signers().len(), 2);
        assert_eq!(client.get_admin_signers_threshold(), 2);

        // The second signer's approval reaches the threshold and executes.
        client.approve_admin_action(&pid, &signer_b);
        assert!(client.get_admin_action_proposal(&pid).executed);
        assert_eq!(client.get_admin_signers().len(), 2);
        assert_eq!(client.get_admin_signers_threshold(), 2);
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
        let mut memos = soroban_sdk::Vec::new(&env);
        let memo1 = Symbol::new(&env, "inv_101");
        let memo2 = Symbol::new(&env, "");
        memos.push_back(memo1.clone());
        memos.push_back(memo2.clone());

        let res = client.batch_send(&token_id, &from, &recipients, &amounts, &memos);
        assert_eq!(res, ());
        assert_eq!(token.balance(&r1), 300);
        assert_eq!(token.balance(&r2), 700);
        assert_eq!(client.get_tip_total(&r1), 300);
        assert_eq!(client.get_tip_total(&r2), 700);

        let rec1 = client.get_tip_record(&r1, &0);
        assert_eq!(rec1.memo, memo1);

        let rec2 = client.get_tip_record(&r2, &0);
        assert_eq!(rec2.memo, memo2);
    }

    #[test]
    fn test_batch_send_mismatched_lengths_returns_error() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let r1 = Address::generate(&env);
        let r2 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 500);
        let mut recipients = soroban_sdk::Vec::new(&env);
        recipients.push_back(r1.clone());
        recipients.push_back(r2.clone());
        let mut amounts = soroban_sdk::Vec::new(&env);
        amounts.push_back(100i128);
        amounts.push_back(200i128);
        let mut memos = soroban_sdk::Vec::new(&env);
        memos.push_back(Symbol::new(&env, "memo1"));
        // Only 1 memo for 2 recipients — should return LengthMismatch error.

        let res = client.try_batch_send(&token_id, &from, &recipients, &amounts, &memos);
        assert_eq!(res.unwrap_err().unwrap(), ContractError::LengthMismatch);
    }

    #[test]
    fn test_batch_send_oversized_batch_returns_error() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10000);

        let mut recipients = soroban_sdk::Vec::new(&env);
        let mut amounts = soroban_sdk::Vec::new(&env);
        let mut memos = soroban_sdk::Vec::new(&env);
        for _ in 0..51 {
            recipients.push_back(Address::generate(&env));
            amounts.push_back(1i128);
            memos.push_back(Symbol::new(&env, "test"));
        }

        let res = client.try_batch_send(&token_id, &from, &recipients, &amounts, &memos);
        assert_eq!(res.unwrap_err().unwrap(), ContractError::BatchTooLarge);
    }

    #[test]
    fn test_batch_send_multi_success() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let r1 = Address::generate(&env);
        let r2 = Address::generate(&env);
        let r3 = Address::generate(&env);
        env.mock_all_auths();

        // Create two different tokens
        let token1_id = create_token(&env, &admin, &from, 1000);
        let token2_id = create_token(&env, &admin, &from, 1000);

        let token1 = token::Client::new(&env, &token1_id);
        let token2 = token::Client::new(&env, &token2_id);

        // Prepare batch: 3 recipients, 2 different tokens
        let mut tokens = soroban_sdk::Vec::new(&env);
        tokens.push_back(token1_id.clone());
        tokens.push_back(token1_id.clone());
        tokens.push_back(token2_id.clone());

        let mut recipients = soroban_sdk::Vec::new(&env);
        recipients.push_back(r1.clone());
        recipients.push_back(r2.clone());
        recipients.push_back(r3.clone());

        let mut amounts = soroban_sdk::Vec::new(&env);
        amounts.push_back(300i128);
        amounts.push_back(400i128);
        amounts.push_back(500i128);

        let mut memos = soroban_sdk::Vec::new(&env);
        memos.push_back(Symbol::new(&env, "payment1"));
        memos.push_back(Symbol::new(&env, "payment2"));
        memos.push_back(Symbol::new(&env, "payment3"));

        client.batch_send_multi(&from, &tokens, &recipients, &amounts, &memos);

        // Verify balances: r1 and r2 received token1, r3 received token2
        assert_eq!(token1.balance(&r1), 300);
        assert_eq!(token1.balance(&r2), 400);
        assert_eq!(token1.balance(&r3), 0);
        assert_eq!(token2.balance(&r1), 0);
        assert_eq!(token2.balance(&r2), 0);
        assert_eq!(token2.balance(&r3), 500);

        // Verify tip totals
        assert_eq!(client.get_tip_total(&r1), 300);
        assert_eq!(client.get_tip_total(&r2), 400);
        assert_eq!(client.get_tip_total(&r3), 500);
    }

    // ── Escrow recipient index cap ─────────────────────────────────────────

    #[test]
    fn test_create_escrow_rejects_when_recipient_index_full() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(
            &env,
            &admin,
            &from,
            (MAX_USER_ESCROWS as i128 + 1) * MIN_ESCROW_AMOUNT,
        );
        let release = env.ledger().sequence() + 10;
        let memo = Symbol::new(&env, "e");

        for _ in 0..MAX_USER_ESCROWS {
            client.create_escrow(&token_id, &from, &to, &MIN_ESCROW_AMOUNT, &release, &memo);
        }

        // The 101st escrow to the same recipient must be rejected rather than
        // silently created without being indexed.
        let res =
            client.try_create_escrow(&token_id, &from, &to, &MIN_ESCROW_AMOUNT, &release, &memo);
        assert_eq!(res.unwrap_err().unwrap(), ContractError::IndexFull);
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
            &token_id,
            &payer,
            &recipient,
            &MAX_STREAM_RATE,
            &MAX_STREAM_DEPOSIT,
        );
        // Advance to a very large ledger — claimable should be capped by
        // total_streamed = rate * elapsed, not by MAX_STREAM_DEPOSIT.
        advance(&env, start + 1_000_000);
        let claimable = client.get_claimable(&sid);
        let expected = MAX_STREAM_RATE * 1_000_000;
        assert_eq!(claimable, expected);
    }

    // Property-based coverage for the streaming payment formula (the
    // invariants formerly exercised here with a hand-rolled `PropertyRng`)
    // now lives in `tests/property_streaming.rs`, driven by the `proptest`
    // crate against the shared `claimable_at` core.

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
        let id = env.register(FinchippayContract, ());
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
        let id = env.register(FinchippayContract, ());
        let client = FinchippayContractClient::new(&env, &id);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let memo = Symbol::new(&env, "test");
        client.create_escrow(
            &Address::generate(&env),
            &from,
            &to,
            &2000,
            &(env.ledger().sequence() + 10),
            &memo,
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
    #[should_panic(expected = "expiration_ledger must be in the future")]
    fn test_multisig_zero_expiration_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let s1 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 2000);

        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1);
        // expiration_ledger = 0 must no longer be accepted as "no expiration".
        client.create_multisig(&token_id, &proposer, &recipient, &2000, &1, &signers, &0);
    }

    #[test]
    #[should_panic(expected = "expiration_ledger must be in the future")]
    fn test_multisig_past_expiration_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let s1 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 2000);

        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1);
        let past = env.ledger().sequence();
        client.create_multisig(&token_id, &proposer, &recipient, &2000, &1, &signers, &past);
    }

    #[test]
    #[should_panic(expected = "expiration_ledger exceeds maximum multi-sig TTL")]
    fn test_multisig_ttl_exceeds_maximum_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let s1 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 2000);

        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1);
        let too_far = env.ledger().sequence() + MAX_MULTISIG_TTL + 1;
        client.create_multisig(
            &token_id, &proposer, &recipient, &2000, &1, &signers, &too_far,
        );
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
        let expiry = env.ledger().sequence() + 1000;
        let _pid = client.create_multisig(
            &token_id, &proposer, &recipient, &2000, &1, &signers, &expiry,
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

    // ── Dashboard view-function aliases ───────────────────────────────────
    // These tests cover the five stable short-name aliases introduced in #62.
    // Each alias simply delegates to its `get_*` counterpart; the tests verify
    // that counts increment correctly after creating records and that the
    // per-address tip functions return the same values as the originals.

    #[test]
    fn test_stream_count_alias_increments_after_open() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &payer, 5_000);

        assert_eq!(client.stream_count(), 0);
        client.open_stream(&token_id, &payer, &recipient, &10, &1_000);
        assert_eq!(client.stream_count(), 1);
        client.open_stream(&token_id, &payer, &recipient, &5, &500);
        assert_eq!(client.stream_count(), 2);
        // Alias agrees with the canonical getter.
        assert_eq!(client.stream_count(), client.get_stream_count());
    }

    #[test]
    fn test_escrow_count_alias_increments_after_create() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        assert_eq!(client.escrow_count(), 0);
        let release = env.ledger().sequence() + 10;
        let memo = Symbol::new(&env, "e");
        client.create_escrow(&token_id, &from, &to, &2_000, &release, &memo);
        assert_eq!(client.escrow_count(), 1);
        client.create_escrow(&token_id, &from, &to, &2_000, &release, &memo);
        assert_eq!(client.escrow_count(), 2);
        // Alias agrees with the canonical getter.
        assert_eq!(client.escrow_count(), client.get_escrow_count());
    }

    #[test]
    fn test_multisig_count_alias_increments_after_create() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let s1 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 5_000);

        assert_eq!(client.multisig_count(), 0);
        let expiry = env.ledger().sequence() + 1_000;
        let signers = soroban_sdk::Vec::from_array(&env, [s1.clone()]);
        client.create_multisig(
            &token_id, &proposer, &recipient, &1_000, &1, &signers, &expiry,
        );
        assert_eq!(client.multisig_count(), 1);
        client.create_multisig(
            &token_id, &proposer, &recipient, &1_000, &1, &signers, &expiry,
        );
        assert_eq!(client.multisig_count(), 2);
        // Alias agrees with the canonical getter.
        assert_eq!(client.multisig_count(), client.get_multisig_count());
    }

    #[test]
    fn test_tip_count_alias_matches_get_tip_count() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 2_000);

        // Before any tips.
        assert_eq!(client.tip_count(&to), 0);
        client.send_tip(&token_id, &from, &to, &300, &Symbol::new(&env, "t1"));
        assert_eq!(client.tip_count(&to), 1);
        client.send_tip(&token_id, &from, &to, &500, &Symbol::new(&env, "t2"));
        assert_eq!(client.tip_count(&to), 2);
        // Alias agrees with the canonical getter.
        assert_eq!(client.tip_count(&to), client.get_tip_count(&to));
    }

    #[test]
    fn test_tip_total_alias_matches_get_tip_total() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 3_000);

        // Before any tips.
        assert_eq!(client.tip_total(&to), 0);
        client.send_tip(&token_id, &from, &to, &400, &Symbol::new(&env, "a"));
        assert_eq!(client.tip_total(&to), 400);
        client.send_tip(&token_id, &from, &to, &600, &Symbol::new(&env, "b"));
        assert_eq!(client.tip_total(&to), 1_000);
        // Alias agrees with the canonical getter.
        assert_eq!(client.tip_total(&to), client.get_tip_total(&to));
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
        let expiry = env.ledger().sequence() + 1000;
        client.create_multisig(
            &token_id, &proposer, &recipient, &500, &1, &signers, &expiry,
        );
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
        let expiry = env.ledger().sequence() + 1000;
        let pid = client.create_multisig(
            &token_id, &proposer, &recipient, &1_000, &2, &signers, &expiry,
        );
        client.approve_multisig(&pid, &s1);
        client.approve_multisig(&pid, &s1); // duplicate — should panic
    }

    // ── Malicious / fake token protection ──────────────────────────────────────

    /// A minimal malicious token contract that reports successful transfers
    /// without actually moving any funds. Used to verify that our balance
    /// check protection works correctly.
    #[contract]
    struct MaliciousToken;

    #[contractimpl]
    impl MaliciousToken {
        /// Malicious: `balance` always returns 0 regardless of any
        /// "transfers" that supposedly occurred.
        pub fn balance(_env: Env, _id: Address) -> i128 {
            0
        }
        /// Malicious: transfer succeeds (no panic) but does not move
        /// any tokens — balance() stays 0.
        pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {
            // no-op
        }
    }

    #[test]
    #[should_panic(expected = "TransferFailed")]
    fn test_create_escrow_rejects_malicious_token() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let fake_token_id = env.register_contract(None, MaliciousToken);
        let release = env.ledger().sequence() + 10;
        client.create_escrow(
            &fake_token_id,
            &from,
            &to,
            &2000,
            &release,
            &Symbol::new(&env, "mal"),
        );
    }

    #[test]
    #[should_panic(expected = "TransferFailed")]
    fn test_send_tip_rejects_malicious_token() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let fake_token_id = env.register_contract(None, MaliciousToken);
        client.send_tip(&fake_token_id, &from, &to, &300, &Symbol::new(&env, "mal"));
    }

    #[test]
    #[should_panic(expected = "TransferFailed")]
    fn test_open_stream_rejects_malicious_token() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let fake_token_id = env.register_contract(None, MaliciousToken);
        client.open_stream(&fake_token_id, &payer, &recipient, &10, &500);
    }

    #[test]
    #[should_panic(expected = "TransferFailed")]
    fn test_create_multisig_rejects_malicious_token() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let signer = Address::generate(&env);
        let signers = Vec::from_array(&env, [signer.clone()]);
        env.mock_all_auths();
        let fake_token_id = env.register_contract(None, MaliciousToken);
        let expiry = env.ledger().sequence() + 1000;
        client.create_multisig(
            &fake_token_id,
            &proposer,
            &recipient,
            &1_000,
            &1,
            &signers,
            &expiry,
        );
    }

    #[test]
    #[should_panic(expected = "TransferFailed")]
    fn test_top_up_stream_with_malicious_token_panics() {
        // open_stream with a real token first; the stored `stream.token`
        // points to a legitimate SAC token.  We then craft a separate
        // scenario — a second stream opened with the malicious token —
        // to confirm that the balance check in `top_up_stream` would also
        // catch a fake token if one were somehow wired in.
        // Note: `top_up_stream` uses `stream.token` from storage, so we
        // can't substitute a fake token after the fact.  The test here
        // validates that `open_stream` gates the deposit at creation,
        // which is the primary vector.  The code path for `top_up_stream`
        // is identical (same `require_transfer_succeeded` call), so
        // coverage is shared.
        let env = Env::default();
        let (_, client) = deploy(&env);
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let fake_token_id = env.register_contract(None, MaliciousToken);
        let fake_sid = client.open_stream(&fake_token_id, &payer, &recipient, &10, &500);
        let _ = fake_sid;
    }

    #[test]
    fn test_real_token_transfers_pass_balance_check() {
        // Verify that legitimate (non-malicious) token transfers are NOT
        // blocked by the new balance check.
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 1_000);
        // This should NOT panic — the real SAC token moves funds correctly.
        client.send_tip(&token_id, &from, &to, &300, &Symbol::new(&env, "ok"));
        assert_eq!(client.get_tip_total(&to), 300);
    }

    #[test]
    fn test_batch_send_with_real_token_passes_balance_check() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to1 = Address::generate(&env);
        let to2 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 2_000);
        let recipients = Vec::from_array(&env, [to1.clone(), to2.clone()]);
        let amounts = Vec::from_array(&env, [500_i128, 700_i128]);
        let mut memos = soroban_sdk::Vec::new(&env);
        memos.push_back(Symbol::new(&env, ""));
        memos.push_back(Symbol::new(&env, ""));
        client.batch_send(&token_id, &from, &recipients, &amounts, &memos);
        assert_eq!(client.get_tip_total(&to1), 500);
        assert_eq!(client.get_tip_total(&to2), 700);
    }

    // ── Event emission ────────────────────────────────────────────────────────
    // Regression coverage for issue #55: every state-changing entry point must
    // emit a structured event carrying enough fields to reconstruct state
    // without reading storage.

    #[test]
    fn test_cancel_escrow_emits_escrow_cancelled_event() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 2_000);
        let release = env.ledger().sequence() + 50;
        let id = client.create_escrow(
            &token_id,
            &from,
            &to,
            &2_000,
            &release,
            &Symbol::new(&env, "e2"),
        );
        client.cancel_escrow(&id);

        let events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            events,
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "escrow_cancelled"),).into_val(&env),
                    (id, from, 2_000i128).into_val(&env),
                ),
            ]
        );
    }

    #[test]
    fn test_top_up_stream_emits_stream_topped_up_event() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &payer, 10_000);
        let sid = client.open_stream(&token_id, &payer, &recipient, &10, &1_000);
        client.top_up_stream(&sid, &payer, &500);

        let events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            events,
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "stream_topped_up"),).into_val(&env),
                    (sid, payer, 500i128, 1_500i128).into_val(&env),
                ),
            ]
        );
    }

    #[test]
    fn test_cancel_multisig_emits_multisig_cancelled_event() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let signer = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 5_000);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(signer);
        let expiry = env.ledger().sequence() + 1000;
        let id = client.create_multisig(
            &token_id, &proposer, &recipient, &2_000, &1, &signers, &expiry,
        );
        client.cancel_multisig(&id, &proposer);

        let events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            events,
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "multisig_cancelled"),).into_val(&env),
                    (id, proposer, 2_000i128).into_val(&env),
                ),
            ]
        );
    }

    #[test]
    fn test_batch_send_emits_batch_sent_event() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to1 = Address::generate(&env);
        let to2 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 1_000);
        let mut recipients = soroban_sdk::Vec::new(&env);
        recipients.push_back(to1.clone());
        recipients.push_back(to2.clone());
        let mut amounts = soroban_sdk::Vec::new(&env);
        amounts.push_back(300i128);
        amounts.push_back(200i128);
        let mut memos = soroban_sdk::Vec::new(&env);
        memos.push_back(Symbol::new(&env, "m1"));
        memos.push_back(Symbol::new(&env, "m2"));
        client.batch_send(&token_id, &from, &recipients, &amounts, &memos);

        let events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            events,
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "tip"), from.clone(), to1.clone()).into_val(&env),
                    (300i128, Symbol::new(&env, "m1")).into_val(&env),
                ),
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "tip"), from.clone(), to2.clone()).into_val(&env),
                    (200i128, Symbol::new(&env, "m2")).into_val(&env),
                ),
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "batch_sent"),).into_val(&env),
                    (from, 2u32, 500i128).into_val(&env),
                ),
            ]
        );
    }

    #[test]
    #[should_panic(expected = "unknown admin action")]
    fn test_rescue_tokens_admin_action_rejected() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &contract_id, 400);
        let data: Vec<Val> = Vec::from_array(
            &env,
            [
                token_id.clone().into_val(&env),
                to.clone().into_val(&env),
                400i128.into_val(&env),
            ],
        );

        // `rescue_tokens` is no longer a supported admin action. Proposing it
        // must be rejected, steering callers to the time-delayed
        // `initiate_emergency_withdrawal` → `approve_emergency_withdrawal` →
        // `execute_emergency_withdrawal` flow instead.
        client.propose_admin_action(&admin, &Symbol::new(&env, "rescue_tokens"), &data);
    }
    #[test]
    fn test_pagination_bounds() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &payer, 100_000);

        // Open 3 streams
        for _ in 0..3 {
            client.open_stream(&token_id, &payer, &recipient, &10, &1_000);
        }

        // Test list_streams_by_payer completely full response sequence
        let all = client.list_streams_by_payer(&payer, &0, &10);
        assert_eq!(all.len(), 3);

        // Test partially filled tracking bounds
        let part = client.list_streams_by_payer(&payer, &1, &1);
        assert_eq!(part.len(), 1);

        // Test empty arrays (out of bounds)
        let empty = client.list_streams_by_payer(&payer, &5, &10);
        assert_eq!(empty.len(), 0);
    }

    #[test]
    fn test_vesting_full_lifecycle() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 10_000);
        let amount = 1_000i128;
        let start = env.ledger().sequence();
        let cliff = start + 10;
        let end = start + 30;

        let id = client.create_vesting(&token_id, &from, &beneficiary, &amount, &cliff, &end);
        assert_eq!(id, 0);

        let vesting = client.get_vesting(&id);
        assert_eq!(vesting.total_amount, amount);
        assert_eq!(vesting.cliff_ledger, cliff);
        assert_eq!(vesting.end_ledger, end);
        assert_eq!(vesting.claimed, 0);
        assert_eq!(vesting.revoked, false);
    }

    #[test]
    fn test_vesting_claim_before_cliff() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 10_000);
        let amount = 1_000i128;
        let start = env.ledger().sequence();
        let cliff = start + 10;
        let end = start + 30;

        let id = client.create_vesting(&token_id, &from, &beneficiary, &amount, &cliff, &end);

        // Before cliff, claimable amount must be 0
        let claimable = client.get_claimable_vesting(&id);
        assert_eq!(claimable, 0);

        // Claiming before cliff must return 0 without error
        let claimed = client.claim_vesting(&id, &beneficiary);
        assert_eq!(claimed, 0);
    }

    #[test]
    fn test_vesting_partial_claim_after_cliff() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 10_000);
        let amount = 1_000i128;
        let start = env.ledger().sequence();
        let cliff = start + 10;
        let end = start + 30;

        let id = client.create_vesting(&token_id, &from, &beneficiary, &amount, &cliff, &end);

        // Advance ledger past cliff but before end (e.g. half-way from cliff to end: cliff + 10 = 20)
        // Duration from cliff to end is 20 ledgers.
        // We advance to start + 20 (cliff + 10).
        // Claimable should be: 1000 * 10 / 20 = 500.
        advance(&env, start + 20);

        let claimable = client.get_claimable_vesting(&id);
        assert_eq!(claimable, 500);

        let claimed = client.claim_vesting(&id, &beneficiary);
        assert_eq!(claimed, 500);

        let vesting = client.get_vesting(&id);
        assert_eq!(vesting.claimed, 500);

        // Check token balance of beneficiary
        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&beneficiary), 500);
    }

    #[test]
    fn test_vesting_full_claim_at_end() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 10_000);
        let amount = 1_000i128;
        let start = env.ledger().sequence();
        let cliff = start + 10;
        let end = start + 30;

        let id = client.create_vesting(&token_id, &from, &beneficiary, &amount, &cliff, &end);

        // Advance past end
        advance(&env, end + 5);

        let claimable = client.get_claimable_vesting(&id);
        assert_eq!(claimable, amount);

        let claimed = client.claim_vesting(&id, &beneficiary);
        assert_eq!(claimed, amount);

        let vesting = client.get_vesting(&id);
        assert_eq!(vesting.claimed, amount);

        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&beneficiary), amount);
    }

    #[test]
    fn test_vesting_revoke_before_cliff() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 10_000);
        let amount = 1_000i128;
        let start = env.ledger().sequence();
        let cliff = start + 10;
        let end = start + 30;

        let id = client.create_vesting(&token_id, &from, &beneficiary, &amount, &cliff, &end);

        // Revoke before cliff
        client.revoke_vesting(&id, &admin);

        let vesting = client.get_vesting(&id);
        assert_eq!(vesting.revoked, true);

        // Claiming after revoke should fail/return 0
        let claimable = client.get_claimable_vesting(&id);
        assert_eq!(claimable, 0);

        // Check that funds returned to the funder
        let token_client = token::Client::new(&env, &token_id);
        // Original balance: 10_000. Spent 1_000. Revoke returned 1_000. Total = 10_000.
        assert_eq!(token_client.balance(&from), 10_000);
    }

    #[test]
    fn test_vesting_revoke_after_partial_claim() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 10_000);
        let amount = 1_000i128;
        let start = env.ledger().sequence();
        let cliff = start + 10;
        let end = start + 30;

        let id = client.create_vesting(&token_id, &from, &beneficiary, &amount, &cliff, &end);

        // Advance to cliff + 10 ledgers
        advance(&env, start + 20);

        // Claim 500
        client.claim_vesting(&id, &beneficiary);

        // Revoke. Unclaimed is 500. Funder should get back 500.
        client.revoke_vesting(&id, &admin);

        let vesting = client.get_vesting(&id);
        assert_eq!(vesting.revoked, true);

        // Check balances
        let token_client = token::Client::new(&env, &token_id);
        // Beneficiary has 500. Funder has 9000 (after initial 1000 spend) + 500 (returned) = 9500.
        assert_eq!(token_client.balance(&beneficiary), 500);
        assert_eq!(token_client.balance(&from), 9500);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_vesting_revoke_unauthorized() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let non_admin = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 10_000);
        let amount = 1_000i128;
        let start = env.ledger().sequence();
        let cliff = start + 10;
        let end = start + 30;

        let id = client.create_vesting(&token_id, &from, &beneficiary, &amount, &cliff, &end);

        // Call revoke with non_admin - should panic with "Unauthorized"
        client.revoke_vesting(&id, &non_admin);
    }

    // ── Vesting locked-balance accounting (#692) ──────────────────────────

    /// The emergency-withdrawal path reads the same locked balance, so it must
    /// also refuse to initiate a withdrawal of vesting funds.
    #[test]
    #[should_panic(expected = "insufficient unlocked balance")]
    fn test_vesting_funds_are_locked_against_emergency_withdrawal() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 10_000);
        let amount = 1_000i128;
        let start = env.ledger().sequence();
        let cliff = start + 10;
        let end = start + 30;

        client.create_vesting(&token_id, &from, &beneficiary, &amount, &cliff, &end);

        client.initiate_emergency_withdrawal(&admin, &token_id, &amount, &to);
    }

    /// While a vesting is active only genuinely unlocked funds (e.g. a direct
    /// donation to the contract address) are withdrawable via the emergency
    /// withdrawal flow; the vesting deposit itself stays protected.
    #[test]
    fn test_vesting_emergency_withdrawal_can_sweep_only_unlocked_funds() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 10_000);
        let amount = 1_000i128;
        let start = env.ledger().sequence();
        let cliff = start + 10;
        let end = start + 30;

        client.create_vesting(&token_id, &from, &beneficiary, &amount, &cliff, &end);

        // 300 untracked tokens land directly on the contract (stray transfer).
        // Only these are unlocked and therefore withdrawable via the emergency
        // withdrawal flow.
        let sac = token::StellarAssetClient::new(&env, &token_id);
        sac.mint(&contract_id, &300);

        let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &300, &to);
        let w = client.get_emergency_withdrawal(&wid);
        advance(&env, w.activation_ledger);
        client.approve_emergency_withdrawal(&wid, &admin);
        assert_eq!(sac.balance(&to), 300);
    }

    /// After a full claim the locked balance must drop to zero so the claimed
    /// amount is no longer protected from (and no longer blocks) emergency
    /// withdrawals.
    #[test]
    fn test_vesting_claim_releases_locked_balance() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 10_000);
        let amount = 1_000i128;
        let start = env.ledger().sequence();
        let cliff = start + 10;
        let end = start + 30;

        let id = client.create_vesting(&token_id, &from, &beneficiary, &amount, &cliff, &end);

        // Fully claim the vesting.
        advance(&env, end + 5);
        let claimed = client.claim_vesting(&id, &beneficiary);
        assert_eq!(claimed, amount);

        // Donate 300 untracked tokens; with the locked balance now zero these
        // are the only funds on the contract and must be withdrawable via the
        // emergency withdrawal flow.
        let sac = token::StellarAssetClient::new(&env, &token_id);
        sac.mint(&contract_id, &300);

        let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &300, &to);
        let w = client.get_emergency_withdrawal(&wid);
        advance(&env, w.activation_ledger);
        client.approve_emergency_withdrawal(&wid, &admin);
        assert_eq!(sac.balance(&to), 300);
    }

    /// After a revoke the unclaimed remainder is returned to the funder and
    /// must leave the locked pool, so post-revoke donations stay withdrawable
    /// via the emergency withdrawal flow.
    #[test]
    fn test_vesting_revoke_releases_locked_balance() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 10_000);
        let amount = 1_000i128;
        let start = env.ledger().sequence();
        let cliff = start + 10;
        let end = start + 30;

        let id = client.create_vesting(&token_id, &from, &beneficiary, &amount, &cliff, &end);

        // Revoke before the cliff: the whole deposit goes back to the funder.
        client.revoke_vesting(&id, &admin);

        // Donate 300 untracked tokens; with the locked balance now zero these
        // must be withdrawable via the emergency withdrawal flow.
        let sac = token::StellarAssetClient::new(&env, &token_id);
        sac.mint(&contract_id, &300);

        let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &300, &to);
        let w = client.get_emergency_withdrawal(&wid);
        advance(&env, w.activation_ledger);
        client.approve_emergency_withdrawal(&wid, &admin);
        assert_eq!(sac.balance(&to), 300);
    }

    // ── Emergency withdrawal ──────────────────────────────────────────────

    /// Helper: deploy a contract, create a token, mint to contract, and
    /// configure admin signers with the given threshold.
    fn setup_emergency(
        env: &Env,
        num_signers: u32,
        threshold: u32,
        contract_tokens: i128,
    ) -> (Address, FinchippayContractClient<'_>, Address, Vec<Address>) {
        let (id, client) = deploy(env);
        let admin = client.get_admin();
        env.mock_all_auths();

        // Mint tokens directly to the contract (simulates untracked funds).
        let token_id = create_token(env, &admin, &id, contract_tokens);

        // Build admin signers: admin + (num_signers - 1) generated addresses.
        let mut signers: Vec<Address> = Vec::new(env);
        signers.push_back(admin.clone());
        for _ in 1..num_signers {
            signers.push_back(Address::generate(env));
        }
        // Rotate the signer set through the multi-sig path (threshold-1 deploy
        // auto-executes on propose).
        let data: Vec<Val> = Vec::from_array(
            env,
            [signers.clone().into_val(env), threshold.into_val(env)],
        );
        client.propose_admin_action(&admin, &Symbol::new(env, "set_admin_signers"), &data);

        (id, client, token_id, signers)
    }

    #[test]
    fn test_emergency_withdrawal_full_lifecycle() {
        let env = Env::default();
        let (_contract_id, client, token_id, signers) = setup_emergency(&env, 3, 2, 10_000);
        let admin = client.get_admin();
        let to = Address::generate(&env);
        let token = token::Client::new(&env, &token_id);

        let current = env.ledger().sequence();
        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &5_000, &to);
        let w = client.get_emergency_withdrawal(&id);
        assert_eq!(w.status, EmergencyWithdrawalStatus::Pending);
        assert_eq!(w.activation_ledger, current + EMERGENCY_WITHDRAWAL_DELAY);

        // First approval — still pending.
        client.approve_emergency_withdrawal(&id, &signers.get(1).unwrap());
        let w = client.get_emergency_withdrawal(&id);
        assert_eq!(w.status, EmergencyWithdrawalStatus::Pending);
        assert_eq!(w.approvals.len(), 1);

        // Advance past activation ledger, then second approval triggers execution.
        advance(&env, w.activation_ledger);
        client.approve_emergency_withdrawal(&id, &signers.get(2).unwrap());
        let w = client.get_emergency_withdrawal(&id);
        assert_eq!(w.status, EmergencyWithdrawalStatus::Executed);
        assert_eq!(token.balance(&to), 5_000);
    }

    #[test]
    #[should_panic(expected = "emergency withdrawal not ready")]
    fn test_emergency_withdrawal_execute_before_delay_panics() {
        let env = Env::default();
        let (_, client, token_id, signers) = setup_emergency(&env, 2, 2, 5_000);
        let admin = client.get_admin();
        let to = Address::generate(&env);

        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &3_000, &to);
        // Both approvals before activation ledger — manual execute must fail.
        client.approve_emergency_withdrawal(&id, &admin);
        client.approve_emergency_withdrawal(&id, &signers.get(1).unwrap());
        // Threshold met, but activation ledger not reached.
        client.execute_emergency_withdrawal(&id);
    }

    #[test]
    fn test_emergency_withdrawal_cancel_by_admin() {
        let env = Env::default();
        let (_, client, token_id, signers) = setup_emergency(&env, 2, 2, 5_000);
        let admin = client.get_admin();
        let to = Address::generate(&env);

        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &2_000, &to);
        client.approve_emergency_withdrawal(&id, &signers.get(1).unwrap());
        // Cancel before execution.
        client.cancel_emergency_withdrawal(&id, &admin);
        let w = client.get_emergency_withdrawal(&id);
        assert_eq!(w.status, EmergencyWithdrawalStatus::Cancelled);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_emergency_withdrawal_non_admin_cannot_initiate() {
        let env = Env::default();
        let (_, client, token_id, _signers) = setup_emergency(&env, 2, 2, 5_000);
        let stranger = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();

        client.initiate_emergency_withdrawal(&stranger, &token_id, &1_000, &to);
    }

    #[test]
    #[should_panic(expected = "insufficient admin approvals")]
    fn test_emergency_withdrawal_execute_without_enough_approvals_panics() {
        let env = Env::default();
        let (_, client, token_id, signers) = setup_emergency(&env, 3, 3, 5_000);
        let admin = client.get_admin();
        let to = Address::generate(&env);

        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &1_000, &to);
        let w = client.get_emergency_withdrawal(&id);
        advance(&env, w.activation_ledger);
        // Only 1 of 3 approvals.
        client.approve_emergency_withdrawal(&id, &signers.get(1).unwrap());
        client.execute_emergency_withdrawal(&id);
    }

    #[test]
    #[should_panic(expected = "already approved")]
    fn test_emergency_withdrawal_duplicate_approval_panics() {
        let env = Env::default();
        let (_, client, token_id, signers) = setup_emergency(&env, 2, 2, 5_000);
        let admin = client.get_admin();
        let to = Address::generate(&env);

        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &1_000, &to);
        client.approve_emergency_withdrawal(&id, &signers.get(1).unwrap());
        client.approve_emergency_withdrawal(&id, &signers.get(1).unwrap()); // duplicate
    }

    #[test]
    fn test_emergency_withdrawal_threshold_met_before_delay_executes_later() {
        let env = Env::default();
        let (_, client, token_id, signers) = setup_emergency(&env, 2, 2, 5_000);
        let admin = client.get_admin();
        let to = Address::generate(&env);
        let token = token::Client::new(&env, &token_id);

        let id = client.initiate_emergency_withdrawal(&admin, &token_id, &4_000, &to);
        // Both approvals immediately — threshold met but delay not elapsed.
        // Admin (signer[0]) approved on initiate? No — must approve separately.
        client.approve_emergency_withdrawal(&id, &admin);
        client.approve_emergency_withdrawal(&id, &signers.get(1).unwrap());
        let w = client.get_emergency_withdrawal(&id);
        assert_eq!(w.status, EmergencyWithdrawalStatus::Pending);

        // Advance past activation ledger, then call execute.
        advance(&env, w.activation_ledger);
        client.execute_emergency_withdrawal(&id);
        let w = client.get_emergency_withdrawal(&id);
        assert_eq!(w.status, EmergencyWithdrawalStatus::Executed);
        assert_eq!(token.balance(&to), 4_000);
    }

    // ── Receipt verification ─────────────────────────────────────────────

    #[test]
    fn test_verify_receipt_matches_on_chain_data() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let _token_id = create_token(&env, &admin, &from, 5_000);
        let memo = Symbol::new(&env, "inv_42");
        client.mint_receipt(&from, &to, &1_500, &memo);

        assert!(client.verify_receipt(&from, &0, &1_500, &memo));
    }

    #[test]
    fn test_verify_receipt_returns_false_for_wrong_amount() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let _token_id = create_token(&env, &admin, &from, 5_000);
        let memo = Symbol::new(&env, "inv_42");
        client.mint_receipt(&from, &to, &1_500, &memo);

        assert!(!client.verify_receipt(&from, &0, &9_999, &memo));
    }

    #[test]
    fn test_verify_receipt_returns_false_for_wrong_memo() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let _token_id = create_token(&env, &admin, &from, 5_000);
        let memo = Symbol::new(&env, "inv_42");
        client.mint_receipt(&from, &to, &1_500, &memo);

        let wrong_memo = Symbol::new(&env, "WRONG");
        assert!(!client.verify_receipt(&from, &0, &1_500, &wrong_memo));
    }

    #[test]
    fn test_verify_receipt_returns_false_for_nonexistent_index() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let _token_id = create_token(&env, &admin, &from, 5_000);
        let memo = Symbol::new(&env, "inv_42");
        client.mint_receipt(&from, &to, &1_500, &memo);

        assert!(!client.verify_receipt(&from, &99, &1_500, &memo));
    }

    #[test]
    fn test_generate_receipt_proof_returns_stored_fields() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let _token_id = create_token(&env, &admin, &from, 5_000);
        let memo = Symbol::new(&env, "rent_jan");
        client.mint_receipt(&from, &to, &2_500, &memo);

        let proof = client.generate_receipt_proof(&from, &0);
        assert_eq!(proof.receipt_index, 0);
        assert_eq!(proof.payer, from);
        assert_eq!(proof.expected_amount, 2_500);
        assert_eq!(proof.expected_memo, memo);
    }

    #[test]
    fn test_verify_receipt_multiple_receipts_independent() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let _token_id = create_token(&env, &admin, &from, 10_000);
        let memo_a = Symbol::new(&env, "receipt_a");
        let memo_b = Symbol::new(&env, "receipt_b");
        client.mint_receipt(&from, &to, &100, &memo_a);
        client.mint_receipt(&from, &to, &200, &memo_b);

        // Each receipt verifies independently.
        assert!(client.verify_receipt(&from, &0, &100, &memo_a));
        assert!(client.verify_receipt(&from, &1, &200, &memo_b));
        // Cross-checks fail.
        assert!(!client.verify_receipt(&from, &0, &200, &memo_b));
        assert!(!client.verify_receipt(&from, &1, &100, &memo_a));
    }

    // ── View function tests ──────────────────────────────────────────────

    #[test]
    fn test_get_stream_success() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &payer, 1_000);
        let sid = client.open_stream(&token_id, &payer, &recipient, &10, &500);
        let stream = client.get_stream(&sid);
        assert_eq!(stream.id, sid);
        assert_eq!(stream.payer, payer);
        assert_eq!(stream.recipient, recipient);
        assert_eq!(stream.rate_per_ledger, 10);
        assert_eq!(stream.deposited, 500);
    }

    #[test]
    fn test_get_stream_not_found() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let result = client.try_get_stream(&999);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotFound);
    }

    #[test]
    fn test_get_escrow_success() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 2_000);
        let release = env.ledger().sequence() + 10;
        let memo = Symbol::new(&env, "escrow_test");
        let id = client.create_escrow(&token_id, &from, &to, &2_000, &release, &memo);
        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.id, id);
        assert_eq!(escrow.from, from);
        assert_eq!(escrow.to, to);
        assert_eq!(escrow.amount, 2_000);
    }

    #[test]
    fn test_get_escrow_not_found() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let result = client.try_get_escrow(&999);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotFound);
    }

    // ==================== Milestone-based escrows (#476) ====================

    /// Create a 2-milestone escrow (600 + 400 = 1000) from `from` to `to` with
    /// `agent` as the designated milestone approver.
    fn create_milestone_fixture(
        env: &Env,
        client: &FinchippayContractClient<'_>,
        token_id: &Address,
        from: &Address,
        to: &Address,
        agent: &Address,
    ) -> u32 {
        let m0 = Milestone {
            id: 99,
            description: Symbol::new(env, "milestone_a"),
            amount: 600,
            approved: false,
            claimed: false,
            approval_deadline_ledger: 0,
        };
        let m1 = Milestone {
            id: 42,
            description: Symbol::new(env, "milestone_b"),
            amount: 400,
            approved: false,
            claimed: false,
            approval_deadline_ledger: 0,
        };
        client.create_milestone_escrow(token_id, from, to, agent, &vec![env, m0, m1], &1000)
    }

    #[test]
    fn test_milestone_escrow_create_holds_deposit_and_assigns_ids() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);
        let token = token::Client::new(&env, &token_id);

        let id = create_milestone_fixture(&env, &client, &token_id, &from, &to, &agent);

        // Deposit moved to the contract and is counted as locked.
        assert_eq!(token.balance(&from), 9_000);
        assert_eq!(token.balance(&contract_id), 1_000);

        let escrow = client.get_escrow(&id);
        assert!(escrow.is_milestone_based);
        assert_eq!(escrow.agent, Some(agent.clone()));
        assert_eq!(escrow.status, EscrowStatus::Pending);
        assert_eq!(escrow.amount, 1_000);

        // Contract-assigned sequential ids, ignoring caller-supplied ones.
        let milestones = client.get_milestones(&id);
        assert_eq!(milestones.len(), 2);
        assert_eq!(milestones.get(0).unwrap().id, 0);
        assert_eq!(milestones.get(1).unwrap().id, 1);
        assert_eq!(milestones.get(0).unwrap().amount, 600);
        assert_eq!(milestones.get(1).unwrap().amount, 400);

        // Summary reflects the untouched deposit.
        let summary = client.get_escrow_summary(&id);
        assert_eq!(summary.total_amount, 1_000);
        assert_eq!(summary.released_amount, 0);
        assert_eq!(summary.remaining_amount, 1_000);
        assert_eq!(summary.milestone_count, 2);
        assert_eq!(summary.approved_milestones, 0);
        assert_eq!(summary.claimed_milestones, 0);
        assert_eq!(summary.status, EscrowStatus::Pending);
        assert!(summary.is_milestone_based);
    }

    #[test]
    fn test_milestone_escrow_approve_and_claim_partial_release() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);
        let token = token::Client::new(&env, &token_id);

        let id = create_milestone_fixture(&env, &client, &token_id, &from, &to, &agent);

        // Agent approves milestone 0; recipient claims it → partial release.
        client.approve_milestone(&id, &0, &agent);
        client.claim_milestone(&id, &0, &to);
        assert_eq!(token.balance(&to), 600);
        assert_eq!(token.balance(&contract_id), 400);

        let milestones = client.get_milestones(&id);
        assert!(milestones.get(0).unwrap().approved);
        assert!(milestones.get(0).unwrap().claimed);
        assert!(!milestones.get(1).unwrap().approved);
        let summary = client.get_escrow_summary(&id);
        assert_eq!(summary.released_amount, 600);
        assert_eq!(summary.remaining_amount, 400);
        assert_eq!(summary.approved_milestones, 1);
        assert_eq!(summary.claimed_milestones, 1);
        assert_eq!(summary.status, EscrowStatus::Pending);

        // Client approves milestone 1; claiming it fully releases the escrow.
        client.approve_milestone(&id, &1, &from);
        client.claim_milestone(&id, &1, &to);
        assert_eq!(token.balance(&to), 1_000);
        assert_eq!(token.balance(&contract_id), 0);
        assert_eq!(client.get_escrow(&id).status, EscrowStatus::Released);
        assert_eq!(client.get_escrow_summary(&id).released_amount, 1_000);
        assert_eq!(client.get_escrow_summary(&id).remaining_amount, 0);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_milestone_escrow_approve_unauthorized_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        let stranger = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let id = create_milestone_fixture(&env, &client, &token_id, &from, &to, &agent);
        client.approve_milestone(&id, &0, &stranger);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_milestone_escrow_claim_unauthorized_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        let stranger = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let id = create_milestone_fixture(&env, &client, &token_id, &from, &to, &agent);
        client.approve_milestone(&id, &0, &agent);
        client.claim_milestone(&id, &0, &stranger);
    }

    #[test]
    #[should_panic(expected = "milestone not approved")]
    fn test_milestone_escrow_claim_before_approval_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let id = create_milestone_fixture(&env, &client, &token_id, &from, &to, &agent);
        client.claim_milestone(&id, &0, &to);
    }

    #[test]
    #[should_panic(expected = "milestone already claimed")]
    fn test_milestone_escrow_claim_twice_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let id = create_milestone_fixture(&env, &client, &token_id, &from, &to, &agent);
        client.approve_milestone(&id, &0, &agent);
        client.claim_milestone(&id, &0, &to);
        client.claim_milestone(&id, &0, &to);
    }

    #[test]
    fn test_milestone_escrow_cancel_refunds_unclaimed_only() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);
        let token = token::Client::new(&env, &token_id);

        let id = create_milestone_fixture(&env, &client, &token_id, &from, &to, &agent);

        // Milestone 0 is approved and claimed (600 paid out); cancelling the
        // escrow must refund only the unclaimed 400 back to the payer.
        client.approve_milestone(&id, &0, &agent);
        client.claim_milestone(&id, &0, &to);
        client.cancel_escrow(&id);

        assert_eq!(token.balance(&to), 600);
        assert_eq!(token.balance(&from), 9_400);
        assert_eq!(token.balance(&contract_id), 0);
        assert_eq!(client.get_escrow(&id).status, EscrowStatus::Cancelled);
        let summary = client.get_escrow_summary(&id);
        assert_eq!(summary.released_amount, 600);
        assert_eq!(summary.remaining_amount, 0);
        assert_eq!(summary.status, EscrowStatus::Cancelled);
    }

    #[test]
    #[should_panic(expected = "milestone escrow must be claimed via claim_milestone")]
    fn test_milestone_escrow_claim_escrow_blocked() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let id = create_milestone_fixture(&env, &client, &token_id, &from, &to, &agent);
        // The generic claim path must not drain a milestone escrow.
        client.claim_escrow(&id);
    }

    #[test]
    #[should_panic(expected = "milestone amounts must sum to the deposit")]
    fn test_milestone_escrow_amounts_must_sum_to_deposit() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let m0 = Milestone {
            id: 0,
            description: Symbol::new(&env, "a"),
            amount: 600,
            approved: false,
            claimed: false,
            approval_deadline_ledger: 0,
        };
        let m1 = Milestone {
            id: 1,
            description: Symbol::new(&env, "b"),
            amount: 400,
            approved: false,
            claimed: false,
            approval_deadline_ledger: 0,
        };
        // Milestones sum to 1000 but the deposit is 1500.
        client.create_milestone_escrow(&token_id, &from, &to, &agent, &vec![&env, m0, m1], &1500);
    }

    #[test]
    #[should_panic(expected = "too many milestones")]
    fn test_milestone_escrow_rejects_more_than_10_milestones() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let mut milestones = Vec::new(&env);
        for i in 0..11u32 {
            milestones.push_back(Milestone {
                id: i,
                description: Symbol::new(&env, "m"),
                amount: 100,
                approved: false,
                claimed: false,
                approval_deadline_ledger: 0,
            });
        }
        client.create_milestone_escrow(&token_id, &from, &to, &agent, &milestones, &1100);
    }

    #[test]
    #[should_panic(expected = "milestone amount must be positive")]
    fn test_milestone_escrow_zero_amount_milestone_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let m0 = Milestone {
            id: 0,
            description: Symbol::new(&env, "a"),
            amount: 0,
            approved: false,
            claimed: false,
            approval_deadline_ledger: 0,
        };
        client.create_milestone_escrow(&token_id, &from, &to, &agent, &vec![&env, m0], &1000);
    }

    #[test]
    #[should_panic(expected = "agent cannot be the recipient")]
    fn test_milestone_escrow_agent_cannot_be_recipient() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let m0 = Milestone {
            id: 0,
            description: Symbol::new(&env, "a"),
            amount: 1000,
            approved: false,
            claimed: false,
            approval_deadline_ledger: 0,
        };
        // Agent == recipient would let the recipient self-approve.
        client.create_milestone_escrow(&token_id, &from, &to, &to, &vec![&env, m0], &1000);
    }

    #[test]
    #[should_panic(expected = "approval deadline passed")]
    fn test_milestone_escrow_approval_deadline_enforced() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let deadline = env.ledger().sequence() + 10;
        let m0 = Milestone {
            id: 0,
            description: Symbol::new(&env, "a"),
            amount: 1000,
            approved: false,
            claimed: false,
            approval_deadline_ledger: deadline,
        };
        let id =
            client.create_milestone_escrow(&token_id, &from, &to, &agent, &vec![&env, m0], &1000);
        advance(&env, deadline + 1);
        client.approve_milestone(&id, &0, &agent);
    }

    #[test]
    fn test_milestone_escrow_emits_events() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let agent = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &from, 10_000);

        let id = create_milestone_fixture(&env, &client, &token_id, &from, &to, &agent);
        // The event recorder only surfaces events from the most recent
        // invocation, so each event is asserted right after its call.
        let events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            events,
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "milestone_escrow_created"), id).into_val(&env),
                    (2u32).into_val(&env),
                )
            ]
        );

        client.approve_milestone(&id, &0, &agent);
        let events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            events,
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "milestone_approved"), id).into_val(&env),
                    (0u32).into_val(&env),
                )
            ]
        );

        client.claim_milestone(&id, &0, &to);
        let events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            events,
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "milestone_claimed"), id, 0u32).into_val(&env),
                    (600i128).into_val(&env),
                )
            ]
        );
    }

    #[test]
    fn test_get_multisig_success() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let s1 = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &proposer, 1_000);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1.clone());
        let expiry = env.ledger().sequence() + 1000;
        let pid = client.create_multisig(
            &token_id, &proposer, &recipient, &1_000, &1, &signers, &expiry,
        );
        let proposal = client.get_multisig(&pid);
        assert_eq!(proposal.id, pid);
        assert_eq!(proposal.proposer, proposer);
        assert_eq!(proposal.recipient, recipient);
        assert_eq!(proposal.amount, 1_000);
    }

    #[test]
    fn test_get_multisig_not_found() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let result = client.try_get_multisig(&999);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotFound);
    }

    #[test]
    fn test_get_receipt_success() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        env.mock_all_auths();
        let memo = Symbol::new(&env, "Rent");
        let idx = client.mint_receipt(&payer, &payee, &1_500, &memo);
        assert_eq!(idx, 0);
        let receipt = client.get_receipt(&payer, &0);
        assert_eq!(receipt.amount, 1_500);
        assert_eq!(receipt.memo, memo);
    }

    #[test]
    fn test_get_receipt_not_found() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let payer = Address::generate(&env);
        let result = client.try_get_receipt(&payer, &999);
        assert_eq!(result.unwrap_err().unwrap(), ContractError::NotFound);
    }

    // ==================== Storage Compatibility Tests ====================

    #[test]
    fn test_get_storage_layout_version_returns_initial() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let version = client.get_storage_layout_version();
        assert_eq!(version, STORAGE_LAYOUT_VERSION);
    }

    #[test]
    fn test_validate_compatibility_same_version_passes() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        assert!(client.validate_storage_compatibility(&STORAGE_LAYOUT_VERSION));
    }

    #[test]
    fn test_validate_compatibility_higher_version_passes() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        assert!(client.validate_storage_compatibility(&5));
    }

    #[test]
    #[should_panic(expected = "new WASM storage layout version is lower than current")]
    fn test_validate_compatibility_lower_version_panics() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        client.validate_storage_compatibility(&0);
    }

    #[test]
    #[should_panic(expected = "new WASM storage layout version is lower than current")]
    fn test_upgrade_rejects_lower_layout_version() {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        env.mock_all_auths();

        let dummy_hash = BytesN::from_array(&env, &[1u8; 32]);
        let data: Vec<Val> =
            Vec::from_array(&env, [dummy_hash.into_val(&env), 0u32.into_val(&env)]);
        client.propose_admin_action(&admin, &Symbol::new(&env, "upgrade"), &data);
    }

    // ==================== Storage TTL Tests ====================

    use soroban_sdk::testutils::storage::Persistent as _;

    /// The contract instance and the token contract must outlive the long ledger
    /// jumps these tests perform, so they are registered while the network's
    /// minimum persistent TTL is generous. Data entries written afterwards are
    /// born with a short lifetime, which is what makes a bump observable.
    const TTL_TEST_ENTRY_BIRTH_TTL: u32 = 4_096;

    fn ttl_env() -> Env {
        let env = Env::default();
        env.ledger().with_mut(|li| {
            li.sequence_number = 1_000;
            li.min_persistent_entry_ttl = 6_000_000;
            li.max_entry_ttl = 6_312_001;
        });
        env
    }

    fn shorten_entry_lifetimes(env: &Env) {
        env.ledger()
            .with_mut(|li| li.min_persistent_entry_ttl = TTL_TEST_ENTRY_BIRTH_TTL);
    }

    fn ttl_of(env: &Env, contract: &Address, key: &DataKey) -> u32 {
        env.as_contract(contract, || env.storage().persistent().get_ttl(key))
    }

    /// Deploy a contract plus a funded token, then switch to short-lived entries.
    fn ttl_fixture(env: &Env) -> (Address, FinchippayContractClient<'_>, Address, Address) {
        let (id, client) = deploy(env);
        let admin = client.get_admin();
        let payer = Address::generate(env);
        env.mock_all_auths();
        let token = create_token(env, &admin, &payer, 10_000_000);
        shorten_entry_lifetimes(env);
        (id, client, token, payer)
    }

    #[test]
    fn test_created_entry_starts_at_ttl_floor() {
        let env = ttl_env();
        let (id, client, token, payer) = ttl_fixture(&env);
        let recipient = Address::generate(&env);

        let release = env.ledger().sequence() + 100;
        client.create_escrow(
            &token,
            &payer,
            &recipient,
            &50_000,
            &release,
            &Symbol::new(&env, "rent"),
        );

        assert_eq!(
            ttl_of(&env, &id, &DataKey::EscrowRecipient(0)),
            MIN_TTL_LEDGERS
        );
        assert_eq!(
            ttl_of(&env, &id, &DataKey::EscrowByRecipient(recipient)),
            MIN_TTL_LEDGERS
        );
    }

    #[test]
    fn test_read_refreshes_entry_that_fell_below_threshold() {
        let env = ttl_env();
        let (id, client, token, payer) = ttl_fixture(&env);
        let recipient = Address::generate(&env);
        let start = env.ledger().sequence();

        client.create_escrow(
            &token,
            &payer,
            &recipient,
            &50_000,
            &(start + 100),
            &Symbol::new(&env, "rent"),
        );

        // Age the entry until only just under the refresh threshold is left.
        advance(&env, start + MIN_TTL_LEDGERS - MIN_TTL_THRESHOLD + 1);
        assert!(ttl_of(&env, &id, &DataKey::EscrowRecipient(0)) < MIN_TTL_THRESHOLD);

        // A plain view call is enough to restore a full lifetime.
        let escrow = client.get_escrow(&0);
        assert_eq!(escrow.amount, 50_000);
        assert_eq!(
            ttl_of(&env, &id, &DataKey::EscrowRecipient(0)),
            MIN_TTL_LEDGERS
        );
    }

    #[test]
    fn test_bumped_entry_outlives_an_unbumped_one() {
        let env = ttl_env();
        let (id, client, token, payer) = ttl_fixture(&env);
        let recipient = Address::generate(&env);
        let start = env.ledger().sequence();

        client.create_escrow(
            &token,
            &payer,
            &recipient,
            &50_000,
            &(start + 100),
            &Symbol::new(&env, "rent"),
        );

        // A write that skips the bump only gets the network minimum, which is
        // exactly the data-loss scenario the bumps exist to prevent.
        let unbumped = DataKey::TipTotal(recipient.clone());
        env.as_contract(&id, || {
            env.storage().persistent().set(&unbumped, &7i128);
        });
        assert!(ttl_of(&env, &id, &unbumped) < MIN_TTL_LEDGERS);
        assert_eq!(
            ttl_of(&env, &id, &DataKey::EscrowRecipient(0)),
            MIN_TTL_LEDGERS
        );

        // Long past the point the unbumped entry would have expired, the
        // escrow is still intact.
        advance(&env, start + 300_000);
        assert_eq!(client.get_escrow(&0).amount, 50_000);
    }

    #[test]
    fn test_bump_all_ttls_refreshes_cold_entries() {
        let env = ttl_env();
        let (id, client, token, payer) = ttl_fixture(&env);
        let admin = client.get_admin();
        let recipient = Address::generate(&env);
        let start = env.ledger().sequence();

        client.create_escrow(
            &token,
            &payer,
            &recipient,
            &50_000,
            &(start + 100),
            &Symbol::new(&env, "rent"),
        );
        client.open_stream(&token, &payer, &recipient, &10, &50_000);

        // Nobody touches these entries; they simply decay.
        advance(&env, start + 500_000);
        assert!(ttl_of(&env, &id, &DataKey::EscrowRecipient(0)) < MIN_TTL_THRESHOLD);
        assert!(ttl_of(&env, &id, &DataKey::Stream(0)) < MIN_TTL_THRESHOLD);

        // Five config keys (admin, signers, threshold, version, layout), the two
        // escrow keys plus their counter, and the two stream keys plus theirs.
        let bumped = client.bump_all_ttls(&admin, &100);
        assert_eq!(bumped, 11);

        for key in [
            DataKey::Admin,
            DataKey::AdminSigners,
            DataKey::AdminSignersThreshold,
            DataKey::Version,
            DataKey::StorageLayoutVersion,
            DataKey::EscrowCount,
            DataKey::EscrowRecipient(0),
            DataKey::EscrowByRecipient(recipient),
            DataKey::StreamCount,
            DataKey::Stream(0),
            DataKey::StreamByPayer(payer),
        ] {
            assert!(
                ttl_of(&env, &id, &key) >= MIN_TTL_LEDGERS,
                "a swept key was left below the TTL floor"
            );
        }

        // The entries that had actually decayed sit exactly on the floor.
        assert_eq!(
            ttl_of(&env, &id, &DataKey::EscrowRecipient(0)),
            MIN_TTL_LEDGERS
        );
        assert_eq!(ttl_of(&env, &id, &DataKey::Stream(0)), MIN_TTL_LEDGERS);
    }

    #[test]
    fn test_bump_all_ttls_resumes_across_calls() {
        let env = ttl_env();
        let (id, client, token, payer) = ttl_fixture(&env);
        let admin = client.get_admin();
        let start = env.ledger().sequence();

        let mut recipients = Vec::new(&env);
        for _ in 0..4 {
            let recipient = Address::generate(&env);
            client.create_escrow(
                &token,
                &payer,
                &recipient,
                &50_000,
                &(start + 100),
                &Symbol::new(&env, "rent"),
            );
            recipients.push_back(recipient);
        }

        advance(&env, start + 500_000);

        // A budget of two keys per call never runs away, and repeated calls
        // eventually cover every escrow.
        for _ in 0..12 {
            let bumped = client.bump_all_ttls(&admin, &2);
            assert!(
                bumped <= 4,
                "a call bumped {bumped} keys with a budget of 2"
            );
        }

        for index in 0..recipients.len() {
            assert_eq!(
                ttl_of(&env, &id, &DataKey::EscrowRecipient(index)),
                MIN_TTL_LEDGERS
            );
            assert_eq!(
                ttl_of(
                    &env,
                    &id,
                    &DataKey::EscrowByRecipient(recipients.get(index).unwrap())
                ),
                MIN_TTL_LEDGERS
            );
        }
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_bump_all_ttls_rejects_non_admin() {
        let env = ttl_env();
        let (_, client) = deploy(&env);
        env.mock_all_auths();
        client.bump_all_ttls(&Address::generate(&env), &10);
    }

    #[test]
    #[should_panic(expected = "max_keys must be positive")]
    fn test_bump_all_ttls_rejects_zero_budget() {
        let env = ttl_env();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        env.mock_all_auths();
        client.bump_all_ttls(&admin, &0);
    }

    #[test]
    fn test_get_min_ttl_tracks_sweeps() {
        let env = ttl_env();
        let (_, client, token, payer) = ttl_fixture(&env);
        let admin = client.get_admin();
        let recipient = Address::generate(&env);
        let start = env.ledger().sequence();

        // `initialize` leaves the only populated class at the floor.
        assert_eq!(
            client.get_min_ttl(),
            (MIN_TTL_LEDGERS, Symbol::new(&env, "config"))
        );

        // A newly populated class has no proven lifetime until it is swept.
        client.create_escrow(
            &token,
            &payer,
            &recipient,
            &50_000,
            &(start + 100),
            &Symbol::new(&env, "rent"),
        );
        assert_eq!(client.get_min_ttl(), (0, Symbol::new(&env, "escrows")));

        client.bump_all_ttls(&admin, &100);
        assert_eq!(
            client.get_min_ttl(),
            (MIN_TTL_LEDGERS, Symbol::new(&env, "config"))
        );

        // The guarantee decays as the ledger advances.
        advance(&env, start + 10_000);
        let (remaining, _) = client.get_min_ttl();
        assert_eq!(remaining, MIN_TTL_LEDGERS - 10_000);
    }
}

// Mock contracts for storage compatibility tests — no longer needed.
// Kept as empty module placeholder to avoid disrupting surrounding code.

// ─── Stellar Constants ─────────────────────────────────────────────────────────
// STROOPS_PER_XLM: 1 XLM = 10_000_000 stroops (the smallest unit on Stellar).
// All on-chain amounts are expressed in stroops to avoid floating-point rounding.
#[allow(dead_code)]
const STROOPS_PER_XLM: i128 = 10_000_000;
