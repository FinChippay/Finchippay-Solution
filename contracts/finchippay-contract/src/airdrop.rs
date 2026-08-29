//! # Airdrop — Merkle-proof token distribution
//!
//! A funder deposits `total_amount` of a token and publishes a Merkle root over
//! leaves of `(recipient, amount)`. Claimants present a branch proof to
//! withdraw their allocation. Airdrop funds are **locked** (`LockedBalance`)
//! exactly like escrows/streams/multi-sig so emergency-rescue paths cannot
//! sweep them, every value-transferring entry point holds the re-entrancy
//! guard, and all state is committed under Checks-Effects-Interactions before
//! any outbound transfer.
//!
//! ## Merkle commitment (frozen, do not change)
//!
//! ```text
//! leaf = sha256( xdr(recipient) || id_be32 || amount_be128 )
//! pair = sha256( xdr(left)  || xdr(right) )
//! ```
//!
//! `id` is the airdrop instance id, bound into the leaf so a proof minted for
//! one airdrop can never be replayed against a different airdrop (`airdrop B`)
//! even with an identical recipient/amount. This format is a **backward
//! compatibility guarantee**: changing it invalidates every outstanding proof,
//! so it must be treated as frozen (see `src/layout.rs` and `FUZZING.md`).

use soroban_sdk::{contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, Vec};

use crate::events::Events;
use crate::storage::*;
use crate::{
    decrease_locked_balance, increase_locked_balance, require_initialized, require_not_paused,
    require_transfer_succeeded, DataKey,
};

/// Maximum Merkle proof length (number of sibling hashes). Bounds the CPU cost
/// of verifying a public, unauthenticated proof and guarantees `index < 2^depth`
/// is representable. 32 covers a tree of up to 2^32 leaves.
pub const MAX_MERKLE_PROOF_LENGTH: u32 = 32;

#[contracttype]
#[derive(Clone)]
pub struct MerkleAirdrop {
    pub id: u32,
    pub funder: Address,
    pub token: Address,
    pub merkle_root: BytesN<32>,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub expiration_ledger: u32,
    pub cancelled: bool,
}

fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut combined = Bytes::new(env);
    combined.append(&left.clone().to_xdr(env));
    combined.append(&right.clone().to_xdr(env));
    env.crypto().sha256(&combined).into()
}

/// Hash a single airdrop leaf, binding the airdrop `id` so proofs cannot be
/// replayed across airdrops. Commitment documented at the top of this module
/// and frozen in `src/layout.rs`.
fn hash_leaf(env: &Env, id: u32, recipient: &Address, amount: i128) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&recipient.clone().to_xdr(env));
    data.append(&Bytes::from_slice(env, &id.to_be_bytes()));
    data.append(&Bytes::from_slice(env, &amount.to_be_bytes()));
    env.crypto().sha256(&data).into()
}

/// Verify `proof` that `leaf` (at `index`) is in a tree whose root is `root`.
///
/// **Cost & soundness bounds:** proof length is capped at [`MAX_MERKLE_PROOF_LENGTH`]
/// (an oversized proof is rejected — `verify_merkle_proof` panics), and an
/// index that does not fit in `2^depth` leaves is out-of-range, so the proof is
/// treated as invalid (`false`). A proof of length N for an index >= 2^N cannot
/// be sound; rejecting them closes that gap.
pub fn verify_merkle_proof(
    env: &Env,
    leaf: BytesN<32>,
    proof: Vec<BytesN<32>>,
    root: BytesN<32>,
    index: u32,
) -> bool {
    if proof.len() as u32 > MAX_MERKLE_PROOF_LENGTH {
        panic!("proof too long");
    }
    let depth = proof.len() as u64;
    if (index as u64) >= (1u64 << depth) {
        // Out-of-range index: a proof of this depth cannot establish the leaf.
        return false;
    }

    let mut current = leaf;
    let mut idx = index;

    for sibling in proof.iter() {
        let (left, right) = if idx % 2 == 0 {
            (current.clone(), sibling.clone())
        } else {
            (sibling.clone(), current.clone())
        };
        current = hash_pair(env, &left, &right);
        idx /= 2;
    }

    current == root
}

pub fn create_airdrop(
    env: &Env,
    token: Address,
    funder: Address,
    merkle_root: BytesN<32>,
    total_amount: i128,
    expiration_ledger: u32,
) -> u32 {
    let _guard = ReentrancyGuard::acquire(env);
    // Reject a zero/empty Merkle root so an uninitialised or malformed caller
    // cannot deploy an airdrop whose every proof (vacuously) "verifies".
    if merkle_root.to_array().iter().all(|&b| b == 0) {
        panic!("Merkle root must not be all-zeros");
    }

    require_initialized(env);
    require_not_paused(env);
    funder.require_auth();

    if total_amount <= 0 {
        panic!("Amount must be positive");
    }

    if expiration_ledger <= env.ledger().sequence() {
        panic!("Expiration must be in the future");
    }

    let token_client = soroban_sdk::token::Client::new(env, &token);
    require_transfer_succeeded(
        env,
        &token_client,
        &funder,
        &env.current_contract_address(),
        &total_amount,
    );
    // Airdrop funds are owed to future claimants, so they are locked exactly
    // like escrow/stream/multi-sig deposits; otherwise rescue_tokens could
    // sweep allocations still owed to claimers (locked-balance parity).
    increase_locked_balance(env, &token, total_amount);

    let count: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::AirdropCount)
        .unwrap_or(0);

    let id = count;
    let airdrop = MerkleAirdrop {
        id,
        funder: funder.clone(),
        token: token.clone(),
        merkle_root: merkle_root.clone(),
        total_amount,
        claimed_amount: 0,
        expiration_ledger,
        cancelled: false,
    };

    env.storage()
        .persistent()
        .set(&DataKey::Airdrop(id), &airdrop);
    bump_to_floor(env, &DataKey::Airdrop(id));
    let next_count = count.checked_add(1).expect("airdrop count overflow");
    env.storage()
        .persistent()
        .set(&DataKey::AirdropCount, &next_count);
    bump(env, &DataKey::AirdropCount);

    env.events().publish(
        (Events::airdrop_created(env), id),
        (funder, token, total_amount),
    );

    id
}

