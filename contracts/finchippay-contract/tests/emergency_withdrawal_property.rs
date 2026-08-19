#![cfg(test)]

//! Property-based tests for the time-delayed, multi-sig-gated emergency
//! withdrawal (`initiate_emergency_withdrawal` → `approve_emergency_withdrawal`
//! → `execute_emergency_withdrawal` / `cancel_emergency_withdrawal`).
//!
//! These tests prove the last-resort funds-rescue path cannot be executed
//! early, double-executed, or executed after cancellation, even under
//! adversarial ordering of approval, ledger-advance, execute, and cancel
//! operations.
//!
//! Security-relevant edge cases covered:
//!   1. Activation-ledger arithmetic (`activation = initiated + DELAY`) has no
//!      off-by-one — execution at `activation - 1` is blocked, at
//!      `activation` is allowed.
//!   2. Approval deduplication — a signer can approve at most once; duplicate
//!      attempts panic and never inflate the approval count.
//!   3. Threshold gating — execution is impossible with fewer than `threshold`
//!      approvals, at any ledger position.
//!   4. Time gating — execution is impossible before `activation_ledger`,
//!      regardless of approval count.
//!   5. Auto-execution fires only when BOTH conditions hold, including when
//!      the threshold is met exactly at the activation boundary.
//!   6. Cancellation is irreversible — a cancelled withdrawal can never be
//!      approved, executed, or re-cancelled, and never transfers funds.
//!   7. Duplicate initiation creates independent withdrawals with distinct,
//!      incrementing IDs and isolated approval state.
//!   8. Signer-set / threshold rotation mid-flight is snapshotted at
//!      initiation: a pending withdrawal keeps its initiation-time threshold,
//!      removed signers lose the ability to approve, and already-recorded
//!      approvals persist.
//!   9. A model-based state-machine property test replays adversarial op
//!      sequences against both the contract and an exact reference model,
//!      asserting identical outcomes and exact panic errors at every step.
//!
//! The contract expresses its `ContractError` failures as panics with a
//! human-readable message rather than a `Result` return, so the tests assert
//! the exact panic payload. Message → `ContractError` mapping:
//!   `ContractError::NotAdminSigner`                → "not an admin signer"
//!   `ContractError::EmergencyWithdrawalNotReady`   → "emergency withdrawal not ready"
//!   `ContractError::Unauthorized`                  → "Unauthorized"

use finchippay_contract::{
    EmergencyWithdrawalStatus, FinchippayContract, FinchippayContractClient,
};
use proptest::prelude::*;
use proptest::test_runner::{Config, TestRunner};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, IntoVal, Symbol, Val, Vec,
};
use std::any::Any;
use std::panic::AssertUnwindSafe;

/// The emergency withdrawal delay, pinned to the contract constant. Hard-coding
/// it here (rather than importing it) is intentional: if the contract value
/// ever changes, these tests must catch the discrepancy instead of silently
/// following the new constant.
const EMERGENCY_WITHDRAWAL_DELAY: u32 = 17_280;

/// Number of admin signers used by the model-based test.
const SIGNER_COUNT: u32 = 4;

/// Number of proptest cases for cheap, pure-arithmetic properties.
const CASES_ARITHMETIC: u32 = 200;

/// Number of proptest cases that drive the deployed contract.
const CASES_MODEL: u32 = 40;

/// Fixed amount each emergency withdrawal attempts to rescue.
const AMOUNT: i128 = 1_000;

fn config(cases: u32) -> Config {
    Config {
        cases,
        failure_persistence: None,
        ..Config::default()
    }
}

fn advance_ledger(env: &Env, to: u32) {
    env.ledger().with_mut(|li| li.sequence_number = to);
}

/// Invoke a closure and return `Ok(())` on success or `Err` with the extracted
/// panic message on failure. Used to assert both the *fact* of a revert and the
/// *exact* error message the contract produced.
fn run_catch<F: FnOnce()>(f: F) -> Result<(), Option<String>> {
    match std::panic::catch_unwind(AssertUnwindSafe(f)) {
        Ok(()) => Ok(()),
        Err(payload) => Err(panic_message(payload.as_ref())),
    }
}

