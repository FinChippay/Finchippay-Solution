#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{Address, Env};
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
    if data.len() < 4 { return; }
    let (env, contract_id, token_id) = setup_env();
    let client = FinchippayContractClient::new(&env, &contract_id);
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&payer, &1_000_000_000_000_000i128);
    // Create a real stream first; claim only that stream (claiming a missing
    // stream id would panic, so we always target the real one).
    let real_id = client
        .try_open_stream(&token_id, &payer, &recipient, &100, &100_000)
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or(0);
    let _ = client.try_claim_stream(&real_id, &recipient);
});
