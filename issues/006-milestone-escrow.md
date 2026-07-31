# Issue #6 — Milestone-Based Escrow Releases Extension

**Labels:** `contract` `feature` `soroban` `escrow`

## Summary
Extend the existing time-locked escrow to support milestone-based conditional releases, where an escrow can be released in stages based on off-chain milestone approvals.

## Background
The current escrow system (`create_escrow`, `claim_escrow`, `cancel_escrow` in `lib.rs`) supports only time-locked single-release. The `EscrowStatus` enum has `Pending`, `Released`, `Cancelled`. There is no mechanism for partial or milestone-based releases.

## Problem Statement
Freelancers, contractors, and DAO contributors need milestone-based payment releases where funds are released gradually as milestones are approved by an escrow agent or client.

## Objectives
1. Extend the `Escrow` data structure to support milestone-based releases.
2. Implement `add_milestone`, `approve_milestone`, and `claim_milestone` functions.
3. Add escrow agent role for milestone approval.
4. Write tests for milestone lifecycle.

## Scope
- **In scope:** milestone escrow extension, agent role, partial release, unit tests.
- **Out of scope:** on-chain milestone verification, dispute resolution.

## Detailed Implementation Requirements

1. **Add `Milestone` struct:** Fields: `id: u32`, `description: Symbol`, `amount: i128`, `approved: bool`, `claimed: bool`, `approval_deadline_ledger: u32`.
2. **Extend `Escrow` struct:** Add optional `agent: Option<Address>`, `milestones: Vec<Milestone>`, `is_milestone_based: bool`.
3. **Add `DataKey::EscrowMilestone(u32, u32)`:** Maps (escrow_id, milestone_id) to Milestone.
4. **Implement `create_milestone_escrow(env, token, from, to, agent, milestones, deposit)`:**
   - Sum of milestone amounts must equal deposit.
   - Max 10 milestones per escrow.
   - Each milestone must have amount > 0.
   - Transfer total deposit to contract.
   - Emit `("milestone_escrow_created", id, milestone_count)`.
5. **Implement `approve_milestone(env, escrow_id, milestone_id, approver)`:**
   - Agent or client can approve.
   - Verify `approver == agent || approver == from`.
   - Mark milestone approved.
   - Emit `("milestone_approved", escrow_id, milestone_id)`.
6. **Implement `claim_milestone(env, escrow_id, milestone_id, recipient)`:**
   - Only the recipient (`to`) can claim.
   - Verify milestone is approved and not yet claimed.
   - Transfer milestone amount to recipient.
   - Mark milestone claimed.
   - After last milestone claimed, set escrow status to Released.
   - Emit `("milestone_claimed", escrow_id, milestone_id, amount)`.
7. **Modify `cancel_escrow`:** For milestone escrows, cancellation refunds only unapproved + unclaimed milestone amounts.
8. **View functions:** `get_milestones(env, escrow_id) -> Vec<Milestone>`, `get_escrow_summary(env, escrow_id)`.
9. **Tests:** Create milestone escrow, approve one milestone, claim it, verify partial release, cancel remaining, full lifecycle.

## Expected Architecture

```
contracts/finchippay-contract/src/lib.rs
  + Milestone struct
  ~ Extended Escrow struct (optional agent, Vec<Milestone>)
  + DataKey::EscrowMilestone
  + create_milestone_escrow(), approve_milestone(), claim_milestone()
  + get_milestones(), get_escrow_summary()
  ~ Modified cancel_escrow() for milestone escrows
  + 8+ new tests
```

## Acceptance Criteria
- [ ] `cargo test` passes with ≥8 new milestone escrow tests.
- [ ] Milestone escrows allow partial claim of individual milestones.
- [ ] Only the designated agent or client can approve milestones.
- [ ] Only the recipient can claim an approved milestone.
- [ ] Cancel refunds only unapproved+unclaimed amounts.
- [ ] Existing escrow tests continue to pass.