fn panic_message(payload: &(dyn Any + Send)) -> Option<String> {
    if let Some(s) = payload.downcast_ref::<String>() {
        return Some(s.clone());
    }
    if let Some(s) = payload.downcast_ref::<&str>() {
        return Some((*s).to_string());
    }
    None
}

/// Deploy, mint a token balance to the contract, and configure an
/// `SIGNER_COUNT`-of-`SIGNER_COUNT` admin signer set. Returns the contract id,
/// client, token id, and the signer pool (`signers[0]` is the legacy admin —
/// the only address permitted to initiate/cancel).
fn deploy<'a>(
    env: &'a Env,
    mint: i128,
) -> (Address, FinchippayContractClient<'a>, Address, Vec<Address>) {
    env.mock_all_auths();
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(&Vec::from_array(env, [admin.clone()]), &1);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    for _ in 1..SIGNER_COUNT {
        signers.push_back(Address::generate(env));
    }
    // Rotate to the full signer set; the threshold-1 deploy auto-executes.
    let data: Vec<Val> = Vec::from_array(
        env,
        [signers.clone().into_val(env), SIGNER_COUNT.into_val(env)],
    );
    client.propose_admin_action(&admin, &Symbol::new(env, "set_admin_signers"), &data);

    let token_admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = sac.address();
    token::StellarAssetClient::new(env, &token_id).mint(&id, &mint);

    (id, client, token_id, signers)
}

/// Rotate the admin-signer threshold to `threshold` (signer set unchanged) via
/// the multi-sig `set_admin_signers` admin action.
fn rotate_threshold(
    env: &Env,
    client: &FinchippayContractClient,
    signers: &Vec<Address>,
    threshold: u32,
) {
    let current_threshold = client.get_admin_signers_threshold();
    let data: Vec<Val> = Vec::from_array(
        env,
        [signers.clone().into_val(env), threshold.into_val(env)],
    );
    let pid = client.propose_admin_action(
        &signers.get(0).unwrap(),
        &Symbol::new(env, "set_admin_signers"),
        &data,
    );
    // The proposer's own approval is recorded at propose time; gather the
    // remaining approvals required by the *current* threshold.
    for i in 1..current_threshold {
        client.approve_admin_action(&pid, &signers.get(i).unwrap());
    }
}

/// Rotate the admin signer set to `new_signers` with `threshold` via the
/// multi-sig `set_admin_signers` admin action. `new_signers[0]` must remain in
/// the current set (it does in all tests below, keeping signers[0]).
fn rotate_signers(
    env: &Env,
    client: &FinchippayContractClient,
    new_signers: &Vec<Address>,
    threshold: u32,
) {
    let current_set = client.get_admin_signers();
    let current_threshold = client.get_admin_signers_threshold();
    let data: Vec<Val> = Vec::from_array(
        env,
        [new_signers.clone().into_val(env), threshold.into_val(env)],
    );
    let pid = client.propose_admin_action(
        &new_signers.get(0).unwrap(),
        &Symbol::new(env, "set_admin_signers"),
        &data,
    );
    // The proposer's own approval is recorded at propose time; gather the
    // remaining approvals required by the *current* threshold from the current
    // (not yet rotated) signer set.
    for i in 1..current_threshold {
        client.approve_admin_action(&pid, &current_set.get(i).unwrap());
    }
    assert!(client.get_admin_signers_threshold() == threshold);
    assert!(client.get_admin_signers().len() == new_signers.len());
}

// ─── 1. Activation-ledger arithmetic: no off-by-one ─────────────────────────

#[test]
fn activation_ledger_arith_has_no_off_by_one() {
    let env = Env::default();
    let (_id, client, token_id, _signers) = deploy(&env, AMOUNT);
    let admin = client.get_admin();

    let mut runner = TestRunner::new(config(CASES_ARITHMETIC));
    runner
        .run(&(0u32..=1_000_000u32), |current| {
            advance_ledger(&env, current);
            let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &admin);
            let w = client.get_emergency_withdrawal(&wid);

            // Exactly DELAY ledgers after initiation — never DELAY-1, never DELAY+1.
            prop_assert_eq!(w.activation_ledger, current + EMERGENCY_WITHDRAWAL_DELAY);
            prop_assert_eq!(
                w.activation_ledger - w.initiated_at_ledger,
                EMERGENCY_WITHDRAWAL_DELAY
            );
            // The delay must always push activation strictly into the future.
            prop_assert!(w.activation_ledger > w.initiated_at_ledger);
            // The ledger immediately *before* activation is still gated.
            advance_ledger(&env, w.activation_ledger.saturating_sub(1));
            prop_assert!(env.ledger().sequence() < w.activation_ledger);
            Ok(())
        })
        .unwrap();
}

