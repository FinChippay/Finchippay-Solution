# Issue #3 — Vesting Schedule Contract Extension

**Labels:** `contract` `feature` `soroban` `vesting`

## Summary
Add a vesting schedule feature to `FinchippayContract` that allows organisations to create token vesting schedules with cliffs, unlockable linearly over time.

## Background
The contract already has time-locked escrow (`create_escrow`, `claim_escrow`, `cancel_escrow`) and streaming payments. A `VestingSchedule` struct already exists in the codebase (`contracts/finchippay-contract/src/lib.rs` lines ~255-265) with fields `id`, `funder`, `token`, `beneficiary`, `total_amount`, `cliff_ledger`, `end_ledger`, `claimed`, `revoked`, and `DataKey::Vesting(u32)` and `DataKey::VestingCount` are defined in the `DataKey` enum. However, no implementation functions exist to create, claim, or revoke vesting schedules.

## Problem Statement
Organisations wanting to distribute tokens to team members or community contributors with a vesting schedule must use external tools or manual management. The struct and storage keys are defined but the implementation is missing — this is a prime opportunity to deliver high-value functionality.

## Objectives
1. Implement `create_vesting`, `claim_vesting`, and `revoke_vesting` (admin-only) functions.
2. Add `get_vesting` and `get_claimable_vesting` read-only functions.
3. Write comprehensive tests including cliff enforcement, linear unlock maths, and partial claims.

## Scope
- **In scope:** vesting schedule implementation, claim/revoke functions, unit tests, event emission.
- **Out of scope:** batch vesting creation, transferable vesting positions.

## Detailed Implementation Requirements

1. **Implement `create_vesting(env, token, from, beneficiary, amount, cliff_ledger, end_ledger) -> u32`:**
   - Call `from.require_auth()`.
   - Validate: `cliff_ledger < end_ledger`, `amount > 0`, `amount ≤ MAX_VESTING_AMOUNT`.
   - Validate: `end_ledger - cliff_ledger ≤ MAX_VESTING_DURATION_LEDGERS`.
   - Transfer total amount from `from` to the contract using `require_transfer_succeeded`.
   - Increment locked balance for the token.
   - Store the `VestingSchedule` struct, increment `VestingCount`.
   - Emit `("vesting_create", id, (from, beneficiary, amount, cliff_ledger, end_ledger))`.
   - Return the new vesting ID.

2. **Implement `claim_vesting(env, id, beneficiary)`:**
   - Call `beneficiary.require_auth()`.
   - Validate: vesting exists, not revoked, beneficiary matches.
   - Compute: `elapsed = current_ledger.saturating_sub(cliff_ledger)`. If `current_ledger < cliff_ledger`, return 0 (no panic).
   - Compute: `total_duration = end_ledger - cliff_ledger`.
   - Compute: `claimable = total_amount * elapsed / total_duration - claimed`.
   - Cap claimable at `total_amount - claimed`.
   - If claimable > 0, transfer from contract to beneficiary, update claimed, decrease locked balance.
   - Emit `("vesting_claim", id, (beneficiary, claimable))`.
   - Return claimable amount.

3. **Implement `revoke_vesting(env, id, admin)`:**
   - Call `admin.require_auth()`. Verify admin matches stored admin.
   - Validate: vesting exists, not already revoked.
   - Compute remaining = `total_amount - claimed`.
   - Transfer remaining from contract back to the funder.
   - Set `revoked = true`, decrease locked balance.
   - Emit `("vesting_revoke", id, (funder, remaining))`.

4. **Implement view functions:**
   - `get_vesting(env, id) -> Option<VestingSchedule>` — retrieve the full struct.
   - `get_claimable_vesting(env, id) -> i128` — compute and return the claimable amount without transferring.

5. **Tests (8+ tests):**
   - Full lifecycle: create → claim partial → claim remaining → fully vested.
   - Claim before cliff returns 0 without error.
   - Claim at cliff returns 0 (nothing vested yet).
   - Claim at end_ledger returns full remaining.
   - Revoke before cliff refunds all.
   - Revoke after partial claim refunds remaining.
   - Non-admin cannot revoke.
   - Beneficiary mismatch on claim fails.

## Expected Architecture

```
contracts/finchippay-contract/src/lib.rs
  + VestingSchedule struct (ALREADY DEFINED)
  + DataKey::Vesting(u32), DataKey::VestingCount (ALREADY DEFINED)
  + create_vesting(), claim_vesting(), revoke_vesting() (NEW)
  + get_vesting(), get_claimable_vesting() (NEW)
  + 8+ new tests
```

## Acceptance Criteria
- [ ] `cargo test` passes with ≥8 new vesting-specific tests.
- [ ] `cargo build --release --target wasm32-unknown-unknown` succeeds.
- [ ] `claim_vesting` before cliff returns 0 without error (no panic).
- [ ] After the end ledger, `get_claimable_vesting` returns the full remaining balance.
- [ ] `revoke_vesting` is only callable by the contract admin.
- [ ] All existing contract tests continue to pass.
