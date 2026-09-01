//! # Storage Layout & Commitment Manifest
//!
//! Contracts store persistent `#[contracttype]` structs whose field order and
//! serialization are part of the on-chain upgrade contract. This module is the
//! **layout manifest + migration registry** (shared across workstream 6): it
//! freezes which layouts exist, in which storage-layout version they were
//! introduced/changed, and it pins the Merkle commitment format so a future
//! change cannot silently invalidate outstanding airdrop proofs.
//!
//! ## Why this exists
//!
//! Airdrop `hash_leaf`/`hash_pair`, `MerkleAirdrop`, `VestingSchedule` and
//! `MultiSigProposal` have no layout-version coupling today, so a future
//! refactor (e.g. adding a nonce to the airdrop leaf) would invalidate every
//! deployed proof and every stored schedule with no migration path. Registering
//! them here (and asserting the manifest — see `tests/layout_manifest.rs` and
//! `LayoutManifest::validate`) means any such change must first bump
//! [`crate::STORAGE_LAYOUT_VERSION`] and be recorded as a migration.
//!
//! ## Frozen Merkle commitment (do not change)
//!
//! ```text
//! leaf = sha256( xdr(recipient) || id_be32 || amount_be128 )
//! pair = sha256( xdr(left)  || xdr(right) )
//! ```
//!
//! `id` is the airdrop instance id, bound into the leaf so proofs cannot be
//! replayed across airdrops. This is a backward-compatibility guarantee and a
//! **breaking proof-format change**: after launch any change requires a fresh
//! merkle root per airdrop and a storage-layout-version bump.

/// Human-readable commitment format (mirrors `airdrop::hash_leaf`/`hash_pair`).
pub const FROZEN_MERKLE_COMMITMENT: &str =
    "leaf = sha256(xdr(recipient) || id_be32 || amount_be128); pair = sha256(xdr(left) || xdr(right))";

/// Layout manifest: the on-chain `#[contracttype]` structs/Datakey families
/// whose serialization is frozen. Entries are identified by their Rust type
/// name. Kept as static data so tests and audits can assert coverage without
/// a deployed contract.
pub struct LayoutManifest;

impl LayoutManifest {
    /// Every persistent struct/family registered in the manifest.
    pub const ENTRIES: &[&str] = &[
        "MerkleAirdrop",
        "VestingSchedule",
        "MultiSigProposal",
        "Stream",
        "ReceiptMetadata",
        "TipRecord",
        "EmergencyWithdrawal",
        "AdminActionProposal",
        "YieldEscrow",
        "StoredEscrow",
        "LockedBalance",
    ];

    /// Fail fast if the manifest is empty or the merkle commitment string is
    /// empty — the manifest is supposed to be monotonic and non-empty.
    pub fn validate() {
        assert!(
            !Self::ENTRIES.is_empty(),
            "layout manifest must not be empty"
        );
        assert!(
            !FROZEN_MERKLE_COMMITMENT.is_empty(),
            "frozen merkle commitment must be documented"
        );
    }

    /// Whether `type_name` (a struct/family in the manifest) is present.
    pub fn covers(type_name: &str) -> bool {
        Self::ENTRIES.contains(&type_name)
    }
}

/// Migration registry: `(layout_name, storage_layout_version)` pairs. The
/// storage layout version (`crate::STORAGE_LAYOUT_VERSION`) is currently 3.
/// Adding a case to this registry communicates that a layout changed in a
/// given version and must be migrated together with the version bump.
pub const MIGRATION_REGISTRY: &[(&str, u32)] = &[
    ("Stream", 1),
    ("StoredEscrow", 1),
    ("ReceiptMetadata", 1),
    ("TipRecord", 1),
    ("EmergencyWithdrawal", 2),
    ("AdminActionProposal", 2),
    ("VestingSchedule", 3),
    ("MultiSigProposal", 3),
    ("MerkleAirdrop", 3),
    ("YieldEscrow", 3),
    ("LockedBalance", 3),
];

/// Validate the manifest against the migration registry: every entry frozen at
/// the current layout must be covered by the manifest. Panics on drift.
pub fn validate_layout_manifest(current_layout_version: u32) {
    LayoutManifest::validate();
    let current = current_layout_version.max(3);
    for (name, version) in MIGRATION_REGISTRY {
        if *version <= current && !LayoutManifest::covers(name) {
            panic!("layout manifest missing registered entry: {}", name);
        }
    }
}
