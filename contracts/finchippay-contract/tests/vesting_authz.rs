//! # Vesting access-control (workstream 2)
//!
//! - `claim_vesting` / `revoke_vesting` now require the contract to be
//!   initialised (parity with `create_vesting`).
//! - `revoke_vesting` is gated by the **admin-signer set**, not the legacy
//!   single `Admin` key, mirroring pause/unpause/rescue_tokens.

use finchippay_contract::{FinchippayContract, FinchippayContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env, Vec};

fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    env.mock_all_auths();
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let sac_client = token::StellarAssetClient::new(env, &token_id);
    sac_client.mint(to, &amount);
    token_id
}

/// Deploy with an explicit admin-signer set (the first signer is the legacy
/// `Admin`; every signer is in the multi-sig set that gates privileged ops).
fn deploy_with_signers<'a>(
    env: &'a Env,
    signers: &[Address],
    threshold: u32,
) -> (Address, FinchippayContractClient<'a>) {
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let mut signer_vec = Vec::new(env);
    for a in signers {
        signer_vec.push_back(a.clone());
    }
    client.initialize(&signer_vec, &threshold);
    (id, client)
}

#[test]
fn test_claim_vesting_reverts_when_uninitialized() {
    let env = Env::default();
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(&env, &id);
    env.mock_all_auths();
    assert!(
        client
            .try_claim_vesting(&0, &Address::generate(&env))
            .is_err(),
        "claiming vesting before initialize must revert"
    );
}

#[test]
fn test_revoke_vesting_reverts_when_uninitialized() {
    let env = Env::default();
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(&env, &id);
    env.mock_all_auths();
    assert!(
        client
            .try_revoke_vesting(&0, &Address::generate(&env))
            .is_err(),
        "revoking vesting before initialize must revert"
    );
}

/// `revoke_vesting` must be authorized by the admin-signer set, not the legacy
/// single `Admin` key. A configured signer that is NOT the legacy admin may
/// revoke; a complete stranger may not.
#[test]
fn test_revoke_vesting_requires_admin_signer() {
    let env = Env::default();
    let s1 = Address::generate(&env); // legacy Admin AND signer
    let s2 = Address::generate(&env); // signer but NOT legacy admin
    let stranger = Address::generate(&env);
    let funder = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let (_, client) = deploy_with_signers(&env, &[s1.clone(), s2.clone()], 1);
    env.mock_all_auths();
    let token = create_token(&env, &s1, &funder, 10_000_000);

    let start = env.ledger().sequence();
    let vid = client.create_vesting(
        &token,
        &funder,
        &beneficiary,
        &1_000_000,
        &(start + 10),
        &(start + 20),
    );

    // Legacy-admin check alone is insufficient: a stranger fails...
    assert!(
        client.try_revoke_vesting(&vid, &stranger).is_err(),
        "a stranger must not be able to revoke vesting"
    );

    // ...but a real signer (s2, not the legacy Admin) is authorized (WS2).
    client.revoke_vesting(&vid, &s2);
    // revoked schedules no longer claimable
    assert_eq!(client.get_claimable_vesting(&vid), 0);
}
