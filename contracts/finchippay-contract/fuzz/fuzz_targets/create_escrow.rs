#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{Address, Env, Symbol};
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
    let mut amt_bytes = [0u8; 16];
    let copy_len = data.len().min(16);
    amt_bytes[..copy_len].copy_from_slice(&data[..copy_len]);
    // Constrain to [MIN_ESCROW_AMOUNT, MAX_ESCROW_AMOUNT] = [1000, 10^18].
    let amount = i128::from_be_bytes(amt_bytes).abs() % 1_000_000_000_000i128 + 1_000;
    let mut led_bytes = [0u8; 4];
    if data.len() >= 20 { led_bytes.copy_from_slice(&data[16..20]); }
    let offset = u32::from_be_bytes(led_bytes) % 100_000 + 1;
    let (env, contract_id, token_id) = setup_env();
    let client = FinchippayContractClient::new(&env, &contract_id);
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    StellarAssetClient::new(&env, &token_id).mint(&from, &1_000_000_000_000_000i128);
    let release = env.ledger().sequence() + offset;
    let memo = Symbol::new(&env, "fuzz");
    let _ = client.try_create_escrow(&token_id, &from, &to, &amount, &release, &memo);
});
