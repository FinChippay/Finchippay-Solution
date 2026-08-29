#![cfg(test)]

use finchippay_contract::{
    ContractError, EscrowStatus, FinchippayContract, FinchippayContractClient, MultiSigStatus,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, Address, Env, IntoVal, Symbol, Val, Vec,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn deploy(env: &Env) -> (Address, FinchippayContractClient<'_>) {
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let signers = Vec::from_array(env, [admin.clone()]);
    client.initialize(&signers, &1);
    (id, client)
}

/// Pause the contract through the admin multi-sig path. The default
/// deploy() uses a threshold of 1, so the proposal auto-executes on propose.
fn pause_contract(env: &Env, client: &FinchippayContractClient<'_>) {
    let admin = client.get_admin();
    client.propose_admin_action(&admin, &Symbol::new(env, "pause"), &Vec::new(env));
}

/// Unpause through the admin multi-sig path.
fn unpause_contract(env: &Env, client: &FinchippayContractClient<'_>) {
    let admin = client.get_admin();
    client.propose_admin_action(&admin, &Symbol::new(env, "unpause"), &Vec::new(env));
}

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

// ─── Admin & Initialization ─────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    assert_ne!(admin, Address::generate(&env));
}

#[test]
fn test_initialize_cannot_be_called_twice() {
    let env = Env::default();
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let signers = Vec::from_array(&env, [admin.clone()]);
    client.initialize(&signers, &1);
    let result = client.try_initialize(&signers, &1);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::AlreadyInitialized
    );
}

#[test]
fn test_pause_unpause() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    env.mock_all_auths();

    assert!(!client.is_paused());
    pause_contract(&env, &client);
    assert!(client.is_paused());

    unpause_contract(&env, &client);
    assert!(!client.is_paused());
}

#[test]
fn test_pause_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();

    pause_contract(&env, &client);
    // The test host clears the event buffer at the start of every top-level
    // invocation, so inspect the proposal's events before any further call.
    let events = env.events().all().filter_by_contract(&contract_id);
    let raw = events.events();
    // admin_action_proposed + admin_action_approved + paused
    assert!(raw.len() >= 3);
    assert!(client.is_paused());
}

#[test]
fn test_unpause_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();
    pause_contract(&env, &client);

    unpause_contract(&env, &client);
    let events = env.events().all().filter_by_contract(&contract_id);
    let raw = events.events();
    assert!(raw.len() >= 3);
    assert!(!client.is_paused());
}

#[test]
fn test_pause_blocks_send_tip() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    env.mock_all_auths();
    pause_contract(&env, &client);

    let token_id = Address::generate(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let result = client.try_send_tip(&token_id, &from, &to, &100, &Symbol::new(&env, ""));
    assert!(result.is_err());
}

#[test]
fn test_transfer_admin() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let new_admin = Address::generate(&env);
    env.mock_all_auths();
    client.transfer_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_get_version() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    assert_eq!(client.get_version(), 4);
}

#[test]
fn test_initialize_event() {
    let env = Env::default();
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let signers = Vec::from_array(&env, [admin.clone()]);
    client.initialize(&signers, &1);
    let events = env.events().all().filter_by_contract(&id);
    let raw = events.events();
    assert_eq!(raw.len(), 1);
}

// ─── Tip Flow ────────────────────────────────────────────────────────────────

#[test]
fn test_send_tip_basic() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 1_000);
    let bal_before = client.get_tip_total(&to);
    assert_eq!(bal_before, 0);

    client.send_tip(&token_id, &from, &to, &100, &Symbol::new(&env, "thanks"));

    assert_eq!(client.get_tip_total(&to), 100);
    assert_eq!(client.get_tip_count(&to), 1);

    let record = client.get_tip_record(&to, &0);
    assert_eq!(record.amount, 100);
    assert_eq!(record.from, from);
    assert_eq!(record.to, to);
}

#[test]
fn test_send_tip_self_transfer_fails() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    env.mock_all_auths();
    let token_id = create_token(&env, &admin, &from, 1_000);
    let result = client.try_send_tip(&token_id, &from, &from, &100, &Symbol::new(&env, ""));
    assert!(result.is_err());
}

