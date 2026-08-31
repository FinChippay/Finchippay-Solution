#![cfg(test)]

//! # Yield Escrow — Oracle-Derived Share Pricing
//!
//! Exercises `yield_escrow.rs`'s oracle integration (see `oracle.rs`):
//!
//! 1. A mock price oracle stands in for a real on-chain oracle (e.g.
//!    Reflector) and reports `(price, ledger)` for a pool's LP share value.
//! 2. `claim_yield_escrow` values `shares_received` at the oracle's current
//!    price and pays out `principal + max(0, share_value - principal)`.
//! 3. Stale oracle quotes (older than `oracle::MAX_ORACLE_AGE` ledgers) are
//!    rejected rather than used to under/over-value a claim.

use finchippay_contract::oracle::PRICE_SCALE;
use finchippay_contract::yield_escrow::YieldEscrowStatus;
use finchippay_contract::{FinchippayContract, FinchippayContractClient};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger as _},
    token, Address, Env, Symbol,
};

// ─── Mock price oracle ──────────────────────────────────────────────────────

#[contracttype]
enum MockOracleKey {
    Price,
    Ledger,
}

/// Minimal stand-in for a real Stellar/Soroban price oracle (Reflector, Band
/// Protocol, ...). Exposes `get_price(pool) -> PriceData` with the exact
/// signature `oracle::PriceOracleClient` expects, and a `set_price` setter so
/// tests can drive static, rising, falling, and stale quotes.
#[contract]
pub struct MockPriceOracle;

#[contractimpl]
impl MockPriceOracle {
    pub fn set_price(env: Env, price: i128, ledger: u32) {
        env.storage().instance().set(&MockOracleKey::Price, &price);
        env.storage()
            .instance()
            .set(&MockOracleKey::Ledger, &ledger);
    }

    pub fn get_price(env: Env, _pool: Address) -> finchippay_contract::oracle::PriceData {
        let price: i128 = env.storage().instance().get(&MockOracleKey::Price).unwrap();
        let ledger: u32 = env
            .storage()
            .instance()
            .get(&MockOracleKey::Ledger)
            .unwrap();
        finchippay_contract::oracle::PriceData { price, ledger }
    }
}

// ─── Test harness ───────────────────────────────────────────────────────────

fn deploy(env: &Env) -> (FinchippayContractClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signers = soroban_sdk::Vec::from_array(env, [admin.clone()]);
    client.initialize(&signers, &1);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();

    let oracle_id = env.register(MockPriceOracle, ());

    (client, token, oracle_id, admin)
}

fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
    let _ = admin;
    let token_admin = token::StellarAssetClient::new(env, token);
    token_admin.mint(to, &amount);
}

const AMOUNT: i128 = 1_000_000;

// ============================================================================
// Static price: yield is zero when the share price hasn't moved.
// ============================================================================

#[test]
fn claim_pays_principal_only_at_static_price() {
    let env = Env::default();
    let (client, token, oracle_id, admin) = deploy(&env);
    let oracle = MockPriceOracleClient::new(&env, &oracle_id);

    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    mint(&env, &token, &admin, &funder, AMOUNT);

    let current_ledger = env.ledger().sequence();
    oracle.set_price(&PRICE_SCALE, &current_ledger);

    let release_ledger = current_ledger + 100;
    let memo = Symbol::new(&env, "test");
    let id = client.create_yield_escrow(
        &token,
        &token,
        &oracle_id,
        &funder,
        &beneficiary,
        &AMOUNT,
        &release_ledger,
        &memo,
    );

    env.ledger()
        .with_mut(|li| li.sequence_number = release_ledger);
    oracle.set_price(&PRICE_SCALE, &release_ledger);

    let payout = client.claim_yield_escrow(&id);
    assert_eq!(payout, AMOUNT);

    let escrow = client.get_yield_escrow(&id);
    assert_eq!(escrow.status, YieldEscrowStatus::Claimed);
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&beneficiary), AMOUNT);
}

// ============================================================================
// Rising price: yield is paid out on top of principal.
// ============================================================================

