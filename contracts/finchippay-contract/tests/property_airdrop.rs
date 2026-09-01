#![cfg(test)]
#![allow(deprecated)]
#![allow(clippy::manual_is_multiple_of, clippy::needless_range_loop)]

//! # Property tests (workstream 7)
//!
//! Pins the invariants the issue calls out before they are considered proven:
//!
//! 1. **Merkle soundness** — `airdrop::verify_merkle_proof` returns `true` iff
//!    the leaf is genuinely in the tree at `index`; a leaf not in the tree, a
//!    proof used at the wrong index, and an out-of-range index all return
//!    `false`.
//! 2. **Batch conservation** — after `batch_send`, each recipient's `TipTotal`
//!    delta equals the sum of that recipient's amounts, `TipCount` equals the
//!    number of transfers to them, and the sum of all `TipTotal` deltas equals
//!    the total transferred.
//! 3. **Vesting monotonicity & boundedness** — `vested(t2) >= vested(t1)` for
//!    `t2 >= t1` and `vested <= total_amount`, and `claimable` can never exceed
//!    `total_amount - claimed` (no over-claim).

use finchippay_contract::{
    airdrop::verify_merkle_proof, FinchippayContract, FinchippayContractClient,
};
use proptest::prelude::*;
use proptest::test_runner::{Config, TestRunner};
use soroban_sdk::{
    testutils::Address as _, token, xdr::ToXdr, Address, Bytes, BytesN, Env, Symbol, Vec,
};

const CASES_PURE: u32 = 2_000;
/// Contract-driving cases are pricier (token transfers/storage); keep small.
const CASES_CONTRACT: u32 = 40;

fn config(cases: u32) -> Config {
    Config {
        cases,
        failure_persistence: None,
        ..Config::default()
    }
}

// ─── Merkle helpers (match `airdrop.rs` commitment exactly) ─────────────────

fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut combined = Bytes::new(env);
    combined.append(&left.clone().to_xdr(env));
    combined.append(&right.clone().to_xdr(env));
    env.crypto().sha256(&combined).into()
}

fn hash_leaf(env: &Env, id: u32, recipient: &Address, amount: i128) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&recipient.clone().to_xdr(env));
    data.append(&Bytes::from_slice(env, &id.to_be_bytes()));
    data.append(&Bytes::from_slice(env, &amount.to_be_bytes()));
    env.crypto().sha256(&data).into()
}

/// Return `(root, proof)` for the leaf at `index` in a fully-built tree over
/// `leaves` (length must be a power of two).
fn root_and_proof(
    env: &Env,
    leaves: &[BytesN<32>],
    index: usize,
) -> (BytesN<32>, std::vec::Vec<BytesN<32>>) {
    assert!(leaves.len().is_power_of_two() && index < leaves.len());
    let mut layer: std::vec::Vec<BytesN<32>> = leaves.to_vec();
    let mut cur = index as u32;
    let mut proof: std::vec::Vec<BytesN<32>> = std::vec::Vec::new();
    while layer.len() > 1 {
        let pair_base = (cur >> 1) << 1;
        let sibling_idx = if cur % 2 == 0 {
            (pair_base + 1) as usize
        } else {
            pair_base as usize
        };
        proof.push(layer[sibling_idx].clone());

        let mut next = std::vec::Vec::with_capacity(layer.len() / 2);
        let mut i = 0;
        while i < layer.len() {
            next.push(hash_pair(env, &layer[i], &layer[i + 1]));
            i += 2;
        }
        layer = next;
        cur /= 2;
    }
    (layer[0].clone(), proof)
}

fn to_bucket(env: &Env, proof: &std::vec::Vec<BytesN<32>>) -> Vec<BytesN<32>> {
    let mut out = Vec::new(env);
    for b in proof {
        out.push_back(b.clone());
    }
    out
}

// ─── Deploy / token harness ─────────────────────────────────────────────────

fn deploy<'a>(env: &'a Env) -> (Address, FinchippayContractClient<'a>, Address) {
    env.mock_all_auths();
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(&Vec::from_array(env, [admin.clone()]), &1);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let tok = token::StellarAssetClient::new(env, &token_id);
    // A large initial float so every proptest case's payer can be funded.
    tok.mint(&admin, &(i128::MAX / 4));
    (id, client, token_id)
}

// ─── Invariant 1: Merkle verification soundness ─────────────────────────────

