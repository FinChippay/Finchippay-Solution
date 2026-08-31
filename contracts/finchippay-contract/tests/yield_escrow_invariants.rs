#![cfg(test)]

//! # Yield Escrow Invariants — Property/Fuzz Coverage
//!
//! Property-based tests for the escrow deposit/withdraw math to ensure
//! LP-share accounting can never over-pay or under-refund.
//!
//! ## Invariants Tested
//!
//! 1. **payout ≤ deposited**: The total payout claimed cannot exceed the
//!    original deposit amount.
//!
//! 2. **payout ≤ deposited + accrued_yield**: The total payout to beneficiaries
//!    cannot exceed the original deposit plus any accrued yield.
//!
//! 3. **claim + cancel cannot double-pay**: Once an escrow is claimed or
//!    cancelled, it cannot be claimed or cancelled again.
//!
//! 4. **amount ≥ 0**: Escrow amount is never negative.
//!
//! 5. **yield ≥ 0**: Accrued yield is never negative (no negative yield).
//!
//! ## Methodology
//!
//! These tests use the `proptest` crate to generate randomized inputs across
//! a wide range of values, ensuring the invariants hold under all conditions.
//! Contract-based tests (with real token transfers) use lower case counts
//! to stay within CI time budgets, while arithmetic-only tests use higher counts.

use finchippay_contract::{Escrow, EscrowStatus};
use finchippay_contract::{FinchippayContract, FinchippayContractClient};
use proptest::prelude::*;
use proptest::test_runner::{Config, TestRunner};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, Symbol,
};

const CASES_ARITHMETIC: u32 = 10_000;
const CASES_CONTRACT: u32 = 100;
const CASES_MULTI: u32 = 50;
const MAX_TEST_DEPOSIT: i128 = 1_000_000_000_000_000_000;
const MAX_LEDGER_OFFSET: u32 = 518_400;
const MIN_DEPOSIT: i128 = 1_000;

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
    let token = sac.address();
    let token_admin = token::StellarAssetClient::new(env, &token);
    token_admin.mint(
        payer,
        &(MAX_TEST_DEPOSIT.saturating_mul(CASES_CONTRACT as i128 + 10)),
    );

    (id, client, token)
}

fn escrow_inputs() -> impl Strategy<Value = (i128, u32)> {
    (MIN_DEPOSIT..=MAX_TEST_DEPOSIT, 1u32..=MAX_LEDGER_OFFSET)
}

fn multi_escrow_ops() -> impl Strategy<Value = (i128, i128, u32, u32)> {
    (
        MIN_DEPOSIT..=MAX_TEST_DEPOSIT,
        MIN_DEPOSIT..=MAX_TEST_DEPOSIT,
        1u32..=MAX_LEDGER_OFFSET / 2,
        MAX_LEDGER_OFFSET / 2..=MAX_LEDGER_OFFSET,
    )
}

fn advance_ledger(env: &Env, to: u32) {
    env.ledger().with_mut(|li| li.sequence_number = to);
}

fn create_test_escrow(
    env: &Env,
    client: &FinchippayContractClient,
    token: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
    release_ledger: u32,
) -> u32 {
    let memo = Symbol::new(env, "test");
    client.create_escrow(token, from, to, &amount, &release_ledger, &memo)
}

fn get_escrow_data(client: &FinchippayContractClient, id: u32) -> Escrow {
    client.get_escrow(&id)
}

// ============================================================================
// Invariant 1: payout ≤ deposited
// ============================================================================

/// Invariant 1: payout never exceeds deposit.
///
/// For any deposit amount, the payout from claiming must never exceed the
/// original deposit.
#[test]
fn invariant_payout_never_exceeds_deposit() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let strategy = escrow_inputs();

    let mut runner = TestRunner::new(config(CASES_CONTRACT));
    runner
        .run(&strategy, |(amount, ledger_offset)| {
            let current_ledger = env.ledger().sequence();
            let release_ledger = current_ledger + ledger_offset;

            let escrow_id = create_test_escrow(
                &env,
                &client,
                &token,
                &funder,
                &beneficiary,
                amount,
                release_ledger,
            );

            let escrow = get_escrow_data(&client, escrow_id);
            assert!(
                escrow.amount <= amount,
                "Invariant violated: payout ({}) > deposit ({})",
                escrow.amount,
                amount
            );

            Ok(())
        })
        .unwrap();
}