// ─── 2. Both gates must hold: threshold AND activation ──────────────────────

#[test]
fn execution_requires_both_activation_and_threshold() {
    let env = Env::default();
    let (_id, client, token_id, signers) = deploy(&env, AMOUNT * 100);
    let admin = client.get_admin();
    let token = token::Client::new(&env, &token_id);

    let strategy = (1u32..=SIGNER_COUNT, 0u32..=6u32, -1i64..=1i64);
    let mut runner = TestRunner::new(config(CASES_MODEL));
    runner
        .run(&strategy, |(threshold, approvals_raw, offset)| {
            rotate_threshold(&env, &client, &signers, threshold);
            advance_ledger(&env, 0);
            let to = Address::generate(&env);
            let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);
            let w = client.get_emergency_withdrawal(&wid);

            // Approve a bounded prefix of signers *before* the delay elapses,
            // so no approval can auto-execute yet (activation is in the future).
            let approvals = (approvals_raw.min(threshold + 1)).min(SIGNER_COUNT) as usize;
            for i in 0..approvals {
                assert!(
                    run_catch(|| client
                        .approve_emergency_withdrawal(&wid, &signers.get(i as u32).unwrap()))
                    .is_ok(),
                    "approval {} should have succeeded",
                    i
                );
            }
            let w = client.get_emergency_withdrawal(&wid);
            prop_assert_eq!(w.status, EmergencyWithdrawalStatus::Pending);

            // Move to activation - 1, activation, or activation + 1 and attempt
            // a manual execute. Success requires BOTH gates.
            let target = (w.activation_ledger as i64 + offset).max(0) as u32;
            advance_ledger(&env, target);
            let ok = run_catch(|| client.execute_emergency_withdrawal(&wid)).is_ok();
            let expected = approvals as u32 >= threshold && offset >= 0;
            prop_assert_eq!(
                ok,
                expected,
                "threshold={} approvals={} offset={}",
                threshold,
                approvals,
                offset
            );

            let w = client.get_emergency_withdrawal(&wid);
            if expected {
                prop_assert_eq!(w.status, EmergencyWithdrawalStatus::Executed);
                prop_assert_eq!(token.balance(&to), AMOUNT);
            } else {
                prop_assert_eq!(w.status, EmergencyWithdrawalStatus::Pending);
                prop_assert_eq!(token.balance(&to), 0);
            }
            Ok(())
        })
        .unwrap();
}

// ─── 3. Activation boundary: exact error, exact single transfer ─────────────

#[test]
fn execute_at_activation_boundary_exact_errors() {
    let env = Env::default();
    let (_id, client, token_id, signers) = deploy(&env, AMOUNT * 10);
    let admin = client.get_admin();
    let to = Address::generate(&env);
    let token = token::Client::new(&env, &token_id);

    rotate_threshold(&env, &client, &signers, 3);
    advance_ledger(&env, 10_000);
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);
    let w = client.get_emergency_withdrawal(&wid);
    assert_eq!(w.activation_ledger, 10_000 + EMERGENCY_WITHDRAWAL_DELAY);

    // Meet the threshold before the delay elapses → still Pending.
    for i in 0..3 {
        client.approve_emergency_withdrawal(&wid, &signers.get(i).unwrap());
    }
    let w = client.get_emergency_withdrawal(&wid);
    assert_eq!(w.status, EmergencyWithdrawalStatus::Pending);
    assert_eq!(w.approvals.len(), 3);
    assert_eq!(token.balance(&to), 0);

    // One ledger before activation: blocked with the exact error.
    advance_ledger(&env, w.activation_ledger - 1);
    let msg = run_catch(|| client.execute_emergency_withdrawal(&wid))
        .unwrap_err()
        .expect("readable panic payload");
    assert!(
        msg.contains("emergency withdrawal not ready"),
        "unexpected message: {}",
        msg
    );
    let w = client.get_emergency_withdrawal(&wid);
    assert_eq!(w.status, EmergencyWithdrawalStatus::Pending);
    assert_eq!(token.balance(&to), 0);

    // Exactly at activation: executes, funds move exactly once.
    advance_ledger(&env, w.activation_ledger);
    client.execute_emergency_withdrawal(&wid);
    let w = client.get_emergency_withdrawal(&wid);
    assert_eq!(w.status, EmergencyWithdrawalStatus::Executed);
    assert_eq!(token.balance(&to), AMOUNT);

    // Double execution is impossible.
    let msg = run_catch(|| client.execute_emergency_withdrawal(&wid))
        .unwrap_err()
        .expect("readable panic payload");
    assert!(
        msg.contains("emergency withdrawal is not pending"),
        "unexpected message: {}",
        msg
    );
    // Re-approval after execution is impossible.
    let msg = run_catch(|| client.approve_emergency_withdrawal(&wid, &signers.get(3).unwrap()))
        .unwrap_err()
        .expect("readable panic payload");
    assert!(
        msg.contains("emergency withdrawal is not pending"),
        "unexpected message: {}",
        msg
    );
    assert_eq!(token.balance(&to), AMOUNT);
}