#[test]
fn claim_pays_out_positive_yield_on_rising_price() {
    let env = Env::default();
    let (client, token, oracle_id, admin) = deploy(&env);
    let oracle = MockPriceOracleClient::new(&env, &oracle_id);

    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    // The contract only ever moves tokens it holds; fund it with enough to
    // cover the simulated yield on top of the escrowed principal (stands in
    // for the extra tokens a real AMM withdrawal would return).
    mint(&env, &token, &admin, &funder, AMOUNT * 2);

    let current_ledger = env.ledger().sequence();
    oracle.set_price(&PRICE_SCALE, &current_ledger);

    let release_ledger = current_ledger + 100;
    let memo = Symbol::new(&env, "test");
    let id = client.create_yield_escrow(
        &token,
        &token,
        &oracle_id,
        &funder,
        &beneficiary,
        &AMOUNT,
        &release_ledger,
        &memo,
    );

    // Simulate the pool's LP shares appreciating 50% by claim time, and top
    // up the contract's balance to represent the (not-yet-implemented) real
    // pool withdrawal returning the appreciated value.
    let risen_price = PRICE_SCALE + PRICE_SCALE / 2; // 1.5x
    env.ledger()
        .with_mut(|li| li.sequence_number = release_ledger);
    oracle.set_price(&risen_price, &release_ledger);

    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&client.address, &(AMOUNT / 2));

    let payout = client.claim_yield_escrow(&id);
    assert_eq!(payout, AMOUNT + AMOUNT / 2);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&beneficiary), AMOUNT + AMOUNT / 2);
}

// ============================================================================
// Falling price: yield never goes negative; beneficiary still gets principal.
// ============================================================================

#[test]
fn claim_never_pays_less_than_principal_on_falling_price() {
    let env = Env::default();
    let (client, token, oracle_id, admin) = deploy(&env);
    let oracle = MockPriceOracleClient::new(&env, &oracle_id);

    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    mint(&env, &token, &admin, &funder, AMOUNT);

    let current_ledger = env.ledger().sequence();
    oracle.set_price(&PRICE_SCALE, &current_ledger);

    let release_ledger = current_ledger + 100;
    let memo = Symbol::new(&env, "test");
    let id = client.create_yield_escrow(
        &token,
        &token,
        &oracle_id,
        &funder,
        &beneficiary,
        &AMOUNT,
        &release_ledger,
        &memo,
    );

    // Pool share price halves by claim time.
    let fallen_price = PRICE_SCALE / 2;
    env.ledger()
        .with_mut(|li| li.sequence_number = release_ledger);
    oracle.set_price(&fallen_price, &release_ledger);

    let payout = client.claim_yield_escrow(&id);
    assert_eq!(
        payout, AMOUNT,
        "principal must never be reduced by a falling price"
    );

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&beneficiary), AMOUNT);
}

// ============================================================================
// Staleness: a quote older than MAX_ORACLE_AGE ledgers must be rejected.
// ============================================================================

#[test]
#[should_panic]
fn claim_panics_on_stale_oracle_price() {
    let env = Env::default();
    let (client, token, oracle_id, admin) = deploy(&env);
    let oracle = MockPriceOracleClient::new(&env, &oracle_id);

    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    mint(&env, &token, &admin, &funder, AMOUNT);

    let current_ledger = env.ledger().sequence();
    oracle.set_price(&PRICE_SCALE, &current_ledger);

    let release_ledger = current_ledger + 100;
    let memo = Symbol::new(&env, "test");
    let id = client.create_yield_escrow(
        &token,
        &token,
        &oracle_id,
        &funder,
        &beneficiary,
        &AMOUNT,
        &release_ledger,
        &memo,
    );

    // Advance far past release, but leave the oracle's quote stuck at the
    // original ledger — it is now stale.
    let far_future = release_ledger + finchippay_contract::oracle::MAX_ORACLE_AGE + 1;
    env.ledger().with_mut(|li| li.sequence_number = far_future);

    client.claim_yield_escrow(&id);
}