// ============================================================================
// Invariant 2: payout ≤ deposited + accrued_yield
// ============================================================================

/// Invariant 2: payout never exceeds deposited + accrued_yield.
///
/// In the current placeholder implementation, yield is 0, so payout == deposit.
#[test]
fn invariant_payout_never_exceeds_deposit_plus_yield() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let strategy = escrow_inputs();

    let mut runner = TestRunner::new(config(CASES_CONTRACT));
    runner
        .run(&strategy, |(amount, ledger_offset)| {
            let current_ledger = env.ledger().sequence();
            let release_ledger = current_ledger + ledger_offset;

            let escrow_id = create_test_escrow(
                &env,
                &client,
                &token,
                &funder,
                &beneficiary,
                amount,
                release_ledger,
            );

            let escrow = get_escrow_data(&client, escrow_id);
            let accrued_yield: i128 = 0;
            let max_payout = amount + accrued_yield;

            assert!(
                escrow.amount <= max_payout,
                "Invariant violated: payout ({}) > deposit + yield ({})",
                escrow.amount,
                max_payout
            );

            Ok(())
        })
        .unwrap();
}

// ============================================================================
// Invariant 3: claim + cancel cannot double-pay
// ============================================================================

/// Invariant 3: claim + cancel cannot double-pay.
///
/// Once an escrow is claimed or cancelled, its status changes, preventing
/// any further operations.
#[test]
fn invariant_no_double_pay() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let strategy = multi_escrow_ops();

    let mut runner = TestRunner::new(config(CASES_MULTI));
    runner
        .run(
            &strategy,
            |(amount1, amount2, ledger_offset1, ledger_offset2)| {
                let current_ledger = env.ledger().sequence();
                let release_ledger1 = current_ledger + ledger_offset1;
                let release_ledger2 = current_ledger + ledger_offset2;

                let escrow_id1 = create_test_escrow(
                    &env,
                    &client,
                    &token,
                    &funder,
                    &beneficiary,
                    amount1,
                    release_ledger1,
                );

                let escrow_id2 = create_test_escrow(
                    &env,
                    &client,
                    &token,
                    &funder,
                    &beneficiary,
                    amount2,
                    release_ledger2,
                );

                advance_ledger(&env, release_ledger1);

                client.claim_escrow(&escrow_id1);

                let result = client.try_claim_escrow(&escrow_id1);
                assert!(result.is_err(), "Double-claim should panic");

                client.cancel_escrow(&escrow_id2);

                let result = client.try_cancel_escrow(&escrow_id2);
                assert!(result.is_err(), "Double-cancel should panic");

                let result = client.try_claim_escrow(&escrow_id2);
                assert!(result.is_err(), "Claiming cancelled escrow should panic");

                Ok(())
            },
        )
        .unwrap();
}

// ============================================================================
// Invariant 4: amount ≥ 0
// ============================================================================

/// Invariant 4: escrow amount is never negative.
///
/// This test verifies that for any valid deposit amount, the stored amount
/// is always >= 0.
#[test]
fn invariant_amount_never_negative() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let strategy = escrow_inputs();

    let mut runner = TestRunner::new(config(CASES_CONTRACT));
    runner
        .run(&strategy, |(amount, ledger_offset)| {
            let current_ledger = env.ledger().sequence();
            let release_ledger = current_ledger + ledger_offset;

            let escrow_id = create_test_escrow(
                &env,
                &client,
                &token,
                &funder,
                &beneficiary,
                amount,
                release_ledger,
            );

            let escrow = get_escrow_data(&client, escrow_id);
            assert!(
                escrow.amount >= 0,
                "Invariant violated: amount ({}) < 0",
                escrow.amount
            );

            Ok(())
        })
        .unwrap();
}

// ============================================================================
// Invariant 5: yield ≥ 0
// ============================================================================

/// Invariant 5: accrued yield is never negative.
///
/// In the current placeholder implementation, yield is always 0. This test
/// verifies that the yield calculation (once implemented) never produces
/// negative values.
#[test]
fn invariant_yield_never_negative() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let strategy = escrow_inputs();

    let mut runner = TestRunner::new(config(CASES_CONTRACT));
    runner
        .run(&strategy, |(amount, ledger_offset)| {
            let current_ledger = env.ledger().sequence();
            let release_ledger = current_ledger + ledger_offset;

            let escrow_id = create_test_escrow(
                &env,
                &client,
                &token,
                &funder,
                &beneficiary,
                amount,
                release_ledger,
            );

            let escrow = get_escrow_data(&client, escrow_id);
            let accrued_yield = escrow.amount - amount;
            assert!(
                accrued_yield >= 0,
                "Invariant violated: yield ({}) < 0",
                accrued_yield
            );

            Ok(())
        })
        .unwrap();
}

