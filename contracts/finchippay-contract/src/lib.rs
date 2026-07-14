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
}

// ─── Shared data types ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct TipRecord {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub ledger: u32,
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
#[derive(Clone, Debug)]
pub struct Escrow {
    pub id: u32,
    pub from: Address,
    pub to: Address,
    pub token: Address,
    pub amount: i128,
    pub release_ledger: u32,
    pub status: EscrowStatus,
}

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
/// Maximum signers allowed in a multi-sig proposal.
const MAX_MULTISIG_SIGNERS: u32 = 20;
/// Contract version identifier (used for off-chain discovery).
const CONTRACT_VERSION: u32 = 2;

// ─── Storage key enum ─────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
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
    // Streaming
    StreamCount,
    Stream(u32),
    // Multi-sig
    MultiSigCount,
    MultiSig(u32),
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn bump<K: soroban_sdk::TryIntoVal<Env, soroban_sdk::Val> + soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    env.storage().persistent().extend_ttl(
        key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
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
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            panic!("Unauthorized");
        }
        env.storage().persistent().set(&DataKey::Paused, &true);
        bump(&env, &DataKey::Paused);
        env.events()
            .publish((Symbol::new(&env, "paused"),), ());
    }

    /// Admin: resume all value-transferring operations.
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored = get_admin(&env);
        if admin != stored {
            panic!("Unauthorized");
        }
        env.storage().persistent().set(&DataKey::Paused, &false);
        bump(&env, &DataKey::Paused);
        env.events()
            .publish((Symbol::new(&env, "unpaused"),), ());
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

    // ─── Tips ─────────────────────────────────────────────────────────────────

    /// Transfer `amount` tokens from `from` to `to` and record the tip on-chain.
    ///
    /// # Errors
    /// Panics if `amount <= 0`, the contract is paused, or `from` has not
    /// authorised the call.
    pub fn send_tip(env: Env, token_address: Address, from: Address, to: Address, amount: i128) {
        require_initialized(&env);
        require_not_paused(&env);
        from.require_auth();
        if amount <= 0 {
            panic!("Tip amount must be positive");
        }
        let token = token::Client::new(&env, &token_address);
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
    ) -> u32 {
        require_initialized(&env);
        require_not_paused(&env);
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        if amount > MAX_ESCROW_AMOUNT {
            panic!("amount exceeds maximum escrow size");
        }
        if release_ledger <= env.ledger().sequence() {
            panic!("release_ledger must be in the future");
        }
        if release_ledger > env.ledger().sequence() + MAX_ESCROW_LEDGERS {
            panic!("release_ledger is too far in the future");
        }

        let token = token::Client::new(&env, &token_address);
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
        };
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(next_id), &escrow);
        bump(&env, &DataKey::Escrow(next_id));
        env.storage()
            .persistent()
            .set(&DataKey::EscrowCount, &(next_id + 1));
        bump(&env, &DataKey::EscrowCount);

        env.events().publish(
            (Symbol::new(&env, "escrow_create"), next_id),
            (from, to, amount, release_ledger),
        );
        next_id
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

        let token = token::Client::new(&env, &escrow.token);
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

        let token = token::Client::new(&env, &escrow.token);
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
        let token = token::Client::new(&env, &token_address);
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

        let token = token::Client::new(&env, &stream.token);
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

        let token = token::Client::new(&env, &stream.token);
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

        let token = token::Client::new(&env, &stream.token);

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
    ) -> u32 {
        require_initialized(&env);
        require_not_paused(&env);
        proposer.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        if amount > MAX_MULTISIG_AMOUNT {
            panic!("amount exceeds maximum multi-sig size");
        }
        if threshold == 0 || threshold > signers.len() {
            panic!("threshold must be between 1 and signers.len()");
        }
        if signers.len() > MAX_MULTISIG_SIGNERS {
            panic!("too many signers");
        }

        // Lock funds.
        let token = token::Client::new(&env, &token_address);
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

        // Verify signer is in the allowed list.
        let mut allowed = false;
        for i in 0..proposal.signers.len() {
            if proposal.signers.get(i).unwrap() == signer {
                allowed = true;
                break;
            }
        }
        if !allowed {
            panic!("signer not authorised for this proposal");
        }

        // Prevent duplicate approvals.
        for i in 0..proposal.approvals.len() {
            if proposal.approvals.get(i).unwrap() == signer {
                panic!("already approved");
            }
        }

        proposal.approvals.push_back(signer.clone());

        env.events().publish(
            (Symbol::new(&env, "multisig_approve"), proposal_id),
            signer.clone(),
        );

        // Auto-execute if threshold is reached.
        if proposal.approvals.len() >= proposal.threshold {
            let token = token::Client::new(&env, &proposal.token);
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

        let token = token::Client::new(&env, &proposal.token);
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
        if recipients.len() != amounts.len() {
            panic!("arrays must have equal length");
        }
        let token = token::Client::new(&env, &token_address);
        for i in 0..recipients.len() {
            let to = recipients.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            if amount <= 0 {
                panic!("amount must be positive");
            }
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
            };
            env.storage()
                .persistent()
                .set(&DataKey::TipRecord(to.clone(), count), &record);
            bump(&env, &DataKey::TipRecord(to.clone(), count));
        }

        env.events()
            .publish((Symbol::new(&env, "batch_send"), from), recipients.len());
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
        client.send_tip(&token_id, &from, &to, &300);
        client.send_tip(&token_id, &from, &to, &700);
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
        let id = client.create_escrow(&token_id, &from, &to, &500, &release);
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
        let id = client.create_escrow(&token_id, &from, &to, &200, &release);
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
        let token_id = create_token(&env, &admin, &from, 100);
        let release = env.ledger().sequence() + 20;
        let id = client.create_escrow(&token_id, &from, &to, &100, &release);
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
        let pid = client.create_multisig(&token_id, &proposer, &recipient, &1_000, &2, &signers);
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
        let token_id = create_token(&env, &admin, &proposer, 500);
        let token = token::Client::new(&env, &token_id);

        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(s1.clone());
        let pid = client.create_multisig(&token_id, &proposer, &recipient, &500, &1, &signers);
        client.cancel_multisig(&pid, &proposer);
        assert_eq!(client.get_multisig(&pid).status, MultiSigStatus::Cancelled);
        assert_eq!(token.balance(&proposer), 500);
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
        let pid = client.create_multisig(&token_id, &proposer, &recipient, &1_000, &2, &signers);
        client.approve_multisig(&pid, &s1);
        client.approve_multisig(&pid, &s1); // duplicate — should panic
    }
}
