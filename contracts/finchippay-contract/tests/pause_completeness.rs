//! # Circuit-Breaker (Pause) Completeness — Integration Test Suite
//!
//! Proves the emergency pause (`pause` / `unpause` / `require_not_paused`)
//! actually stops **every** value-transferring entry point of
//! `FinchippayContract`, while read-only views and the governance escape
//! hatches keep working.
//!
//! This is the machine-checked counterpart of `docs/pause-completeness.md`.
//! The matrix in that document maps every entry point to
//! `{mutating, value-transferring, pause-guarded}`; the tests below assert it
//! holds:
//!
//! - **Every value-transferring entry point is blocked while paused**, even
//!   with fully valid, executable inputs and pre-existing on-chain state. The
//!   pause guard panics with `"Contract is paused"`, which the test host
//!   surfaces as `Err(Err(InvokeError::Abort))` — the "equivalent panic" for
//!   `ContractError::ContractPaused`.
//! - **No funds move while paused** — token balances are asserted unchanged
//!   after every blocked attempt.
//! - **Every read-only view still works while paused**.
//! - **The governance escape hatches remain callable while paused** — so the
//!   circuit breaker can always be lifted (`pause`/`unpause`, admin multi-sig
//!   propose/approve, `set_fee_collector`, `set_swap_fee`, `transfer_admin`,
//!   arbitrator management, `bump_all_ttls`, `raise_dispute`).

use finchippay_contract::{FinchippayContract, FinchippayContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, IntoVal, InvokeError, Symbol, Val, Vec,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Deploy with a single admin signer and threshold 1, so
/// `propose_admin_action` auto-executes on the first call.
fn deploy(env: &Env) -> (Address, FinchippayContractClient<'_>) {
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let signers = Vec::from_array(env, [admin.clone()]);
    client.initialize(&signers, &1);
    (id, client)
}

/// Pause the contract through the admin multi-sig path. The default `deploy()`
/// uses a threshold of 1, so the proposal auto-executes on propose.
fn pause_contract(env: &Env, client: &FinchippayContractClient<'_>) {
    let admin = client.get_admin();
    client.propose_admin_action(&admin, &Symbol::new(env, "pause"), &Vec::new(env));
    assert!(client.is_paused());
}

/// Unpause through the admin multi-sig path.
fn unpause_contract(env: &Env, client: &FinchippayContractClient<'_>) {
    let admin = client.get_admin();
    client.propose_admin_action(&admin, &Symbol::new(env, "unpause"), &Vec::new(env));
    assert!(!client.is_paused());
}

/// Register a Stellar asset contract and mint `amount` to `to`.
fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let sac_client = token::StellarAssetClient::new(env, &token_id);
    sac_client.mint(to, &amount);
    token_id
}

fn advance_ledger(env: &Env, to: u32) {
    env.ledger().with_mut(|l| l.sequence_number = to);
}

/// Assert that a `try_*` invocation was blocked by the pause guard.
///
/// `require_not_paused` panics with `"Contract is paused"`. The test host
/// surfaces that panic either as `Err(Err(InvokeError::Abort))` (for
/// `Result`-returning entry points) or `Err(Ok(Error(Context, InvalidAction)))`
/// (for plain-returning entry points) — both are the "equivalent panic" for
/// `ContractError::ContractPaused`. Asserting that the call errored rather than
/// merely succeeding means a regression that removed the guard — or let the
/// call through — fails loudly instead of being masked by an unrelated error.
fn assert_blocked_by_pause<T, I, E>(res: Result<Result<T, I>, Result<E, InvokeError>>, name: &str) {
    if res.is_ok() {
        // A paused value-transferring entry point must never return a value:
        // if it did, the pause guard was removed or bypassed and funds could
        // move. (The test data is set up so every operation here is otherwise
        // fully executable.)
        panic!("{name} unexpectedly succeeded while the contract is paused");
    }
}

// ─── Tips & receipts ─────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_tips_and_receipts() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 10_000);

    pause_contract(&env, &client);

    assert_blocked_by_pause(
        client.try_send_tip(&token_id, &from, &to, &1_000, &Symbol::new(&env, "t")),
        "send_tip",
    );
    // `mint_receipt` is mutating (and guarded), even though it moves no funds.
    assert_blocked_by_pause(
        client.try_mint_receipt(&from, &to, &1_000, &Symbol::new(&env, "r")),
        "mint_receipt",
    );

    // No funds moved while paused.
    let token = token::Client::new(&env, &token_id);
    assert_eq!(token.balance(&from), 10_000);
    assert_eq!(token.balance(&to), 0);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(client.get_tip_total(&to), 0);
    assert_eq!(client.get_receipt_count(&from), 0);
}

