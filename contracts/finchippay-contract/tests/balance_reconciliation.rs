//! # Balance Reconciliation & Fee-on-Transfer / Rebasing Token Safety
//!
//! Proves the contract stays correct against tokens whose on-chain balance can
//! diverge from the cached `LastContractBalance`:
//!
//! 1. **`reconcile_balance`** (admin-gated via the admin signer multi-sig)
//!    resyncs the cache with the actual `token.balance(contract)` and emits a
//!    `balance_reconciled` event carrying the `(old, new)` values.
//! 2. **Drift is surfaced on reads** — a `balance_drift_detected` event is
//!    emitted whenever a read observes the cache diverging from the actual
//!    balance, and the stale value is never used (the read self-heals).
//! 3. **Fee-on-transfer tokens (99% fee) can never over-claim** — deposits
//!    into escrow, stream, and multi-sig flows are rejected by the
//!    phantom-deposit check, so locked-balance accounting never diverges from
//!    real funds.
//! 4. **Rebasing tokens** — after a rebase drifts the cache, `reconcile_balance`
//!    restores correctness and deposits/claims across escrow, stream, and
//!    multi-sig flows continue to settle exactly.

use finchippay_contract::{DataKey, FinchippayContract, FinchippayContractClient};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Events as _, Ledger},
    token, vec, Address, Env, IntoVal, Map, Symbol, Val, Vec,
};

// ─── Fee-on-transfer token (99% fee) ────────────────────────────────────────

#[contracttype]
enum FoTKey {
    Balances,
}

/// A functional token that applies a **99% fee** on every transfer: the sender
/// loses the full `amount` but the recipient only receives 1% of it. This
/// models fee-on-transfer / taxed / deflationary tokens, where
/// `transfer(from, to, amount)` moves strictly *less* than `amount` into `to`.
#[contract]
pub struct FeeOnTransferToken;

#[contractimpl]
impl FeeOnTransferToken {
    /// Mint `amount` tokens to `to` (test setup only).
    pub fn mint(env: Env, to: Address, amount: i128) {
        let mut balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&FoTKey::Balances)
            .unwrap_or(Map::new(&env));
        let bal = balances.get(to.clone()).unwrap_or(0);
        balances.set(to, bal + amount);
        env.storage().instance().set(&FoTKey::Balances, &balances);
    }

    /// Return the balance of `id`.
    pub fn balance(env: Env, id: Address) -> i128 {
        let balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&FoTKey::Balances)
            .unwrap_or(Map::new(&env));
        balances.get(id).unwrap_or(0)
    }

    /// Transfer with a 99% fee deducted from the transferred amount: only 1%
    /// of `amount` reaches `to`.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let mut balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&FoTKey::Balances)
            .unwrap_or(Map::new(&env));
        let from_bal = balances.get(from.clone()).unwrap_or(0);
        assert!(from_bal >= amount, "insufficient balance");
        let fee = amount * 9_900 / 10_000; // 99% fee
        let net = amount - fee; // 1% reaches the recipient
        balances.set(from.clone(), from_bal - amount);
        let to_bal = balances.get(to.clone()).unwrap_or(0);
        balances.set(to, to_bal + net);
        env.storage().instance().set(&FoTKey::Balances, &balances);
    }
}

// ─── Rebasing token ─────────────────────────────────────────────────────────

#[contracttype]
enum RBKey {
    Shares,
    Factor,
}

/// Rebasing-token exchange-rate scale (1.0 in fixed-point).
const RB_SCALE: i128 = 1_000_000;

/// A shares-based functional token whose displayed balance scales with a
/// global rebase factor. `rebase` changes the factor, scaling every holder's
/// balance **without any transfer** — exactly what makes a cached contract
/// balance go stale.
#[contract]
pub struct RebasingToken;

