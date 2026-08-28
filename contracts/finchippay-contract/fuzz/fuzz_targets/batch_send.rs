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
    let mut cnt_bytes = [0u8; 4];
    cnt_bytes.copy_from_slice(&data[..4]);
    let count = (u32::from_be_bytes(cnt_bytes) % 5 + 1) as u32;
    let (env, client, token_id) = setup_env();
    let from = Address::generate(&env);
    let tc = TokenClient::new(&env, &token_id);
    tc.mint(&from, &1_000_000_000_000_000i128);
    let mut recipients: Vec<Address> = Vec::new(&env);
    let mut amounts: Vec<i128> = Vec::new(&env);
    let mut memos: Vec<Symbol> = Vec::new(&env);
    for i in 0..count {
        recipients.push_back(Address::generate(&env));
        amounts.push_back((i as i128 + 1) * 100);
        memos.push_back(Symbol::new(&env, "fz"));
    }
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _res = client.batch_send(&token_id, &from, &recipients, &amounts, &memos);
    }));
});
