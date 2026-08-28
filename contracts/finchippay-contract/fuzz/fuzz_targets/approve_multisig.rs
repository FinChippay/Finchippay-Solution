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
    let prop_id = u32::from_be_bytes(id_bytes);
    let (env, client, token_id) = setup_env();
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let tc = TokenClient::new(&env, &token_id);
    tc.mint(&proposer, &1_000_000_000_000_000i128);
    let mut signers: Vec<Address> = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    let expiration = env.ledger().sequence() + 1_000_000;
    let _real_id = client.create_multisig(&token_id, &proposer, &recipient, &1000, &2, &signers, &expiration);
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.approve_multisig(&prop_id, &signer1);
    }));
});
