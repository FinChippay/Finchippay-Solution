#![cfg(test)]

//! Property-based tests for the streaming payment lifecycle
//! (`open_stream`, `claim_stream`, `close_stream`, `reject_stream`,
//! `get_claimable`).
//!
//! These tests replace the ad-hoc `PropertyRng` LCG previously used in
//! `src/lib.rs` with the `proptest` crate, generating randomized
//! `rate_per_ledger`, `deposit`, `start_ledger`, and ledger-advance
//! combinations bounded by `MAX_STREAM_RATE` / `MAX_STREAM_DEPOSIT`.
//!
//! Two of the five invariants (2 and 3) exercise real token transfers
//! through the deployed contract, so their case counts are kept lower than
//! the purely-arithmetic invariants (1, 4, 5) in order to fit the whole
//! suite comfortably under the 30-second CI budget — a single contract
//! call in the Soroban test host is several orders of magnitude more
//! expensive than evaluating `claimable_at` in-process. See the
//! `CASES_ARITHMETIC` / `CASES_CONTRACT` constants below for the exact
//! counts and rationale.

use finchippay_contract::{
    claimable_at, FinchippayContract, FinchippayContractClient, Stream, MAX_STREAM_DEPOSIT,
    MAX_STREAM_RATE,
};
use proptest::prelude::*;
use proptest::test_runner::{Config, TestRunner};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env,
};

/// Case count for invariants that only exercise the pure `claimable_at`
/// arithmetic (no contract/token I/O). Comfortably exceeds the >=100,000
/// acceptance criterion and still runs in well under a second.
const CASES_ARITHMETIC: u32 = 100_000;

/// Case count for invariants that must go through a deployed contract
/// (real token transfers, storage writes, auth checks). Each case here
/// costs on the order of milliseconds, so this is tuned to keep the whole
/// test binary under the 30s CI budget rather than the same 100,000 used
/// for the arithmetic-only invariants.
const CASES_CONTRACT: u32 = 250;

/// Case count for the read-only idempotency check, which reuses a single
/// already-open stream (no per-case token transfer or stream creation), so
/// it can afford the full >=100,000 cases cheaply.
const CASES_IDEMPOTENT: u32 = 100_000;

fn config(cases: u32) -> Config {
    Config {
        cases,
        failure_persistence: None,
        ..Config::default()
    }
}

fn deploy<'a>(env: &'a Env, payer: &Address) -> (Address, FinchippayContractClient<'a>, Address) {
    env.mock_all_auths();
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let signers = soroban_sdk::Vec::from_array(env, [admin.clone()]);
    client.initialize(&signers, &1);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let token_admin = token::StellarAssetClient::new(env, &token_id);
    // Comfortably covers `CASES_CONTRACT` iterations at MAX_STREAM_DEPOSIT
    // each without approaching i128::MAX.
    token_admin.mint(
        payer,
        &(MAX_STREAM_DEPOSIT.saturating_mul(CASES_CONTRACT as i128 + 10)),
    );
    (id, client, token_id)
}

/// Strategy for (rate, deposit, start_ledger, advance) bounded by the
/// contract's documented safety limits, for tests driving the real
/// contract entrypoints.
fn stream_inputs() -> impl Strategy<Value = (i128, i128, u32, u32)> {
    (
        1i128..=MAX_STREAM_RATE,
        1i128..=MAX_STREAM_DEPOSIT,
        0u32..=1_000_000u32,
        0u32..=10_000_000u32,
    )
}

fn advance_ledger(env: &Env, to: u32) {
    env.ledger().with_mut(|li| li.sequence_number = to);
}

fn open_stream_with(
    env: &Env,
    client: &FinchippayContractClient,
    token_id: &Address,
    payer: &Address,
    recipient: &Address,
    rate: i128,
    deposit: i128,
    start_ledger: u32,
) -> u32 {
    advance_ledger(env, start_ledger);
    client.open_stream(token_id, payer, recipient, &rate, &deposit)
}

fn synthetic_stream(payer: &Address, recipient: &Address, token: &Address) -> Stream {
    Stream {
        id: 0,
        payer: payer.clone(),
        recipient: recipient.clone(),
        token: token.clone(),
        rate_per_ledger: 1,
        deposited: 1,
        claimed: 0,
        start_ledger: 0,
        closed: false,
        paused_at_ledger: 0,
        total_paused_duration: 0,
    }
}

/// Invariant 1: `claimable` never exceeds the remaining, unclaimed deposit
/// (`deposited - claimed`), and is never negative, regardless of rate,
/// deposit, start ledger, or how far the ledger has advanced.
///
/// Exercises the pure `claimable_at` core directly (the same function
/// `FinchippayContract::_claimable` delegates to), so it can afford a very
/// large number of cases cheaply.
#[test]
fn invariant_claimable_never_exceeds_remaining_deposit() {
    let env = Env::default();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let base = synthetic_stream(&payer, &recipient, &token);

    let strategy = (
        1i128..=MAX_STREAM_RATE,
        1i128..=MAX_STREAM_DEPOSIT,
        0u32..=u32::MAX,
        0i128..=MAX_STREAM_DEPOSIT,
        0u32..=u32::MAX,
    );

    let mut runner = TestRunner::new(config(CASES_ARITHMETIC));
    runner
        .run(
            &strategy,
            |(rate, deposit, start_ledger, claimed_raw, current_ledger)| {
                let claimed = claimed_raw.min(deposit);
                let stream = Stream {
                    rate_per_ledger: rate,
                    deposited: deposit,
                    claimed,
                    start_ledger,
                    ..base.clone()
                };
                let claimable = claimable_at(&stream, current_ledger);
                prop_assert!(claimable >= 0);
                prop_assert!(claimable <= deposit - claimed);
                Ok(())
            },
        )
        .unwrap();
}

