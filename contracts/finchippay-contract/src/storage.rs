//! # Storage TTL Management
//!
//! Soroban's persistent storage requires entries to have their TTL (time-to-live)
//! extended periodically or they expire and are lost. This module provides:
//!
//! - **TTL constants**: target lifetimes, thresholds, and safety bounds.
//! - **Bump helpers**: `bump`, `bump_to_floor`, `bump_if_present` — the four
//!   primitives every read/write path uses to keep entries alive.
//! - **TTL sweeping**: `bump_all_ttls` / `get_min_ttl` machinery for proactive
//!   batch lifetime extension across all enumerable storage classes.
//!
//! ## Design
//!
//! Every mutating function in the contract calls `bump()` (or a variant) on the
//! keys it touches. Because `bump` only extends when the remaining lifetime drops
//! below `MIN_TTL_THRESHOLD`, frequently accessed hot paths incur zero extra cost
//! while cold entries stay alive.
//!
//! For entries that are never read (e.g., old receipts, settled escrows), an
//! admin-orchestrated sweep via `bump_all_ttls` walks every enumerable storage
//! class in bounded chunks and raises every key to the `MIN_TTL_LEDGERS` floor.

use soroban_sdk::{Address, Env, Symbol};

use crate::{ContractError, DataKey, Stream, TtlClass};

// ─── Storage lifetime constants ───────────────────────────────────────────────

/// Target TTL (in ledgers) a persistent entry is extended to (~31 days at
/// 5 s/ledger). Every entry the contract creates or sweeps is guaranteed to
/// have at least this many ledgers of life remaining.
pub const MIN_TTL_LEDGERS: u32 = 535_680;

/// Remaining TTL below which a hot-path touch refreshes an entry. Reads and
/// updates only pay for a TTL extension once an entry drops under this bound,
/// which keeps per-call gas flat on frequently exercised paths.
pub const MIN_TTL_THRESHOLD: u32 = 100_000;

/// Hard cap on the number of keys a single `bump_all_ttls` call may touch.
///
/// # Budget rationale
///
/// Soroban meters every transaction against a per-transaction CPU instruction
/// budget (100M instructions on mainnet). Each swept key costs a constant
/// handful of instructions (`extend_ttl` is a host call, and multi-key items
/// additionally perform one `get`), so a call is bounded by the number of keys
/// it touches, not by the total size of user state. Bounding a single invocation
/// to 100 keys keeps the worst case — 100 TTL extensions plus a few dozen reads
/// — orders of magnitude inside the instruction budget, which is what guarantees
/// a full sweep can be driven to completion by repeated calls without any one
/// call failing part-way and leaving the sweep half-applied. The value is
/// deliberately conservative to leave headroom for the contract's other work and
/// for future metering changes.
pub const MAX_KEYS_PER_SWEEP: u32 = 100;

/// Number of variants in `TtlClass`, i.e. how many key groups a full sweep
/// walks through.
///
/// Note: tip-record families (`TipTotal`/`TipCount`/`TipRecord`) are **not** a
/// sweep class because they are keyed by an arbitrary recipient address with no
/// on-chain index (see the tip-retention policy in `src/lib.rs`). Their TTL is
/// kept alive by the per-access bumps in `send_tip`/`batch_send`, which is
/// documented there and in the README.
pub const TTL_CLASS_COUNT: u32 = 9;

/// Number of singleton configuration keys enumerated by the `Config` class.
pub const TTL_CONFIG_KEYS: u32 = 9;

// ─── Non-reentrancy guard ─────────────────────────────────────────────────────