pub fn claim_airdrop(
    env: &Env,
    airdrop_id: u32,
    recipient: Address,
    amount: i128,
    proof: Vec<BytesN<32>>,
    index: u32,
) {
    let _guard = ReentrancyGuard::acquire(env);
    require_initialized(env);
    require_not_paused(env);
    recipient.require_auth();

    // Zero/negative amounts burn a claim slot while moving nothing; reject them
    // before doing any proof work.
    if amount <= 0 {
        panic!("Claim amount must be positive");
    }

    let mut airdrop: MerkleAirdrop = env
        .storage()
        .persistent()
        .get(&DataKey::Airdrop(airdrop_id))
        .unwrap_or_else(|| panic!("Airdrop not found"));

    if airdrop.cancelled {
        panic!("Airdrop has been cancelled");
    }

    if env.ledger().sequence() > airdrop.expiration_ledger {
        panic!("Airdrop has expired");
    }

    if env
        .storage()
        .persistent()
        .get::<_, bool>(&DataKey::AirdropClaimed(airdrop_id, recipient.clone()))
        .is_some()
    {
        panic!("Already claimed");
    }

    let leaf = hash_leaf(env, airdrop.id, &recipient, amount);
    if !verify_merkle_proof(env, leaf, proof, airdrop.merkle_root.clone(), index) {
        panic!("Invalid Merkle proof");
    }

    // Checked arithmetic (never silent wrap-around in a release build) and a
    // positive-amount allocation guard.
    let new_claimed = airdrop
        .claimed_amount
        .checked_add(amount)
        .expect("airdrop claimed overflow");
    if new_claimed > airdrop.total_amount {
        panic!("Claim exceeds remaining airdrop amount");
    }

    // Checks-effects-interactions: commit the claim and the locked-balance
    // delta *before* the external transfer so a hostile token re-entering
    // `claim_airdrop` observes the marker already set and reverts (also held
    // for the whole call by the ReentrancyGuard).
    airdrop.claimed_amount = new_claimed;
    env.storage()
        .persistent()
        .set(&DataKey::Airdrop(airdrop_id), &airdrop);
    bump(env, &DataKey::Airdrop(airdrop_id));
    env.storage().persistent().set(
        &DataKey::AirdropClaimed(airdrop_id, recipient.clone()),
        &true,
    );
    bump_to_floor(env, &DataKey::AirdropClaimed(airdrop_id, recipient.clone()));
    decrease_locked_balance(env, &airdrop.token, amount);

    let token_client = soroban_sdk::token::Client::new(env, &airdrop.token);
    token_client.transfer(&env.current_contract_address(), &recipient, &amount);

    env.events().publish(
        (Events::airdrop_claimed(env), airdrop_id),
        (recipient, amount),
    );
}

pub fn cancel_airdrop(env: &Env, airdrop_id: u32, funder: Address) {
    let _guard = ReentrancyGuard::acquire(env);
    require_initialized(env);
    require_not_paused(env);
    funder.require_auth();

    let mut airdrop: MerkleAirdrop = env
        .storage()
        .persistent()
        .get(&DataKey::Airdrop(airdrop_id))
        .unwrap_or_else(|| panic!("Airdrop not found"));

    if airdrop.funder != funder {
        panic!("Only the funder can cancel");
    }

    if airdrop.cancelled {
        panic!("Already cancelled");
    }

    if env.ledger().sequence() <= airdrop.expiration_ledger {
        panic!("Cannot cancel before expiration");
    }

    let unclaimed = airdrop
        .total_amount
        .checked_sub(airdrop.claimed_amount)
        .expect("airdrop underflow");

    // Checks-effects-interactions: commit the cancelled state and release the
    // locked-balance before the outbound refund, so a re-entrant call cannot
    // re-cancel / double-refund (also guarded non-reentrantly).
    airdrop.cancelled = true;
    env.storage()
        .persistent()
        .set(&DataKey::Airdrop(airdrop_id), &airdrop);
    bump(env, &DataKey::Airdrop(airdrop_id));
    decrease_locked_balance(env, &airdrop.token, unclaimed);

    if unclaimed > 0 {
        let token_client = soroban_sdk::token::Client::new(env, &airdrop.token);
        token_client.transfer(&env.current_contract_address(), &funder, &unclaimed);
    }

    env.events().publish(
        (Events::airdrop_cancelled(env), airdrop_id),
        (funder, unclaimed),
    );
}
