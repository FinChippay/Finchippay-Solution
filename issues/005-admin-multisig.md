# Issue #5 — Admin Multi-Sig for Contract Governance

**Labels:** `contract` `security` `governance` `soroban`

## Summary
Upgrade the single-admin model in `FinchippayContract` to support N-of-M multi-signature governance for the `pause`, `unpause`, `upgrade`, `set_pauser`, and `rescue_tokens` admin functions.

## Background
Currently, the contract has a single `Admin` address (`get_admin()` in `lib.rs` line ~130) and an optional `Pauser`. The `upgrade()`, `pause()`, and `rescue_tokens()` functions require only the single admin's signature. For production deployments, this is a centralisation risk — a single compromised key can pause the contract or deploy a malicious upgrade.

## Problem Statement
Production deployments require multi-signature governance for admin operations to meet security best practices and pass third-party audits. The existing `set_admin_signers` and `get_admin_signers` functions provide emergency withdrawal multi-sig but not general admin governance.

## Objectives
1. Modify `initialize` to accept `(admin_signers, threshold)` instead of a single admin.
2. Implement `propose_admin_action` and `approve_admin_action` functions for async governance.
3. Modify all admin-gated functions to verify multi-sig approvals.
4. Maintain backward compatibility through a test helper.

## Scope
- **In scope:** admin multi-sig for pause/unpause/upgrade/set_pauser/rescue_tokens, unit tests.
- **Out of scope:** on-chain voting for non-admin parameters, timelock delays (future issue).

## Detailed Implementation Requirements

1. **Modify `initialize`:** Change signature to `initialize(env, admin_signers: Vec<Address>, threshold: u32)`. Validate threshold in [1, signers.len()] and signers.len() ≤ 20. Store signers and threshold. The stored `Admin` key becomes the primary admin (must be in signers). Add default `AdminSignersThreshold = threshold`, `AdminSigners = signers`.

2. **Add `DataKey::AdminActionCount` and `AdminActionProposal` struct:** Fields: `id`, `action_type: Symbol` (e.g., `"pause"`, `"upgrade"`, `"rescue"`), `action_data: Vec<Val>`, `approvals: Vec<Address>`, `threshold: u32`, `executed: bool`, `expiration_ledger: u32`.

3. **Implement `propose_admin_action(env, proposer, action_type, action_data)`:** Creates a proposal. No authentication needed to propose, but execution requires threshold. Emit `("admin_action_proposed", id, (action_type, proposer))`.

4. **Implement `approve_admin_action(env, proposal_id, approver)`:** Validates approver is in admin signers. Prevents double-approval. When approvals.len() ≥ threshold, auto-execute the action. Emit `("admin_action_approved", proposal_id, (approver, approvals.len(), threshold))`.

5. **Modify admin functions:** `pause(env, proposal_id)` and `upgrade(env, proposal_id, ...)` should only execute as actions triggered by an approved proposal. Keep the old single-admin path for backward compatibility behind a `#[cfg(test)]` feature flag.

6. **Update tests:** Modify all existing tests that call admin functions. Use `env.mock_all_auths()` for convenience.

## Expected Architecture

```
contracts/finchippay-contract/src/lib.rs
  ~ initialize() signature changes
  + propose_admin_action(), approve_admin_action()
  + AdminActionProposal struct
  + DataKey::AdminActionCount
  ~ Updated tests for multi-sig admin
```

## Acceptance Criteria
- [ ] `initialize` accepts a signer list and threshold; rejects invalid parameters.
- [ ] Admin functions (`pause`, `unpause`, `upgrade`, `rescue_tokens`) require multi-sig approval via proposals.
- [ ] Proposals auto-execute when approval threshold is met.
- [ ] All existing tests updated and passing (`cargo test`).
- [ ] `cargo build --release --target wasm32-unknown-unknown` succeeds.