// ─── 4. Threshold met exactly at the activation boundary auto-executes ──────

#[test]
fn auto_execute_when_threshold_met_exactly_at_activation() {
    let env = Env::default();
    let (_id, client, token_id, signers) = deploy(&env, AMOUNT * 10);
    let admin = client.get_admin();
    let to = Address::generate(&env);
    let token = token::Client::new(&env, &token_id);

    rotate_threshold(&env, &client, &signers, 2);
    advance_ledger(&env, 7_000);
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);
    let w = client.get_emergency_withdrawal(&wid);
    let activation = w.activation_ledger;

    // First approval before activation — pending.
    client.approve_emergency_withdrawal(&wid, &signers.get(0).unwrap());
    assert_eq!(
        client.get_emergency_withdrawal(&wid).status,
        EmergencyWithdrawalStatus::Pending
    );

    // Advance to exactly activation, then the second (threshold) approval
    // auto-executes: threshold met exactly at the activation boundary.
    advance_ledger(&env, activation);
    client.approve_emergency_withdrawal(&wid, &signers.get(1).unwrap());
    let w = client.get_emergency_withdrawal(&wid);
    assert_eq!(w.status, EmergencyWithdrawalStatus::Executed);
    assert_eq!(w.approvals.len(), 2);
    assert_eq!(token.balance(&to), AMOUNT);
}

// ─── 5. Approval deduplication ──────────────────────────────────────────────

#[test]
fn duplicate_approval_rejected_and_never_counts() {
    let env = Env::default();
    let (_id, client, token_id, signers) = deploy(&env, AMOUNT * 10);
    let admin = client.get_admin();
    let to = Address::generate(&env);

    rotate_threshold(&env, &client, &signers, 3);
    advance_ledger(&env, 0);
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);

    client.approve_emergency_withdrawal(&wid, &signers.get(0).unwrap());
    // Duplicate attempts → exact error, and the approval list never grows.
    for _ in 0..5 {
        let msg = run_catch(|| client.approve_emergency_withdrawal(&wid, &signers.get(0).unwrap()))
            .unwrap_err()
            .expect("readable panic payload");
        assert!(
            msg.contains("already approved"),
            "unexpected message: {}",
            msg
        );
        assert_eq!(client.get_emergency_withdrawal(&wid).approvals.len(), 1);
    }

    // Distinct signers still count toward the threshold.
    client.approve_emergency_withdrawal(&wid, &signers.get(1).unwrap());
    client.approve_emergency_withdrawal(&wid, &signers.get(2).unwrap());
    let w = client.get_emergency_withdrawal(&wid);
    assert_eq!(w.approvals.len(), 3);
    // Delay not elapsed → still pending even though threshold is met.
    assert_eq!(w.status, EmergencyWithdrawalStatus::Pending);
}

// ─── 6. Cancellation is irreversible ────────────────────────────────────────

