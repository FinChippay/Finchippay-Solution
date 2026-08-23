#![cfg(test)]

//! Cross-contract composability tests for `FinchippayContract`.
//!
//! These integration tests verify that FinchippayContract composes correctly
//! with real Stellar Asset Contract (SAC) tokens and with hypothetical external
//! contracts:
//!
//! 1. **SAC token integration** — deploy a real SAC, lock tokens in an escrow,
//!    and claim them out again.
//! 2. **Multi-token escrow** — two independent SAC tokens escrowed in parallel
//!    keep their balances isolated.
//! 3. **Decimal edge cases** — 0-decimal (non-divisible) and 18-decimal tokens
//!    (via a mock token, since the SAC is fixed at 7 decimals) verify that
//!    amounts are handled without overflow or precision loss.
//! 4. **External caller** — a mock contract calls back into Finchippay and
//!    `require_auth` propagates through the cross-contract boundary.

use finchippay_contract::{EscrowStatus, FinchippayContract, FinchippayContractClient};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger as _},
    token, Address, Env, MuxedAddress, Symbol, Vec,
};

// ─── Mock external caller ─────────────────────────────────────────────────────

/// A minimal external contract that calls back into `FinchippayContract`,
/// used to verify that `require_auth` on the `from` address propagates through
/// the cross-contract call boundary.
#[contract]
pub struct ExternalCaller;

#[contractimpl]
impl ExternalCaller {
    pub fn call_finchippay_send_tip(
        env: Env,
        finchippay: Address,
        token_address: Address,
        from: Address,
        to: Address,
        amount: i128,
        memo: Symbol,
    ) {
        FinchippayContractClient::new(&env, &finchippay)
            .send_tip(&token_address, &from, &to, &amount, &memo);
    }
}

// ─── Mock token (configurable decimals) ──────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum MockTokenDataKey {
    Admin,
    Decimals,
    Balance(Address),
}

/// Minimal SEP-41-style token used to exercise decimal edge cases that the
/// Stellar Asset Contract cannot represent (the SAC is fixed at 7 decimals).
///
/// It implements exactly the subset of the token interface that
/// `token::Client` (and therefore FinchippayContract) depends on:
/// `transfer`, `balance`, and `decimals`, plus an admin-gated `mint`.
#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn initialize(env: Env, admin: Address, decimals: u32) {
        env.storage()
            .persistent()
            .set(&MockTokenDataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&MockTokenDataKey::Decimals, &decimals);
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&MockTokenDataKey::Decimals)
            .unwrap_or(7)
    }

    pub fn mint(env: Env, admin: Address, to: Address, amount: i128) {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .persistent()
            .get(&MockTokenDataKey::Admin)
            .expect("token not initialized");
        if admin != stored {
            panic!("only the token admin can mint");
        }
        let key = MockTokenDataKey::Balance(to);
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&key, &(balance.checked_add(amount).expect("overflow")));
    }

    pub fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let to_addr = to.address();
        if from == to_addr {
            return;
        }
        let from_key = MockTokenDataKey::Balance(from);
        let to_key = MockTokenDataKey::Balance(to_addr);
        let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        if from_balance < amount {
            panic!("insufficient balance");
        }
        let to_balance: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&from_key, &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&to_key, &(to_balance.checked_add(amount).expect("overflow")));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&MockTokenDataKey::Balance(id))
            .unwrap_or(0)
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn deploy_finchippay(env: &Env) -> (Address, FinchippayContractClient<'_>) {
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let signers = Vec::from_array(env, [admin.clone()]);
    client.initialize(&signers, &1);
    (id, client)
}

fn create_sac_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let sac_client = token::StellarAssetClient::new(env, &token_id);
    sac_client.mint(to, &amount);
    token_id
}

fn create_mock_token(env: &Env, admin: &Address, decimals: u32) -> Address {
    let id = env.register(MockToken, ());
    MockTokenClient::new(env, &id).initialize(admin, &decimals);
    id
}

fn mint_mock_token(env: &Env, token_id: &Address, admin: &Address, to: &Address, amount: i128) {
    MockTokenClient::new(env, token_id).mint(admin, to, &amount);
}

fn advance_ledger(env: &Env, to: u32) {
    env.ledger().with_mut(|l| l.sequence_number = to);
}

// ─── Test 1: SAC token integration ───────────────────────────────────────────

#[test]
fn test_sac_token_integration() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client) = deploy_finchippay(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    let token_id = create_sac_token(&env, &admin, &from, 5_000);
    let sac = token::Client::new(&env, &token_id);

    let release = env.ledger().sequence() + 100;
    let escrow_id = client.create_escrow(
        &token_id,
        &from,
        &to,
        &2_000,
        &release,
        &Symbol::new(&env, "deposit"),
    );
    assert_eq!(escrow_id, 0);

    // Funds are held by the contract itself while the escrow is pending.
    assert_eq!(sac.balance(&contract_id), 2_000);
    assert_eq!(sac.balance(&from), 3_000);

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Pending);
    assert_eq!(escrow.amount, 2_000);

    // Claim triggers a contract -> SAC transfer to the recipient.
    advance_ledger(&env, release + 1);
    client.claim_escrow(&escrow_id);

    assert_eq!(sac.balance(&to), 2_000);
    assert_eq!(sac.balance(&contract_id), 0);
    assert_eq!(client.get_escrow(&escrow_id).status, EscrowStatus::Released);
}