#[test]
fn test_send_tip_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();
    let token_id = create_token(&env, &admin, &from, 1_000);
    client.send_tip(&token_id, &from, &to, &100, &Symbol::new(&env, "thanks"));

    let events = env.events().all().filter_by_contract(&contract_id);
    let raw = events.events();
    assert_eq!(raw.len(), 1);
}

#[test]
fn test_tip_total_and_count_aggregate() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();
    let token_id = create_token(&env, &admin, &from, 10_000);

    client.send_tip(&token_id, &from, &to, &50, &Symbol::new(&env, ""));
    client.send_tip(&token_id, &from, &to, &75, &Symbol::new(&env, ""));
    client.send_tip(&token_id, &from, &to, &25, &Symbol::new(&env, ""));

    assert_eq!(client.get_tip_total(&to), 150);
    assert_eq!(client.get_tip_count(&to), 3);
}

// ─── Receipt Flow ────────────────────────────────────────────────────────────

#[test]
fn test_mint_receipt() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    env.mock_all_auths();

    let memo = Symbol::new(&env, "Rent");
    let idx = client.mint_receipt(&payer, &payee, &1_500, &memo);
    assert_eq!(idx, 0);

    let receipt = client.get_receipt(&payer, &0);
    assert_eq!(receipt.amount, 1_500);
    assert_eq!(receipt.memo, memo);
    assert_eq!(receipt.from, payer);
    assert_eq!(receipt.to, payee);
}

#[test]
fn test_get_receipt_not_found() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let payer = Address::generate(&env);
    let result = client.try_get_receipt(&payer, &999);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::NotFound);
}

#[test]
fn test_verify_receipt() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    env.mock_all_auths();
    let memo = Symbol::new(&env, "memo");
    client.mint_receipt(&payer, &payee, &500, &memo);

    assert!(client.verify_receipt(&payer, &0, &500, &memo));
    assert!(!client.verify_receipt(&payer, &0, &999, &memo));
    assert!(!client.verify_receipt(&payer, &999, &500, &memo));
}

#[test]
fn test_generate_receipt_proof() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    env.mock_all_auths();
    let memo = Symbol::new(&env, "proof_test");
    client.mint_receipt(&payer, &payee, &1_000, &memo);

    let proof = client.generate_receipt_proof(&payer, &0);
    assert_eq!(proof.receipt_index, 0);
    assert_eq!(proof.payer, payer);
    assert_eq!(proof.expected_amount, 1_000);
    assert_eq!(proof.expected_memo, memo);
}

#[test]
fn test_mint_receipt_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    env.mock_all_auths();
    client.mint_receipt(&payer, &payee, &500, &Symbol::new(&env, "e"));

    let events = env.events().all().filter_by_contract(&contract_id);
    let raw = events.events();
    assert_eq!(raw.len(), 1);
}

#[test]
fn test_get_receipt_count() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    env.mock_all_auths();

    assert_eq!(client.get_receipt_count(&payer), 0);
    client.mint_receipt(&payer, &payee, &100, &Symbol::new(&env, "a"));
    client.mint_receipt(&payer, &payee, &200, &Symbol::new(&env, "b"));
    assert_eq!(client.get_receipt_count(&payer), 2);
}

// ─── Escrow Flow ─────────────────────────────────────────────────────────────

#[test]
fn test_create_escrow() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 5_000);
    let release = env.ledger().sequence() + 100;
    let memo = Symbol::new(&env, "deposit");
    let id = client.create_escrow(&token_id, &from, &to, &2_000, &release, &memo);
    assert_eq!(id, 0);

    let escrow = client.get_escrow(&id);
    assert_eq!(escrow.from, from);
    assert_eq!(escrow.to, to);
    assert_eq!(escrow.amount, 2_000);
    assert_eq!(escrow.status, EscrowStatus::Pending);
}

#[test]
fn test_get_escrow_not_found() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let result = client.try_get_escrow(&999);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::NotFound);
}

