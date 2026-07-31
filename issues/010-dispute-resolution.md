# Issue #10 — On-Chain Dispute Resolution for Escrow

**Labels:** `contract` `feature` `soroban` `escrow` `dispute`

## Summary
Add an on-chain dispute resolution mechanism to the escrow system, allowing a designated arbitrator to resolve disputes between escrow participants.

## Background
The current escrow system supports time-locked escrows (`create_escrow`, `claim_escrow`, `cancel_escrow`) and milestone-based escrows. However, there is no mechanism for dispute resolution — if the payer and recipient disagree, the funds remain locked until the release ledger. A dispute resolution system adds trust-minimised escrow for higher-value transactions.

## Problem Statement
For high-value transactions (e.g., freelancer payments, marketplace purchases), participants need a dispute resolution mechanism where a trusted arbitrator can adjudicate and release funds to the appropriate party.

## Objectives
1. Add `arbitrator` role to the escrow system.
2. Implement `raise_dispute`, `resolve_dispute` functions.
3. Implement `add_arbitrator`, `remove_arbitrator` admin functions.
4. Write comprehensive dispute lifecycle tests.

## Scope
- **In scope:** dispute creation, arbitrator resolution, arbitrator management.
- **Out of scope:** on-chain evidence submission, multi-arbitrator panels.

## Detailed Implementation Requirements

1. **Extend `Escrow` struct:** Add `arbitrator: Option<Address>`, `disputed: bool`, `dispute_raised_by: Option<Address>`, `dispute_raised_at: u32`.

2. **Add global storage:** `DataKey::Arbitrators` — a `Vec<Address>` of registered arbitrators. Add `DataKey::ArbitratorCount`.

3. **Implement `add_arbitrator(env, admin, arbitrator)`:**
   - Admin-only. Add address to global arbitrator list.
   - Emit `("arbitrator_added", arbitrator)`.

4. **Implement `remove_arbitrator(env, admin, arbitrator)`:**
   - Admin-only. Remove from list.
   - Emit `("arbitrator_removed", arbitrator)`.

5. **Implement `create_disputable_escrow(env, token, from, to, amount, release_ledger, arbitrator)`:**
   - Same as `create_escrow` but with designated arbitrator.
   - Arbitrator must be in the global list.
   - Emit `("disputable_escrow_created", id, arbitrator)`.

6. **Implement `raise_dispute(env, escrow_id, by)`:**
   - Call `by.require_auth()`. Only `from` or `to` can raise.
   - Validate: escrow exists, status = Pending, not already disputed.
   - Set `disputed = true`, `dispute_raised_by = by`, `dispute_raised_at = current_ledger`.
   - Emit `("dispute_raised", escrow_id, by)`.

7. **Implement `resolve_dispute(env, escrow_id, arbitrator, resolution: Symbol, to: Address, amount: i128)`:**
   - Validates: arbitrator is the designated arbitrator for this escrow.
   - Validates: escrow is disputed.
   - Resolution can be `"release"` (release amount to `to`), `"refund"` (refund amount to from), `"split"` (release amount to `to`, refund rest to `from`).
   - Transfer tokens accordingly.
   - Set escrow status to Released.
   - Emit `("dispute_resolved", escrow_id, resolution, to, amount)`.

8. **Tests:** Create disputable escrow, raise dispute by payer, raise dispute by recipient, resolve with release, resolve with refund, resolve with split, non-arbitrator cannot resolve, non-participant cannot raise dispute, cancel before dispute.

## Expected Architecture

```
contracts/finchippay-contract/src/lib.rs
  + DataKey::Arbitrators, DataKey::ArbitratorCount
  + add_arbitrator(), remove_arbitrator()
  ~ Extended Escrow: +arbitrator, +disputed, etc.
  + create_disputable_escrow(), raise_dispute(), resolve_dispute()
  + 9+ new tests
```

## Acceptance Criteria
- [ ] `cargo test` passes with ≥9 new dispute resolution tests.
- [ ] Only escrow participants can raise a dispute.
- [ ] Only the designated arbitrator can resolve a dispute.
- [ ] `resolve_dispute` supports release, refund, and split resolutions.
- [ ] Admin can add/remove arbitrators.
- [ ] Non-arbitrators cannot be assigned to disputable escrows.
- [ ] Existing escrow tests continue to pass.
