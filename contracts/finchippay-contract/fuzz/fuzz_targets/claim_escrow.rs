#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{Address, Env, Symbol, Vec};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::testutils::Address as _;
use finchippay_contract::FinchippayContractClient;

fn setup_env<'a>() -> (Env, FinchippayContractClient<'a>, Address) {
    let env = Env::default();
    let contract_id = env.register(
        finchippay_contract::FinchippayContract,
        (),
    );
    let client = FinchippayContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = soroban_sdk::Vec::from_array(&env, [admin.clone()]);
    let _ = client.initialize(&signers, &1);
    // Register a real Stellar Asset Contract so StellarAssetClient works
    let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let sac = StellarAssetClient::new(&env, &token_id);
    sac.mint(&admin, &1_000_000_000_000_000i128);
    (env, client, token_id)
}

fuzz_target!(|data: &[u8]| {
    if data.len() < 4 { return; }
    let mut id_bytes = [0u8; 4];
    id_bytes.copy_from_slice(&data[..4]);
    let escrow_id = u32::from_be_bytes(id_bytes);
    let (env, client, token_id) = setup_env();
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let tc = StellarAssetClient::new(&env, &token_id);
    tc.mint(&from, &1_000_000_000_000_000i128);
    let current = env.ledger().get().sequence_number;
    let release = current + 10;
    let _real_id = client.create_escrow(&token_id, &from, &to, &1000, &release, &Symbol::new(&env, "fz"));
    // Advance ledger so escrow is claimable
    env.ledger().with_mut(|li| li.sequence_number = current + 20);
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.claim_escrow(&escrow_id);
    }));
});