#[test]
fn test_claim_escrow_after_release() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 5_000);
    let release = env.ledger().sequence() + 1;
    let id = client.create_escrow(
        &token_id,
        &from,
        &to,
        &2_000,
        &release,
        &Symbol::new(&env, "deposit"),
    );

    advance_ledger(&env, release + 1);
    client.claim_escrow(&id);

    let escrow = client.get_escrow(&id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert_eq!(client.get_escrow_count(), 1);
}

#[test]
fn test_claim_escrow_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 5_000);
    let release = env.ledger().sequence() + 1;
    let id = client.create_escrow(
        &token_id,
        &from,
        &to,
        &2_000,
        &release,
        &Symbol::new(&env, "deposit"),
    );
    advance_ledger(&env, release + 1);
    client.claim_escrow(&id);

    let events = env.events().all().filter_by_contract(&contract_id);
    assert_eq!(events.events().len(), 1);
}

#[test]
fn test_cancel_escrow_before_release() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 5_000);
    let release = env.ledger().sequence() + 100;
    let id = client.create_escrow(
        &token_id,
        &from,
        &to,
        &2_000,
        &release,
        &Symbol::new(&env, "deposit"),
    );

    client.cancel_escrow(&id);
    let escrow = client.get_escrow(&id);
    assert_eq!(escrow.status, EscrowStatus::Cancelled);
}

#[test]
fn test_cancel_escrow_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 5_000);
    let release = env.ledger().sequence() + 100;
    let id = client.create_escrow(
        &token_id,
        &from,
        &to,
        &2_000,
        &release,
        &Symbol::new(&env, "deposit"),
    );
    client.cancel_escrow(&id);

    let events = env.events().all().filter_by_contract(&contract_id);
    assert_eq!(events.events().len(), 1);
}

#[test]
fn test_create_escrow_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 5_000);
    let release = env.ledger().sequence() + 100;
    client.create_escrow(
        &token_id,
        &from,
        &to,
        &2_000,
        &release,
        &Symbol::new(&env, "deposit"),
    );

    let events = env.events().all().filter_by_contract(&contract_id);
    assert_eq!(events.events().len(), 1);
}

#[test]
fn test_get_user_escrows() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 10_000);
    let release = env.ledger().sequence() + 100;
    let id = client.create_escrow(
        &token_id,
        &from,
        &to,
        &1_000,
        &release,
        &Symbol::new(&env, ""),
    );
    let ids = client.get_user_escrows(&to);
    assert_eq!(ids.len(), 1);
    assert_eq!(ids.get(0).unwrap(), id);
}

#[test]
fn test_claim_escrow_partial() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 5_000);
    let release = env.ledger().sequence() + 1;
    let id = client.create_escrow(
        &token_id,
        &from,
        &to,
        &2_000,
        &release,
        &Symbol::new(&env, ""),
    );
    advance_ledger(&env, release + 1);

    let remaining = client.claim_escrow_partial(&id, &500);
    assert_eq!(remaining, 1_500);
    let escrow = client.get_escrow(&id);
    assert_eq!(escrow.amount, 1_500);
    assert_eq!(escrow.status, EscrowStatus::Pending);
}

// ─── Stream Flow ─────────────────────────────────────────────────────────────

#[test]
fn test_open_stream() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &payer, 5_000);
    let sid = client.open_stream(&token_id, &payer, &recipient, &10, &1_000);
    assert_eq!(sid, 0);

    let stream = client.get_stream(&sid);
    assert_eq!(stream.payer, payer);
    assert_eq!(stream.recipient, recipient);
    assert_eq!(stream.rate_per_ledger, 10);
    assert_eq!(stream.deposited, 1_000);
    assert!(!stream.closed);
}

#[test]
fn test_get_stream_not_found() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let result = client.try_get_stream(&999);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::NotFound);
}

#[test]
fn test_claim_stream() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &payer, 5_000);
    let sid = client.open_stream(&token_id, &payer, &recipient, &100, &1_000);

    advance_ledger(&env, env.ledger().sequence() + 5);
    let claimed = client.claim_stream(&sid, &recipient);
    assert_eq!(claimed, 500);

    let stream = client.get_stream(&sid);
    assert_eq!(stream.claimed, 500);
}