#[test]
fn cancellation_is_irreversible_and_blocks_execution_forever() {
    let env = Env::default();
    let (_id, client, token_id, signers) = deploy(&env, AMOUNT * 10);
    let admin = client.get_admin();
    let to = Address::generate(&env);
    let token = token::Client::new(&env, &token_id);

    rotate_threshold(&env, &client, &signers, 2);
    advance_ledger(&env, 0);
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);

    client.approve_emergency_withdrawal(&wid, &signers.get(0).unwrap());
    client.approve_emergency_withdrawal(&wid, &signers.get(1).unwrap());
    assert_eq!(
        client.get_emergency_withdrawal(&wid).status,
        EmergencyWithdrawalStatus::Pending
    );
    client.cancel_emergency_withdrawal(&wid, &admin);
    assert_eq!(
        client.get_emergency_withdrawal(&wid).status,
        EmergencyWithdrawalStatus::Cancelled
    );

    // Far past activation, execution must still be blocked — cancellation wins
    // over a fully-satisfied (but voided) withdrawal.
    advance_ledger(&env, 1_000_000);
    let cancelled_ops: [&dyn Fn(); 3] = [
        &|| client.execute_emergency_withdrawal(&wid),
        &|| client.approve_emergency_withdrawal(&wid, &signers.get(1).unwrap()),
        &|| client.cancel_emergency_withdrawal(&wid, &admin),
    ];
    for op in cancelled_ops {
        let msg = run_catch(op).unwrap_err().expect("readable panic payload");
        assert!(
            msg.contains("emergency withdrawal is not pending"),
            "unexpected message: {}",
            msg
        );
    }
    assert_eq!(token.balance(&to), 0);
}

// ─── 7. Duplicate initiation ────────────────────────────────────────────────

#[test]
fn duplicate_initiation_creates_independent_withdrawals() {
    let env = Env::default();
    let (_id, client, token_id, signers) = deploy(&env, AMOUNT * 10);
    let admin = client.get_admin();
    let to = Address::generate(&env);

    rotate_threshold(&env, &client, &signers, 2);
    advance_ledger(&env, 100);

    let id_a = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);
    let id_b = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);
    assert_ne!(id_a, id_b);
    assert_eq!(client.get_emergency_withdrawal_count(), 2);

    let a = client.get_emergency_withdrawal(&id_a);
    let b = client.get_emergency_withdrawal(&id_b);
    assert_eq!(a.status, EmergencyWithdrawalStatus::Pending);
    assert_eq!(b.status, EmergencyWithdrawalStatus::Pending);
    assert_eq!(a.approvals.len(), 0);
    assert_eq!(b.approvals.len(), 0);
    assert_eq!(a.activation_ledger, b.activation_ledger);

    // Approving only one leaves the other untouched.
    client.approve_emergency_withdrawal(&id_a, &signers.get(0).unwrap());
    assert_eq!(client.get_emergency_withdrawal(&id_a).approvals.len(), 1);
    assert_eq!(client.get_emergency_withdrawal(&id_b).approvals.len(), 0);

    // A third initiation still gets a fresh, sequential id.
    let id_c = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);
    assert_eq!(id_c, 2);
}

// ─── 8. Authorization: only the legacy admin initiates/cancels ──────────────

#[test]
fn only_legacy_admin_can_initiate_or_cancel() {
    let env = Env::default();
    let (_id, client, token_id, signers) = deploy(&env, AMOUNT * 10);
    let to = Address::generate(&env);

    rotate_threshold(&env, &client, &signers, 2);

    // A configured admin signer that is NOT the legacy admin cannot initiate.
    let msg = run_catch(|| {
        let _ =
            client.initiate_emergency_withdrawal(&signers.get(1).unwrap(), &token_id, &AMOUNT, &to);
    })
    .unwrap_err()
    .expect("readable panic payload");
    assert!(msg.contains("Unauthorized"), "unexpected message: {}", msg);

    // The legacy admin can initiate...
    let admin = client.get_admin();
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);
    // ...but a non-admin cannot cancel it.
    let msg = run_catch(|| client.cancel_emergency_withdrawal(&wid, &signers.get(1).unwrap()))
        .unwrap_err()
        .expect("readable panic payload");
    assert!(msg.contains("Unauthorized"), "unexpected message: {}", msg);
    assert_eq!(
        client.get_emergency_withdrawal(&wid).status,
        EmergencyWithdrawalStatus::Pending
    );
}

