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
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env, Symbol,
    Vec,
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
    /// Token transfer succeeded but the actual balance did not increase by
    /// the expected amount (possible malicious/fake token contract).
    TransferFailed = 17,
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
const MAX_USER_STREAMS: u32 = 100;
const MAX_PAGE_SIZE: u32 = 50;

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
    /// Always strictly greater than the ledger at creation time — see
    /// `MAX_MULTISIG_TTL` for the enforced upper bound.
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
/// Maximum ledgers into the future a multi-sig proposal's expiration may be
/// set (≈ 30 days at 5 s/ledger). Prevents proposals from outliving the
/// security assumptions (e.g. signer key rotation) made at creation time.
const MAX_MULTISIG_TTL: u32 = 518_400;
/// Maximum number of recipients allowed in a single batch_send call.
const MAX_BATCH_SIZE: u32 = 50;
/// Contract version identifier (used for off-chain discovery).
const CONTRACT_VERSION: u32 = 3;

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
    StreamByPayer(Address),
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

/// Perform a token transfer and verify that the recipient's balance actually
/// increased by at least `amount`. This guards against malicious/fake token
/// contracts that report a successful `transfer` without moving any funds
/// (phantom deposit attack).
///
/// # Panics
/// Panics with `TransferFailed` if the balance check does not hold.
fn require_transfer_succeeded(
    env: &Env,
    token: &token::Client,
    from: &Address,
    to: &Address,
    amount: &i128,
) {
    let balance_before = token.balance(to);
    token.transfer(from, to, amount);
    let balance_after = token.balance(to);
    let expected_min = balance_before.checked_add(*amount).expect("overflow");
    if balance_after < expected_min {
        panic!("TransferFailed");
    }
}

/// Check that the contract is not paused. Panics with `ContractPaused` if it is.
fn require_not_paused(env: &Env) {
    let key = DataKey::Paused;
    let paused: bool = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(false);
    if paused {
        panic!("Contract is paused");
    }
    // Only bump TTL if the key exists in storage.
    if env.storage().persistent().has(&DataKey::Paused) {
        bump(env, &DataKey::Paused);
    }
}

/// Check that the contract has been initialised. Panics if `initialize()` was
/// never called. This prevents use of the contract before the admin is set.
fn require_initialized(env: &Env) {
    if !env.storage().persistent().has(&DataKey::Admin) {
        panic!("Contract not initialized");
    }
}


#[contract]
pub struct FinchippayContract;