#[test]
fn test_claim_stream_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &payer, 5_000);
    let sid = client.open_stream(&token_id, &payer, &recipient, &100, &1_000);
    advance_ledger(&env, env.ledger().sequence() + 5);
    client.claim_stream(&sid, &recipient);

    let events = env.events().all().filter_by_contract(&contract_id);
    assert_eq!(events.events().len(), 1);
}

#[test]
fn test_close_stream() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &payer, 5_000);
    let sid = client.open_stream(&token_id, &payer, &recipient, &100, &500);

    advance_ledger(&env, env.ledger().sequence() + 2);
    let refund = client.close_stream(&sid, &payer);

    let stream = client.get_stream(&sid);
    assert!(stream.closed);
    assert!(refund >= 0);
}

#[test]
fn test_close_stream_emits_events() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &payer, 5_000);
    let sid = client.open_stream(&token_id, &payer, &recipient, &100, &500);
    advance_ledger(&env, env.ledger().sequence() + 2);
    client.close_stream(&sid, &payer);

    let events = env.events().all().filter_by_contract(&contract_id);
    assert_eq!(events.events().len(), 2);
}

#[test]
fn test_top_up_stream() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &payer, 10_000);
    let sid = client.open_stream(&token_id, &payer, &recipient, &10, &500);
    client.top_up_stream(&sid, &payer, &300);

    let stream = client.get_stream(&sid);
    assert_eq!(stream.deposited, 800);
}

#[test]
fn test_open_stream_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &payer, 5_000);
    client.open_stream(&token_id, &payer, &recipient, &10, &1_000);

    let events = env.events().all().filter_by_contract(&contract_id);
    assert_eq!(events.events().len(), 1);
}

#[test]
fn test_stream_count() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &payer, 10_000);
    client.open_stream(&token_id, &payer, &recipient, &10, &500);
    client.open_stream(&token_id, &payer, &recipient, &20, &1_000);

    assert_eq!(client.get_stream_count(), 2);
}

#[test]
fn test_list_streams_by_payer() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &payer, 10_000);
    client.open_stream(&token_id, &payer, &recipient, &10, &500);
    client.open_stream(&token_id, &payer, &recipient, &20, &1_000);

    let streams = client.list_streams_by_payer(&payer, &0, &10);
    assert_eq!(streams.len(), 2);
}

// ─── MultiSig Flow ───────────────────────────────────────────────────────────

#[test]
fn test_create_multisig() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &proposer, 5_000);
    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    signers.push_back(s2.clone());
    let expiry = env.ledger().sequence() + 1000;

    let pid = client.create_multisig(
        &token_id, &proposer, &recipient, &2_000, &2, &signers, &expiry,
    );
    assert_eq!(pid, 0);

    let proposal = client.get_multisig(&pid);
    assert_eq!(proposal.proposer, proposer);
    assert_eq!(proposal.recipient, recipient);
    assert_eq!(proposal.amount, 2_000);
    assert_eq!(proposal.threshold, 2);
    assert_eq!(proposal.approvals.len(), 0);
}

#[test]
fn test_get_multisig_not_found() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let result = client.try_get_multisig(&999);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::NotFound);
}

#[test]
fn test_approve_multisig_executes_when_threshold_met() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let s1 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &proposer, 5_000);
    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    let expiry = env.ledger().sequence() + 1000;

    let pid = client.create_multisig(
        &token_id, &proposer, &recipient, &2_000, &1, &signers, &expiry,
    );

    client.approve_multisig(&pid, &s1);

    let proposal = client.get_multisig(&pid);
    assert_eq!(proposal.status, MultiSigStatus::Executed);
}

#[test]
fn test_approve_multisig_already_signed_fails() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let s1 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &proposer, 5_000);
    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    let expiry = env.ledger().sequence() + 1000;

    let pid = client.create_multisig(
        &token_id, &proposer, &recipient, &2_000, &1, &signers, &expiry,
    );
    client.approve_multisig(&pid, &s1);
    let result = client.try_approve_multisig(&pid, &s1);
    assert!(result.is_err());
}