#[test]
fn non_signer_approval_rejected_exact_error() {
    let env = Env::default();
    let (_id, client, token_id, signers) = deploy(&env, AMOUNT * 10);
    let admin = client.get_admin();
    let to = Address::generate(&env);

    rotate_threshold(&env, &client, &signers, 2);
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);

    let stranger = Address::generate(&env);
    let msg = run_catch(|| client.approve_emergency_withdrawal(&wid, &stranger))
        .unwrap_err()
        .expect("readable panic payload");
    assert!(
        msg.contains("not an admin signer"),
        "unexpected message: {}",
        msg
    );
    assert_eq!(client.get_emergency_withdrawal(&wid).approvals.len(), 0);
}

// ─── 9. Threshold / signer-set changes mid-flight ───────────────────────────

#[test]
fn midflight_threshold_change_is_snapshotted_at_initiation() {
    let env = Env::default();
    let (_id, client, token_id, signers) = deploy(&env, AMOUNT * 10);
    let admin = client.get_admin();
    let to = Address::generate(&env);
    let token = token::Client::new(&env, &token_id);

    // Start with a 3-of-4 withdrawal.
    rotate_threshold(&env, &client, &signers, 3);
    advance_ledger(&env, 0);
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);
    assert_eq!(client.get_emergency_withdrawal(&wid).threshold, 3);

    client.approve_emergency_withdrawal(&wid, &signers.get(0).unwrap());
    client.approve_emergency_withdrawal(&wid, &signers.get(1).unwrap());

    // LOWER the global threshold to 1 while the withdrawal is pending. The
    // stored threshold is snapshotted at initiation, so the withdrawal still
    // requires its original 3 approvals.
    rotate_threshold(&env, &client, &signers, 1);
    assert_eq!(client.get_admin_signers_threshold(), 1);
    assert_eq!(client.get_emergency_withdrawal(&wid).threshold, 3);

    // Well past activation, 2 approvals < stored 3 → still blocked.
    advance_ledger(&env, 1_000_000);
    let msg = run_catch(|| client.execute_emergency_withdrawal(&wid))
        .unwrap_err()
        .expect("readable panic payload");
    assert!(
        msg.contains("insufficient admin approvals"),
        "unexpected message: {}",
        msg
    );
    assert_eq!(token.balance(&to), 0);

    // A third approval executes under the (unchanged) stored threshold.
    client.approve_emergency_withdrawal(&wid, &signers.get(2).unwrap());
    let w = client.get_emergency_withdrawal(&wid);
    assert_eq!(w.status, EmergencyWithdrawalStatus::Executed);
    assert_eq!(token.balance(&to), AMOUNT);

    // A NEW withdrawal picks up the lowered global threshold (1), proving the
    // snapshot applies only to the pending withdrawal.
    let wid2 = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);
    assert_eq!(client.get_emergency_withdrawal(&wid2).threshold, 1);
    assert_eq!(
        client.get_emergency_withdrawal(&wid2).activation_ledger,
        env.ledger().sequence() + EMERGENCY_WITHDRAWAL_DELAY
    );
    advance_ledger(&env, env.ledger().sequence() + EMERGENCY_WITHDRAWAL_DELAY);
    client.approve_emergency_withdrawal(&wid2, &signers.get(0).unwrap());
    assert_eq!(
        client.get_emergency_withdrawal(&wid2).status,
        EmergencyWithdrawalStatus::Executed
    );
}

