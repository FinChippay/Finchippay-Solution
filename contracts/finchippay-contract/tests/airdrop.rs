//! # Airdrop — Workstream 1/2/3/6 security test suite
//!
//! Covers the airdrop module fixes:
//!
//! - **WS1 (CEI & locked-balance parity):** `create_airdrop` raises
//!   `LockedBalance` by `total_amount`; each claim lowers it by exactly
//!   `amount`; `cancel_airdrop` lowers it by `unclaimed`. No double-claim.
//! - **WS2 (access control):** uninitialised / paused instances reject airdrop
//!   calls; a zero/empty Merkle root is rejected.
//! - **WS3 (arithmetic & proof bounds):** zero/negative claims revert; claims
//!   exceeding `total_amount` revert; oversized proofs revert; out-of-range
//!   indices fail to verify.
//! - **WS6 (commitment freeze):** a proof minted for airdrop A cannot claim a
//!   different airdrop B with the same recipient/amount (leaf binds `id`).

#![allow(deprecated)]
#![allow(
    clippy::len_zero,
    clippy::manual_is_multiple_of,
    clippy::needless_borrow,
    clippy::ptr_arg
)]

use finchippay_contract::{DataKey, FinchippayContract, FinchippayContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, Symbol, Vec,
};

// ─── Merkle helpers (mirror airdrop.rs commitment exactly) ──────────────────

/// hash_pair = sha256(xdr(left) || xdr(right))
fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut combined = Bytes::new(env);
    combined.append(&left.clone().to_xdr(env));
    combined.append(&right.clone().to_xdr(env));
    env.crypto().sha256(&combined).into()
}

/// leaf = sha256(xdr(recipient) || id_be32 || amount_be128) — frozen format.
fn hash_leaf(env: &Env, id: u32, recipient: &Address, amount: i128) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&recipient.clone().to_xdr(env));
    data.append(&Bytes::from_slice(env, &id.to_be_bytes()));
    data.append(&Bytes::from_slice(env, &amount.to_be_bytes()));
    env.crypto().sha256(&data).into()
}

/// Build an in-memory Merkle tree over `leaves` (length must be a power of two)
/// and return `(root, proofs)` where `proofs[i]` is the proof for `leaves[i]`.
fn merkle_root_and_proofs(
    env: &Env,
    leaves: std::vec::Vec<BytesN<32>>,
) -> (BytesN<32>, std::vec::Vec<std::vec::Vec<BytesN<32>>>) {
    assert!(leaves.len() >= 1 && leaves.len().is_power_of_two());
    let n = leaves.len();
    let mut layer: std::vec::Vec<BytesN<32>> = leaves;
    let mut proofs: std::vec::Vec<std::vec::Vec<BytesN<32>>> = vec![Default::default(); n];
    let mut indices: std::vec::Vec<u32> = (0..n as u32).collect();
    while layer.len() > 1 {
        let mut next = std::vec::Vec::with_capacity(layer.len() / 2);
        let mut pos = 0;
        while pos < layer.len() {
            let left = &layer[pos];
            let right = &layer[pos + 1];
            for j in [pos, pos + 1] {
                let sib = if indices[j] % 2 == 0 {
                    right.clone()
                } else {
                    left.clone()
                };
                (&mut proofs[j]).push(sib);
            }
            next.push(hash_pair(env, left, right));
            pos += 2;
        }
        for x in indices.iter_mut() {
            *x /= 2;
        }
        layer = next;
    }
    (layer[0].clone(), proofs)
}

// ─── Test harness ────────────────────────────────────────────────────────────

fn deploy(env: &Env) -> (Address, FinchippayContractClient<'_>) {
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(&Vec::from_array(env, [admin.clone()]), &1);
    (id, client)
}

fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    // Minting is an authenticated token operation; mock auths so every caller
    // works without remembering to call `mock_all_auths` first.
    env.mock_all_auths();
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let sac_client = token::StellarAssetClient::new(env, &token_id);
    sac_client.mint(to, &amount);
    token_id
}

fn locked_balance(env: &Env, contract: &Address, token: &Address) -> i128 {
    env.as_contract(contract, || {
        env.storage()
            .persistent()
            .get(&DataKey::LockedBalance(token.clone()))
            .unwrap_or(0)
    })
}

fn advance(env: &Env, to: u32) {
    env.ledger().with_mut(|l| l.sequence_number = to);
}

/// Build an airdrop over `(recipient, amount)`-style leaves for `id`, return
/// `(root, proofs)`, and create the airdrop on-chain. `expiration` is in the
/// future.
#[allow(clippy::too_many_arguments)]
fn create_airdrop_with_leaves(
    env: &Env,
    client: &FinchippayContractClient<'_>,
    id: u32,
    token: &Address,
    funder: &Address,
    leaves: &std::vec::Vec<(Address, i128)>,
    total_amount: i128,
    expiration: u32,
) -> (BytesN<32>, std::vec::Vec<std::vec::Vec<BytesN<32>>>) {
    env.mock_all_auths();
    let leaf_hashes: std::vec::Vec<BytesN<32>> = leaves
        .iter()
        .map(|(r, a)| hash_leaf(env, id, r, *a))
        .collect();
    let (root, proofs) = merkle_root_and_proofs(env, leaf_hashes);
    client.create_airdrop(token, funder, &root, &total_amount, &expiration);
    (root, proofs)
}