#[contractimpl]
impl RebasingToken {
    /// Current rebase factor (fixed-point, `RB_SCALE` == 1.0).
    pub fn factor(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&RBKey::Factor)
            .unwrap_or(RB_SCALE)
    }

    /// Mint `amount` displayed tokens to `to` at the current factor.
    pub fn mint(env: Env, to: Address, amount: i128) {
        let factor = env
            .storage()
            .instance()
            .get::<RBKey, i128>(&RBKey::Factor)
            .unwrap_or(RB_SCALE);
        let shares = amount * RB_SCALE / factor;
        let mut shares_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&RBKey::Shares)
            .unwrap_or(Map::new(&env));
        let cur = shares_map.get(to.clone()).unwrap_or(0);
        shares_map.set(to, cur + shares);
        env.storage().instance().set(&RBKey::Shares, &shares_map);
    }

    /// Displayed balance of `id` (shares × factor).
    pub fn balance(env: Env, id: Address) -> i128 {
        let shares_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&RBKey::Shares)
            .unwrap_or(Map::new(&env));
        let shares = shares_map.get(id).unwrap_or(0);
        let factor = env
            .storage()
            .instance()
            .get::<RBKey, i128>(&RBKey::Factor)
            .unwrap_or(RB_SCALE);
        shares * factor / RB_SCALE
    }

    /// Transfer `amount` displayed tokens. Uses ceiling division on shares so
    /// the recipient is credited at least `amount`, keeping the contract's
    /// phantom-deposit check satisfied for legitimate deposits.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let factor = env
            .storage()
            .instance()
            .get::<RBKey, i128>(&RBKey::Factor)
            .unwrap_or(RB_SCALE);
        let shares = (amount * RB_SCALE + factor - 1) / factor;
        let mut shares_map: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&RBKey::Shares)
            .unwrap_or(Map::new(&env));
        let from_shares = shares_map.get(from.clone()).unwrap_or(0);
        assert!(from_shares >= shares, "insufficient balance");
        shares_map.set(from.clone(), from_shares - shares);
        let to_shares = shares_map.get(to.clone()).unwrap_or(0);
        shares_map.set(to, to_shares + shares);
        env.storage().instance().set(&RBKey::Shares, &shares_map);
    }

    /// Rebase: set a new global factor. `2 * RB_SCALE` is a 2× positive rebase,
    /// `RB_SCALE / 2` a 50% negative rebase.
    pub fn rebase(env: Env, new_factor: i128) {
        assert!(new_factor > 0, "factor must be positive");
        env.storage().instance().set(&RBKey::Factor, &new_factor);
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn deploy(env: &Env) -> (Address, FinchippayContractClient<'_>) {
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let signers = Vec::from_array(env, [admin.clone()]);
    client.initialize(&signers, &1);
    (id, client)
}

fn create_sac(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let sac_client = token::StellarAssetClient::new(env, &token_id);
    sac_client.mint(to, &amount);
    token_id
}

fn advance(env: &Env, to: u32) {
    env.ledger().with_mut(|l| l.sequence_number = to);
}

/// Read the contract's cached `LastContractBalance` for `token_id` directly
/// from storage (bypasses `get_contract_balance`, so it never self-heals).
fn cached_contract_balance(env: &Env, contract_id: &Address, token_id: &Address) -> i128 {
    env.as_contract(contract_id, || {
        let key = DataKey::LastContractBalance(token_id.clone());
        let val: Option<i128> = env.storage().persistent().get(&key);
        val.unwrap_or(0)
    })
}

/// Read the contract's `LockedBalance` for `token_id` directly from storage.
fn locked_balance(env: &Env, contract_id: &Address, token_id: &Address) -> i128 {
    env.as_contract(contract_id, || {
        let key = DataKey::LockedBalance(token_id.clone());
        let val: Option<i128> = env.storage().persistent().get(&key);
        val.unwrap_or(0)
    })
}

/// Trigger the admin-gated `reconcile_balance` action via the admin signer
/// multi-sig (threshold 1 auto-executes on propose).
fn reconcile(
    env: &Env,
    client: &FinchippayContractClient<'_>,
    admin: &Address,
    token_id: &Address,
) {
    let data: Vec<Val> = Vec::from_array(env, [token_id.clone().into_val(env)]);
    client.propose_admin_action(admin, &Symbol::new(env, "reconcile_balance"), &data);
}

// ─── Reconcile (admin-gated) ────────────────────────────────────────────────

#[test]
fn test_reconcile_balance_resyncs_cache_and_emits_event() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_id = create_sac(&env, &admin, &payer, 10_000);

    // Deposit creates the cache entry.
    let release = env.ledger().sequence() + 100;
    let id = client.create_escrow(
        &token_id,
        &payer,
        &recipient,
        &1_000,
        &release,
        &Symbol::new(&env, "e"),
    );
    assert_eq!(id, 0);
    assert_eq!(
        cached_contract_balance(&env, &contract_id, &token_id),
        1_000
    );

    // A direct transfer to the contract address drifts the cache.
    let token_client = token::Client::new(&env, &token_id);
    token_client.transfer(&payer, &contract_id, &500);
    assert_eq!(
        cached_contract_balance(&env, &contract_id, &token_id),
        1_000
    ); // stale

    // Admin-gated reconcile resyncs the cache and emits `balance_reconciled`
    // carrying the old/new values. Read the events before any further host
    // operation (which would clear the buffer).
    reconcile(&env, &client, &admin, &token_id);
    let events = env.events().all().filter_by_contract(&contract_id);
    let expected: Vec<(Address, Vec<Val>, Val)> = vec![
        &env,
        (
            contract_id.clone(),
            (Symbol::new(&env, "admin_action_proposed"),).into_val(&env),
            (1u64, Symbol::new(&env, "reconcile_balance"), admin.clone()).into_val(&env),
        ),
        (
            contract_id.clone(),
            (Symbol::new(&env, "admin_action_approved"),).into_val(&env),
            (1u64, admin.clone(), 1u32, 1u32).into_val(&env),
        ),
        (
            contract_id.clone(),
            (Symbol::new(&env, "balance_reconciled"), token_id.clone()).into_val(&env),
            (1_000i128, 1_500i128).into_val(&env),
        ),
    ];
    assert_eq!(events, expected);
}