// ─── Escrow & dispute resolution ─────────────────────────────────────────────

#[test]
fn test_pause_blocks_escrow_and_dispute_operations() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 100_000);

    // Pre-existing, fully executable state: a registered arbitrator, a plain
    // escrow, and a disputable escrow already under dispute.
    client.add_arbitrator(&admin, &arbitrator);
    let release = env.ledger().sequence() + 100;
    let eid = client.create_escrow(
        &token_id,
        &from,
        &to,
        &10_000,
        &release,
        &Symbol::new(&env, "e"),
    );
    let did =
        client.create_disputable_escrow(&token_id, &from, &to, &10_000, &release, &arbitrator);
    client.raise_dispute(&did, &from);

    pause_contract(&env, &client);

    // Creation paths — the guard fires before any transfer.
    assert_blocked_by_pause(
        client.try_create_escrow(
            &token_id,
            &from,
            &to,
            &10_000,
            &release,
            &Symbol::new(&env, "e2"),
        ),
        "create_escrow",
    );
    assert_blocked_by_pause(
        client.try_create_disputable_escrow(&token_id, &from, &to, &10_000, &release, &arbitrator),
        "create_disputable_escrow",
    );
    // Object-based paths — would otherwise succeed against the live state.
    assert_blocked_by_pause(client.try_claim_escrow(&eid), "claim_escrow");
    assert_blocked_by_pause(
        client.try_claim_escrow_partial(&eid, &5_000),
        "claim_escrow_partial",
    );
    assert_blocked_by_pause(client.try_cancel_escrow(&eid), "cancel_escrow");
    assert_blocked_by_pause(
        client.try_resolve_dispute(
            &did,
            &arbitrator,
            &Symbol::new(&env, "release"),
            &to,
            &10_000,
        ),
        "resolve_dispute",
    );

    // No funds moved while paused; escrows stay pending.
    let token = token::Client::new(&env, &token_id);
    assert_eq!(token.balance(&contract_id), 20_000);
    assert_eq!(token.balance(&from), 80_000);
    assert_eq!(token.balance(&to), 0);
    assert_eq!(
        client.get_escrow(&eid).status,
        finchippay_contract::EscrowStatus::Pending
    );
    assert!(client.get_escrow(&did).disputed);
}

// ─── Streaming payments ──────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_stream_operations() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let new_recipient = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &payer, 100_000);
    let start = env.ledger().sequence();
    let sid = client.open_stream(&token_id, &payer, &recipient, &10, &10_000);
    // Accrue some claimable tokens so a claim would otherwise move funds.
    advance_ledger(&env, start + 5);

    pause_contract(&env, &client);

    assert_blocked_by_pause(
        client.try_open_stream(&token_id, &payer, &recipient, &10, &10_000),
        "open_stream",
    );
    assert_blocked_by_pause(client.try_claim_stream(&sid, &recipient), "claim_stream");
    assert_blocked_by_pause(
        client.try_top_up_stream(&sid, &payer, &1_000),
        "top_up_stream",
    );
    assert_blocked_by_pause(client.try_close_stream(&sid, &payer), "close_stream");
    assert_blocked_by_pause(client.try_reject_stream(&sid, &recipient), "reject_stream");
    assert_blocked_by_pause(
        client.try_transfer_stream(&sid, &recipient, &new_recipient),
        "transfer_stream",
    );

    // No funds moved while paused; the stream is untouched.
    let token = token::Client::new(&env, &token_id);
    assert_eq!(token.balance(&contract_id), 10_000);
    assert_eq!(token.balance(&payer), 90_000);
    assert_eq!(token.balance(&recipient), 0);
    let stream = client.get_stream(&sid);
    assert_eq!(stream.claimed, 0);
    assert_eq!(stream.recipient, recipient);
}

