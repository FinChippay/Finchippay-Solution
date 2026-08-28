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
    if data.len() < 4 { return; }
    let mut id_bytes = [0u8; 4];
    id_bytes.copy_from_slice(&data[..4]);
    let stream_id = u32::from_be_bytes(id_bytes);
    let (env, client, token_id) = setup_env();
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&payer, &1_000_000_000_000_000i128);
    // Create a real stream first
    let real_id = client.open_stream(&token_id, &payer, &recipient, &100, &100_000);
    let target_id = if stream_id % 2 == 0 { real_id } else { stream_id };
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _claimed = client.claim_stream(&target_id, &recipient);
    }));
});