#[test]
fn test_approve_multisig_emits_events() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let s1 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &proposer, 5_000);
    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    let expiry = env.ledger().sequence() + 1000;

    let pid = client.create_multisig(
        &token_id, &proposer, &recipient, &2_000, &1, &signers, &expiry,
    );
    client.approve_multisig(&pid, &s1);

    // approve triggers both "multisig_approve" and "multisig_executed"
    let events = env.events().all().filter_by_contract(&contract_id);
    assert_eq!(events.events().len(), 2);
}

#[test]
fn test_approve_multisig_event_reports_actual_count() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &proposer, 5_000);
    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    signers.push_back(s2.clone());
    let expiry = env.ledger().sequence() + 1000;

    let pid = client.create_multisig(
        &token_id, &proposer, &recipient, &2_000, &2, &signers, &expiry,
    );
    client.approve_multisig(&pid, &s1);

    let events = env.events().all().filter_by_contract(&contract_id);
    let expected: Vec<(Address, Vec<Val>, Val)> = Vec::from_array(
        &env,
        [(
            contract_id.clone(),
            (Symbol::new(&env, "multisig_approved"), pid).into_val(&env),
            (s1, 1u32, 2u32).into_val(&env),
        )],
    );
    assert_eq!(events, expected);
}

#[test]
fn test_create_multisig_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let s1 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &proposer, 5_000);
    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    let expiry = env.ledger().sequence() + 1000;
    client.create_multisig(
        &token_id, &proposer, &recipient, &2_000, &1, &signers, &expiry,
    );

    let events = env.events().all().filter_by_contract(&contract_id);
    assert_eq!(events.events().len(), 1);
}

#[test]
fn test_multisig_count() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let s1 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &proposer, 10_000);
    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    let expiry = env.ledger().sequence() + 1000;

    client.create_multisig(
        &token_id, &proposer, &recipient, &1_000, &1, &signers, &expiry,
    );
    client.create_multisig(
        &token_id, &proposer, &recipient, &2_000, &1, &signers, &expiry,
    );

    assert_eq!(client.get_multisig_count(), 2);
}

#[test]
fn test_cancel_multisig() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let s1 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &proposer, 5_000);
    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    let expiry = env.ledger().sequence() + 1000;

    let pid = client.create_multisig(
        &token_id, &proposer, &recipient, &2_000, &1, &signers, &expiry,
    );
    client.cancel_multisig(&pid, &proposer);

    let proposal = client.get_multisig(&pid);
    assert_eq!(proposal.status, MultiSigStatus::Cancelled);
}

#[test]
fn test_cancel_multisig_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let s1 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &proposer, 5_000);
    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    let expiry = env.ledger().sequence() + 1000;

    let pid = client.create_multisig(
        &token_id, &proposer, &recipient, &2_000, &1, &signers, &expiry,
    );
    client.cancel_multisig(&pid, &proposer);

    let events = env.events().all().filter_by_contract(&contract_id);
    assert_eq!(events.events().len(), 1);
}

// ─── Batch Send ──────────────────────────────────────────────────────────────

#[test]
fn test_batch_send() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to1 = Address::generate(&env);
    let to2 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 2_000);
    let mut recipients = Vec::new(&env);
    recipients.push_back(to1.clone());
    recipients.push_back(to2.clone());
    let mut amounts = Vec::new(&env);
    amounts.push_back(300i128);
    amounts.push_back(200i128);
    let mut memos = Vec::new(&env);
    memos.push_back(Symbol::new(&env, "m1"));
    memos.push_back(Symbol::new(&env, "m2"));

    client.batch_send(&token_id, &from, &recipients, &amounts, &memos);

    assert_eq!(client.get_tip_total(&to1), 300);
    assert_eq!(client.get_tip_total(&to2), 200);
}

#[test]
fn test_batch_send_length_mismatch() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 1_000);
    let mut recipients = Vec::new(&env);
    recipients.push_back(to);
    let mut amounts = Vec::new(&env);
    amounts.push_back(100i128);
    amounts.push_back(200i128);
    let memos = Vec::new(&env);

    let result = client.try_batch_send(&token_id, &from, &recipients, &amounts, &memos);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::LengthMismatch);
}