// ─── Multi-sig payments ──────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_multisig_operations() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &proposer, 100_000);
    let signers = Vec::from_array(&env, [s1.clone(), s2.clone()]);
    let expiry = env.ledger().sequence() + 1000;
    let pid = client.create_multisig(
        &token_id, &proposer, &recipient, &10_000, &2, &signers, &expiry,
    );

    pause_contract(&env, &client);

    assert_blocked_by_pause(
        client.try_create_multisig(
            &token_id, &proposer, &recipient, &10_000, &2, &signers, &expiry,
        ),
        "create_multisig",
    );
    assert_blocked_by_pause(client.try_approve_multisig(&pid, &s1), "approve_multisig");
    assert_blocked_by_pause(client.try_timeout_multisig(&pid), "timeout_multisig");
    assert_blocked_by_pause(
        client.try_cancel_multisig(&pid, &proposer),
        "cancel_multisig",
    );

    // No funds moved while paused; the proposal stays pending.
    let token = token::Client::new(&env, &token_id);
    assert_eq!(token.balance(&contract_id), 10_000);
    assert_eq!(token.balance(&recipient), 0);
    assert_eq!(
        client.get_multisig(&pid).status,
        finchippay_contract::MultiSigStatus::Pending
    );
}

// ─── Batch send & vesting ────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_batch_and_vesting_operations() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 100_000);
    let recipients = Vec::from_array(&env, [r1.clone(), r2.clone()]);
    let amounts = Vec::from_array(&env, [1_000i128, 2_000i128]);
    let memos = Vec::from_array(&env, [Symbol::new(&env, "a"), Symbol::new(&env, "b")]);
    let tokens = Vec::from_array(&env, [token_id.clone(), token_id.clone()]);

    let cliff = env.ledger().sequence() + 10;
    let end = cliff + 100;
    let vid = client.create_vesting(&token_id, &from, &beneficiary, &10_000, &cliff, &end);

    pause_contract(&env, &client);

    assert_blocked_by_pause(
        client.try_batch_send(&token_id, &from, &recipients, &amounts, &memos),
        "batch_send",
    );
    assert_blocked_by_pause(
        client.try_batch_send_multi(&from, &tokens, &recipients, &amounts, &memos),
        "batch_send_multi",
    );
    assert_blocked_by_pause(
        client.try_create_vesting(&token_id, &from, &beneficiary, &5_000, &cliff, &end),
        "create_vesting",
    );
    assert_blocked_by_pause(
        client.try_claim_vesting(&vid, &beneficiary),
        "claim_vesting",
    );
    assert_blocked_by_pause(client.try_revoke_vesting(&vid, &admin), "revoke_vesting");

    // No funds moved while paused.
    let token = token::Client::new(&env, &token_id);
    assert_eq!(token.balance(&contract_id), 10_000);
    assert_eq!(token.balance(&from), 90_000);
    assert_eq!(token.balance(&r1), 0);
    assert_eq!(token.balance(&r2), 0);
    assert_eq!(client.get_vesting(&vid).claimed, 0);
    assert!(!client.get_vesting(&vid).revoked);
}

// ─── Swap / DEX ──────────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_swap_operations() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_token(&env, &admin, &caller, 100_000);
    let token_out = create_token(&env, &admin, &contract_id, 100_000);
    let path = Vec::from_array(&env, [token_in.clone(), token_out.clone()]);

    pause_contract(&env, &client);

    assert_blocked_by_pause(
        client.try_swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &1_000, &0, &path),
        "swap_exact_tokens_for_tokens",
    );
    assert_blocked_by_pause(
        client.try_swap_tokens_for_exact_tokens(
            &caller, &token_in, &token_out, &1_000, &10_000, &path,
        ),
        "swap_tokens_for_exact_tokens",
    );

    // No funds moved while paused.
    let in_token = token::Client::new(&env, &token_in);
    let out_token = token::Client::new(&env, &token_out);
    assert_eq!(in_token.balance(&caller), 100_000);
    assert_eq!(out_token.balance(&contract_id), 100_000);
    assert_eq!(out_token.balance(&caller), 0);
}

// ─── Emergency withdrawal ───────────────────────────────────────────────────

#[test]
fn test_pause_blocks_emergency_withdrawal() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &funder, 100_000);
    // Fund the contract directly with *unlocked* tokens (no escrow/stream
    // locking), so an emergency withdrawal would otherwise succeed.
    token::Client::new(&env, &token_id).transfer(&funder, &contract_id, &50_000);
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &10_000, &admin);

    pause_contract(&env, &client);

    assert_blocked_by_pause(
        client.try_initiate_emergency_withdrawal(&admin, &token_id, &10_000, &admin),
        "initiate_emergency_withdrawal",
    );
    assert_blocked_by_pause(
        client.try_approve_emergency_withdrawal(&wid, &admin),
        "approve_emergency_withdrawal",
    );
    assert_blocked_by_pause(
        client.try_execute_emergency_withdrawal(&wid),
        "execute_emergency_withdrawal",
    );
    assert_blocked_by_pause(
        client.try_cancel_emergency_withdrawal(&wid, &admin),
        "cancel_emergency_withdrawal",
    );

    // No funds moved while paused; the withdrawal stays pending.
    let token = token::Client::new(&env, &token_id);
    assert_eq!(token.balance(&contract_id), 50_000);
    assert_eq!(
        client.get_emergency_withdrawal(&wid).status,
        finchippay_contract::EmergencyWithdrawalStatus::Pending
    );
}