/// Invariant 2: after `claim_stream`, the recipient's token balance
/// increases by exactly the amount returned by `claim_stream`.
#[test]
fn invariant_claim_stream_transfers_exact_amount() {
    let env = Env::default();
    let payer = Address::generate(&env);
    let (_id, client, token_id) = deploy(&env, &payer);
    let recipient = Address::generate(&env);
    let token_client = token::Client::new(&env, &token_id);

    let mut runner = TestRunner::new(config(CASES_CONTRACT));
    runner
        .run(&stream_inputs(), |(rate, deposit, start, advance)| {
            let stream_id = open_stream_with(
                &env, &client, &token_id, &payer, &recipient, rate, deposit, start,
            );
            let target = (start as u64)
                .saturating_add(advance as u64)
                .min(u32::MAX as u64) as u32;
            advance_ledger(&env, target);

            let balance_before = token_client.balance(&recipient);
            let claimed_amount = client.claim_stream(&stream_id, &recipient);
            let balance_after = token_client.balance(&recipient);

            prop_assert_eq!(balance_after - balance_before, claimed_amount);
            Ok(())
        })
        .unwrap();
}

/// Invariant 3: after `close_stream`, `refund == deposited - total_claimed`
/// and the payer's balance increases by exactly that refund.
#[test]
fn invariant_close_stream_refunds_exact_remainder() {
    let env = Env::default();
    let payer = Address::generate(&env);
    let (_id, client, token_id) = deploy(&env, &payer);
    let recipient = Address::generate(&env);
    let token_client = token::Client::new(&env, &token_id);

    let mut runner = TestRunner::new(config(CASES_CONTRACT));
    runner
        .run(&stream_inputs(), |(rate, deposit, start, advance)| {
            let stream_id = open_stream_with(
                &env, &client, &token_id, &payer, &recipient, rate, deposit, start,
            );
            let target = (start as u64)
                .saturating_add(advance as u64)
                .min(u32::MAX as u64) as u32;
            advance_ledger(&env, target);

            let balance_before = token_client.balance(&payer);
            let refund = client.close_stream(&stream_id, &payer);
            let balance_after = token_client.balance(&payer);
            let stream = client.get_stream(&stream_id);

            prop_assert_eq!(refund, stream.deposited - stream.claimed);
            prop_assert_eq!(balance_after - balance_before, refund);
            Ok(())
        })
        .unwrap();
}

/// Invariant 4: for any stream with `rate > 0` and `deposited > 0`, after
/// advancing the ledger by `deposited / rate + 1` ledgers past `start_ledger`
/// the stream is fully depleted: `claimable == deposited - claimed`.
///
/// Exercises the pure `claimable_at` core directly.
#[test]
fn invariant_stream_fully_depletes_after_deposit_over_rate_plus_one() {
    let env = Env::default();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);
    let base = synthetic_stream(&payer, &recipient, &token);

    // `deposit` is derived from `rate` and a bounded elapsed-ledger target so
    // that `deposit / rate + 1` always fits comfortably within a u32 ledger
    // sequence number, regardless of how small `rate` is.
    let strategy = (
        1i128..=MAX_STREAM_RATE,
        1u32..=4_000_000u32,
        0u32..=1_000_000u32,
        0i128..=MAX_STREAM_DEPOSIT,
    )
        .prop_map(|(rate, elapsed_target, start, claimed_raw)| {
            let deposit =
                (rate.saturating_mul(elapsed_target as i128)).clamp(1, MAX_STREAM_DEPOSIT);
            let claimed = claimed_raw.min(deposit);
            (rate, deposit, start, claimed)
        });

    let mut runner = TestRunner::new(config(CASES_ARITHMETIC));
    runner
        .run(&strategy, |(rate, deposit, start, claimed)| {
            let stream = Stream {
                rate_per_ledger: rate,
                deposited: deposit,
                claimed,
                start_ledger: start,
                ..base.clone()
            };
            let elapsed_needed = (deposit / rate + 1) as u64;
            let target = (start as u64)
                .saturating_add(elapsed_needed)
                .min(u32::MAX as u64) as u32;

            let claimable = claimable_at(&stream, target);
            prop_assert_eq!(claimable, deposit - claimed);
            Ok(())
        })
        .unwrap();
}

/// Invariant 5: `get_claimable` is idempotent — calling it twice through the
/// deployed contract without advancing the ledger or otherwise mutating the
/// stream returns the same value both times. A single stream is opened once
/// and reused across cases (only the ledger position varies), since this
/// invariant is about read-only call stability rather than the streaming
/// arithmetic itself.
#[test]
fn invariant_get_claimable_is_idempotent() {
    let env = Env::default();
    let payer = Address::generate(&env);
    let (_id, client, token_id) = deploy(&env, &payer);
    let recipient = Address::generate(&env);

    let stream_id = open_stream_with(
        &env,
        &client,
        &token_id,
        &payer,
        &recipient,
        MAX_STREAM_RATE,
        MAX_STREAM_DEPOSIT,
        0,
    );

    let mut runner = TestRunner::new(config(CASES_IDEMPOTENT));
    runner
        .run(&(0u32..=10_000_000u32), |advance| {
            advance_ledger(&env, advance);
            let first = client.get_claimable(&stream_id);
            let second = client.get_claimable(&stream_id);
            prop_assert_eq!(first, second);
            Ok(())
        })
        .unwrap();
}