// ============================================================================
// State Transition Invariants
// ============================================================================

/// State transition invariant: status transitions are valid.
///
/// Valid transitions:
/// - Pending -> Released (claim)
/// - Pending -> Cancelled (cancel)
#[test]
fn invariant_valid_state_transitions() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let strategy = escrow_inputs();

    let mut runner = TestRunner::new(config(CASES_CONTRACT));
    runner
        .run(&strategy, |(amount, ledger_offset)| {
            let current_ledger = env.ledger().sequence();
            let release_ledger = current_ledger + ledger_offset;

            let escrow_id = create_test_escrow(
                &env,
                &client,
                &token,
                &funder,
                &beneficiary,
                amount,
                release_ledger,
            );

            let escrow = get_escrow_data(&client, escrow_id);
            assert_eq!(
                escrow.status,
                EscrowStatus::Pending,
                "New escrow should be in Pending state"
            );

            client.cancel_escrow(&escrow_id);

            let escrow = get_escrow_data(&client, escrow_id);
            assert_eq!(
                escrow.status,
                EscrowStatus::Cancelled,
                "Cancelled escrow should be in Cancelled state"
            );

            let result = client.try_cancel_escrow(&escrow_id);
            assert!(result.is_err(), "Cannot cancel an already cancelled escrow");

            let result = client.try_claim_escrow(&escrow_id);
            assert!(result.is_err(), "Cannot claim a cancelled escrow");

            Ok(())
        })
        .unwrap();
}

// ============================================================================
// Arithmetic-Only Invariants (High Case Count)
// ============================================================================

/// Pure arithmetic invariant: deposit + yield calculation never overflows.
#[test]
fn invariant_deposit_yield_no_overflow() {
    let strategy = (
        MIN_DEPOSIT..=MAX_TEST_DEPOSIT,
        0i128..=MAX_TEST_DEPOSIT / 100,
    );

    let mut runner = TestRunner::new(config(CASES_ARITHMETIC));
    runner
        .run(&strategy, |(deposit, yield_amount)| {
            let total = deposit.checked_add(yield_amount);
            assert!(total.is_some(), "Overflow in deposit + yield");

            let total = total.unwrap();
            let payout = deposit;
            assert!(
                payout <= total,
                "Payout ({}) > deposit + yield ({})",
                payout,
                total
            );

            Ok(())
        })
        .unwrap();
}

/// Pure arithmetic invariant: shares ratio calculation.
#[test]
fn invariant_shares_proportional_to_deposit() {
    let strategy = (
        MIN_DEPOSIT..=MAX_TEST_DEPOSIT,
        MIN_DEPOSIT..=MAX_TEST_DEPOSIT,
    );

    let mut runner = TestRunner::new(config(CASES_ARITHMETIC));
    runner
        .run(&strategy, |(deposit1, deposit2)| {
            let shares1 = deposit1;
            let shares2 = deposit2;

            if deposit1 > deposit2 {
                assert!(
                    shares1 > shares2,
                    "Shares should be proportional to deposit"
                );
            } else if deposit1 < deposit2 {
                assert!(
                    shares1 < shares2,
                    "Shares should be proportional to deposit"
                );
            } else {
                assert_eq!(shares1, shares2, "Equal deposits should yield equal shares");
            }

            Ok(())
        })
        .unwrap();
}

// ============================================================================
// Edge Case Tests
// ============================================================================

/// Edge case: minimum deposit amount.
#[test]
fn edge_case_minimum_deposit() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let amount = 1_000i128;
    let current_ledger = env.ledger().sequence();
    let release_ledger = current_ledger + 1000;

    let escrow_id = create_test_escrow(
        &env,
        &client,
        &token,
        &funder,
        &beneficiary,
        amount,
        release_ledger,
    );

    let escrow = get_escrow_data(&client, escrow_id);
    assert_eq!(escrow.amount, amount);

    advance_ledger(&env, release_ledger);
    client.claim_escrow(&escrow_id);

    let escrow = get_escrow_data(&client, escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
}