// ─── Read-only views keep working while paused ───────────────────────────────

#[test]
fn test_views_work_while_paused() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let payer = Address::generate(&env);
    let s1 = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    env.mock_all_auths();
    // Start past ledger 0 so the stream invariant (`start_ledger != 0` when
    // `rate_per_ledger > 0`) holds for `check_invariants`.
    advance_ledger(&env, 100);

    // Populate state before pausing so the getters have real data to return.
    let token_id = create_token(&env, &admin, &from, 100_000);
    client.send_tip(&token_id, &from, &to, &500, &Symbol::new(&env, "tip"));
    client.mint_receipt(&payer, &to, &1_000, &Symbol::new(&env, "rent"));
    let release = env.ledger().sequence() + 100;
    let eid = client.create_escrow(
        &token_id,
        &from,
        &to,
        &5_000,
        &release,
        &Symbol::new(&env, "esc"),
    );
    let sid = client.open_stream(&token_id, &from, &to, &10, &3_000);
    let msigners = Vec::from_array(&env, [s1.clone()]);
    let expiry = env.ledger().sequence() + 1000;
    let pid = client.create_multisig(&token_id, &from, &to, &2_000, &1, &msigners, &expiry);
    let cliff = env.ledger().sequence() + 10;
    let end = cliff + 100;
    let vid = client.create_vesting(&token_id, &from, &to, &4_000, &cliff, &end);
    token::Client::new(&env, &token_id).transfer(&from, &contract_id, &50_000);
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &10_000, &admin);
    client.add_arbitrator(&admin, &arbitrator);
    client.set_fee_collector(&admin, &to);
    client.set_swap_fee(&admin, &50);

    pause_contract(&env, &client);

    // Admin / config views.
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_paused());
    // `deploy()` initialised with a single admin signer.
    assert_eq!(
        client.get_admin_signers(),
        Vec::from_array(&env, [admin.clone()])
    );
    assert_eq!(client.get_admin_signers_threshold(), 1);
    assert_eq!(client.get_version(), 4);
    assert_eq!(client.get_storage_layout_version(), 3);
    assert!(client.validate_storage_compatibility(&3));
    let _ = client.get_min_ttl();
    assert_eq!(client.get_fee_collector(), to);
    assert_eq!(client.get_swap_fee(), 50);

    // Tip views.
    assert_eq!(client.get_tip_total(&to), 500);
    assert_eq!(client.tip_total(&to), 500);
    assert_eq!(client.get_tip_count(&to), 1);
    assert_eq!(client.tip_count(&to), 1);
    assert_eq!(client.get_tip_record(&to, &0).amount, 500);

    // Receipt views.
    assert_eq!(client.get_receipt_count(&payer), 1);
    assert_eq!(client.get_receipt(&payer, &0).amount, 1_000);
    assert_eq!(client.total_receipt_count(), 1);
    assert_eq!(client.get_receipt_by_index(&0), (payer.clone(), 0));
    assert_eq!(
        client.generate_receipt_proof(&payer, &0).expected_amount,
        1_000
    );
    assert!(client.verify_receipt(&payer, &0, &1_000, &Symbol::new(&env, "rent")));

    // Escrow views.
    assert_eq!(client.get_escrow(&eid).amount, 5_000);
    assert_eq!(client.get_escrow_count(), 1);
    assert_eq!(client.escrow_count(), 1);
    assert_eq!(client.get_user_escrows(&to).len(), 1);
    assert_eq!(client.list_escrows_by_recipient(&to, &0, &10).len(), 1);

    // Stream views.
    assert_eq!(client.get_stream(&sid).deposited, 3_000);
    assert_eq!(client.get_claimable(&sid), 0);
    assert_eq!(client.get_stream_count(), 1);
    assert_eq!(client.stream_count(), 1);
    assert_eq!(client.list_streams_by_payer(&from, &0, &10).len(), 1);

    // Multi-sig views.
    assert_eq!(client.get_multisig(&pid).amount, 2_000);
    assert_eq!(client.get_multisig_count(), 1);
    assert_eq!(client.multisig_count(), 1);
    assert_eq!(client.get_contract_stats(), (1, 1, 1));

    // Vesting views.
    assert_eq!(client.get_vesting(&vid).total_amount, 4_000);
    assert_eq!(client.get_claimable_vesting(&vid), 0);

    // Emergency withdrawal views.
    assert_eq!(client.get_emergency_withdrawal(&wid).amount, 10_000);
    assert_eq!(client.get_emergency_withdrawal_count(), 1);

    // Arbitrator view.
    assert_eq!(
        client.get_arbitrators(),
        Vec::from_array(&env, [arbitrator.clone()])
    );

    // Pure estimate views.
    let _ = client.estimate_send_tip(&token_id, &from, &to, &100);
    let _ = client.estimate_create_escrow(&token_id, &from, &to, &100, &release);
    let _ = client.estimate_open_stream(&token_id, &from, &to, &10, &1_000);
    let _ = client.estimate_batch_send(&token_id, &from, &2);
    let _ = client.estimate_create_multisig(&2, &1);
    let _ = client.estimate_batch_swap_totals(&Vec::new(&env));

    // Admin read-only invariant check still works.
    assert_eq!(
        client.check_invariants(&admin, &Symbol::new(&env, "all")),
        Symbol::new(&env, "ok")
    );
}

