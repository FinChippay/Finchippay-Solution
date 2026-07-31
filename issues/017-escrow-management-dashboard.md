# Issue #17 — Escrow Management Dashboard UI

**Labels:** `frontend` `feature` `escrow` `dashboard` `ux`

## Summary
Build a comprehensive escrow management dashboard that displays all user escrows (active, pending, released) with real-time status, countdown timers, and one-click claim/cancel actions.

## Background
The frontend has an `Escrow` page (`frontend/pages/escrow.tsx`) and escrow is used in `frontend/components/EscrowPage.stories.tsx`. However, there is no dedicated escrow dashboard showing all active escrows, milestones, and dispute status. The contract supports escrow creation, claiming, cancellation, and milestone-based releases.

## Problem Statement
Users have no unified view of their escrows — they must check individual transactions. With the upcoming milestone and dispute features, a dedicated dashboard is essential for managing escrow activity.

## Objectives
1. Build a full escrow management dashboard at `/escrow/manage`.
2. Display escrows in three views: Active, Pending Release, Historical.
3. Add real-time countdown timers for release ledgers.
4. Implement one-click claim and cancel actions.
5. Add milestone progress visualization for milestone escrows.

## Scope
- **In scope:** escrow dashboard, status views, countdown timers, claim/cancel actions, milestone visualization.
- **Out of scope:** creating escrows from the dashboard (use SendPaymentForm).

## Detailed Implementation Requirements

1. **Contract integration:** Create `frontend/lib/escrowManager.ts`:
   - `getEscrows(publicKey)` — query contract storage for escrows associated with address.
   - Uses `get_escrow_by_recipient` and scans `EscrowCount` for escrows from address.
   - `claimEscrow(id)` — call contract `claim_escrow`.
   - `cancelEscrow(id, from)` — call contract `cancel_escrow`.
   - Cache escrow data in IndexedDB with 30s TTL for offline viewing.

2. **Dashboard page:** Create `frontend/pages/escrow/manage.tsx`:
   - Three tabs: Active (pending release), Completed (released/cancelled), Incoming (where user is recipient).
   - Each escrow card shows: amount, token, counterparty, release ledger, countdown, status badge.
   - Sort by: time remaining (ascending), amount (descending), date created.
   - Search/filter by counterparty address or amount range.

3. **Countdown component:** Create `frontend/components/EscrowCountdown.tsx`:
   - Real-time countdown: "Releases in 3d 12h 34m".
   - Color transitions: green (>7 days), yellow (1-7 days), red (<24 hours).
   - Auto-refresh countdown every second using `useEffect` with `setInterval`.
   - Show exact date/time on hover.

4. **Milestone visualization:** Create `frontend/components/MilestoneProgress.tsx`:
   - Horizontal stepper showing milestone status (pending/approved/claimed).
   - Connected by progress line with percentage complete.
   - Tooltip on each milestone showing amount and deadline.

5. **Actions:** Claim button (green) with confirmation dialog for release-eligible escrows. Cancel button (red) with reason prompt for cancel-eligible escrows. View on Explorer link.

6. **Notifications:** Subscribe to escrow events via the event indexer (Issue #8) to show real-time status changes.

7. **Tests:** Create `frontend/__tests__/EscrowManager.test.tsx` for the dashboard, countdown component, and milestone visualization. Update `frontend/e2e/escrow.spec.ts`.

## Expected Architecture

```
frontend/
├── lib/
│   └── escrowManager.ts       (NEW)
├── components/
│   ├── EscrowCountdown.tsx    (NEW)
│   └── MilestoneProgress.tsx  (NEW)
├── pages/
│   └── escrow/
│       └── manage.tsx         (NEW)
├── __tests__/
│   └── EscrowManager.test.tsx (NEW)
└── e2e/
    └── escrow.spec.ts         (UPDATE)
```

## Acceptance Criteria
- [ ] Dashboard shows all escrows where user is participant (from or to).
- [ ] Three views: Active, Completed, Incoming work correctly.
- [ ] Countdown timer updates in real-time with color coding.
- [ ] Claim button is active only when release ledger has passed.
- [ ] Cancel button is active only before release ledger and for the from address.
- [ ] Milestone visualization shows correct progress for milestone escrows.
- [ ] Search/filter works by counterparty address.
- [ ] All existing tests pass.