// ─── WS1: locked-balance parity & CEI ───────────────────────────────────────

#[test]
fn test_create_airdrop_locks_total_amount() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    env.mock_all_auths();
    let token = create_token(&env, &admin, &funder, 10_000_000);

    assert_eq!(locked_balance(&env, &contract_id, &token), 0);

    let leaves = vec![(funder.clone(), 2_000_000i128)];
    let (root, _) = create_airdrop_with_leaves(
        &env,
        &client,
        0,
        &token,
        &funder,
        &leaves,
        2_000_000,
        env.ledger().sequence() + 100,
    );
    let _ = root;

    // WS1: the whole pool is locked, so rescue_tokens cannot sweep allocations.
    assert_eq!(locked_balance(&env, &contract_id, &token), 2_000_000);
}

#[test]
fn test_claim_releases_locked_balance_and_marks_claimed() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    env.mock_all_auths();
    let token = create_token(&env, &admin, &funder, 10_000_000);

    let leaves = vec![(recipient.clone(), 1_000_000i128)];
    let (_root, proofs) = create_airdrop_with_leaves(
        &env,
        &client,
        0,
        &token,
        &funder,
        &leaves,
        1_000_000,
        env.ledger().sequence() + 100,
    );
    assert_eq!(locked_balance(&env, &contract_id, &token), 1_000_000);

    env.mock_all_auths();
    client.claim_airdrop(&0, &recipient, &1_000_000, &to_svec(&env, &proofs[0]), &0);

    // Each claim lowers exactly `amount` from the locked pool.
    assert_eq!(locked_balance(&env, &contract_id, &token), 0);
    assert_eq!(
        token::Client::new(&env, &token).balance(&recipient),
        1_000_000
    );
}

#[test]
fn test_airdrop_cannot_claim_twice() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin, &funder, 10_000_000);

    let leaves = vec![(recipient.clone(), 1_000_000i128)];
    let (_root, proofs) = create_airdrop_with_leaves(
        &env,
        &client,
        0,
        &token,
        &funder,
        &leaves,
        1_000_000,
        env.ledger().sequence() + 100,
    );
    env.mock_all_auths();
    client.claim_airdrop(&0, &recipient, &1_000_000, &to_svec(&env, &proofs[0]), &0);
    // Second claim must revert (marker is committed before the transfer — WS1).
    assert!(client
        .try_claim_airdrop(&0, &recipient, &1_000_000, &to_svec(&env, &proofs[0]), &0)
        .is_err());
    assert_eq!(locked_balance(&env, &contract_id, &token), 0);
}

#[test]
fn test_cancel_airdrop_releases_unclaimed_and_refunds() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin, &funder, 10_000_000);
    let start = env.ledger().sequence();
    env.mock_all_auths();

    let leaves = vec![
        (recipient.clone(), 400_000i128),
        (funder.clone(), 600_000i128),
    ];
    let (_root, proofs) = create_airdrop_with_leaves(
        &env,
        &client,
        0,
        &token,
        &funder,
        &leaves,
        1_000_000,
        start + 100,
    );
    env.mock_all_auths();
    // One 400k claim happens, leaving 600k unclaimed.
    client.claim_airdrop(&0, &recipient, &400_000, &to_svec(&env, &proofs[0]), &0);
    assert_eq!(locked_balance(&env, &contract_id, &token), 600_000);

    // Cursor: funder's original token balance (10M) minus 1M locked = 9M after
    // create; after the claim 400k went to recipient. Funder still holds 9M.
    let funder_bal_before = token::Client::new(&env, &token).balance(&funder);

    // Cancel before expiration is not allowed.
    assert!(client.try_cancel_airdrop(&0, &funder).is_err());

    // Expire, then cancel → unclaimed (600k) is refunded to the funder.
    advance(&env, start + 101);
    client.cancel_airdrop(&0, &funder);
    assert_eq!(locked_balance(&env, &contract_id, &token), 0);
    assert_eq!(
        token::Client::new(&env, &token).balance(&funder),
        funder_bal_before + 600_000
    );
}

// ─── WS2: access control ────────────────────────────────────────────────────

#[test]
fn test_create_airdrop_rejects_zero_root() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let token = create_token(&env, &admin, &funder, 10_000_000);
    env.mock_all_auths();
    let zero_root = BytesN::from_array(&env, &[0u8; 32]);
    assert!(client
        .try_create_airdrop(
            &token,
            &funder,
            &zero_root,
            &1_000_000,
            &(env.ledger().sequence() + 100),
        )
        .is_err());
}

#[test]
fn test_airdrop_rejects_uninitialized() {
    let env = Env::default();
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(&env, &id);
    let funder = Address::generate(&env);
    env.mock_all_auths();
    let root = BytesN::from_array(&env, &[7u8; 32]);
    // No initialize() was ever called → the caller must be rejected.
    assert!(client
        .try_create_airdrop(
            &Address::generate(&env),
            &funder,
            &root,
            &1_000_000,
            &(env.ledger().sequence() + 100),
        )
        .is_err());
}