/// RAII guard that enforces non-reentrancy for every value-transferring entry
/// point.
///
/// # Why this exists
///
/// Every `token.transfer` is a cross-contract call into an *untrusted* token
/// implementation. Without a lock, a hostile token's `transfer` can call back
/// into this contract (e.g. re-enter `claim_escrow`, `claim_stream`,
/// `approve_multisig`, `claim_vesting`, or a swap) *before* the outer call has
/// committed its state, letting an attacker double-claim or double-drain funds.
/// Soroban's single-threaded ledger does not by itself prevent this: the outer
/// call is suspended while the token executes, so re-entrancy through an
/// arbitrary token contract is a real attack surface for a funds-custody
/// contract.
///
/// The lock is a single `bool` kept in *instance* storage (transient,
/// per-invocation state) under [`DataKey::Reentrant`]. `acquire` panics with
/// [`ContractError::ReentrantCall`] if the flag is already set; on a clean
/// return the flag is removed by [`Drop`], and on a panic the entire
/// transaction is rolled back by the host, which also clears the flag.
///
/// # Usage
///
/// Acquire the guard as the *first* statement of every value-transferring
/// entry point and bind it to a local so it lives until the function returns:
///
/// ```ignore
/// let _guard = ReentrancyGuard::acquire(&env);
/// ```
pub struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl<'a> ReentrancyGuard<'a> {
    /// Acquire the non-reentrancy lock.
    ///
    /// # Panics
    ///
    /// Panics with [`ContractError::ReentrantCall`] if a value-transferring
    /// entry point is already mid-flight.
    pub fn acquire(env: &'a Env) -> ReentrancyGuard<'a> {
        let key = DataKey::Reentrant;
        if env.storage().instance().has(&key) {
            soroban_sdk::panic_with_error!(env, ContractError::ReentrantCall);
        }
        env.storage().instance().set(&key, &true);
        ReentrancyGuard { env }
    }
}

impl Drop for ReentrancyGuard<'_> {
    fn drop(&mut self) {
        // Clearing on a normal return keeps the lock from leaking into the next
        // call. During a panic this is harmless: the host rolls back the whole
        // transaction (including this removal) before committing anything.
        self.env.storage().instance().remove(&DataKey::Reentrant);
    }
}

// ─── Core bump primitives ─────────────────────────────────────────────────────

/// Refresh an existing entry that is running low on life. Because the threshold
/// is below the target, an entry with plenty of TTL left costs nothing to touch,
/// which keeps hot paths (claims, approvals, view functions) cheap.
///
/// Callers must be sure the entry exists — `extend_ttl` traps on a missing key.
pub fn bump<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    env.storage()
        .persistent()
        .extend_ttl(key, MIN_TTL_THRESHOLD, MIN_TTL_LEDGERS);
}

/// Extend an entry so that its remaining TTL is unconditionally at least
/// `MIN_TTL_LEDGERS`.
///
/// Setting the threshold equal to the target makes the post-condition hold no
/// matter what the entry's TTL was beforehand, which is what lets a completed
/// sweep record a watermark that `get_min_ttl` can trust. Used when an entry is
/// first created and by `bump_all_ttls`; both are rare enough that the extra TTL
/// write is irrelevant, and on networks whose minimum persistent TTL already
/// exceeds the target it costs nothing at all.
pub fn bump_to_floor<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    env.storage()
        .persistent()
        .extend_ttl(key, MIN_TTL_LEDGERS, MIN_TTL_LEDGERS);
}

/// `bump_to_floor` for keys that may legitimately be absent. Returns the number
/// of keys bumped (0 or 1) so sweep callers can count real work.
pub fn bump_to_floor_if_present<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &K,
) -> u32 {
    if env.storage().persistent().has(key) {
        bump_to_floor(env, key);
        1
    } else {
        0
    }
}

/// `bump` for keys that may legitimately be absent.
pub fn bump_if_present<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    if env.storage().persistent().has(key) {
        bump(env, key);
    }
}

// ─── Storage TTL sweeping ─────────────────────────────────────────────────────

/// Read a counter that gates how many items a TTL class contains.
pub fn counter(env: &Env, key: &DataKey) -> u32 {
    env.storage().persistent().get(key).unwrap_or(0)
}

/// Map a sweep class index onto its `TtlClass`. Indices come from the stored
/// cursor, so they are always below `TTL_CLASS_COUNT`.
pub fn ttl_class_at(index: u32) -> TtlClass {
    match index {
        0 => TtlClass::Config,
        1 => TtlClass::Receipts,
        2 => TtlClass::Escrows,
        3 => TtlClass::Streams,
        4 => TtlClass::MultiSig,
        5 => TtlClass::Vesting,
        6 => TtlClass::YieldEscrow,
        7 => TtlClass::Airdrop,
        _ => TtlClass::Emergency,
    }
}

