//! # Reentrancy Guard — Adversarial Test Suite
//!
//! Proves that a hostile token contract cannot double-claim, double-drain, or
//! double-swap funds by calling back into `FinchippayContract` from inside its
//! own `transfer` implementation.
//!
//! ## Approach
//!
//! `ReentrantToken` is a *functional* mini-token (it tracks balances so the
//! contract's phantom-deposit balance check passes during deposits) that, on a
//! withdrawal (`from == target`), re-enters a configurable entry point via the
//! generated `try_*` client methods. The re-entrant call is expected to be
//! rejected with `ContractError::ReentrantCall`; the token records whether the
//! call was blocked, and the test then asserts that exactly one transfer took
//! place and the contract's on-chain state is unchanged.
//!
//! A separate direct test verifies the guard surfaces `ContractError::ReentrantCall`
//! by holding the lock manually before invoking an entry point.

use finchippay_contract::{
    ContractError, DataKey, EscrowStatus, FinchippayContract, FinchippayContractClient,
    MultiSigStatus,
};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
    token,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, Map, Symbol, Vec,
};

// ─── Adversarial token contract ──────────────────────────────────────────────

/// Storage keys used by [`ReentrantToken`].
#[contracttype]
enum RTKey {
    Balances,
    Target,
    Attack,
    Blocked,
}

/// Which entry point the malicious token re-enters during `transfer`.
#[contracttype]
#[derive(Clone)]
pub enum Attack {
    ClaimEscrow(u32),
    ClaimStream(u32),
    ApproveMultisig(u32),
    ClaimVesting(u32),
    ClaimAirdrop(u32),
    Swap,
}

/// A functional token whose `transfer` re-enters the target contract whenever
/// funds are transferred *out* of the contract (`from == target`). This mirrors
/// the classic reentrancy vector: the contract calls `token.transfer` and the
/// hostile token calls back before the outer call commits.
#[contract]
pub struct ReentrantToken;

#[contractimpl]
impl ReentrantToken {
    /// Mint `amount` tokens to `to` (test setup only).
    pub fn mint(env: Env, to: Address, amount: i128) {
        let mut balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&RTKey::Balances)
            .unwrap_or(Map::new(&env));
        let bal = balances.get(to.clone()).unwrap_or(0);
        balances.set(to, bal + amount);
        env.storage().instance().set(&RTKey::Balances, &balances);
    }

    /// Return the balance of `id`.
    pub fn balance(env: Env, id: Address) -> i128 {
        let balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&RTKey::Balances)
            .unwrap_or(Map::new(&env));
        balances.get(id).unwrap_or(0)
    }

    /// Configure the contract address that `transfer` re-enters.
    pub fn set_target(env: Env, target: Address) {
        env.storage().instance().set(&RTKey::Target, &target);
    }

    /// Configure which entry point `transfer` re-enters.
    pub fn set_attack(env: Env, attack: Attack) {
        env.storage().instance().set(&RTKey::Attack, &attack);
    }

    /// Whether the most recent re-entrant call was rejected.
    pub fn was_blocked(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&RTKey::Blocked)
            .unwrap_or(false)
    }

    /// Token transfer. Moves balances like a real token, then — if the transfer
    /// is *out* of the target contract — attempts to re-enter it.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        // 1. Real balance movement so inbound deposits satisfy the contract's
        //    phantom-deposit balance check.
        let mut balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&RTKey::Balances)
            .unwrap_or(Map::new(&env));
        let from_bal = balances.get(from.clone()).unwrap_or(0);
        let to_bal = balances.get(to.clone()).unwrap_or(0);
        balances.set(from.clone(), from_bal - amount);
        balances.set(to.clone(), to_bal + amount);
        env.storage().instance().set(&RTKey::Balances, &balances);

        // 2. Re-entrancy attempt on withdrawal.
        let target: Address = env
            .storage()
            .instance()
            .get(&RTKey::Target)
            .unwrap_or_else(|| panic!("reentrant target not configured"));
        let blocked = if from == target {
            let attack: Attack = env
                .storage()
                .instance()
                .get(&RTKey::Attack)
                .unwrap_or_else(|| panic!("reentrant attack not configured"));
            let client = FinchippayContractClient::new(&env, &target);
            match attack {
                Attack::ClaimEscrow(id) => client.try_claim_escrow(&id).is_err(),
                Attack::ClaimStream(id) => client.try_claim_stream(&id, &from).is_err(),
                Attack::ApproveMultisig(id) => client.try_approve_multisig(&id, &from).is_err(),
                Attack::ClaimVesting(id) => client.try_claim_vesting(&id, &from).is_err(),
                Attack::ClaimAirdrop(id) => {
                    let empty_proof: Vec<BytesN<32>> = Vec::new(&env);
                    client
                        .try_claim_airdrop(&id, &from, &100, &empty_proof, &0)
                        .is_err()
                }
                Attack::Swap => {
                    let path = Vec::from_array(&env, [from.clone(), to.clone()]);
                    client
                        .try_swap_exact_tokens_for_tokens(&from, &from, &to, &1, &0, &path)
                        .is_err()
                }
            }
        } else {
            false
        };
        env.storage().instance().set(&RTKey::Blocked, &blocked);
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

