# Issue #4 — Merkle-Tree Airdrop Contract Extension

**Labels:** `contract` `feature` `soroban` `airdrop`

## Summary
Add a Merkle-tree-based airdrop mechanism to `FinchippayContract` enabling gas-efficient token distributions to thousands of recipients.

## Background
The current `batch_send` function (`lib.rs` line ~590) is limited to 50 recipients per call and requires the sender to pay gas for every transfer inline. For large-scale airdrops, a Merkle-tree approach is far more efficient: the funder commits a single Merkle root, and each recipient claims their allocation by providing a Merkle proof. This reduces on-chain cost from O(n) to O(log n) per recipient.

## Problem Statement
Projects wanting to airdrop tokens to thousands of Stellar addresses have no efficient on-chain mechanism in Finchippay.

## Objectives
1. Implement `create_airdrop`, `claim_airdrop`, and `cancel_airdrop` functions.
2. Implement Merkle proof verification using SHA-256 hashing.
3. Write comprehensive tests with known Merkle trees.

## Scope
- **In scope:** Merkle proof verification, airdrop create/claim/cancel, unit tests with known Merkle trees.
- **Out of scope:** off-chain Merkle tree generation tooling (future issue), NFT airdrops.

## Detailed Implementation Requirements

1. **Data structures:** Define `MerkleAirdrop` struct with fields `id`, `funder`, `token`, `merkle_root: BytesN<32>`, `total_amount: i128`, `claimed_amount: i128`, `expiration_ledger: u32`, `cancelled: bool`.
2. **Storage keys:** Add `DataKey::Airdrop(u32)`, `DataKey::AirdropCount`, `DataKey::AirdropClaimed(u32, Address)`.
3. **Merkle verification:** Implement a pure `verify_merkle_proof(leaf: BytesN<32>, proof: Vec<BytesN<32>>, root: BytesN<32>) -> bool` helper. Use iterative SHA-256 hashing: start with `leaf`, then for each proof element, hash the concatenation of the current hash and the proof element (sorted — hash lower first as per standard Merkle tree conventions).
4. **Implement `create_airdrop(env, token, funder, merkle_root, total_amount, expiration_ledger)`:** Transfer total amount from funder to contract. Store airdrop. Emit event.
5. **Implement `claim_airdrop(env, id, recipient, amount, proof)`:** Verify proof for `hash(recipient, amount)`. Check not already claimed and airdrop not cancelled. Mark claimed. Transfer tokens. Emit event.
6. **Implement `cancel_airdrop(env, id, funder)`:** Only callable by funder after expiration. Refund unclaimed amount. Emit event.
7. **Tests:** Single-recipient tree, 3-recipient tree, invalid proof rejection, double-claim rejection, cancel after expiration, cancel before expiration (should fail).

## Expected Architecture

```
contracts/finchippay-contract/src/lib.rs
  + MerkleAirdrop struct
  + verify_merkle_proof() helper
  + DataKey::Airdrop*, DataKey::AirdropClaimed
  + create_airdrop(), claim_airdrop(), cancel_airdrop()
  + 6+ new tests
```

## Acceptance Criteria
- [ ] `cargo test` passes with ≥6 new airdrop-specific tests.
- [ ] Merkle proof verification correctly rejects invalid proofs.
- [ ] Double-claim attempt panics with appropriate error.
- [ ] Cancelled airdrop refunds unclaimed tokens to the funder.
- [ ] Expiration ledger enforcement works correctly.
- [ ] Existing contract tests continue to pass.