/// Human-readable name reported by `get_min_ttl`.
pub fn ttl_class_symbol(env: &Env, class: &TtlClass) -> Symbol {
    match class {
        TtlClass::Config => Symbol::new(env, "config"),
        TtlClass::Receipts => Symbol::new(env, "receipts"),
        TtlClass::Escrows => Symbol::new(env, "escrows"),
        TtlClass::Streams => Symbol::new(env, "streams"),
        TtlClass::MultiSig => Symbol::new(env, "multisig"),
        TtlClass::Vesting => Symbol::new(env, "vesting"),
        TtlClass::Emergency => Symbol::new(env, "emergency"),
        TtlClass::YieldEscrow => Symbol::new(env, "yieldescrow"),
        TtlClass::Airdrop => Symbol::new(env, "airdrop"),
    }
}

/// How many sweep items a class holds. Item 0 of every counted class is the
/// counter itself, so the count is `1 + items` and is never zero.
pub fn ttl_class_len(env: &Env, class: &TtlClass) -> u32 {
    match class {
        TtlClass::Config => TTL_CONFIG_KEYS,
        TtlClass::Receipts => 1 + counter(env, &DataKey::TotalReceiptCount),
        TtlClass::Escrows => 1 + counter(env, &DataKey::EscrowCount),
        TtlClass::Streams => 1 + counter(env, &DataKey::StreamCount),
        TtlClass::MultiSig => 1 + counter(env, &DataKey::MultiSigCount),
        TtlClass::Vesting => 1 + counter(env, &DataKey::VestingCount),
        TtlClass::Emergency => 1 + counter(env, &DataKey::EmergencyWithdrawalCount),
        TtlClass::YieldEscrow => 1 + counter(env, &DataKey::YieldEscrowCount),
        TtlClass::Airdrop => 1 + counter(env, &DataKey::AirdropCount),
    }
}

/// Whether a class holds any state worth guaranteeing a lifetime for. `Config`
/// always does, since `initialize` writes into it.
pub fn ttl_class_is_populated(env: &Env, class: &TtlClass) -> bool {
    match class {
        TtlClass::Config => true,
        _ => ttl_class_len(env, class) > 1,
    }
}

/// Bump the `index`-th singleton configuration key. Most are optional, so each
/// one is guarded.
pub fn bump_config_key(env: &Env, index: u32) -> u32 {
    match index {
        0 => bump_to_floor_if_present(env, &DataKey::Admin),
        1 => bump_to_floor_if_present(env, &DataKey::Version),
        2 => bump_to_floor_if_present(env, &DataKey::StorageLayoutVersion),
        3 => bump_to_floor_if_present(env, &DataKey::Paused),
        4 => bump_to_floor_if_present(env, &DataKey::Pauser),
        5 => bump_to_floor_if_present(env, &DataKey::AdminSigners),
        6 => bump_to_floor_if_present(env, &DataKey::AdminSignersThreshold),
        7 => bump_to_floor_if_present(env, &DataKey::Arbitrators),
        _ => bump_to_floor_if_present(env, &DataKey::ArbitratorCount),
    }
}

/// Worst-case number of keys [`bump_ttl_class_item`] will touch for sweep item
/// `index` of `class`. `bump_all_ttls` checks this *before* starting an item so
/// a call can plan its budget and never overshoot [`MAX_KEYS_PER_SWEEP`], even
/// though a single item is bumped atomically (it can own up to three keys).
///
/// This must stay in sync with [`bump_ttl_class_item`]: it reports the count the
/// sibling function would touch when every optional key is present. Actual
/// touches may be lower when optional keys are absent, which is safe because the
/// budget is planned against the worst case.
pub fn ttl_class_item_key_cost(class: &TtlClass, index: u32) -> u32 {
    match class {
        TtlClass::Config => 1,
        TtlClass::Receipts => {
            if index == 0 {
                1
            } else {
                // Index entry + receipt record + per-payer receipt counter.
                3
            }
        }
        TtlClass::Escrows | TtlClass::Streams => {
            if index == 0 {
                1
            } else {
                // Per-id entry + per-owner index entry.
                2
            }
        }
        TtlClass::MultiSig
        | TtlClass::Vesting
        | TtlClass::Emergency
        | TtlClass::YieldEscrow
        | TtlClass::Airdrop => 1,
    }
}