#[test]
fn test_batch_send_emits_events() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to1 = Address::generate(&env);
    let to2 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 2_000);
    let mut recipients = Vec::new(&env);
    recipients.push_back(to1.clone());
    recipients.push_back(to2.clone());
    let mut amounts = Vec::new(&env);
    amounts.push_back(300i128);
    amounts.push_back(200i128);
    let mut memos = Vec::new(&env);
    memos.push_back(Symbol::new(&env, "m1"));
    memos.push_back(Symbol::new(&env, "m2"));

    client.batch_send(&token_id, &from, &recipients, &amounts, &memos);

    // batch_send emits per-recipient + one batch_sent event
    let events = env.events().all().filter_by_contract(&contract_id);
    assert_eq!(events.events().len(), 3);
}

#[test]
fn test_batch_send_too_large() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 100_000);
    let mut recipients = Vec::new(&env);
    let mut amounts = Vec::new(&env);
    let mut memos = Vec::new(&env);
    for _ in 0..51 {
        recipients.push_back(Address::generate(&env));
        amounts.push_back(100i128);
        memos.push_back(Symbol::new(&env, ""));
    }

    let result = client.try_batch_send(&token_id, &from, &recipients, &amounts, &memos);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::BatchTooLarge);
}

// ─── View Functions ─────────────────────────────────────────────────────────

#[test]
fn test_view_functions_return_not_found() {
    let env = Env::default();
    let (_, client) = deploy(&env);

    assert_eq!(
        client.try_get_stream(&999).unwrap_err().unwrap(),
        ContractError::NotFound
    );
    assert_eq!(
        client.try_get_escrow(&999).unwrap_err().unwrap(),
        ContractError::NotFound
    );
    assert_eq!(
        client.try_get_multisig(&999).unwrap_err().unwrap(),
        ContractError::NotFound
    );

    let payer = Address::generate(&env);
    assert_eq!(
        client.try_get_receipt(&payer, &999).unwrap_err().unwrap(),
        ContractError::NotFound
    );
}

#[test]
fn test_view_functions_return_correct_data() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let payer = Address::generate(&env);
    let s1 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 10_000);

    let sid = client.open_stream(&token_id, &from, &to, &10, &500);
    let stream = client.get_stream(&sid);
    assert_eq!(stream.id, sid);
    assert_eq!(stream.payer, from);

    let release = env.ledger().sequence() + 100;
    let eid = client.create_escrow(
        &token_id,
        &from,
        &to,
        &1_000,
        &release,
        &Symbol::new(&env, "v"),
    );
    let escrow = client.get_escrow(&eid);
    assert_eq!(escrow.id, eid);
    assert_eq!(escrow.amount, 1_000);

    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    let expiry = env.ledger().sequence() + 1000;
    let pid = client.create_multisig(&token_id, &from, &to, &2_000, &1, &signers, &expiry);
    let proposal = client.get_multisig(&pid);
    assert_eq!(proposal.id, pid);
    assert_eq!(proposal.amount, 2_000);

    let idx = client.mint_receipt(&payer, &to, &500, &Symbol::new(&env, "r"));
    let receipt = client.get_receipt(&payer, &idx);
    assert_eq!(receipt.amount, 500);
}

// ─── Contract Stats ──────────────────────────────────────────────────────────

#[test]
fn test_get_contract_stats() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let s1 = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &from, 10_000);

    let release = env.ledger().sequence() + 100;
    client.create_escrow(
        &token_id,
        &from,
        &to,
        &1_000,
        &release,
        &Symbol::new(&env, ""),
    );
    client.open_stream(&token_id, &from, &to, &10, &500);

    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    let expiry = env.ledger().sequence() + 1000;
    client.create_multisig(&token_id, &from, &to, &1_000, &1, &signers, &expiry);

    let (escrows, streams, multisigs) = client.get_contract_stats();
    assert_eq!(escrows, 1);
    assert_eq!(streams, 1);
    assert_eq!(multisigs, 1);
}

// ─── Paused State Blocks Mutations ─────────────────────────────────────────

#[test]
fn test_paused_blocks_escrow_create() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    env.mock_all_auths();
    pause_contract(&env, &client);

    let result = client.try_create_escrow(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &1_000,
        &(env.ledger().sequence() + 100),
        &Symbol::new(&env, ""),
    );
    assert!(result.is_err());
}

