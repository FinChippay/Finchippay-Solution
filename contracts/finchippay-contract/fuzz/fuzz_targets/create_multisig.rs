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
    if data.len() < 12 { return; }
    let mut amt_bytes = [0u8; 16];
    let copy_len = data.len().min(16);
    amt_bytes[..copy_len].copy_from_slice(&data[..copy_len]);
    let amount = i128::from_be_bytes(amt_bytes).abs() % 1_000_000_000_000i128 + 1;
    let mut thresh_bytes = [0u8; 4];
    thresh_bytes.copy_from_slice(&data[16..20]);
    let signers_count = (u32::from_be_bytes(thresh_bytes) % 4 + 2) as u32; // 2..5
    let threshold = if signers_count > 1 { signers_count - 1 } else { 1 };
    let (env, client, token_id) = setup_env();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let tc = TokenClient::new(&env, &token_id);
    tc.mint(&proposer, &1_000_000_000_000_000i128);
    let mut signers: Vec<Address> = Vec::new(&env);
    for _ in 0..signers_count {
        signers.push_back(Address::generate(&env));
    }
    let expiration = env.ledger().sequence() + 1_000_000;
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _id = client.create_multisig(&token_id, &proposer, &recipient, &amount, &threshold, &signers, &expiration);
    }));
});