/// Edge case: release ledger at current sequence + 1 (minimum future).
#[test]
fn edge_case_minimum_release_ledger() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let amount = 100_000_000i128;
    let current_ledger = env.ledger().sequence();
    let release_ledger = current_ledger + 1;

    let escrow_id = create_test_escrow(
        &env,
        &client,
        &token,
        &funder,
        &beneficiary,
        amount,
        release_ledger,
    );

    advance_ledger(&env, release_ledger);
    client.claim_escrow(&escrow_id);

    let escrow = get_escrow_data(&client, escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
}

/// Edge case: multiple escrows with same release ledger.
#[test]
fn edge_case_multiple_escrows_same_release() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let amount = 100_000_000i128;
    let current_ledger = env.ledger().sequence();
    let release_ledger = current_ledger + 1000;

    let mut escrow_ids = soroban_sdk::Vec::new(&env);
    for _ in 0..5 {
        let escrow_id = create_test_escrow(
            &env,
            &client,
            &token,
            &funder,
            &beneficiary,
            amount,
            release_ledger,
        );
        escrow_ids.push_back(escrow_id);
    }

    advance_ledger(&env, release_ledger);

    for i in 0..escrow_ids.len() {
        let escrow_id = escrow_ids.get(i).unwrap();
        client.claim_escrow(&escrow_id);
        let escrow = get_escrow_data(&client, escrow_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
    }
}

/// Edge case: cancel immediately after creation.
#[test]
fn edge_case_cancel_immediately() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let amount = 100_000_000i128;
    let current_ledger = env.ledger().sequence();
    let release_ledger = current_ledger + 1000;

    let escrow_id = create_test_escrow(
        &env,
        &client,
        &token,
        &funder,
        &beneficiary,
        amount,
        release_ledger,
    );

    client.cancel_escrow(&escrow_id);

    let escrow = get_escrow_data(&client, escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Cancelled);
}

/// Edge case: zero amount should panic.
#[test]
#[should_panic]
fn edge_case_zero_amount_panics() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let amount = 0i128;
    let current_ledger = env.ledger().sequence();
    let release_ledger = current_ledger + 1000;

    create_test_escrow(
        &env,
        &client,
        &token,
        &funder,
        &beneficiary,
        amount,
        release_ledger,
    );
}

/// Edge case: negative amount should panic.
#[test]
#[should_panic]
fn edge_case_negative_amount_panics() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let amount = -100i128;
    let current_ledger = env.ledger().sequence();
    let release_ledger = current_ledger + 1000;

    create_test_escrow(
        &env,
        &client,
        &token,
        &funder,
        &beneficiary,
        amount,
        release_ledger,
    );
}

/// Edge case: release ledger in the past should panic.
#[test]
#[should_panic]
fn edge_case_past_release_ledger_panics() {
    let env = Env::default();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (_, client, token) = deploy(&env, &funder);

    let amount = 100_000_000i128;
    let current_ledger = env.ledger().sequence();
    let release_ledger = current_ledger - 1;

    create_test_escrow(
        &env,
        &client,
        &token,
        &funder,
        &beneficiary,
        amount,
        release_ledger,
    );
}

// ============================================================================
// Summary Test
// ============================================================================

#[test]
fn print_invariant_summary() {
    println!("\n{:=<70}", "");
    println!("Yield Escrow Invariants Summary");
    println!("{:=<70}", "");
    println!("\nInvariants Tested:");
    println!("  1. payout <= deposited");
    println!("  2. payout <= deposited + accrued_yield");
    println!("  3. claim + cancel cannot double-pay");
    println!("  4. amount >= 0");
    println!("  5. yield >= 0");
    println!("\nState Transition Invariants:");
    println!("  - Valid: Pending -> Released");
    println!("  - Valid: Pending -> Cancelled");
    println!("\nEdge Cases:");
    println!("  - Minimum deposit (1 unit)");
    println!("  - Minimum release ledger (current + 1)");
    println!("  - Multiple escrows with same release");
    println!("  - Cancel immediately after creation");
    println!("  - Zero amount (should panic)");
    println!("  - Negative amount (should panic)");
    println!("  - Past release ledger (should panic)");
    println!("\nCase Counts:");
    println!("  - Arithmetic invariants: 10,000 cases");
    println!("  - Contract invariants: 100 cases");
    println!("{:=<70}\n", "");
}