#[test]
fn test_paused_blocks_open_stream() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    env.mock_all_auths();
    pause_contract(&env, &client);

    let result = client.try_open_stream(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &10,
        &500,
    );
    assert!(result.is_err());
}

#[test]
fn test_paused_blocks_create_multisig() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    env.mock_all_auths();
    pause_contract(&env, &client);

    let mut signers = Vec::new(&env);
    signers.push_back(Address::generate(&env));
    let result = client.try_create_multisig(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &1_000,
        &1,
        &signers,
        &(env.ledger().sequence() + 1000),
    );
    assert!(result.is_err());
}

#[test]
fn test_paused_does_not_block_view_functions() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();
    pause_contract(&env, &client);

    let result = client.try_get_stream(&999);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::NotFound);

    assert!(client.is_paused());
    assert_eq!(client.get_admin(), admin);
}

// ─── Vesting Schedule ────────────────────────────────────────────────────────

#[test]
fn test_create_vesting() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &funder, 10_000);
    let cliff = env.ledger().sequence() + 100;
    let end = cliff + 1000;
    let vid = client.create_vesting(&token_id, &funder, &beneficiary, &5_000, &cliff, &end);
    assert_eq!(vid, 0);

    let schedule = client.get_vesting(&vid);
    assert_eq!(schedule.funder, funder);
    assert_eq!(schedule.beneficiary, beneficiary);
    assert_eq!(schedule.total_amount, 5_000);
}

#[test]
fn test_create_vesting_rejects_current_or_past_end_ledger() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &funder, 10_000);
    advance_ledger(&env, 100);
    let cliff = 50u32;
    let current_end = env.ledger().sequence();
    let past_end = current_end - 1;

    assert!(client
        .try_create_vesting(
            &token_id,
            &funder,
            &beneficiary,
            &5_000,
            &cliff,
            &current_end,
        )
        .is_err());
    assert!(client
        .try_create_vesting(&token_id, &funder, &beneficiary, &5_000, &cliff, &past_end,)
        .is_err());
}

#[test]
fn test_claim_vesting_after_cliff() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &funder, 10_000);
    let cliff = env.ledger().sequence() + 10;
    let end = cliff + 100;
    let vid = client.create_vesting(&token_id, &funder, &beneficiary, &5_000, &cliff, &end);

    advance_ledger(&env, cliff + 50);
    let claimed = client.claim_vesting(&vid, &beneficiary);
    assert!(claimed > 0);

    let schedule = client.get_vesting(&vid);
    assert_eq!(schedule.claimed, claimed);
}

#[test]
fn test_revoke_vesting_before_cliff() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    env.mock_all_auths();

    let token_id = create_token(&env, &admin, &funder, 10_000);
    let cliff = env.ledger().sequence() + 100;
    let end = cliff + 1000;
    let vid = client.create_vesting(&token_id, &funder, &beneficiary, &5_000, &cliff, &end);

    client.revoke_vesting(&vid, &admin);
    let schedule = client.get_vesting(&vid);
    assert!(schedule.revoked);
}

// ─── Emergency Withdrawal ────────────────────────────────────────────────────

#[test]
fn test_initiate_emergency_withdrawal() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let signer2 = Address::generate(&env);
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer2.clone());
    // Rotate to a 2-of-2 signer set via the multi-sig path (threshold-1 deploy
    // auto-executes on propose).
    let data: Vec<Val> = Vec::from_array(&env, [signers.into_val(&env), 2u32.into_val(&env)]);
    client.propose_admin_action(&admin, &Symbol::new(&env, "set_admin_signers"), &data);

    let token_id = create_token(&env, &admin, &contract_id, 5_000);

    // Need to wrap in a contract context to get the contract balance
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &2_000, &admin);
    assert_eq!(wid, 0);

    let withdrawal = client.get_emergency_withdrawal(&wid);
    assert_eq!(withdrawal.amount, 2_000);
    assert_eq!(withdrawal.initiator, admin);
}

