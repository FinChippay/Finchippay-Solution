#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{Address, Bytes, BytesN, Env, Vec};
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

/// leaf = sha256(xdr(recipient) || id_be32 || amount_be128) — frozen format.
fn hash_leaf(env: &Env, id: u32, recipient: &Address, amount: i128) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&recipient.clone().to_xdr(env));
    data.append(&Bytes::from_slice(env, &id.to_be_bytes()));
    data.append(&Bytes::from_slice(env, &amount.to_be_bytes()));
    env.crypto().sha256(&data).into()
}

fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&left.clone().to_xdr(env));
    data.append(&right.clone().to_xdr(env));
    env.crypto().sha256(&data).into()
}

/// Two-leaf merkle tree -> (root, proof for leaf 0, proof for leaf 1)
fn two_leaf_tree(
    env: &Env,
    id: u32,
    a: &Address,
    amt_a: i128,
    b: &Address,
    amt_b: i128,
) -> (BytesN<32>, Vec<BytesN<32>>, Vec<BytesN<32>>) {
    let la = hash_leaf(env, id, a, amt_a);
    let lb = hash_leaf(env, id, b, amt_b);
    let root = hash_pair(env, &la, &lb);
    let proof_a = Vec::from_array(env, [lb.clone()]);
    let proof_b = Vec::from_array(env, [la]);
    (root, proof_a, proof_b)
}

fuzz_target!(|data: &[u8]| {
    if data.len() < 4 {
        return;
    }
    let (env, contract_id, token_id) = setup_env();
    let client = FinchippayContractClient::new(&env, &contract_id);
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Deterministic airdrop id from the first 4 bytes.
    let mut id_bytes = [0u8; 4];
    id_bytes.copy_from_slice(&data[..4]);
    let airdrop_id = u32::from_be_bytes(id_bytes);

    // Deterministic amounts from the next bytes (kept small to stay in budget).
    let amt_a = 1_000_000i128 + (data.get(4).copied().unwrap_or(0) as i128) * 1_000;
    let amt_b = 1_000_000i128 + (data.get(5).copied().unwrap_or(1) as i128) * 1_000;
    let total = amt_a + amt_b;

    let (root, proof_a, _proof_b) = two_leaf_tree(&env, airdrop_id, &recipient, amt_a, &funder, amt_b);

    // Fund the funder so create_airdrop can succeed on the valid path.
    StellarAssetClient::new(&env, &token_id).mint(&funder, &(total * 2));

    // Create: fuzz the merkle root (valid tree or garbage bytes) and amount.
    let fuzz_root: BytesN<32> = if data.len() >= 36 {
        let mut r = [0u8; 32];
        r.copy_from_slice(&data[4..36]);
        BytesN::from_array(&env, &r)
    } else {
        root.clone()
    };
    let total_amount = if data.len() >= 40 {
        let mut a = [0u8; 16];
        a.copy_from_slice(&data[24..40]);
        i128::from_be_bytes(a).abs() % (total * 2) + 1
    } else {
        total
    };
    let expiration = env.ledger().sequence() + 1_000_000;
    // try_ client methods return contract panics/errors instead of aborting the
    // fuzzer (libFuzzer aborts on any Rust panic).
    let _ = client.try_create_airdrop(&token_id, &funder, &fuzz_root, &total_amount, &expiration);

    // Claim: fuzz recipient/amount/proof (valid leaf proof or garbage).
    let claim_amount = if data.len() >= 44 {
        let mut a = [0u8; 16];
        a.copy_from_slice(&data[28..44]);
        i128::from_be_bytes(a).abs() % (amt_a + amt_b) + 1
    } else {
        amt_a
    };
    let claim_index = if data.len() % 5 == 0 {
        0u32
    } else {
        u32::from_be_bytes([data[0], data[1], data[2], data[3]])
    };
    let proof = if data.len() % 2 == 0 {
        proof_a.clone()
    } else {
        let mut garbage = [0u8; 32];
        garbage.copy_from_slice(&data[data.len().min(4)..data.len().min(36)]);
        Vec::from_array(&env, [BytesN::from_array(&env, &garbage)])
    };
    let _ = client.try_claim_airdrop(&airdrop_id, &recipient, &claim_amount, &proof, &claim_index);

    // Cancel: fuzz the funder side (valid funder or random address).
    let canceller = if data.len() % 3 == 0 {
        funder.clone()
    } else {
        Address::generate(&env)
    };
    let _ = client.try_cancel_airdrop(&airdrop_id, &canceller);
});
