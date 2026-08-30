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
    if data.len() < 24 { return; }
    let mut amt_bytes = [0u8; 16];
    let copy_len = data.len().min(16);
    amt_bytes[..copy_len].copy_from_slice(&data[..copy_len]);
    let amount = i128::from_be_bytes(amt_bytes).abs() % 1_000_000_000_000i128 + 1;
    let mut thresh_bytes = [0u8; 4];
    thresh_bytes.copy_from_slice(&data[16..20]);
    let signers_count = (u32::from_be_bytes(thresh_bytes) % 4 + 2) as u32; // 2..5
    let threshold = if signers_count > 1 { signers_count - 1 } else { 1 };
    let (env, contract_id, token_id) = setup_env();
    let client = FinchippayContractClient::new(&env, &contract_id);
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    StellarAssetClient::new(&env, &token_id).mint(&proposer, &1_000_000_000_000_000i128);
    let mut signers: Vec<Address> = Vec::new(&env);
    for _ in 0..signers_count {
        signers.push_back(Address::generate(&env));
    }
    // Constrain to MAX_MULTISIG_TTL (518_400 ledgers).
    let expiration = env.ledger().sequence() + (u32::from_be_bytes([data[20], data[21], data[22], data[23]]) % 518_400 + 1);
    let _ = client.try_create_multisig(&token_id, &proposer, &recipient, &amount, &threshold, &signers, &expiration);
});
