#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{Address, Env, Vec};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::testutils::Address as _;
use finchippay_contract::FinchippayContractClient;

fn setup_env() -> (Env, Address, Address) {
    let env = Env::default();
    let contract_id = env.register(finchippay_contract::FinchippayContract, ());
    let client = FinchippayContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = soroban_sdk::Vec::from_array(&env, [admin.clone()]);
    let _ = client.initialize(&signers, &1);
    env.mock_all_auths();
    // Register a real Stellar Asset Contract so TokenClient works
    let token_id = env.register_stellar_asset_contract(admin.clone());
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&admin, &1_000_000_000_000_000i128);
    (env, contract_id, token_id)
}

fuzz_target!(|data: &[u8]| {
    if data.len() < 8 { return; }
    let (env, contract_id, token_id) = setup_env();
    let client = FinchippayContractClient::new(&env, &contract_id);
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    StellarAssetClient::new(&env, &token_id).mint(&proposer, &1_000_000_000_000_000i128);
    let mut signers: Vec<Address> = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    // Constrain to MAX_MULTISIG_TTL (518_400 ledgers).
    let expiration = env.ledger().sequence() + (u32::from_be_bytes([data[4], data[5], data[6], data[7]]) % 518_400 + 1);
    let real_id = client
        .try_create_multisig(&token_id, &proposer, &recipient, &1000, &2, &signers, &expiration)
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or(0);
    let _ = client.try_approve_multisig(&real_id, &signer1);
});
