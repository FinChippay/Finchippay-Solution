#![cfg(test)]

use finchippay_contract::{DataKey, FinchippayContract, FinchippayContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, Vec,
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

fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let sac_client = token::StellarAssetClient::new(env, &token_id);
    sac_client.mint(to, &amount);
    token_id
}

fn locked_balance(env: &Env, contract_id: &Address, token_id: &Address) -> i128 {
    env.as_contract(contract_id, || {
        let key = DataKey::LockedBalance(token_id.clone());
        let val: Option<i128> = env.storage().persistent().get(&key);
        val.unwrap_or(0)
    })
}

fn advance_ledger(env: &Env, to: u32) {
    env.ledger().with_mut(|l| l.sequence_number = to);
}

fn hash_leaf(env: &Env, recipient: &Address, amount: i128) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&recipient.clone().to_xdr(env));
    data.append(&Bytes::from_slice(env, &amount.to_be_bytes()));
    env.crypto().sha256(&data).into()
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn test_create_airdrop_increases_locked_balance() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    let funder = Address::generate(&env);
    let token_id = create_token(&env, &admin, &funder, 10_000);

    let recipient = Address::generate(&env);
    let amount = 1_000;
    let leaf = hash_leaf(&env, &recipient, amount);
    let expiration = env.ledger().sequence() + 100;
    let total_amount = 1_000;

    env.as_contract(&contract_id, || {
        finchippay_contract::airdrop::create_airdrop(
            &env,
            token_id.clone(),
            funder.clone(),
            leaf.clone(),
            total_amount,
            expiration,
        );
    });

    assert_eq!(locked_balance(&env, &contract_id, &token_id), 1_000);
}

#[test]
fn test_claim_airdrop_decreases_locked_balance() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    let funder = Address::generate(&env);
    let token_id = create_token(&env, &admin, &funder, 10_000);

    let recipient = Address::generate(&env);
    let amount = 1_000;
    let leaf = hash_leaf(&env, &recipient, amount);
    let expiration = env.ledger().sequence() + 100;

    let total_amount = 1_000;
    let airdrop_id = env.as_contract(&contract_id, || {
        finchippay_contract::airdrop::create_airdrop(
            &env,
            token_id.clone(),
            funder.clone(),
            leaf.clone(),
            total_amount,
            expiration,
        )
    });

    assert_eq!(locked_balance(&env, &contract_id, &token_id), 1_000);

    let proof = Vec::new(&env);
    env.as_contract(&contract_id, || {
        finchippay_contract::airdrop::claim_airdrop(
            &env,
            airdrop_id,
            recipient.clone(),
            amount,
            proof.clone(),
            0,
        );
    });

    assert_eq!(locked_balance(&env, &contract_id, &token_id), 0);
    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&recipient), 1_000);
}

#[test]
fn test_cancel_airdrop_decreases_locked_balance() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    let funder = Address::generate(&env);
    let token_id = create_token(&env, &admin, &funder, 10_000);

    let recipient = Address::generate(&env);
    let amount = 1_000;
    let leaf = hash_leaf(&env, &recipient, amount);
    let expiration = env.ledger().sequence() + 100;

    let total_amount = 1_000;
    let airdrop_id = env.as_contract(&contract_id, || {
        finchippay_contract::airdrop::create_airdrop(
            &env,
            token_id.clone(),
            funder.clone(),
            leaf.clone(),
            total_amount,
            expiration,
        )
    });

    assert_eq!(locked_balance(&env, &contract_id, &token_id), 1_000);

    advance_ledger(&env, expiration + 1);
    env.as_contract(&contract_id, || {
        finchippay_contract::airdrop::cancel_airdrop(&env, airdrop_id, funder.clone());
    });

    assert_eq!(locked_balance(&env, &contract_id, &token_id), 0);
    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&funder), 10_000);
}

#[test]
#[should_panic(expected = "insufficient unlocked balance")]
fn test_rescue_tokens_cannot_sweep_unclaimed_airdrop() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    let funder = Address::generate(&env);
    let token_id = create_token(&env, &admin, &funder, 10_000);

    let recipient = Address::generate(&env);
    let amount = 1_000;
    let leaf = hash_leaf(&env, &recipient, amount);
    let expiration = env.ledger().sequence() + 100;

    let total_amount = 1_000;
    env.as_contract(&contract_id, || {
        finchippay_contract::airdrop::create_airdrop(
            &env,
            token_id.clone(),
            funder.clone(),
            leaf.clone(),
            total_amount,
            expiration,
        );
    });

    // The entire airdrop is now considered locked
    assert_eq!(locked_balance(&env, &contract_id, &token_id), 1_000);

    // Emergency withdrawal attempts to withdraw 1000, but only 0 are unlocked
    let rescue_recipient = Address::generate(&env);
    client.initiate_emergency_withdrawal(&admin, &token_id, &1_000, &rescue_recipient);
}
