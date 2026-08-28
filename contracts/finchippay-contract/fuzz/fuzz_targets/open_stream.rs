#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{Address, Env, Symbol, Vec};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::testutils::Address as _;
use finchippay_contract::FinchippayContractClient;

fn setup_env() -> (Env, FinchippayContractClient, Address) {
    let env = Env::default();
    let contract_id = env.register(
        finchippay_contract::FinchippayContract,
        (),
    );
    let client = FinchippayContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = soroban_sdk::Vec::from_array(&env, [admin.clone()]);
    let _ = client.initialize(&signers, &1);
    // Register a real Stellar Asset Contract so TokenClient works
    let token_id = env.register_stellar_asset_contract(admin.clone());
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&admin, &1_000_000_000_000_000i128);
    (env, client, token_id)
}

fuzz_target!(|data: &[u8]| {
    if data.len() < 8 { return; }
    let (env, client, token_id) = setup_env();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&payer, &1_000_000_000_000_000i128);
    // Derive rate and deposit from first 8 bytes
    let mut arr = [0u8; 16];
    let copy_len = data.len().min(16);
    arr[..copy_len].copy_from_slice(&data[..copy_len]);
    let rate = i128::from_be_bytes(arr).abs() % 1_000_000_000_000i128 + 1;
    let deposit = if data.len() >= 32 {
        let mut arr2 = [0u8; 16];
        arr2.copy_from_slice(&data[16..32]);
        i128::from_be_bytes(arr2).abs() % 10_000_000_000_000i128 + 1
    } else { 1000 };
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _id = client.open_stream(&token_id, &payer, &recipient, &rate, &deposit);
    }));
});