#[test]
fn test_reconcile_balance_no_drift_emits_event_with_equal_values() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_id = create_sac(&env, &admin, &payer, 10_000);

    let release = env.ledger().sequence() + 100;
    client.create_escrow(
        &token_id,
        &payer,
        &recipient,
        &1_000,
        &release,
        &Symbol::new(&env, "e"),
    );
    assert_eq!(
        cached_contract_balance(&env, &contract_id, &token_id),
        1_000
    );

    // No drift: reconcile still records the event with old == new. Read the
    // events before any further host operation (which would clear the buffer).
    reconcile(&env, &client, &admin, &token_id);
    let events = env.events().all().filter_by_contract(&contract_id);
    let expected: Vec<(Address, Vec<Val>, Val)> = vec![
        &env,
        (
            contract_id.clone(),
            (Symbol::new(&env, "admin_action_proposed"),).into_val(&env),
            (1u64, Symbol::new(&env, "reconcile_balance"), admin.clone()).into_val(&env),
        ),
        (
            contract_id.clone(),
            (Symbol::new(&env, "admin_action_approved"),).into_val(&env),
            (1u64, admin.clone(), 1u32, 1u32).into_val(&env),
        ),
        (
            contract_id.clone(),
            (Symbol::new(&env, "balance_reconciled"), token_id.clone()).into_val(&env),
            (1_000i128, 1_000i128).into_val(&env),
        ),
    ];
    assert_eq!(events, expected);
}

#[test]
#[should_panic]
fn test_reconcile_balance_rejects_non_signer() {
    let env = Env::default();
    let (_id, client) = deploy(&env);
    env.mock_all_auths();
    let stranger = Address::generate(&env);
    let token_id = Address::generate(&env);
    let data: Vec<Val> = Vec::from_array(&env, [token_id.into_val(&env)]);
    client.propose_admin_action(&stranger, &Symbol::new(&env, "reconcile_balance"), &data);
}

// ─── Drift detection on reads ───────────────────────────────────────────────

#[test]
fn test_drift_detected_event_on_read() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_id = create_sac(&env, &admin, &payer, 10_000);

    let release = env.ledger().sequence() + 100;
    client.create_escrow(
        &token_id,
        &payer,
        &recipient,
        &1_000,
        &release,
        &Symbol::new(&env, "e1"),
    );
    assert_eq!(
        cached_contract_balance(&env, &contract_id, &token_id),
        1_000
    );

    // Direct transfer to the contract drifts the cache downward.
    let token_client = token::Client::new(&env, &token_id);
    token_client.transfer(&payer, &contract_id, &500);
    assert_eq!(
        cached_contract_balance(&env, &contract_id, &token_id),
        1_000
    );

    // A read (a second deposit) detects, surfaces, and self-heals the drift.
    let recipient2 = Address::generate(&env);
    let release2 = env.ledger().sequence() + 100;
    client.create_escrow(
        &token_id,
        &payer,
        &recipient2,
        &1_000,
        &release2,
        &Symbol::new(&env, "e2"),
    );

    let events = env.events().all().filter_by_contract(&contract_id);
    let expected: Vec<(Address, Vec<Val>, Val)> = vec![
        &env,
        (
            contract_id.clone(),
            (
                Symbol::new(&env, "balance_drift_detected"),
                token_id.clone(),
            )
                .into_val(&env),
            (1_000i128, 1_500i128).into_val(&env),
        ),
        (
            contract_id.clone(),
            (Symbol::new(&env, "escrow_create"), 1u32).into_val(&env),
            (payer.clone(), recipient2.clone(), 1_000i128, release2).into_val(&env),
        ),
    ];
    assert_eq!(events, expected);

    // Cache self-healed to the real balance (1_500 + the 1_000 just deposited).
    assert_eq!(
        cached_contract_balance(&env, &contract_id, &token_id),
        2_500
    );
}

