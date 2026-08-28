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
    let mut amt_bytes = [0u8; 16];
    let copy_len = data.len().min(16);
    amt_bytes[..copy_len].copy_from_slice(&data[..copy_len]);
    let amount = i128::from_be_bytes(amt_bytes).abs() % 1_000_000_000_000i128 + 1;
    let mut led_bytes = [0u8; 4];
    if data.len() >= 20 { led_bytes.copy_from_slice(&data[16..20]); }
    let offset = u32::from_be_bytes(led_bytes) % 100_000 + 1;
    let (env, client, token_id) = setup_env();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let tc = TokenClient::new(&env, &token_id);
    tc.mint(&from, &1_000_000_000_000_000i128);
    let release = env.ledger().sequence() + offset;
    let memo = Symbol::new(&env, "fuzz");
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _id = client.create_escrow(&token_id, &from, &to, &amount, &release, &memo);
    }));
});