#[test]
fn test_airdrop_blocked_when_paused() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let token = create_token(&env, &admin, &funder, 10_000_000);
    env.mock_all_auths();
    // Pause via the admin multi-sig path (threshold 1 → auto-executes).
    client.propose_admin_action(&admin, &Symbol::new(&env, "pause"), &Vec::new(&env));
    assert!(client.is_paused());

    let root = BytesN::from_array(&env, &[9u8; 32]);
    assert!(client
        .try_create_airdrop(
            &token,
            &funder,
            &root,
            &1_000_000,
            &(env.ledger().sequence() + 100),
        )
        .is_err());
}

// ─── WS3: arithmetic & proof bounds ─────────────────────────────────────────

#[test]
fn test_claim_rejects_zero_and_negative_amounts() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin, &funder, 10_000_000);

    let leaves = vec![(recipient.clone(), 1_000_000i128)];
    let (_root, proofs) = create_airdrop_with_leaves(
        &env,
        &client,
        0,
        &token,
        &funder,
        &leaves,
        1_000_000,
        env.ledger().sequence() + 100,
    );
    env.mock_all_auths();
    // Zero amount must revert even with a "valid-looking" index.
    assert!(client
        .try_claim_airdrop(&0, &recipient, &0, &to_svec(&env, &proofs[0]), &0)
        .is_err());
    assert!(client
        .try_claim_airdrop(&0, &recipient, &-5, &to_svec(&env, &proofs[0]), &0)
        .is_err());
    assert_eq!(
        token::Client::new(&env, &token).balance(&recipient),
        0,
        "nothing should have been transferred"
    );
}

#[test]
fn test_claim_cannot_exceed_total_amount() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin, &funder, 10_000_000);

    let leaves = vec![(recipient.clone(), 1_000_000i128)];
    let (_root, proofs) = create_airdrop_with_leaves(
        &env,
        &client,
        0,
        &token,
        &funder,
        &leaves,
        1_000_000,
        env.ledger().sequence() + 100,
    );
    env.mock_all_auths();
    // The leaf covers 1M; claiming more than the remaining pool must revert.
    assert!(client
        .try_claim_airdrop(&0, &recipient, &2_000_000, &to_svec(&env, &proofs[0]), &0)
        .is_err());
}

#[test]
fn test_oversized_proof_is_rejected() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin, &funder, 10_000_000);

    let leaves = vec![(recipient.clone(), 1_000_000i128)];
    let (_root, _proofs) = create_airdrop_with_leaves(
        &env,
        &client,
        0,
        &token,
        &funder,
        &leaves,
        1_000_000,
        env.ledger().sequence() + 100,
    );
    env.mock_all_auths();
    // Craft an oversized proof (33 siblings) — must be rejected outright.
    let mut huge = soroban_sdk::Vec::new(&env);
    for _ in 0..33 {
        huge.push_back(BytesN::from_array(&env, &[1u8; 32]));
    }
    assert!(client
        .try_claim_airdrop(&0, &recipient, &1_000_000, &huge, &0)
        .is_err());
    assert_eq!(token::Client::new(&env, &token).balance(&recipient), 0);
}

// ─── WS6: cross-airdrop proof replay is impossible ──────────────────────────

#[test]
fn test_cross_airdrop_proof_replay_rejected() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin, &funder, 10_000_000);
    env.mock_all_auths();

    // Two airdrops, id 0 and id 1, with an identical (recipient, amount) leaf at
    // index 0 and a second leaf at index 1 so each carries a real proof path.
    let other = Address::generate(&env);
    let leaves = vec![
        (recipient.clone(), 1_000_000i128),
        (other.clone(), 500_000i128),
    ];
    let (root_a, proofs_a) = create_airdrop_with_leaves(
        &env,
        &client,
        0,
        &token,
        &funder,
        &leaves,
        1_500_000,
        env.ledger().sequence() + 100,
    );
    let (root_b, _proofs_b) = create_airdrop_with_leaves(
        &env,
        &client,
        1,
        &token,
        &funder,
        &leaves,
        1_500_000,
        env.ledger().sequence() + 100,
    );
    // Same recipient/amount → same logical leaf value, but the root is committed
    // per-airdrop (id is bound into the leaf).
    assert_ne!(
        root_a, root_b,
        "identical leaves should still commit to different roots because id is bound in"
    );

    // A proof minted for airdrop A (correct leaf+index) must fail when presented
    // against airdrop B's root.
    assert!(
        client
            .try_claim_airdrop(&1, &recipient, &1_000_000, &to_svec(&env, &proofs_a[0]), &0)
            .is_err(),
        "a proof from airdrop A must not be usable against airdrop B"
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn to_svec(env: &Env, proof: &std::vec::Vec<BytesN<32>>) -> soroban_sdk::Vec<BytesN<32>> {
    let mut out = soroban_sdk::Vec::new(env);
    for b in proof {
        out.push_back(b.clone());
    }
    out
}