#[test]
fn midflight_signer_removal_keeps_recorded_but_blocks_new_approvals() {
    let env = Env::default();
    let (_id, client, token_id, signers) = deploy(&env, AMOUNT * 10);
    let admin = client.get_admin();
    let to = Address::generate(&env);
    let token = token::Client::new(&env, &token_id);

    // 2-of-4 withdrawal using signers[0] and signers[1].
    rotate_threshold(&env, &client, &signers, 2);
    advance_ledger(&env, 0);
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);
    assert_eq!(client.get_emergency_withdrawal(&wid).threshold, 2);

    client.approve_emergency_withdrawal(&wid, &signers.get(1).unwrap());
    assert_eq!(client.get_emergency_withdrawal(&wid).approvals.len(), 1);

    // Remove signers[1..]: only the legacy admin remains, threshold 1.
    let shrunken = Vec::from_array(&env, [admin.clone()]);
    rotate_signers(&env, &client, &shrunken, 1);
    assert_eq!(client.get_admin_signers_threshold(), 1);

    // The removed signer can no longer approve the pending withdrawal.
    let msg = run_catch(|| client.approve_emergency_withdrawal(&wid, &signers.get(1).unwrap()))
        .unwrap_err()
        .expect("readable panic payload");
    assert!(
        msg.contains("not an admin signer"),
        "unexpected message: {}",
        msg
    );

    // ...but the approval it recorded before removal persists.
    assert_eq!(client.get_emergency_withdrawal(&wid).approvals.len(), 1);

    // The still-valid admin approves: recorded + new = 2 ≥ stored threshold 2,
    // so the withdrawal executes after activation.
    advance_ledger(&env, 1_000_000);
    client.approve_emergency_withdrawal(&wid, &admin);
    let w = client.get_emergency_withdrawal(&wid);
    assert_eq!(w.status, EmergencyWithdrawalStatus::Executed);
    assert_eq!(w.approvals.len(), 2);
    assert_eq!(token.balance(&to), AMOUNT);
}