// ─── Test 2: multi-token escrow ──────────────────────────────────────────────

#[test]
fn test_multi_token_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client) = deploy_finchippay(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    let token_a = create_sac_token(&env, &admin, &from, 10_000);
    let token_b = create_sac_token(&env, &admin, &from, 10_000);

    let sac_a = token::Client::new(&env, &token_a);
    let sac_b = token::Client::new(&env, &token_b);

    let release = env.ledger().sequence() + 100;
    let escrow_a = client.create_escrow(
        &token_a,
        &from,
        &to,
        &1_000,
        &release,
        &Symbol::new(&env, "a"),
    );
    let escrow_b = client.create_escrow(
        &token_b,
        &from,
        &to,
        &2_500,
        &release,
        &Symbol::new(&env, "b"),
    );

    // Each token's balance is tracked independently — no cross-token bleed.
    assert_eq!(sac_a.balance(&contract_id), 1_000);
    assert_eq!(sac_b.balance(&contract_id), 2_500);
    assert_eq!(sac_a.balance(&from), 9_000);
    assert_eq!(sac_b.balance(&from), 7_500);

    advance_ledger(&env, release + 1);
    client.claim_escrow(&escrow_a);
    client.claim_escrow(&escrow_b);

    assert_eq!(sac_a.balance(&to), 1_000);
    assert_eq!(sac_b.balance(&to), 2_500);
    assert_eq!(sac_a.balance(&contract_id), 0);
    assert_eq!(sac_b.balance(&contract_id), 0);
}

// ─── Test 3: decimal edge cases ──────────────────────────────────────────────

#[test]
fn test_decimal_edge_cases() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client) = deploy_finchippay(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let tip_to = Address::generate(&env);

    // 0-decimal (non-divisible) token: 100 base units == 100 whole tokens.
    let zero_dec = create_mock_token(&env, &admin, 0);
    mint_mock_token(&env, &zero_dec, &admin, &from, 1_000);
    assert_eq!(token::Client::new(&env, &zero_dec).decimals(), 0);

    client.send_tip(&zero_dec, &from, &tip_to, &100, &Symbol::new(&env, "integer"));
    assert_eq!(token::Client::new(&env, &zero_dec).balance(&tip_to), 100);
    assert_eq!(client.get_tip_total(&tip_to), 100);

    // 18-decimal token: 10^18 base units == 1.0 whole token, and exactly the
    // contract's MAX_ESCROW_AMOUNT. Must not overflow or lose precision.
    let escrow_to = Address::generate(&env);
    let eighteen_dec = create_mock_token(&env, &admin, 18);
    mint_mock_token(
        &env,
        &eighteen_dec,
        &admin,
        &from,
        1_000_000_000_000_000_000i128,
    );
    assert_eq!(token::Client::new(&env, &eighteen_dec).decimals(), 18);

    let release = env.ledger().sequence() + 100;
    let escrow_id = client.create_escrow(
        &eighteen_dec,
        &from,
        &escrow_to,
        &1_000_000_000_000_000_000i128,
        &release,
        &Symbol::new(&env, "18dec"),
    );
    assert_eq!(
        token::Client::new(&env, &eighteen_dec).balance(&contract_id),
        1_000_000_000_000_000_000i128
    );

    advance_ledger(&env, release + 1);
    client.claim_escrow(&escrow_id);

    assert_eq!(
        token::Client::new(&env, &eighteen_dec).balance(&escrow_to),
        1_000_000_000_000_000_000i128
    );
    assert_eq!(client.get_escrow(&escrow_id).status, EscrowStatus::Released);
}

// ─── Test 4: external caller require_auth propagation ────────────────────────

#[test]
fn test_external_caller_auth_propagation() {
    let env = Env::default();

    let (contract_id, client) = deploy_finchippay(&env);
    let admin = client.get_admin();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    // Deploy + fund (minting the SAC requires the admin's auth).
    env.mock_all_auths();
    let token_id = create_sac_token(&env, &admin, &from, 1_000);

    let caller_id = env.register(ExternalCaller, ());
    let caller = ExternalCallerClient::new(&env, &caller_id);

    let amount = 100i128;
    let memo = Symbol::new(&env, "via-external");

    // Negative: with no authorizations set, the cross-contract call must fail
    // because Finchippay's `send_tip` requires auth from `from`.
    env.set_auths(&[]);
    let result = caller.try_call_finchippay_send_tip(
        &contract_id,
        &token_id,
        &from,
        &to,
        &amount,
        &memo,
    );
    assert!(
        result.is_err(),
        "unauthenticated cross-contract call should fail"
    );

    // Positive: once `from` is authorized (non-root, since the auth happens
    // inside Finchippay rather than the root `ExternalCaller` invocation), the
    // call succeeds end-to-end and the tokens actually move.
    env.mock_all_auths_allowing_non_root_auth();
    caller.call_finchippay_send_tip(&contract_id, &token_id, &from, &to, &amount, &memo);

    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&to), amount);
    assert_eq!(client.get_tip_total(&to), amount);

    // `require_auth` must have been recorded against `from`, proving that the
    // authorization requirement propagated across the contract boundary.
    let auths = env.auths();
    let mut saw_from = false;
    for i in 0..auths.len() {
        if auths.get(i).unwrap().0 == from {
            saw_from = true;
            break;
        }
    }
    assert!(saw_from, "require_auth should propagate to the `from` address");
}