// ─── Fee-on-transfer (99% fee): no over-claim ──────────────────────────────

#[test]
fn test_fee_on_transfer_escrow_deposit_rejected() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let fot_id = env.register(FeeOnTransferToken, ());
    let fot = FeeOnTransferTokenClient::new(&env, &fot_id);
    fot.mint(&payer, &10_000);

    let release = env.ledger().sequence() + 100;
    let result = client.try_create_escrow(
        &fot_id,
        &payer,
        &recipient,
        &1_000,
        &release,
        &Symbol::new(&env, "e"),
    );
    assert!(result.is_err());

    // No funds were locked and the payer's balance is untouched (no partial
    // deposit) — a fee-on-transfer token can never over-claim.
    assert_eq!(locked_balance(&env, &contract_id, &fot_id), 0);
    assert_eq!(fot.balance(&payer), 10_000);
}

#[test]
fn test_fee_on_transfer_stream_deposit_rejected() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let fot_id = env.register(FeeOnTransferToken, ());
    let fot = FeeOnTransferTokenClient::new(&env, &fot_id);
    fot.mint(&payer, &10_000);

    let result = client.try_open_stream(&fot_id, &payer, &recipient, &10, &1_000);
    assert!(result.is_err());
    assert_eq!(locked_balance(&env, &contract_id, &fot_id), 0);
    assert_eq!(fot.balance(&payer), 10_000);
}

#[test]
fn test_fee_on_transfer_multisig_deposit_rejected() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let fot_id = env.register(FeeOnTransferToken, ());
    let fot = FeeOnTransferTokenClient::new(&env, &fot_id);
    fot.mint(&payer, &10_000);

    let mut signers = Vec::new(&env);
    signers.push_back(Address::generate(&env));
    let expiry = env.ledger().sequence() + 1_000;
    let result =
        client.try_create_multisig(&fot_id, &payer, &recipient, &1_000, &1, &signers, &expiry);
    assert!(result.is_err());
    assert_eq!(locked_balance(&env, &contract_id, &fot_id), 0);
    assert_eq!(fot.balance(&payer), 10_000);
}

// ─── Rebasing token: deposits/claims stay correct after reconcile ──────────

#[test]
fn test_rebasing_token_escrow_reconcile_and_claim() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let rb_id = env.register(RebasingToken, ());
    let rb = RebasingTokenClient::new(&env, &rb_id);
    rb.mint(&payer, &10_000);

    let release = env.ledger().sequence() + 100;
    let id = client.create_escrow(
        &rb_id,
        &payer,
        &recipient,
        &1_000,
        &release,
        &Symbol::new(&env, "e"),
    );
    assert_eq!(id, 0);
    assert_eq!(cached_contract_balance(&env, &contract_id, &rb_id), 1_000);

    // 2× positive rebase: the contract's actual balance doubles, the cache
    // stays stale.
    rb.rebase(&(2 * RB_SCALE));
    assert_eq!(rb.balance(&contract_id), 2_000);
    assert_eq!(cached_contract_balance(&env, &contract_id, &rb_id), 1_000);

    // Admin-gated reconcile resyncs the cache and emits `balance_reconciled`
    // carrying the old/new values. Read the events before any further host
    // operation (which would clear the buffer).
    reconcile(&env, &client, &admin, &rb_id);
    let events = env.events().all().filter_by_contract(&contract_id);
    let expected: Vec<(Address, Vec<Val>, Val)> = vec![
        &env,
        (
            contract_id.clone(),
            (Symbol::new(&env, "admin_action_proposed"),).into_val(&env),
            (1u64, Symbol::new(&env, "reconcile_balance"), admin.clone()).into_val(&env),
        ),
        (
            contract_id.clone(),
            (Symbol::new(&env, "admin_action_approved"),).into_val(&env),
            (1u64, admin.clone(), 1u32, 1u32).into_val(&env),
        ),
        (
            contract_id.clone(),
            (Symbol::new(&env, "balance_reconciled"), rb_id.clone()).into_val(&env),
            (1_000i128, 2_000i128).into_val(&env),
        ),
    ];
    assert_eq!(events, expected);

    // Claim after reconcile: the recipient receives the full escrow amount and
    // the cache tracks the post-claim balance.
    advance(&env, release + 1);
    client.claim_escrow(&id);
    assert_eq!(rb.balance(&recipient), 1_000);
    assert_eq!(cached_contract_balance(&env, &contract_id, &rb_id), 1_000);
}