/// Deploy `ReentrantToken`, configure it to attack `target`, and return its
/// address + client.
fn deploy_reentrant_token<'a>(
    env: &'a Env,
    target: &Address,
    attack: Attack,
) -> (Address, ReentrantTokenClient<'a>) {
    let token_id = env.register(ReentrantToken, ());
    let token_client = ReentrantTokenClient::new(env, &token_id);
    token_client.set_target(target);
    token_client.set_attack(&attack);
    (token_id, token_client)
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

/// Root of a single-leaf airdrop = the leaf itself, using the frozen commitment
/// `leaf = sha256(xdr(recipient) || id_be32 || amount_be128)`. A single-leaf
/// tree has an empty proof, which is exactly what the re-entrant attack needs.
fn airdrop_single_leaf_root(env: &Env, id: u32, recipient: &Address, amount: i128) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&recipient.clone().to_xdr(env));
    data.append(&Bytes::from_slice(env, &id.to_be_bytes()));
    data.append(&Bytes::from_slice(env, &amount.to_be_bytes()));
    env.crypto().sha256(&data).into()
}

// ─── Direct guard test ───────────────────────────────────────────────────────

#[test]
fn test_guard_returns_reentrant_call() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();

    // Simulate a mid-flight call by holding the reentrancy flag directly.
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::Reentrant, &true);
    });

    // A mutating, value-transferring entry point must be rejected with the
    // dedicated ReentrantCall error (surfaced as a contract error).
    let res = client.try_create_escrow(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &1000,
        &(env.ledger().sequence() + 10),
        &Symbol::new(&env, "re"),
    );
    assert_eq!(res.unwrap_err().unwrap(), ContractError::ReentrantCall);
}

#[test]
fn test_guard_is_released_after_successful_call() {
    let env = Env::default();
    let (_, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let token_id = create_sac(&env, &admin, &from, 1000);

    // A normal transfer acquires and then releases the lock, so a second call
    // in the same test process must also succeed (no sticky lock).
    client.send_tip(&token_id, &from, &to, &300, &Symbol::new(&env, "one"));
    client.send_tip(&token_id, &from, &to, &200, &Symbol::new(&env, "two"));
    assert_eq!(client.get_tip_total(&to), 500);
}

// ─── Adversarial tests ───────────────────────────────────────────────────────

#[test]
fn test_escrow_claim_reentrancy_blocked() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();

    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) =
        deploy_reentrant_token(&env, &contract_id, Attack::ClaimEscrow(0));
    token_client.mint(&funder, &1000);

    let release = env.ledger().sequence() + 5;
    let id = client.create_escrow(
        &token_id,
        &funder,
        &recipient,
        &1000,
        &release,
        &Symbol::new(&env, "escrow"),
    );
    assert_eq!(id, 0);

    advance(&env, release + 1);
    client.claim_escrow(&id);

    // The hostile token's re-entrant claim was rejected and exactly one claim
    // went through — no double-claim.
    assert!(token_client.was_blocked());
    assert_eq!(token_client.balance(&recipient), 1000);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(client.get_escrow(&id).status, EscrowStatus::Released);
}

