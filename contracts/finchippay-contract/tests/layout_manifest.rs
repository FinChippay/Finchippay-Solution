//! # Layout Manifest & Migration Registry (workstream 6)
//!
//! Freezes the on-chain struct layouts (and the airdrop Merkle commitment) so
//! future refactors cannot silently invalidate outstanding proofs or stored
//! schedules. `src/layout.rs` is the registry; these tests pin that it covers
//! the airdrop/vesting/multi-sig structs (and their DataKey families) and is
//! consistent with `STORAGE_LAYOUT_VERSION` (3) at all times.

use finchippay_contract::layout::{
    validate_layout_manifest, LayoutManifest, FROZEN_MERKLE_COMMITMENT, MIGRATION_REGISTRY,
};
use finchippay_contract::{FinchippayContract, FinchippayContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

/// The three structs the issue calls out are all registered.
#[test]
fn manifest_covers_airdrop_vesting_multisig() {
    assert!(
        LayoutManifest::covers("MerkleAirdrop"),
        "MerkleAirdrop not in manifest"
    );
    assert!(
        LayoutManifest::covers("VestingSchedule"),
        "VestingSchedule not in manifest"
    );
    assert!(
        LayoutManifest::covers("MultiSigProposal"),
        "MultiSigProposal not in manifest"
    );
}

/// Every migration-registry entry is covered by the manifest, and the registry +
/// manifest are consistent with the current storage layout version (3).
#[test]
fn migration_registry_is_consistent_with_manifest_and_version() {
    // Validating against the current version must not panic.
    validate_layout_manifest(3);

    for (name, version) in MIGRATION_REGISTRY {
        assert!(*version >= 1, "migration versions start at 1");
        assert!(
            LayoutManifest::covers(name),
            "migration entry '{name}' missing from the layout manifest"
        );
    }
    assert!(
        !FROZEN_MERKLE_COMMITMENT.is_empty(),
        "the frozen merkle commitment must be documented"
    );
    // Cross-airdrop leaf binds the airdrop id (WS6 requirement).
    assert!(
        FROZEN_MERKLE_COMMITMENT.contains("id_be32"),
        "commitment docs must bind the airdrop id into the leaf"
    );
}

/// The deployed contract reports the same registry via its read-only view.
#[test]
fn contract_reports_layout_manifest_registry() {
    let env = Env::default();
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&Vec::from_array(&env, [admin.clone()]), &1);

    let manifest = client.get_storage_layout_manifest();
    assert!(
        manifest.len() as usize == MIGRATION_REGISTRY.len(),
        "contract view and registry count differ"
    );
    // Contains the migration-registry names (airdrop/vesting/multisig).
    let s_airdrop = Symbol::new(&env, "MerkleAirdrop");
    let s_vesting = Symbol::new(&env, "VestingSchedule");
    let s_multisig = Symbol::new(&env, "MultiSigProposal");
    let any = |sym: &Symbol| (0..manifest.len()).any(|i| (&manifest.get(i).unwrap().0) == sym);
    assert!(any(&s_airdrop), "manifest view misses MerkleAirdrop");
    assert!(any(&s_vesting), "manifest view misses VestingSchedule");
    assert!(any(&s_multisig), "manifest view misses MultiSigProposal");
    // MerkleAirdrop is registered frozen at the current storage layout version.
    let has_airdrop_v3 = (0..manifest.len()).any(|i| {
        let (sym, ver) = manifest.get(i).unwrap();
        sym == s_airdrop && ver == 3u32
    });
    assert!(
        has_airdrop_v3,
        "MerkleAirdrop must be registered against layout version 3"
    );
}