#[test]
fn test_approve_emergency_withdrawal() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let signer2 = Address::generate(&env);
    env.mock_all_auths();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer2.clone());
    // Rotate to a 2-of-2 signer set via the multi-sig path (threshold-1 deploy
    // auto-executes on propose).
    let data: Vec<Val> = Vec::from_array(&env, [signers.into_val(&env), 2u32.into_val(&env)]);
    client.propose_admin_action(&admin, &Symbol::new(&env, "set_admin_signers"), &data);

    let token_id = create_token(&env, &admin, &contract_id, 5_000);
    let wid = client.initiate_emergency_withdrawal(&admin, &token_id, &2_000, &admin);

    client.approve_emergency_withdrawal(&wid, &signer2);
    let withdrawal = client.get_emergency_withdrawal(&wid);
    assert_eq!(withdrawal.approvals.len(), 1);
}

// ─── Dispute Resolution ────────────────────────────────────────────────────

#[test]
fn test_resolve_dispute_release_twice_fails() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    env.mock_all_auths();

    client.add_arbitrator(&admin, &arbitrator);

    let token_id = create_token(&env, &admin, &from, 5_000);
    let release = env.ledger().sequence() + 100;

    let eid = client.create_disputable_escrow(&token_id, &from, &to, &2_000, &release, &arbitrator);

    client.raise_dispute(&eid, &from);

    let release_sym = Symbol::new(&env, "release");
    client.resolve_dispute(&eid, &arbitrator, &release_sym, &to, &2_000);

    let result = client.try_resolve_dispute(&eid, &arbitrator, &release_sym, &to, &2_000);
    assert!(result.is_err());
}

#[test]
fn test_resolve_dispute_refund_twice_fails() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    env.mock_all_auths();

    client.add_arbitrator(&admin, &arbitrator);

    let token_id = create_token(&env, &admin, &from, 5_000);
    let release = env.ledger().sequence() + 100;

    let eid = client.create_disputable_escrow(&token_id, &from, &to, &2_000, &release, &arbitrator);

    client.raise_dispute(&eid, &from);

    let refund_sym = Symbol::new(&env, "refund");
    client.resolve_dispute(&eid, &arbitrator, &refund_sym, &to, &0);

    let result = client.try_resolve_dispute(&eid, &arbitrator, &refund_sym, &to, &0);
    assert!(result.is_err());
}

#[test]
fn test_resolve_dispute_split_twice_fails() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    env.mock_all_auths();

    client.add_arbitrator(&admin, &arbitrator);

    let token_id = create_token(&env, &admin, &from, 5_000);
    let release = env.ledger().sequence() + 100;

    let eid = client.create_disputable_escrow(&token_id, &from, &to, &2_000, &release, &arbitrator);

    client.raise_dispute(&eid, &from);

    let split_sym = Symbol::new(&env, "split");
    client.resolve_dispute(&eid, &arbitrator, &split_sym, &to, &1_000);

    let result = client.try_resolve_dispute(&eid, &arbitrator, &split_sym, &to, &1_000);
    assert!(result.is_err());
}

#[test]
fn test_resolve_dispute_state_and_token_checks() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    env.mock_all_auths();

    client.add_arbitrator(&admin, &arbitrator);

    let token_id = create_token(&env, &admin, &from, 10_000);
    let release = env.ledger().sequence() + 100;

    let eid = client.create_disputable_escrow(&token_id, &from, &to, &2_000, &release, &arbitrator);

    client.create_escrow(
        &token_id,
        &from,
        &to,
        &5_000,
        &release,
        &Symbol::new(&env, ""),
    );

    let sac_client = token::Client::new(&env, &token_id);
    let contract_bal_before = sac_client.balance(&contract_id);

    client.raise_dispute(&eid, &from);

    let split_sym = Symbol::new(&env, "split");
    client.resolve_dispute(&eid, &arbitrator, &split_sym, &to, &1_000);

    let contract_bal_mid = sac_client.balance(&contract_id);
    assert_eq!(contract_bal_mid, contract_bal_before - 2_000);

    let escrow = client.get_escrow(&eid);
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert_eq!(escrow.disputed, false);

    let result = client.try_resolve_dispute(&eid, &arbitrator, &split_sym, &to, &1_000);
    assert!(result.is_err());

    let contract_bal_after = sac_client.balance(&contract_id);
    assert_eq!(contract_bal_after, contract_bal_mid);
}