#[test]
fn invariant_merkle_verification_is_sound() {
    let strategy = (
        proptest::collection::vec(1i128..=1_000_000i128, 4),
        0usize..4usize,
    );

    let mut runner = TestRunner::new(config(CASES_PURE));
    runner
        .run(&strategy, |(amounts, index)| {
            // Fresh Env per case: the test host budget would otherwise exhaust
            // after thousands of sha256 host calls on a shared Env.
            let env2 = Env::default();
            let id = 7u32;
            // Addresses must be generated in the same Env that hashes them.
            let addrs: std::vec::Vec<Address> = (0..4).map(|_| Address::generate(&env2)).collect();
            let leaves: std::vec::Vec<BytesN<32>> = amounts
                .iter()
                .enumerate()
                .map(|(i, a)| hash_leaf(&env2, id, &addrs[i], *a))
                .collect();
            let (root, proof) = root_and_proof(&env2, &leaves, index);
            let actual = leaves[index].clone();
            let proof_v = to_bucket(&env2, &proof);
            let root_c = &root;

            // 1a. Correct leaf at its own index verifies.
            prop_assert!(verify_merkle_proof(
                &env2,
                actual.clone(),
                proof_v.clone(),
                root_c.clone(),
                index as u32,
            ));

            // 1b. A leaf not in the tree must not verify at this index.
            // (uses a different amount, so the leaf is absent from the tree)
            let wrong = hash_leaf(&env2, id, &addrs[(index + 1) % 4], 999_999_999i128);
            prop_assert!(!verify_merkle_proof(
                &env2,
                wrong,
                proof_v.clone(),
                root_c.clone(),
                index as u32,
            ));

            // 1c. The correct leaf fails at any other index (path changes).
            let other = (index + 1) % 4;
            prop_assert!(!verify_merkle_proof(
                &env2,
                actual.clone(),
                proof_v.clone(),
                root_c.clone(),
                other as u32,
            ));

            // 1d. An out-of-range index (>= 2^depth = 4) is rejected as invalid.
            prop_assert!(!verify_merkle_proof(
                &env2,
                actual,
                proof_v,
                root_c.clone(),
                4u32 + 13u32,
            ));
            Ok(())
        })
        .unwrap();
}

// ─── Invariant 2: batch fan-out conservation ────────────────────────────────

#[test]
fn invariant_batch_fanout_conserves_tip_totals() {
    let env = Env::default();
    let (_, client, token_id) = deploy(&env);

    // count of recipients + one shared amount vector (len >= count).
    let strategy = (
        2usize..=4usize,
        proptest::collection::vec(1i128..=20_000i128, 4),
    );

    let mut runner = TestRunner::new(config(CASES_CONTRACT));
    runner
        .run(&strategy, |(count, amounts)| {
            env.mock_all_auths();
            let payer = Address::generate(&env);
            // Fund the payer for this case.
            let sac_client = token::StellarAssetClient::new(&env, &token_id);
            sac_client.mint(&payer, &200_000);

            let mut recipients = Vec::new(&env);
            let mut amt_vec = Vec::new(&env);
            let mut memo_vec = Vec::new(&env);
            let mut expected: std::vec::Vec<(Address, i128)> = std::vec::Vec::new();
            for i in 0..count {
                let to = Address::generate(&env);
                recipients.push_back(to.clone());
                amt_vec.push_back(amounts[i]);
                memo_vec.push_back(Symbol::new(&env, "m"));
                expected.push((to, amounts[i]));
            }

            client.batch_send(&token_id, &payer, &recipients, &amt_vec, &memo_vec);

            // Per-recipient conservation: TipTotal[to] == its amount,
            // TipCount[to] == 1 (distinct recipients).
            let token_client = token::Client::new(&env, &token_id);
            for (to, amt) in expected.iter() {
                // TipTotal delta == sum of that recipient's transferred amounts.
                prop_assert_eq!(client.get_tip_total(to), *amt);
                prop_assert_eq!(client.get_tip_count(to), 1);
            }
            // Sum of per-recipient balances received == sum of amounts.

            let sum_amounts: i128 = amounts.iter().take(count).sum();
            let sum_balances: i128 = expected
                .iter()
                .map(|(to, _)| token_client.balance(to))
                .sum();
            prop_assert_eq!(
                sum_balances,
                sum_amounts,
                "batch fan-out must conserve value"
            );
            Ok(())
        })
        .unwrap();
}

// ─── Invariant 3: vesting-formula monotonicity & boundedness ────────────────

/// Pure replication of the linear-vesting formula used by `claim_vesting`.
fn vested_at(total: i128, elapsed: i128, duration: i128) -> i128 {
    if duration <= 0 {
        return 0;
    }
    total
        .checked_mul(elapsed)
        .unwrap()
        .checked_div(duration)
        .unwrap()
}

#[test]
fn invariant_vesting_formula_is_monotonic_and_bounded() {
    let strategy = (
        1i128..=1_000_000_000i128, // total_amount
        1i128..=100_000i128,       // duration
        // two elapsed values, generated unordered then sorted so t1 <= t2
        proptest::collection::vec(0i128..=200_000i128, 2),
    );

    let mut runner = TestRunner::new(config(CASES_PURE));
    runner
        .run(&strategy, |(total, duration, mut ts)| {
            ts.sort();
            // Elapsed is capped at the schedule duration, as claim_vesting does
            // (effective_ledger = min(current, end)).
            let (t1, t2) = (ts[0].min(duration), ts[1].min(duration));
            let v1 = vested_at(total, t1, duration);
            let v2 = vested_at(total, t2, duration);
            // Monotonic: later is never less vested.
            prop_assert!(v2 >= v1, "vested must be non-decreasing");
            // Bounded: vested never exceeds the total allocation (no over-claim).
            prop_assert!(v2 <= total && v1 <= total, "vested must not exceed total");
            // A claim of the delta between two points never exceeds what remains
            // after the earlier amount was already vested.
            let claimable = v2 - v1;
            prop_assert!(claimable >= 0);
            prop_assert!(
                claimable <= total - v1,
                "claimable must never exceed the remaining allocation"
            );
            Ok(())
        })
        .unwrap();
}