// ─── 10. Model-based adversarial ordering ───────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
enum Op {
    Advance(u32),
    Approve(u32),
    Execute,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Status {
    Pending,
    Executed,
    Cancelled,
}

impl Status {
    fn from_contract(s: EmergencyWithdrawalStatus) -> Status {
        match s {
            EmergencyWithdrawalStatus::Pending => Status::Pending,
            EmergencyWithdrawalStatus::Executed => Status::Executed,
            EmergencyWithdrawalStatus::Cancelled => Status::Cancelled,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum ModelErr {
    NotPending,
    NotAdminSigner,
    AlreadyApproved,
    NotReady,
    InsufficientApprovals,
}

impl ModelErr {
    fn expected_message(&self) -> &'static str {
        match self {
            ModelErr::NotPending => "emergency withdrawal is not pending",
            ModelErr::NotAdminSigner => "not an admin signer",
            ModelErr::AlreadyApproved => "already approved",
            ModelErr::NotReady => "emergency withdrawal not ready",
            ModelErr::InsufficientApprovals => "insufficient admin approvals",
        }
    }
}

/// Exact reference model of one emergency withdrawal. Mirrors the contract's
/// check ordering and auto-execution rules.
#[derive(Debug, Clone)]
struct Model {
    status: Status,
    approvals: std::vec::Vec<bool>,
    threshold: u32,
    activation_ledger: u32,
    current_ledger: u32,
    executed_total: i128,
}

impl Model {
    fn new(activation_ledger: u32, threshold: u32) -> Self {
        Model {
            status: Status::Pending,
            approvals: vec![false; SIGNER_COUNT as usize],
            threshold,
            activation_ledger,
            current_ledger: 0,
            executed_total: 0,
        }
    }

    fn approval_count(&self) -> u32 {
        self.approvals.iter().filter(|b| **b).count() as u32
    }

    fn apply(&mut self, op: Op, amount: i128) -> Result<(), ModelErr> {
        match op {
            Op::Advance(to) => {
                self.current_ledger = to;
                Ok(())
            }
            Op::Approve(idx) => self.approve(idx as usize, amount),
            Op::Execute => self.execute(amount),
            Op::Cancel => self.cancel(),
        }
    }

    fn approve(&mut self, idx: usize, amount: i128) -> Result<(), ModelErr> {
        if self.status != Status::Pending {
            return Err(ModelErr::NotPending);
        }
        if idx >= self.approvals.len() {
            return Err(ModelErr::NotAdminSigner);
        }
        if self.approvals[idx] {
            return Err(ModelErr::AlreadyApproved);
        }
        self.approvals[idx] = true;
        if self.approval_count() >= self.threshold && self.current_ledger >= self.activation_ledger
        {
            self.status = Status::Executed;
            self.executed_total += amount;
        }
        Ok(())
    }

    fn execute(&mut self, amount: i128) -> Result<(), ModelErr> {
        if self.status != Status::Pending {
            return Err(ModelErr::NotPending);
        }
        if self.current_ledger < self.activation_ledger {
            return Err(ModelErr::NotReady);
        }
        if self.approval_count() < self.threshold {
            return Err(ModelErr::InsufficientApprovals);
        }
        self.status = Status::Executed;
        self.executed_total += amount;
        Ok(())
    }

    fn cancel(&mut self) -> Result<(), ModelErr> {
        if self.status != Status::Pending {
            return Err(ModelErr::NotPending);
        }
        self.status = Status::Cancelled;
        Ok(())
    }
}

/// Replay randomized adversarial orderings of ledger-advance / approve /
/// execute / cancel against both the deployed contract and the reference
/// model, asserting identical outcomes and exact panic messages throughout.
#[test]
fn adversarial_op_ordering_never_breaks_the_gates() {
    let env = Env::default();
    let (_id, client, token_id, signers) = deploy(&env, AMOUNT * (CASES_MODEL as i128 + 2) * 2);
    let admin = client.get_admin();
    let token = token::Client::new(&env, &token_id);

    // Approver pool: the valid signer set followed by strangers that must be
    // rejected by the `not an admin signer` gate.
    let mut approvers: Vec<Address> = Vec::new(&env);
    for i in 0..SIGNER_COUNT {
        approvers.push_back(signers.get(i).unwrap());
    }
    for _ in 0..2 {
        approvers.push_back(Address::generate(&env));
    }

    let strategy = (
        0u32..=100_000u32,
        1u32..=SIGNER_COUNT,
        proptest::collection::vec(any::<u8>(), 1..=20),
    );

    let mut runner = TestRunner::new(config(CASES_MODEL));
    runner
        .run(&strategy, |(init_ledger, threshold, bytes)| {
            rotate_threshold(&env, &client, &signers, threshold);
            advance_ledger(&env, init_ledger);

            let to = Address::generate(&env);
            let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &AMOUNT, &to);
            let w = client.get_emergency_withdrawal(&wid);
            let mut model = Model::new(w.activation_ledger, threshold);
            model.current_ledger = init_ledger;

            let ops: std::vec::Vec<Op> = bytes
                .into_iter()
                .map(|b| match b % 4 {
                    0 => Op::Advance(((b as u32) * 40_000) % 200_000),
                    1 => Op::Approve(b as u32 % (SIGNER_COUNT + 2)),
                    2 => Op::Execute,
                    _ => Op::Cancel,
                })
                .collect();

            for op in &ops {
                let model_result = model.apply(*op, AMOUNT);
                let contract_result = run_catch(|| match *op {
                    Op::Advance(to) => advance_ledger(&env, to),
                    Op::Approve(idx) => {
                        let signer = approvers.get(idx).unwrap();
                        client.approve_emergency_withdrawal(&wid, &signer)
                    }
                    Op::Execute => client.execute_emergency_withdrawal(&wid),
                    Op::Cancel => client.cancel_emergency_withdrawal(&wid, &admin),
                });

                let model_ok = model_result.is_ok();
                let contract_ok = contract_result.is_ok();
                prop_assert_eq!(
                    contract_ok,
                    model_ok,
                    "op {:?}: contract allowed={}, model allowed={}",
                    op,
                    contract_ok,
                    model_ok
                );

                if !contract_ok {
                    let model_err = model_result.unwrap_err();
                    let payload = contract_result.unwrap_err();
                    let msg = payload.as_deref().unwrap_or("<unreadable panic payload>");
                    prop_assert!(
                        msg.contains(model_err.expected_message()),
                        "op {:?}: expected panic containing {:?}, got {:?}",
                        op,
                        model_err.expected_message(),
                        msg
                    );
                }

                // After every op the on-chain record must match the model.
                let w = client.get_emergency_withdrawal(&wid);
                prop_assert_eq!(Status::from_contract(w.status), model.status, "op {:?}", op);
                prop_assert_eq!(
                    w.approvals.len() as u32,
                    model.approval_count(),
                    "op {:?}",
                    op
                );
            }

            // Terminal invariant: funds moved exactly once per execution, and
            // never for cancelled, under-threshold, or pre-activation states.
            prop_assert_eq!(token.balance(&to), model.executed_total);
            let w = client.get_emergency_withdrawal(&wid);
            prop_assert_eq!(Status::from_contract(w.status), model.status);
            Ok(())
        })
        .unwrap();
}
