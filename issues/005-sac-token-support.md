# Issue #5 — SAC Token (USDC) Support Throughout the UI

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `assets` `tokens` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Make Stellar Asset Contract (SAC) tokens like USDC first-class citizens across payment, batch, escrow, streaming, and tip flows — not just the token browser.

## Requirements and Context

`frontend/lib/assetDiscovery.ts` and `frontend/pages/tokens.tsx` already list assets and manage trustlines, but the core money-movement flows are XLM-centric. The roadmap lists "USDC and other SAC token support throughout the UI" as open. SAC tokens use the same classic token interface but require correct issuer handling and trustline checks everywhere amounts are entered.

## Objectives
1. Normalise asset selection (code + issuer) into a reusable `AssetSelect` component.
2. Integrate `AssetSelect` into `SendPaymentForm`, `BatchPaymentForm`, escrow, and streaming forms.
3. Validate that the connected account holds a trustline to the selected asset before sign (with a clear "add trustline" affordance).
4. Display fiat-denominated values where a price feed is available, with a clear fallback when it isn't.

## Suggested Execution
1. Fork and branch: `git checkout -b feat/sac-asset-support`.
2. Create `frontend/components/AssetSelect.tsx` backed by `frontend/lib/assetDiscovery.ts`.
3. Swap XLM-only inputs for `AssetSelect` in the send/batch/escrow/streaming forms.
4. Add trustline checks and an "Add trustline" prompt reusing the `change_trust` path in `assetDiscovery.ts`.
5. Run `npm run lint && npm run type-check && npm test`; add component tests.

## Acceptance Criteria
- [ ] Users can select any SAC asset (e.g. USDC) in send, batch, escrow, and streaming forms by code + issuer.
- [ ] A missing trustline is detected before signing and the UI offers to add it.
- [ ] Amounts for SAC assets validate correctly (asset precision, not XLM stroops).
- [ ] Fiat estimate shows when a price feed is available and hides gracefully otherwise.
- [ ] Tests cover asset selection, trustline gating, and precision handling.

## Guidelines
- TypeScript strict; `npm run type-check` clean; no `any`.
- i18n via `t()` (no hardcoded user-facing strings).
- Responsive at 375px; touch targets ≥44px.

## Timeframe
72 hours