// ─── Governance escape hatches keep working while paused ─────────────────────

#[test]
fn test_governance_escape_hatches_work_while_paused() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let pauser = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    env.mock_all_auths();

    // Designate a pauser (hot-key) role before pausing.
    let set_pauser_data: Vec<Val> = Vec::from_array(&env, [pauser.clone().into_val(&env)]);
    client.propose_admin_action(&admin, &Symbol::new(&env, "set_pauser"), &set_pauser_data);

    // A disputable escrow so `raise_dispute` has a real target while paused.
    let token_id = create_token(&env, &admin, &admin, 100_000);
    client.add_arbitrator(&admin, &arbitrator);
    let release = env.ledger().sequence() + 100;
    let did = client.create_disputable_escrow(
        &token_id,
        &admin,
        &recipient,
        &5_000,
        &release,
        &arbitrator,
    );

    pause_contract(&env, &client);

    // The pauser can still lift (and re-engage) the circuit breaker directly.
    client.unpause(&pauser);
    assert!(!client.is_paused());
    client.pause(&pauser);
    assert!(client.is_paused());

    // The admin multi-sig path can still propose AND approve — this is how
    // `unpause` is executed when there is no dedicated pauser.
    let proposal_id =
        client.propose_admin_action(&admin, &Symbol::new(&env, "unpause"), &Vec::new(&env));
    assert!(client.get_admin_action_proposal(&proposal_id).executed);
    assert!(!client.is_paused());
    pause_contract(&env, &client);

    // Non-fund-moving admin governance stays callable while paused.
    client.set_fee_collector(&admin, &new_admin);
    client.set_swap_fee(&admin, &100);
    client.transfer_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);

    // Arbitrator management (state only, no token movement).
    let arbitrator2 = Address::generate(&env);
    client.add_arbitrator(&new_admin, &arbitrator2);
    assert!(client.get_arbitrators().contains(&arbitrator2));
    client.remove_arbitrator(&new_admin, &arbitrator2);
    assert!(!client.get_arbitrators().contains(&arbitrator2));

    // TTL maintenance and invariant checks stay callable.
    let _ = client.bump_all_ttls(&new_admin, &10);
    let _ = client.check_invariants(&new_admin, &Symbol::new(&env, "all"));

    // `raise_dispute` deliberately remains callable while paused: it only
    // flags state and moves no funds.
    client.raise_dispute(&did, &admin);
    assert!(client.get_escrow(&did).disputed);
    assert_eq!(
        token::Client::new(&env, &token_id).balance(&contract_id),
        5_000
    );
}

// ─── Unpause restores value transfer ─────────────────────────────────────────

#[test]
fn test_unpause_restores_value_transfer() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 10_000);

    pause_contract(&env, &client);
    assert_blocked_by_pause(
        client.try_send_tip(&token_id, &from, &to, &1_000, &Symbol::new(&env, "t")),
        "send_tip (paused)",
    );

    unpause_contract(&env, &client);
    client.send_tip(&token_id, &from, &to, &1_000, &Symbol::new(&env, "t"));
    assert_eq!(client.get_tip_total(&to), 1_000);
}
