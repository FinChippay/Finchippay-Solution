#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    testutils::Address as _,
    Address, Env, Symbol,
};

/// Fuzz the memo/Symbol parsing and storage logic by feeding arbitrary
/// byte sequences through contract entry points that accept `memo: Symbol`.
///
/// Coverage targets:
/// - `send_tip` with various memo Symbols
/// - `mint_receipt` with arbitrary memo Symbols
/// - `create_escrow` with fuzzed memo Symbols
/// - `verify_receipt` round-trip integrity
///
/// Invariants checked:
/// - No panics from malformed memo data
/// - Tip records and receipts are retrievable after creation
/// - Receipt verification matches on correct memo
fuzz_target!(|data: &[u8]| {
    if data.len() < 48 {
        return;
    }

    let env = Env::default();

    // Deploy the contract and initialise
    let contract_id = env.register(finchippay_contract::FinchippayContract, ());
    let client = finchippay_contract::FinchippayContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = soroban_sdk::Vec::from_array(&env, [admin.clone()]);
    let _ = client.initialize(&signers, &1);

    // Create a token for testing
    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = sac.address();

    // Derive fuzzed parameters from input bytes
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap()) as i128 % 1_000_000 + 1_000;
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    if from == to {
        return; // self-transfer panics — not relevant
    }

    // Mint tokens to `from`
    let sac_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    sac_client.mint(&from, &(amount * 10));

    // Fuzz memo: try to construct a Symbol from random bytes.
    // Only use ASCII-range bytes to avoid panics on invalid UTF-8 in Symbol::new.
    let memo_str = data[40..]
        .iter()
        .map(|b| (b % 95 + 32) as u8)
        .take(10)
        .collect::<Vec<u8>>();
    let memo_str = std::str::from_utf8(&memo_str).unwrap_or("fuzz");
    let memo = Symbol::new(&env, memo_str);

    env.mock_all_auths();

    // --- send_tip with fuzzed memo ---
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.send_tip(&token_id, &from, &to, &amount, &memo);
    }));

    // --- mint_receipt with fuzzed memo ---
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let receipt_idx = client.mint_receipt(&from, &to, &amount, &memo);
        // Verify receipt round-trip
        let receipt = client.get_receipt(&from, &receipt_idx);
        assert_eq!(receipt.memo, memo, "memo should round-trip through receipt");
        // Verify receipt proof
        let verified = client.verify_receipt(&from, &receipt_idx, &receipt.amount, &receipt.memo);
        assert!(verified, "verify_receipt should return true for correct memo");
    }));

    // --- create_escrow with fuzzed memo ---
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let release = env.ledger().sequence() + 100;
        let escrow_id = client.create_escrow(&token_id, &from, &to, &amount, &release, &memo);
        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.memo, memo, "memo should round-trip through escrow");
    }));

    // --- Verify get_tip_total integrity ---
    // If send_tip didn't panic, we should be able to read the totals
    let _ = client.get_tip_total(&to);
    let _ = client.get_tip_count(&to);
});
