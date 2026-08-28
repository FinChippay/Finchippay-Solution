# Issue #6 — DAO Treasury Multi-Sig Management UI

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `multisig` `governance` `help wanted`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Build a treasury dashboard for the contract's on-chain multi-sig governance: view proposals, track signer thresholds, and approve/reject admin actions from the UI.

## Requirements and Context

The contract exposes N-of-M multi-sig governance in `contracts/finchippay-contract/src/multi_sig.rs` (proposals, approvals, auto-execute at threshold) and `admin_action_proposed` / `admin_action_approved` events. The existing `frontend/components/MultiSigFlow.tsx` only covers the payment-sharing flow; there is no UI for *treasury governance* — the roadmap's "DAO treasury multi-sig management UI" remains open.

## Objectives
1. Create a `/treasury` page listing all multi-sig proposals and their approval progress.
2. Add proposal detail view: proposer, action type, payload, signers, threshold, status.
3. Add approve/reject actions that invoke the contract entrypoints via `frontend/lib/soroban.ts`.
4. Surface admin actions (`admin_action_proposed`/`admin_action_approved`) alongside payment proposals.

## Suggested Execution
1. Fork and branch: `git checkout -b feat/treasury-multisig-ui`.
2. Create `frontend/pages/treasury.tsx` and `frontend/components/ProposalCard.tsx` / `ProposalDetail.tsx`.
3. Add typed client methods to `frontend/lib/soroban.ts` for `approve_multisig`, `get_multisig`, and admin-action queries.
4. Poll/refresh on new `multisig_*` and `admin_action_*` events (reuse the event indexer API if available).
5. Add tests and Storybook stories; run `npm run lint && npm run type-check && npm test`.

## Acceptance Criteria
- [ ] `/treasury` lists proposals with approval progress (e.g. "2 of 3 signed") and status.
- [ ] Proposal detail shows proposer, action type, payload, signers, and threshold.
- [ ] Approve/reject calls the correct contract entrypoints and reflects the updated state.
- [ ] Empty, loading, and error states are handled.
- [ ] Component tests + Storybook stories; `npm run lint`, `npm run type-check`, `npm test` pass.

## Guidelines
- TypeScript strict; no `any`; `npm run type-check` clean.
- i18n via `t()`; WCAG 2.1 AA (keyboard navigable, focus management, aria-live for status updates).
- Responsive at 375px; touch targets ≥44px.

## Timeframe
96 hours