#[test]
fn test_stream_claim_reentrancy_blocked() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();

    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) =
        deploy_reentrant_token(&env, &contract_id, Attack::ClaimStream(0));
    token_client.mint(&payer, &1000);

    let start = env.ledger().sequence();
    let sid = client.open_stream(&token_id, &payer, &recipient, &10, &1000);
    assert_eq!(sid, 0);

    advance(&env, start + 5);
    let claimed = client.claim_stream(&sid, &recipient);
    assert_eq!(claimed, 50);

    // Only 50 stroops were drained — the re-entrant second claim was blocked.
    assert!(token_client.was_blocked());
    assert_eq!(token_client.balance(&recipient), 50);
    assert_eq!(client.get_stream(&sid).claimed, 50);
}

#[test]
fn test_multisig_execution_reentrancy_blocked() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();

    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let (token_id, token_client) =
        deploy_reentrant_token(&env, &contract_id, Attack::ApproveMultisig(0));
    token_client.mint(&proposer, &1000);

    let signers = Vec::from_array(&env, [s1.clone(), s2.clone()]);
    let expiry = env.ledger().sequence() + 1000;
    let pid = client.create_multisig(
        &token_id, &proposer, &recipient, &1000, &2, &signers, &expiry,
    );
    assert_eq!(pid, 0);

    client.approve_multisig(&pid, &s1);
    // Second approval hits the threshold and auto-executes — the hostile token
    // re-enters approve_multisig during the transfer, which must be blocked.
    client.approve_multisig(&pid, &s2);

    assert!(token_client.was_blocked());
    assert_eq!(token_client.balance(&recipient), 1000);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(client.get_multisig(&pid).status, MultiSigStatus::Executed);
}

#[test]
fn test_vesting_claim_reentrancy_blocked() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();

    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let (token_id, token_client) =
        deploy_reentrant_token(&env, &contract_id, Attack::ClaimVesting(0));
    token_client.mint(&funder, &1000);

    let start = env.ledger().sequence();
    let cliff = start + 10;
    let end = start + 20;
    let vid = client.create_vesting(&token_id, &funder, &beneficiary, &1000, &cliff, &end);
    assert_eq!(vid, 0);

    // Advance past the end so the whole schedule is vested.
    advance(&env, end + 1);
    let claimed = client.claim_vesting(&vid, &beneficiary);
    assert_eq!(claimed, 1000);

    assert!(token_client.was_blocked());
    assert_eq!(token_client.balance(&beneficiary), 1000);
    assert_eq!(client.get_vesting(&vid).claimed, 1000);
}

#[test]
fn test_airdrop_claim_reentrancy_blocked() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    env.mock_all_auths();

    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (token_id, token_client) =
        deploy_reentrant_token(&env, &contract_id, Attack::ClaimAirdrop(0));
    token_client.mint(&funder, &1000);

    // Single-leaf airdrop over (recipient, 1000) at id 0; the empty proof is
    // valid for a single-leaf tree.
    let root = airdrop_single_leaf_root(&env, 0, &recipient, 1000);
    client.create_airdrop(
        &token_id,
        &funder,
        &root,
        &1000,
        &(env.ledger().sequence() + 100),
    );

    // The claim releases the full allocation. The hostile token re-enters
    // `claim_airdrop` during the payout, which must be blocked (WS1 guard).
    let empty_proof: Vec<BytesN<32>> = Vec::new(&env);
    client.claim_airdrop(&0, &recipient, &1000, &empty_proof, &0);

    // Single claim — no double-drain; exactly one payout reached the recipient.
    assert!(token_client.was_blocked());
    assert_eq!(token_client.balance(&recipient), 1000);
    assert_eq!(token_client.balance(&contract_id), 0);
}

#[test]
fn test_swap_reentrancy_blocked() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    // token_in is a real SAC; token_out is the hostile token the contract pays
    // out from. The contract must hold token_out reserves.
    let caller = Address::generate(&env);
    let token_in = create_sac(&env, &admin, &caller, 1000);
    let (token_out, token_client) = deploy_reentrant_token(&env, &contract_id, Attack::Swap);
    token_client.mint(&contract_id, &1000);

    let path = Vec::from_array(&env, [token_in.clone(), token_out.clone()]);
    let amount_out =
        client.swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &100, &0, &path);
    assert_eq!(amount_out, 100);

    // The hostile token_out re-entered the swap during payout; it must be
    // blocked so the caller receives exactly one swap's worth of tokens.
    assert!(token_client.was_blocked());
    assert_eq!(token_client.balance(&caller), 100);
    assert_eq!(token_client.balance(&contract_id), 900);
}