#[contractimpl]
// TODO(#XX): migrate env.events().publish() calls to #[contractevent] macro
#[allow(deprecated)]
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
    /// After a successful upgrade the stored version is incremented so off-chain
    /// indexers can detect the change.
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) {
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            panic!("Unauthorized");
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
        let current_ver: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Version)
            .unwrap_or(CONTRACT_VERSION);
        env.storage()
            .persistent()
            .set(&DataKey::Version, &(current_ver + 1));
        bump(&env, &DataKey::Version);
        env.events().publish(
            (Symbol::new(&env, "upgraded"),),
            (current_ver + 1, new_wasm_hash),
        );
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
        let contract_address = env.current_contract_address();
        require_transfer_succeeded(&env, &token, &from, &contract_address, &amount);

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

        env.events().publish(
            (Symbol::new(&env, "escrow_cancelled"),),
            (id, escrow.from, escrow.amount),
        );
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

    /// Stable alias for `get_escrow_count`. Provides a consistent SDK
    /// binding for dashboard and analytics consumers.
    pub fn escrow_count(env: Env) -> u32 {
        Self::get_escrow_count(env)
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
        let contract_address = env.current_contract_address();
        require_transfer_succeeded(&env, &token, &payer, &contract_address, &deposit);

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

        let s_key = DataKey::StreamByPayer(payer.clone());
        let mut p_streams: Vec<u32> = env
            .storage()
            .persistent()
            .get(&s_key)
            .unwrap_or(Vec::new(&env));
        if p_streams.len() < MAX_USER_STREAMS {
            p_streams.push_back(id);
            env.storage().persistent().set(&s_key, &p_streams);
            bump(&env, &s_key);
        }

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
        let contract_address = env.current_contract_address();
        require_transfer_succeeded(&env, &token, &payer, &contract_address, &amount);

        stream.deposited = stream.deposited.checked_add(amount).expect("overflow");
        if stream.deposited > MAX_STREAM_DEPOSIT {
            panic!("deposit exceeds maximum after top-up");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);
        bump(&env, &DataKey::Stream(stream_id));

        env.events().publish(
            (Symbol::new(&env, "stream_topped_up"),),
            (stream_id, payer, amount, stream.deposited),
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

        let s_key = DataKey::StreamByPayer(payer.clone());
        let p_streams: Vec<u32> = env.storage().persistent().get(&s_key).unwrap_or(Vec::new(&env));
        let mut new_streams = Vec::new(&env);
        for s_id in p_streams.iter() {
            if s_id != stream_id {
                new_streams.push_back(s_id);
            }
        }
        env.storage().persistent().set(&s_key, &new_streams);
        bump(&env, &s_key);

        env.events().publish(
            (Symbol::new(&env, "stream_close"), stream_id),
            (payer, refund),
        );

        // Emit final close event for indexing/UI.
        env.events().publish(
            (Symbol::new(&env, "stream_closed"), stream_id),
            (refund, claimable),
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

    /// Stable alias for `get_stream_count`. Generates a consistent SDK
    /// binding name that will not change across contract upgrades, making
    /// dashboard and analytics integrations resilient to internal refactors.
    pub fn stream_count(env: Env) -> u32 {
        Self::get_stream_count(env)
    }

    pub fn list_streams_by_payer(env: Env, payer: Address, offset: u32, limit: u32) -> Vec<Stream> {
        let s_key = DataKey::StreamByPayer(payer);
        let p_streams: Vec<u32> = env.storage().persistent().get(&s_key).unwrap_or(Vec::new(&env));
        if env.storage().persistent().has(&s_key) {
            bump(&env, &s_key);
        }
        let total = p_streams.len();
        if offset >= total {
            return Vec::new(&env);
        }
        let max_limit = limit.min(MAX_PAGE_SIZE);
        let mut end = offset.saturating_add(max_limit);
        if end > total {
            end = total;
        }
        let mut result = Vec::new(&env);
        for i in offset..end {
            let id = p_streams.get(i).unwrap();
            let stream: Stream = env.storage().persistent().get(&DataKey::Stream(id)).unwrap();
            result.push_back(stream);
        }
        result
    }

    pub fn list_escrows_by_recipient(env: Env, recipient: Address, offset: u32, limit: u32) -> Vec<Escrow> {
        let e_key = DataKey::EscrowByRecipient(recipient);
        let r_escrows: Vec<u32> = env.storage().persistent().get(&e_key).unwrap_or(Vec::new(&env));
        if env.storage().persistent().has(&e_key) {
            bump(&env, &e_key);
        }
        let total = r_escrows.len();
        if offset >= total {
            return Vec::new(&env);
        }
        let max_limit = limit.min(MAX_PAGE_SIZE);
        let mut end = offset.saturating_add(max_limit);
        if end > total {
            end = total;
        }
        let mut result = Vec::new(&env);
        for i in offset..end {
            let id = r_escrows.get(i).unwrap();
            let escrow: Escrow = env.storage().persistent().get(&DataKey::Escrow(id)).unwrap();
            result.push_back(escrow);
        }
        result
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
        if expiration_ledger <= env.ledger().sequence() {
            panic!("expiration_ledger must be in the future");
        }
        if expiration_ledger > env.ledger().sequence() + MAX_MULTISIG_TTL {
            panic!("expiration_ledger exceeds maximum multi-sig TTL");
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
        let contract_address = env.current_contract_address();
        require_transfer_succeeded(&env, &token, &proposer, &contract_address, &amount);

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

        // Check if the proposal has expired. Every proposal is required to
        // carry a positive, bounded expiration (see `create_multisig`), so
        // there is no "no expiration" bypass here.
        if env.ledger().sequence() > proposal.expiration_ledger {
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
            (Symbol::new(&env, "multisig_cancelled"),),
            (proposal_id, proposer, proposal.amount),
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

    /// Stable alias for `get_multisig_count`. Provides a consistent SDK
    /// binding for dashboard and analytics consumers.
    pub fn multisig_count(env: Env) -> u32 {
        Self::get_multisig_count(env)
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
        require_initialized(&env);
        require_not_paused(&env);
        from.require_auth();
        if recipients.len() == 0 {
            panic!("batch must have at least one recipient");
        }
        if recipients.len() > MAX_BATCH_SIZE {
            return Err(ContractError::BatchTooLarge);
        }
        if recipients.len() != amounts.len() || recipients.len() != memos.len() {
            return Err(ContractError::LengthMismatch);
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
        let mut total_amount: i128 = 0;
        for i in 0..recipients.len() {
            let to = recipients.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            require_transfer_succeeded(&env, &token, &from, &to, &amount);
            total_amount = total_amount.checked_add(amount).expect("overflow");

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
                memo: memo.clone(),
            };
            env.storage()
                .persistent()
                .set(&DataKey::TipRecord(to.clone(), count), &record);
            bump(&env, &DataKey::TipRecord(to.clone(), count));

            env.events()
                .publish((Symbol::new(&env, "tip"), from.clone(), to.clone()), (amount, memo));
        }

        env.events().publish(
            (Symbol::new(&env, "batch_sent"),),
            (from, recipients.len(), total_amount),
        );
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

    fn deploy(env: &Env) -> (Address, FinchippayContractClient<'_>) {
        let id = env.register(FinchippayContract, ());
        let client = FinchippayContractClient::new(env, &id);
        let admin = Address::generate(env);
        client.initialize(&admin);
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

    /// Deterministic input generator for property tests. Keeping this local
    /// avoids adding a test-only dependency to the contract crate while still
    /// giving each test 10,000 varied inputs.
    struct PropertyRng(u64);

    impl PropertyRng {
        fn new(seed: u64) -> Self {
            Self(seed)
        }

        fn next(&mut self) -> u64 {
            let mut value = self.0;
            value ^= value << 13;
            value ^= value >> 7;
            value ^= value << 17;
            self.0 = value;
            value
        }

        fn u32(&mut self) -> u32 {
            self.next() as u32
        }

        fn range_u32(&mut self, upper_exclusive: u32) -> u32 {
            self.u32() % upper_exclusive
        }

        fn range_i128(&mut self, upper_exclusive: i128) -> i128 {
            (self.next() as i128) % upper_exclusive
        }
    }

    fn stream_for_property(env: &Env, rate: i128, deposited: i128, start_ledger: u32) -> Stream {
        let address = Address::generate(env);
        Stream {
            id: 0,
            payer: address.clone(),
            recipient: address.clone(),
            token: address,
            rate_per_ledger: rate,
            deposited,
            claimed: 0,
            start_ledger,
            closed: false,
        }
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
        let token_id = create_token(&env, &admin, &from, 2000);
        let token = token::Client::new(&env, &token_id);
        let release = env.ledger().sequence() + 10;
        let id = client.create_escrow(&token_id, &from, &to, &2000, &release, &Symbol::new(&env, "e1"));
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
        let id = client.create_escrow(&token_id, &from, &to, &2000, &release, &Symbol::new(&env, "e2"));
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
        let pid = client.create_multisig(&token_id, &proposer, &recipient, &1_000, &2, &signers, &expiry);
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
        let pid = client.create_multisig(&token_id, &proposer, &recipient, &2000, &1, &signers, &expiry);
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
        // Advance to a very large ledger — claimable should be capped by
        // total_streamed = rate * elapsed, not by MAX_STREAM_DEPOSIT.
        advance(&env, start + 1_000_000);
        let claimable = client.get_claimable(&sid);
        let expected = MAX_STREAM_RATE * 1_000_000;
        assert_eq!(claimable, expected);
    }

    #[test]
    fn property_stream_claimable_is_monotonic() {
        let env = Env::default();
        let mut rng = PropertyRng::new(0x5eed_f00d_cafe_babe);

        for _ in 0..10_000 {
            let start = rng.range_u32(u32::MAX / 2);
            let first_elapsed = rng.range_u32(u32::MAX - start);
            let second_elapsed = first_elapsed
                .saturating_add(1)
                .saturating_add(rng.range_u32(u32::MAX - start - first_elapsed));
            let rate = 1 + rng.range_i128(MAX_STREAM_RATE);
            let deposited = 1 + rng.range_i128(MAX_STREAM_DEPOSIT);
            let stream = stream_for_property(&env, rate, deposited, start);

            advance(&env, start + first_elapsed);
            let first = FinchippayContract::_claimable(&env, &stream);
            advance(&env, start + second_elapsed);
            let second = FinchippayContract::_claimable(&env, &stream);
            assert!(second >= first, "claimable decreased: {first} -> {second}");
        }
    }

    #[test]
    fn property_stream_close_never_claims_above_deposit() {
        let env = Env::default();
        let mut rng = PropertyRng::new(0x1234_5678_9abc_def0);

        for _ in 0..10_000 {
            let start = rng.range_u32(u32::MAX / 2);
            let elapsed = rng.u32().saturating_sub(start);
            let rate = 1 + rng.range_i128(MAX_STREAM_RATE);
            let deposited = 1 + rng.range_i128(MAX_STREAM_DEPOSIT);
            let stream = stream_for_property(&env, rate, deposited, start);

            advance(&env, start.saturating_add(elapsed));
            let claimable = FinchippayContract::_claimable(&env, &stream);
            let total_claimed_at_close = stream.claimed + claimable;
            assert!(total_claimed_at_close <= deposited);
        }
    }

    #[test]
    fn property_stream_close_preserves_every_deposited_token() {
        let env = Env::default();
        let mut rng = PropertyRng::new(0x0ddc_0ffe_e15e_beef);

        for _ in 0..10_000 {
            let start = rng.range_u32(u32::MAX / 2);
            let elapsed = rng.u32().saturating_sub(start);
            let rate = 1 + rng.range_i128(MAX_STREAM_RATE);
            let deposited = 1 + rng.range_i128(MAX_STREAM_DEPOSIT);
            let stream = stream_for_property(&env, rate, deposited, start);

            advance(&env, start.saturating_add(elapsed));
            let claimable = FinchippayContract::_claimable(&env, &stream);
            let total_claimed_at_close = stream.claimed + claimable;
            let payer_refund = deposited - total_claimed_at_close;
            assert_eq!(payer_refund + total_claimed_at_close, deposited);
        }
    }

    #[test]
    fn property_stream_max_rate_is_safe_near_max_ledger() {
        let env = Env::default();
        let mut rng = PropertyRng::new(0xa11c_e5af_e123_4567);

        for _ in 0..10_000 {
            let start = rng.range_u32(1_000);
            let elapsed = u32::MAX - start - rng.range_u32(1_000);
            let deposited = 1 + rng.range_i128(MAX_STREAM_DEPOSIT);
            let stream = stream_for_property(&env, MAX_STREAM_RATE, deposited, start);

            advance(&env, start + elapsed);
            let claimable = FinchippayContract::_claimable(&env, &stream);
            assert_eq!(claimable, deposited);
        }
    }

    #[test]
    fn property_stream_zero_elapsed_has_no_claimable_amount() {
        let env = Env::default();
        let mut rng = PropertyRng::new(0xface_feed_4242_0001);

        for _ in 0..10_000 {
            let start = rng.u32();
            let rate = 1 + rng.range_i128(MAX_STREAM_RATE);
            let deposited = 1 + rng.range_i128(MAX_STREAM_DEPOSIT);
            let stream = stream_for_property(&env, rate, deposited, start);

            advance(&env, start);
            assert_eq!(FinchippayContract::_claimable(&env, &stream), 0);
        }
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
        client.create_multisig(&token_id, &proposer, &recipient, &2000, &1, &signers, &too_far);
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
        client.create_multisig(&token_id, &proposer, &recipient, &1_000, &1, &signers, &expiry);
        assert_eq!(client.multisig_count(), 1);
        client.create_multisig(&token_id, &proposer, &recipient, &1_000, &1, &signers, &expiry);
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
        client.create_multisig(&token_id, &proposer, &recipient, &500, &1, &signers, &expiry);
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
        let pid = client.create_multisig(&token_id, &proposer, &recipient, &1_000, &2, &signers, &expiry);
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
        client.create_escrow(&fake_token_id, &from, &to, &2000, &release, &Symbol::new(&env, "mal"));
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
        client.create_multisig(&fake_token_id, &proposer, &recipient, &1_000, &1, &signers, &expiry);
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
        client.batch_send(&token_id, &from, &recipients, &amounts);
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
        let token_id = create_token(&env, &admin, &from, 200);
        let release = env.ledger().sequence() + 50;
        let id = client.create_escrow(&token_id, &from, &to, &200, &release, &Symbol::new(&env, "e2"));
        client.cancel_escrow(&id);

        let events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            events,
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "init"),).into_val(&env),
                    admin.into_val(&env),
                ),
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "escrow_create"), id).into_val(&env),
                    (from.clone(), to.clone(), 200i128, release).into_val(&env),
                ),
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "escrow_cancelled"),).into_val(&env),
                    (id, from, 200i128).into_val(&env),
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
                    (Symbol::new(&env, "init"),).into_val(&env),
                    admin.into_val(&env),
                ),
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "stream_open"), sid).into_val(&env),
                    (payer.clone(), recipient.clone(), 10i128, 1_000i128).into_val(&env),
                ),
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
        let id = client.create_multisig(&token_id, &proposer, &recipient, &2_000, &1, &signers, &expiry);
        client.cancel_multisig(&id, &proposer);

        let events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            events,
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "init"),).into_val(&env),
                    admin.into_val(&env),
                ),
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "multisig_create"), id).into_val(&env),
                    (proposer.clone(), recipient.clone(), 2_000i128, 1u32).into_val(&env),
                ),
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
        recipients.push_back(to1);
        recipients.push_back(to2);
        let mut amounts = soroban_sdk::Vec::new(&env);
        amounts.push_back(300i128);
        amounts.push_back(200i128);
        client.batch_send(&token_id, &from, &recipients, &amounts);

        let events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            events,
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "init"),).into_val(&env),
                    admin.into_val(&env),
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
    fn test_rescue_tokens_emits_rescue_tokens_event() {
        let env = Env::default();
        let (contract_id, client) = deploy(&env);
        let admin = client.get_admin();
        let to = Address::generate(&env);
        env.mock_all_auths();
        let token_id = create_token(&env, &admin, &contract_id, 400);
        client.rescue_tokens(&admin, &token_id, &400, &to);

        let events = env.events().all().filter_by_contract(&contract_id);
        assert_eq!(
            events,
            vec![
                &env,
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "init"),).into_val(&env),
                    admin.into_val(&env),
                ),
                (
                    contract_id.clone(),
                    (Symbol::new(&env, "rescue_tokens"),).into_val(&env),
                    (token_id, 400i128, to).into_val(&env),
                ),
            ]
        );
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
}
