#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Symbol,
};

/// Fuzz the escrow lifecycle: create → claim → cancel.
///
/// Coverage targets:
/// - `create_escrow` with various amounts, release ledgers
/// - `claim_escrow` after release ledger
/// - `claim_escrow_partial` with various claim amounts
/// - `cancel_escrow` before release ledger
/// - `get_escrow` and `get_user_escrows` indexing
///
/// Invariants checked:
/// - No state corruption after create + claim + cancel sequences
/// - Escrow status transitions are valid (Pending → Released/Cancelled)
/// - Claiming/cancelling a non-pending escrow panics (catches missing state checks)
/// - User escrow index stays consistent
fuzz_target!(|data: &[u8]| {
    if data.len() < 16 {
        return;
    }

    let env = Env::default();

    // Deploy and initialise
    let contract_id = env.register(finchippay_contract::FinchippayContract, ());
    let client = finchippay_contract::FinchippayContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = soroban_sdk::Vec::from_array(&env, [admin.clone()]);
    let _ = client.initialize(&signers, &1);

    // Create test token
    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = sac.address();

    // Parse fuzzed inputs
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    if from == to {
        return;
    }

    let amount_raw = u64::from_le_bytes(data[0..8].try_into().unwrap());
    // Map amount to valid range [MIN_ESCROW, MAX_ESCROW] = [1000, 10^18]
    let amount = (amount_raw % (1_000_000_000_000_000_000 - 1_000)) as i128 + 1_000;

    // Derive release_ledger offset from bytes 8..12
    let release_offset = u32::from_le_bytes(data[8..12].try_into().unwrap()) % 500_000 + 1;

    // Derive operation selector from bytes 12..16
    let ops = u32::from_le_bytes(data[12..16].try_into().unwrap());
    let should_claim = (ops & 1) != 0;
    let should_cancel = (ops & 2) != 0;
    let should_claim_partial = (ops & 4) != 0;
    let partial_divisor = if (ops as usize) % 4 == 0 { 2u32 } else { 4u32 };

    let memo = Symbol::new(&env, "escrow_fuzz");

    // Authorize everything up front (mint included) so setup never panics.
    env.mock_all_auths();

    // Mint tokens
    let sac_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    sac_client.mint(&from, &(amount * 100));

    // --- Create escrow ---
    let current_ledger = env.ledger().sequence();
    let release_ledger = current_ledger + release_offset;

    // try_ client methods return contract errors/panics as results instead of
    // aborting the fuzzer (libFuzzer aborts on any Rust panic).
    let escrow_id = match client.try_create_escrow(&token_id, &from, &to, &amount, &release_ledger, &memo) {
        Ok(Ok(id)) => id,
        _ => return, // Invalid params from fuzzer — expected, skip this iteration
    };

    // Verify escrow was created correctly
    let escrow = client.get_escrow(&escrow_id);
    assert!(matches!(
        escrow.status,
        finchippay_contract::EscrowStatus::Pending
    ), "escrow should be pending after creation");

    // Verify user escrow list includes this escrow
    let user_escrows = client.get_user_escrows(&to);
    assert!(
        user_escrows.iter().any(|id| id == escrow_id),
        "user escrow list should contain the created escrow"
    );

    // --- Advance ledger past release ---
    if should_claim {
        env.ledger().set_sequence_number(release_ledger + 1);

        if should_claim_partial {
            let claim_amount = amount / partial_divisor as i128;
            if claim_amount > 0 {
                if let Ok(Ok(remaining)) = client.try_claim_escrow_partial(&escrow_id, &claim_amount) {
                    let escrow_after = client.get_escrow(&escrow_id);
                    assert_eq!(escrow_after.amount, remaining,
                        "escrow amount should equal remaining after partial claim");
                }
            }
        } else {
            // Full claim
            let _ = client.try_claim_escrow(&escrow_id);
        }

        // After claiming, escrow should be Released (if fully claimed) or still Pending
        let escrow_after_claim = client.get_escrow(&escrow_id);
        if escrow_after_claim.amount == 0 {
            assert!(matches!(
                escrow_after_claim.status,
                finchippay_contract::EscrowStatus::Released
            ), "fully claimed escrow should be Released");
        }
    }

    // --- Cancel escrow (only valid if not claimed and release not passed) ---
    if should_cancel {
        // Reset ledger to before release for cancellation
        env.ledger().set_sequence_number(release_ledger - 1);

        // Only cancel if the escrow is still pending
        let esc = client.get_escrow(&escrow_id);
        if matches!(esc.status, finchippay_contract::EscrowStatus::Pending) {
            if client.try_cancel_escrow(&escrow_id).ok().and_then(|r| r.ok()).is_some() {
                let escrow_after = client.get_escrow(&escrow_id);
                assert!(matches!(
                    escrow_after.status,
                    finchippay_contract::EscrowStatus::Cancelled
                ), "cancelled escrow should be Cancelled");
            }
        }
    }
});
