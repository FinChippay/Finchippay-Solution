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
    if data.len() < 8 { return; }
    let (env, contract_id, token_id) = setup_env();
    let client = FinchippayContractClient::new(&env, &contract_id);
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&payer, &1_000_000_000_000_000i128);
    // Derive rate and deposit from first bytes, constrained to the contract's
    // valid bounds (MAX_STREAM_RATE = 10^10, MAX_STREAM_DEPOSIT = 10^18).
    let mut arr = [0u8; 16];
    let copy_len = data.len().min(16);
    arr[..copy_len].copy_from_slice(&data[..copy_len]);
    let rate = i128::from_be_bytes(arr).abs() % 10_000_000_000i128 + 1;
    let deposit = if data.len() >= 32 {
        let mut arr2 = [0u8; 16];
        arr2.copy_from_slice(&data[16..32]);
        i128::from_be_bytes(arr2).abs() % 1_000_000_000_000_000_000i128 + 1
    } else { 1000 };
    // Use the try_ client method so contract validation panics are returned as
    // errors instead of aborting the fuzzer (libFuzzer aborts on any panic).
    let _ = client.try_open_stream(&token_id, &payer, &recipient, &rate, &deposit);
});