/// Bump every key belonging to sweep item `index` of `class` and return how many
/// keys were actually touched.
///
/// An item can own more than one key — an escrow owns both its per-id recipient
/// entry and the recipient's escrow index — so the caller checks its budget
/// (via [`ttl_class_item_key_cost`]) before starting an item rather than between
/// the keys of one item. That keeps a sweep making progress for any
/// `max_keys >= 1` while respecting [`MAX_KEYS_PER_SWEEP`].
pub fn bump_ttl_class_item(env: &Env, class: &TtlClass, index: u32) -> u32 {
    match class {
        TtlClass::Config => bump_config_key(env, index),
        TtlClass::Receipts => {
            if index == 0 {
                return bump_to_floor_if_present(env, &DataKey::TotalReceiptCount);
            }
            let index_key = DataKey::ReceiptByIndex(index - 1);
            let entry: Option<(Address, u32)> = env.storage().persistent().get(&index_key);
            match entry {
                Some((payer, local_index)) => {
                    bump_to_floor(env, &index_key);
                    1 + bump_to_floor_if_present(
                        env,
                        &DataKey::ReceiptRecord(payer.clone(), local_index),
                    ) + bump_to_floor_if_present(env, &DataKey::ReceiptCount(payer))
                }
                None => 0,
            }
        }
        TtlClass::Escrows => {
            if index == 0 {
                return bump_to_floor_if_present(env, &DataKey::EscrowCount);
            }
            let recipient_key = DataKey::EscrowRecipient(index - 1);
            let recipient: Option<Address> = env.storage().persistent().get(&recipient_key);
            match recipient {
                Some(recipient) => {
                    bump_to_floor(env, &recipient_key);
                    1 + bump_to_floor_if_present(env, &DataKey::EscrowByRecipient(recipient))
                }
                None => 0,
            }
        }
        TtlClass::Streams => {
            if index == 0 {
                return bump_to_floor_if_present(env, &DataKey::StreamCount);
            }
            let stream_key = DataKey::Stream(index - 1);
            let stream: Option<Stream> = env.storage().persistent().get(&stream_key);
            match stream {
                Some(stream) => {
                    bump_to_floor(env, &stream_key);
                    1 + bump_to_floor_if_present(env, &DataKey::StreamByPayer(stream.payer))
                }
                None => 0,
            }
        }
        TtlClass::MultiSig => {
            if index == 0 {
                bump_to_floor_if_present(env, &DataKey::MultiSigCount)
            } else {
                bump_to_floor_if_present(env, &DataKey::MultiSig(index - 1))
            }
        }
        TtlClass::Vesting => {
            if index == 0 {
                bump_to_floor_if_present(env, &DataKey::VestingCount)
            } else {
                bump_to_floor_if_present(env, &DataKey::Vesting(index - 1))
            }
        }
        TtlClass::Emergency => {
            if index == 0 {
                bump_to_floor_if_present(env, &DataKey::EmergencyWithdrawalCount)
            } else {
                bump_to_floor_if_present(env, &DataKey::EmergencyWithdrawal(index - 1))
            }
        }
        TtlClass::YieldEscrow => {
            if index == 0 {
                bump_to_floor_if_present(env, &DataKey::YieldEscrowCount)
            } else {
                bump_to_floor_if_present(env, &DataKey::YieldEscrow((index - 1) as u64))
            }
        }
        TtlClass::Airdrop => {
            if index == 0 {
                bump_to_floor_if_present(env, &DataKey::AirdropCount)
            } else {
                bump_to_floor_if_present(env, &DataKey::Airdrop(index - 1))
            }
        }
    }
}

/// Record that every key in `class` has just been raised to `MIN_TTL_LEDGERS`.
pub fn set_ttl_watermark(env: &Env, class: &TtlClass) {
    let key = DataKey::TtlWatermark(class.clone());
    env.storage()
        .persistent()
        .set(&key, &env.ledger().sequence());
    bump_to_floor(env, &key);
}

/// Remaining lifetime `class` is guaranteed to have, derived from its watermark.
/// `None` means no sweep has ever completed for the class, so nothing is
/// guaranteed.
pub fn ttl_class_remaining(env: &Env, class: &TtlClass) -> Option<u32> {
    let key = DataKey::TtlWatermark(class.clone());
    let swept_at: u32 = env.storage().persistent().get(&key)?;
    let elapsed = env.ledger().sequence().saturating_sub(swept_at);
    Some(MIN_TTL_LEDGERS.saturating_sub(elapsed))
}
