#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{Address, Env, Symbol};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::testutils::{Address as _, Ledger as _};
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
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    StellarAssetClient::new(&env, &token_id).mint(&from, &1_000_000_000_000_000i128);
    let current = env.ledger().sequence();
    let release = current + 10;
    let real_id = client
        .try_create_escrow(&token_id, &from, &to, &1000, &release, &Symbol::new(&env, "fz"))
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or(0);
    // Advance ledger so escrow is claimable, then claim the real escrow.
    env.ledger().set_sequence_number(current + 20);
    let _ = client.try_claim_escrow(&real_id);
});
