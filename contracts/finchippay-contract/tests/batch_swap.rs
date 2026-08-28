#![cfg(test)]

use finchippay_contract::{FinchippayContractClient, SwapItem, TokenTotal};
use soroban_sdk::{testutils::Address as _, token, Address, Env, Vec};

fn deploy(env: &Env) -> (Address, FinchippayContractClient<'_>) {
    let id = env.register(finchippay_contract::FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let signers = Vec::from_array(env, [admin.clone()]);
    client.initialize(&signers, &1);
    (id, client)
}

fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let sac_client = token::StellarAssetClient::new(env, &token_id);
    sac_client.mint(to, &amount);
    token_id
}

#[test]
fn test_estimate_batch_swap_totals() {
    let env = Env::default();
    let (_id, client) = deploy(&env);
    let admin = client.get_admin();
    env.mock_all_auths();

    // Create two tokens and mint to addresses so addresses exist in ledger.
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let t1 = create_token(&env, &admin, &alice, 1000);
    let t2 = create_token(&env, &admin, &bob, 500);

    // Build swaps: two entries for t1 and one for t2
    let mut swaps: Vec<SwapItem> = Vec::new(&env);
    swaps.push_back(SwapItem {
        token: t1.clone(),
        amount: 100,
    });
    swaps.push_back(SwapItem {
        token: t2.clone(),
        amount: 50,
    });
    swaps.push_back(SwapItem {
        token: t1.clone(),
        amount: 25,
    });

    let totals: Vec<TokenTotal> = client.estimate_batch_swap_totals(&swaps);

    // Convert to Rust Vec for assertions
    let mut found_t1 = 0i128;
    let mut found_t2 = 0i128;
    for i in 0..totals.len() {
        let tt = totals.get(i).unwrap();
        if tt.token == t1 {
            found_t1 = tt.total;
        } else if tt.token == t2 {
            found_t2 = tt.total;
        }
    }

    assert_eq!(found_t1, 125);
    assert_eq!(found_t2, 50);
}