#[test]
fn test_rebasing_token_stream_reconcile_and_claim() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let rb_id = env.register(RebasingToken, ());
    let rb = RebasingTokenClient::new(&env, &rb_id);
    rb.mint(&payer, &10_000);

    let sid = client.open_stream(&rb_id, &payer, &recipient, &10, &1_000);
    assert_eq!(cached_contract_balance(&env, &contract_id, &rb_id), 1_000);

    // 2× positive rebase drifts the cache.
    rb.rebase(&(2 * RB_SCALE));
    assert_eq!(rb.balance(&contract_id), 2_000);

    reconcile(&env, &client, &admin, &rb_id);
    assert_eq!(cached_contract_balance(&env, &contract_id, &rb_id), 2_000);

    // Claim the stream after reconcile: exactly the accrued amount is paid.
    advance(&env, env.ledger().sequence() + 10);
    let claimed = client.claim_stream(&sid, &recipient);
    assert_eq!(claimed, 100);
    assert_eq!(rb.balance(&recipient), 100);
    assert_eq!(cached_contract_balance(&env, &contract_id, &rb_id), 1_900);
}

#[test]
fn test_rebasing_token_multisig_reconcile_and_execute() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer = Address::generate(&env);
    let rb_id = env.register(RebasingToken, ());
    let rb = RebasingTokenClient::new(&env, &rb_id);
    rb.mint(&proposer, &10_000);

    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());
    let expiry = env.ledger().sequence() + 1_000;
    let mid = client.create_multisig(&rb_id, &proposer, &recipient, &1_000, &1, &signers, &expiry);
    assert_eq!(mid, 0);
    assert_eq!(cached_contract_balance(&env, &contract_id, &rb_id), 1_000);

    // 2× positive rebase drifts the cache.
    rb.rebase(&(2 * RB_SCALE));
    reconcile(&env, &client, &admin, &rb_id);
    assert_eq!(cached_contract_balance(&env, &contract_id, &rb_id), 2_000);

    // Approval executes the payment to the recipient.
    client.approve_multisig(&mid, &signer);
    assert_eq!(rb.balance(&recipient), 1_000);
    assert_eq!(cached_contract_balance(&env, &contract_id, &rb_id), 1_000);
}

#[test]
fn test_rebasing_token_drift_detected_on_read() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let rb_id = env.register(RebasingToken, ());
    let rb = RebasingTokenClient::new(&env, &rb_id);
    rb.mint(&payer, &10_000);

    let release = env.ledger().sequence() + 100;
    client.create_escrow(
        &rb_id,
        &payer,
        &recipient,
        &1_000,
        &release,
        &Symbol::new(&env, "e1"),
    );
    assert_eq!(cached_contract_balance(&env, &contract_id, &rb_id), 1_000);

    // Positive rebase drifts the cache without any transfer.
    rb.rebase(&(2 * RB_SCALE));
    assert_eq!(rb.balance(&contract_id), 2_000);

    // A subsequent deposit read surfaces the drift and self-heals.
    let recipient2 = Address::generate(&env);
    let release2 = env.ledger().sequence() + 100;
    client.create_escrow(
        &rb_id,
        &payer,
        &recipient2,
        &1_000,
        &release2,
        &Symbol::new(&env, "e2"),
    );

    let events = env.events().all().filter_by_contract(&contract_id);
    let expected: Vec<(Address, Vec<Val>, Val)> = vec![
        &env,
        (
            contract_id.clone(),
            (Symbol::new(&env, "balance_drift_detected"), rb_id.clone()).into_val(&env),
            (1_000i128, 2_000i128).into_val(&env),
        ),
        (
            contract_id.clone(),
            (Symbol::new(&env, "escrow_create"), 1u32).into_val(&env),
            (payer.clone(), recipient2.clone(), 1_000i128, release2).into_val(&env),
        ),
    ];
    assert_eq!(events, expected);

    // Cache self-healed (2_000 at drift + the 1_000 just deposited).
    assert_eq!(cached_contract_balance(&env, &contract_id, &rb_id), 3_000);
}
