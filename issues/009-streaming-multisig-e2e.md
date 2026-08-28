# Issue #9 — Integration Tests for Streaming & Multi-Sig UI Flows

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `testing` `e2e` `playwright` `streaming` `multisig`

> This is a testing issue for the GrantFox FWC26 campaign (Stellar Wave). Extend the Playwright E2E suite to cover the streaming payment and multi-sig UI flows end-to-end against testnet.

## Requirements and Context

`frontend/e2e/` already has `escrow.spec.ts`, `multi-sig.spec.ts`, `dashboard.spec.ts`, and `fixtures.ts`, but streaming flows and the full multi-signer collection path are under-tested. The roadmap lists "Integration tests for streaming and multi-sig UI flows" as open.

## Objectives
1. Add `frontend/e2e/streaming.spec.ts`: open stream → advance ledger → claim → verify on-chain balance delta.
2. Extend `frontend/e2e/multi-sig.spec.ts` to cover the full initiator → co-signer → submit path across browser contexts.
3. Assert against real on-chain state (Horizon/Soroban RPC) after each operation, not just UI text.
4. Keep tests hermetic (unique stream/proposal IDs per test) and deterministic.

## Suggested Execution
1. Fork and branch: `git checkout -b test/streaming-multisig-e2e`.
2. Add streaming tests and expand multi-sig tests in `frontend/e2e/`, reusing `fixtures.ts`.
3. Verify on-chain results via Horizon/Soroban RPC assertions.
4. Run `npm run test:e2e` locally against testnet; confirm no flakes across 2 runs.
5. Open a PR with `Closes #N`.

## Acceptance Criteria
- [ ] Streaming E2E tests cover open → claim → close with on-chain balance assertions.
- [ ] Multi-sig E2E tests cover the full multi-context initiator + co-signer → submit flow.
- [ ] Each test creates its own unique resources (hermetic) and passes consistently across 2 consecutive runs.
- [ ] Tests run against testnet (not mocked) and complete within the existing CI time budget.

## Guidelines
- Tests must be deterministic; no reliance on wall-clock timing beyond ledger advancement.
- Follow the existing `fixtures.ts` patterns; no hardcoded mainnet addresses.
- CI must stay green; document any new test data requirements.

## Timeframe
72 hours
