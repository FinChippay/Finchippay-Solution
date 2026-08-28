# GrantFox FWC26 (Stellar Wave) — Implementation-Ready Issues for Finchippay-Solution

> **12 fresh, campaign-ready issues.** This set was rebuilt against the *current* codebase: every issue references real files, modules, and TODOs that exist today, targets **4–10 hours** of engineering work, and is scoped so an experienced contributor can complete it without clarification.
>
> Each issue follows the GrantFox FWC26 campaign format: **Description → Requirements and Context → Suggested Execution → Acceptance Criteria → Guidelines → Timeframe**.

## Campaign labels (required)

To appear inside the FWC26 campaign, every issue must carry the campaign tag **exactly**:

```
Official Campaign | FWC26, Stellar Wave, GrantFox OSS, Maybe Rewarded
```

---

## CONTRACT / SOROBAN (Issues #1–#3)

---

### Issue #1 — AMM/DeFi Integration for Yield Escrow

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `defi` `amm` `help wanted`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Turn the feature-gated `yield_escrow` scaffold into a real AMM integration: deposit escrowed funds into a liquidity pool for LP shares and return principal plus accrued yield at release.

**Requirements and Context**

`contracts/finchippay-contract/src/yield_escrow.rs` implements the full escrow lifecycle (`create_yield_escrow`, `claim_yield_escrow`, `cancel_yield_escrow`, `get_yield_escrow`) but the yield logic is stubbed out:

- `create_yield_escrow` records `shares = amount` (a 1:1 placeholder) instead of depositing into a pool.
- `pool_address` is set to `token_a.clone()` — a placeholder, not a real AMM contract.
- `claim_yield_escrow` / `cancel_yield_escrow` return principal only; no LP share withdrawal or yield computation.

The module header tracks the remaining work under `TODO(#amm-integration, #yield-escrow-v2)` and links the tracking issue. This is the highest-value open item on the project roadmap ("AMM/DeFi integration (yield_escrow TODOs)").

**Objectives**
1. Replace the placeholder `pool_address` with a configurable AMM pool contract (e.g. Soroswap/Comet-style interface) address stored on the escrow record.
2. In `create_yield_escrow`, transfer token A into the pool and record the actual LP `shares_received`.
3. In `claim_yield_escrow` / `cancel_yield_escrow`, withdraw the LP shares and pay out principal plus accrued yield (or refund the funder).
4. Add a mock AMM contract for tests and integration tests for the full lifecycle.

**Suggested Execution**
1. Fork the repo and create a branch: `git checkout -b feat/amm-yield-escrow`.
2. Implement pool deposit/withdraw in `contracts/finchippay-contract/src/yield_escrow.rs`, replacing the `// TODO(#amm-integration, ...)` markers.
3. Add a mock AMM (a minimal token-pair pool) under `contracts/finchippay-contract/tests/` or `src/test.rs`.
4. Add integration + fuzz tests for the yield escrow lifecycle (create → accrue → claim/cancel).
5. Run `cargo fmt --check && cargo clippy -- -D warnings && cargo test` and commit.
6. Open a PR with `Closes #N` in the description.

**Acceptance Criteria**
- [ ] `create_yield_escrow` deposits into a real (mock-testable) AMM pool and stores actual `shares_received`, not `amount`.
- [ ] `claim_yield_escrow` returns principal + accrued yield computed from LP share value.
- [ ] `cancel_yield_escrow` refunds the funder with principal + accrued yield.
- [ ] `pool_address` is validated and cannot be a placeholder/zero address.
- [ ] ≥5 new tests cover create/claim/cancel with a mock AMM, including a no-yield and a partial-withdraw case.
- [ ] `cargo test` and `cargo build --release --target wasm32v1-none` pass with no warnings.

**Guidelines**
- Minimum 95% test coverage on the changed module (`cargo test`).
- `require_auth` on every state-changing entrypoint; overflow-safe math via `checked_*` (no `unwrap()` in production paths).
- Clear `///` rustdoc on new public functions and events.

**Timeframe:** 96 hours

---

### Issue #2 — Stream Pause / Resume Entrypoints

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `streaming` `feature`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Add `pause_stream` and `resume_stream` entrypoints so a payer can freeze and unfreeze a payment stream without closing it.

**Requirements and Context**

The `Stream` struct in `contracts/finchippay-contract/src/types.rs` and `lib.rs` already tracks pause state:

```rust
pub paused_at_ledger: u32,
pub total_paused_duration: u32,
```

…and `claimable_at()` (in `lib.rs`) already subtracts `total_paused_duration` from the elapsed time when `paused_at_ledger > 0`. The **accounting is in place, but there are no `pause_stream` / `resume_stream` entrypoints** — nothing ever sets these fields, so the feature is unreachable. The roadmap lists "Stream pause / resume (contract extension)" as open.

**Objectives**
1. Implement `pause_stream(env, stream_id, payer)` — payer-only, sets `paused_at_ledger`, emits `stream_paused`.
2. Implement `resume_stream(env, stream_id, payer)` — payer-only, folds the paused duration into `total_paused_duration` and clears `paused_at_ledger`, emits `stream_resumed`.
3. Guard both against closed streams and non-payer callers.
4. Wire the events into `src/events.rs` and add tests for the pause/resume/claim arithmetic.

**Suggested Execution**
1. Fork and branch: `git checkout -b feat/stream-pause-resume`.
2. Implement the two entrypoints in `contracts/finchippay-contract/src/streams.rs`, reusing the existing `claimable_at` semantics.
3. Add `stream_paused` / `stream_resumed` to `src/events.rs`.
4. Add tests: pause stops accrual, resume resumes it, claimable is correct across multiple pause/resume cycles, non-payer call panics.
5. Run `cargo fmt --check && cargo clippy -- -D warnings && cargo test`, then open a PR.

**Acceptance Criteria**
- [ ] `pause_stream` is callable only by the payer and sets `paused_at_ledger`.
- [ ] `resume_stream` accumulates the paused span into `total_paused_duration` and clears `paused_at_ledger`.
- [ ] `claimable_at` returns 0 additional tokens while paused (no accrual during a pause).
- [ ] Multiple pause/resume cycles produce the same final claimable amount as an uninterrupted stream.
- [ ] Both entrypoints panic on closed streams and non-payer callers with descriptive messages.
- [ ] ≥5 new tests; `cargo test` and `cargo build --release --target wasm32v1-none` pass.

**Guidelines**
- Minimum 95% test coverage on the changed module; `require_auth` on every state-changing entrypoint.
- Overflow-safe math (`checked_*`/`saturating_*`); no `unwrap()` in production paths.
- Clear `///` rustdoc on new public functions.

**Timeframe:** 72 hours

---

### Issue #3 — Migrate Contract Events from publish() to #[contractevent]

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `events` `refactor`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Migrate the contract's `env.events().publish(...)` calls to the modern `#[contractevent]` macro for typed, self-describing events.

**Requirements and Context**

Every state change currently emits events via `env.events().publish((Symbol::new(...), id), (...))`. `src/events.rs` centralises the event symbol strings (tip_sent, escrow_created, stream_opened, …), and `lib.rs` carries a note that "the `#[contractevent]` macro is available in newer SDK versions". The roadmap lists "Contract event migration: `publish()` → `#[contractevent]` macro" as open. Typed events improve indexer reliability, SDK bindings, and auditability.

**Objectives**
1. Define `#[contracttype]` event structs for each event in the `src/events.rs` catalog.
2. Replace `env.events().publish(...)` call sites with `#[contractevent]`-derived emission.
3. Keep the event symbol names backward-compatible so the existing indexer (`backend/src/services/eventIndexer.js`) keeps working.
4. Update the event catalog docs in `src/events.rs` and any SDK bindings that reference event shapes.

**Suggested Execution**
1. Fork and branch: `git checkout -b refactor/contractevent-migration`.
2. Convert the event catalog in `src/events.rs` to typed `#[contracttype]` event structs + `#[contractevent]` impls.
3. Sweep `src/*.rs` replacing `env.events().publish(...)` with the new typed emitters.
4. Verify `cargo test` still passes and the indexer can still parse emitted topics/payloads.
5. Open a PR with `Closes #N`.

**Acceptance Criteria**
- [ ] All state-changing entrypoints emit typed `#[contractevent]` events.
- [ ] Event topic names (`tip_sent`, `escrow_created`, `stream_opened`, …) are unchanged.
- [ ] `backend/src/services/eventIndexer.js` parses the migrated events without changes (or documents a minimal, justified change).
- [ ] `src/events.rs` catalog is updated to list the new typed event definitions.
- [ ] `cargo test` and `cargo build --release --target wasm32v1-none` pass; `cargo clippy -- -D warnings` clean.

**Guidelines**
- Minimum 95% test coverage; no `unwrap()` in production paths.
- Keep event payloads ABI-stable unless a breaking change is explicitly documented in the PR.
- Clear `///` rustdoc on every event struct.

**Timeframe:** 48 hours

---

## FRONTEND (Issues #4–#6)

---

### Issue #4 — Multi-Network Switching (Testnet ↔ Mainnet) per Session

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `network` `ux` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Add a per-session network switcher so users can flip between Stellar testnet and mainnet without rebuilding or editing env vars.

**Requirements and Context**

Network configuration is currently baked in at build time via `frontend/lib/stellarConfig.ts` and `NEXT_PUBLIC_*` env vars. The roadmap lists "Multi-network switching (testnet ↔ mainnet) per-session" as a mainnet-readiness item. Users (especially testers and builders) need to switch networks from the UI, with clear visual indication of which network is active.

**Objectives**
1. Introduce a `NetworkProvider` context (`testnet` | `mainnet`) that supplies the active network passphrase, Horizon URL, and Soroban RPC URL.
2. Add a network switcher control to the Navbar with a prominent "testnet/mainnet" indicator.
3. Route all wallet, SDK, and contract calls through the active network config (no hardcoded `NEXT_PUBLIC_*` reads in components).
4. Persist the selection per session (and warn before signing mainnet transactions).

**Suggested Execution**
1. Fork and branch: `git checkout -b feat/network-switcher`.
2. Create `frontend/lib/NetworkContext.tsx` and refactor `stellarConfig.ts` into a per-network resolver.
3. Replace direct env-var reads in `frontend/lib/soroban.ts`, `wallet.ts`, `stellar.ts`, and `sdk-instance.ts` with context-driven values.
4. Add the switcher to `frontend/components/Navbar.tsx` with a clear active-network badge.
5. Add tests for network resolution and the switcher; run `npm run lint && npm run type-check && npm test`.

**Acceptance Criteria**
- [ ] Users can switch between testnet and mainnet from the Navbar without a rebuild.
- [ ] The active network is always visible (badge/color) and persisted for the session.
- [ ] Wallet connect, payments, Soroban contract calls, and SDK calls all use the active network's passphrase/RPC URLs.
- [ ] A confirmation prompt appears before signing on mainnet.
- [ ] Unit tests cover network resolution and switching; `npm run lint`, `npm run type-check`, and `npm test` pass.

**Guidelines**
- TypeScript strict (no `any`); `npm run type-check` clean.
- Follow existing context/hook patterns (`useWallet`, `ThemeContext`).
- WCAG 2.1 AA: network state conveyed by more than color; touch target ≥44px.

**Timeframe:** 72 hours

---

### Issue #5 — SAC Token (USDC) Support Throughout the UI

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `assets` `tokens` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Make Stellar Asset Contract (SAC) tokens like USDC first-class citizens across payment, batch, escrow, streaming, and tip flows — not just the token browser.

**Requirements and Context**

`frontend/lib/assetDiscovery.ts` and `frontend/pages/tokens.tsx` already list assets and manage trustlines, but the core money-movement flows are XLM-centric. The roadmap lists "USDC and other SAC token support throughout the UI" as open. SAC tokens use the same classic token interface but require correct issuer handling and trustline checks everywhere amounts are entered.

**Objectives**
1. Normalise asset selection (code + issuer) into a reusable `AssetSelect` component.
2. Integrate `AssetSelect` into `SendPaymentForm`, `BatchPaymentForm`, escrow, and streaming forms.
3. Validate that the connected account holds a trustline to the selected asset before sign (with a clear "add trustline" affordance).
4. Display fiat-denominated values where a price feed is available, with a clear fallback when it isn't.

**Suggested Execution**
1. Fork and branch: `git checkout -b feat/sac-asset-support`.
2. Create `frontend/components/AssetSelect.tsx` backed by `frontend/lib/assetDiscovery.ts`.
3. Swap XLM-only inputs for `AssetSelect` in the send/batch/escrow/streaming forms.
4. Add trustline checks and an "Add trustline" prompt reusing the `change_trust` path in `assetDiscovery.ts`.
5. Run `npm run lint && npm run type-check && npm test`; add component tests.

**Acceptance Criteria**
- [ ] Users can select any SAC asset (e.g. USDC) in send, batch, escrow, and streaming forms by code + issuer.
- [ ] A missing trustline is detected before signing and the UI offers to add it.
- [ ] Amounts for SAC assets validate correctly (asset precision, not XLM stroops).
- [ ] Fiat estimate shows when a price feed is available and hides gracefully otherwise.
- [ ] Tests cover asset selection, trustline gating, and precision handling.

**Guidelines**
- TypeScript strict; `npm run type-check` clean; no `any`.
- i18n via `t()` (no hardcoded user-facing strings).
- Responsive at 375px; touch targets ≥44px.

**Timeframe:** 72 hours

---

### Issue #6 — DAO Treasury Multi-Sig Management UI

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `multisig` `governance` `help wanted`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Build a treasury dashboard for the contract's on-chain multi-sig governance: view proposals, track signer thresholds, and approve/reject admin actions from the UI.

**Requirements and Context**

The contract exposes N-of-M multi-sig governance in `contracts/finchippay-contract/src/multi_sig.rs` (proposals, approvals, auto-execute at threshold) and `admin_action_proposed` / `admin_action_approved` events. The existing `frontend/components/MultiSigFlow.tsx` only covers the payment-sharing flow; there is no UI for *treasury governance* — the roadmap's "DAO treasury multi-sig management UI" remains open.

**Objectives**
1. Create a `/treasury` page listing all multi-sig proposals and their approval progress.
2. Add proposal detail view: proposer, action type, payload, signers, threshold, status.
3. Add approve/reject actions that invoke the contract entrypoints via `frontend/lib/soroban.ts`.
4. Surface admin actions (`admin_action_proposed`/`admin_action_approved`) alongside payment proposals.

**Suggested Execution**
1. Fork and branch: `git checkout -b feat/treasury-multisig-ui`.
2. Create `frontend/pages/treasury.tsx` and `frontend/components/ProposalCard.tsx` / `ProposalDetail.tsx`.
3. Add typed client methods to `frontend/lib/soroban.ts` for `approve_multisig`, `get_multisig`, and admin-action queries.
4. Poll/refresh on new `multisig_*` and `admin_action_*` events (reuse the event indexer API if available).
5. Add tests and Storybook stories; run `npm run lint && npm run type-check && npm test`.

**Acceptance Criteria**
- [ ] `/treasury` lists proposals with approval progress (e.g. "2 of 3 signed") and status.
- [ ] Proposal detail shows proposer, action type, payload, signers, and threshold.
- [ ] Approve/reject calls the correct contract entrypoints and reflects the updated state.
- [ ] Empty, loading, and error states are handled.
- [ ] Component tests + Storybook stories; `npm run lint`, `npm run type-check`, `npm test` pass.

**Guidelines**
- TypeScript strict; no `any`; `npm run type-check` clean.
- i18n via `t()`; WCAG 2.1 AA (keyboard navigable, focus management, aria-live for status updates).
- Responsive at 375px; touch targets ≥44px.

**Timeframe:** 96 hours

---

## SDK / CROSS-CUTTING (Issue #7)

---

### Issue #7 — Multi-Language SDK Generation (Python, Go, Rust)

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `sdk` `api` `developer-experience` `help wanted`

> This is an sdk issue for the GrantFox FWC26 campaign (Stellar Wave). Generate Python, Go, and Rust client libraries from the backend's OpenAPI spec so non-TS developers can integrate Finchippay.

**Requirements and Context**

The backend exposes a Swagger/OpenAPI 3.0 spec at `/api/docs.json` (`backend/src/swagger.js`), and the TypeScript SDK lives in `sdk/` (`client.ts`, `types.ts`, `index.ts`). The roadmap lists "Multi-language SDKs (Python, Go, Rust) with generated bindings" as open. A generated, typed client in each language removes hours of hand-written HTTP for integrators.

**Objectives**
1. Add OpenAPI-based generation for Python, Go, and Rust clients.
2. Wrap each generated client with a thin hand-written layer for SEP-0010 auth and error handling.
3. Add usage examples (README + one runnable example per language).
4. Add a CI job that regenerates and typechecks/compiles each SDK so bindings can't drift.

**Suggested Execution**
1. Fork and branch: `git checkout -b feat/multilang-sdk`.
2. Use `openapi-generator-cli` (or per-language generators) against `backend/src/swagger.js` output to scaffold `sdk/python`, `sdk/go`, `sdk/rust`.
3. Add auth/error wrappers and a `README.md` with a working example in each language.
4. Add a CI step (`.github/workflows/sdk-check.yml` or a new job) that regenerates and builds all SDKs.
5. Open a PR with `Closes #N`.

**Acceptance Criteria**
- [ ] Python, Go, and Rust clients are generated from the OpenAPI spec and build/run.
- [ ] Each SDK provides typed methods for the core endpoints (accounts, payments, analytics, auth).
- [ ] Each SDK handles SEP-0010 auth and returns structured errors.
- [ ] A CI job regenerates and compiles all SDKs, failing on drift.
- [ ] README examples runnable with a local backend (`npm run dev`).

**Guidelines**
- Generated code is reproducible (generator config committed); hand-written wrappers are idiomatic per language.
- No secrets or tokens committed; use env vars/args for auth.
- Document regeneration commands in the SDK README.

**Timeframe:** 96 hours

---

## DEVOPS / QA / SECURITY (Issues #8–#12)

---

### Issue #8 — Mainnet Deployment + On-Chain Verification

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `devops` `contract` `deployment` `verification`

> This is a devops issue for the GrantFox FWC26 campaign (Stellar Wave). Promote the existing testnet deploy pipeline to a mainnet-ready, hash-verified deployment with a manual approval gate.

**Requirements and Context**

`.github/workflows/contract-deploy.yml` and `scripts/deploy-contract.sh` already build the WASM, deploy to **testnet**, and verify the on-chain hash. The roadmap lists "Mainnet contract deployment + verification" as open. Mainnet deployment needs the same build→hash→deploy→verify flow, plus a required-approver gate and a documented rollback/upgrade path.

**Objectives**
1. Add a mainnet deployment target to the workflow behind a manual approval gate (GitHub Environments).
2. Reuse the existing WASM hash computation to verify the deployed code matches the build artifact.
3. Document the upgrade path (`upgrade(new_wasm_hash)`) and emergency rollback procedure.
4. Add a verification badge and `docs/contract-verification.md` covering independent verification.

**Suggested Execution**
1. Fork and branch: `git checkout -b feat/mainnet-deploy`.
2. Extend `.github/workflows/contract-deploy.yml` with a `mainnet` environment + required reviewers.
3. Add `--network mainnet` support and hash-verify steps to `scripts/deploy-contract.sh`.
4. Write `docs/contract-verification.md` and add a verification badge to `README.md`.
5. Validate the workflow with a testnet dry-run; open a PR.

**Acceptance Criteria**
- [ ] Mainnet deployment requires manual approval via a protected GitHub Environment.
- [ ] The on-chain WASM hash is verified to match the CI build artifact before the deploy is considered successful.
- [ ] `docs/contract-verification.md` documents independent verification and the `upgrade()` rollback path.
- [ ] A contract verification badge is present in `README.md`.
- [ ] A testnet dry-run of the updated pipeline succeeds.

**Guidelines**
- Never commit mainnet keys or secrets; use GitHub Actions secrets.
- Failed verification must fail the workflow with a descriptive error.
- Document all manual steps for operators.

**Timeframe:** 72 hours

---

### Issue #9 — Integration Tests for Streaming & Multi-Sig UI Flows

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `testing` `e2e` `playwright` `streaming` `multisig`

> This is a testing issue for the GrantFox FWC26 campaign (Stellar Wave). Extend the Playwright E2E suite to cover the streaming payment and multi-sig UI flows end-to-end against testnet.

**Requirements and Context**

`frontend/e2e/` already has `escrow.spec.ts`, `multi-sig.spec.ts`, `dashboard.spec.ts`, and `fixtures.ts`, but streaming flows and the full multi-signer collection path are under-tested. The roadmap lists "Integration tests for streaming and multi-sig UI flows" as open.

**Objectives**
1. Add `frontend/e2e/streaming.spec.ts`: open stream → advance ledger → claim → verify on-chain balance delta.
2. Extend `frontend/e2e/multi-sig.spec.ts` to cover the full initiator → co-signer → submit path across browser contexts.
3. Assert against real on-chain state (Horizon/Soroban RPC) after each operation, not just UI text.
4. Keep tests hermetic (unique stream/proposal IDs per test) and deterministic.

**Suggested Execution**
1. Fork and branch: `git checkout -b test/streaming-multisig-e2e`.
2. Add streaming tests and expand multi-sig tests in `frontend/e2e/`, reusing `fixtures.ts`.
3. Verify on-chain results via Horizon/Soroban RPC assertions.
4. Run `npm run test:e2e` locally against testnet; confirm no flakes across 2 runs.
5. Open a PR with `Closes #N`.

**Acceptance Criteria**
- [ ] Streaming E2E tests cover open → claim → close with on-chain balance assertions.
- [ ] Multi-sig E2E tests cover the full multi-context initiator + co-signer → submit flow.
- [ ] Each test creates its own unique resources (hermetic) and passes consistently across 2 consecutive runs.
- [ ] Tests run against testnet (not mocked) and complete within the existing CI time budget.

**Guidelines**
- Tests must be deterministic; no reliance on wall-clock timing beyond ledger advancement.
- Follow the existing `fixtures.ts` patterns; no hardcoded mainnet addresses.
- CI must stay green; document any new test data requirements.

**Timeframe:** 72 hours

---

### Issue #10 — Raise Test Coverage to 80%+ Across Components

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `testing` `coverage` `good first issue`

> This is a testing issue for the GrantFox FWC26 campaign (Stellar Wave). Raise the frontend test coverage to the project's stated 80% lines / 70% branches / 75% functions threshold and enforce it in CI.

**Requirements and Context**

The roadmap sets coverage thresholds of 80% lines / 70% branches / 75% functions ("Increase test coverage to 80%+ across all components" is still open). The frontend has many components with thin or missing unit coverage. This is an ideal first contribution: mechanical, well-bounded, and easy to review incrementally.

**Objectives**
1. Identify the lowest-coverage components from the existing Jest coverage report.
2. Add focused unit tests for uncovered branches in `frontend/components/` and `frontend/lib/`.
3. Enable/verify the coverage thresholds in the Jest config and CI.
4. Document how to run the coverage report locally.

**Suggested Execution**
1. Fork and branch: `git checkout -b test/coverage-80`.
2. Run `npm test -- --coverage` in `frontend/` and list the least-covered files.
3. Add tests until the 80/70/75 thresholds pass; prioritise lib utilities and form validation.
4. Confirm thresholds are enforced in CI (`.github/workflows/ci-core.yml` or Jest config).
5. Open a PR with `Closes #N`; include a before/after coverage snippet.

**Acceptance Criteria**
- [ ] `npm test -- --coverage` reports ≥80% lines, ≥70% branches, ≥75% functions for the frontend.
- [ ] Coverage thresholds are enforced in CI so a drop fails the build.
- [ ] New tests are meaningful (assert behaviour, not snapshots-only) and pass.
- [ ] `npm run lint` and `npm run type-check` pass.

**Guidelines**
- Follow existing test conventions in `frontend/__tests__/`.
- Don't lower thresholds or add `/* istanbul ignore */` to pass — exceptions need a documented rationale.
- Keep PRs scoped to coverage only (no unrelated refactors).

**Timeframe:** 48 hours

---

### Issue #11 — Bundle Size Monitoring

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `devops` `performance` `bundle-size` `ci`

> This is a devops issue for the GrantFox FWC26 campaign (Stellar Wave). Add automated bundle-size budgets to CI so PRs can't silently regress the frontend's JS payload.

**Requirements and Context**

The frontend has grown many large pages/components and uses dynamic imports, but there is no `size-limit`/`bundlesize` check (`.size-limit.js` does not exist). Bundle creep degrades load time, especially on mobile. A CI budget makes regressions visible at review time.

**Objectives**
1. Add `size-limit` (or `@size-limit/preset-app`) as a dev dependency.
2. Define per-page and total-JS budgets in a `frontend/.size-limit.js` config.
3. Add a CI step that runs the size check and fails on overages.
4. Document the budgets and how to update them deliberately.

**Suggested Execution**
1. Fork and branch: `git checkout -b feat/bundle-size-budget`.
2. Add `size-limit` + a `"size": "size-limit"` script in `frontend/package.json`.
3. Create `frontend/.size-limit.js` with budgets for `_app`, `dashboard`, `escrow`, and total JS.
4. Add a `size` step to the frontend CI job (`.github/workflows/ci-core.yml`).
5. Document budgets in `frontend/PERFORMANCE.md`; open a PR with `Closes #N`.

**Acceptance Criteria**
- [ ] `npm run size` measures the production build against the configured budgets.
- [ ] CI fails when any budget is exceeded.
- [ ] Budgets are initialised to current sizes with a small headroom (documented baseline).
- [ ] `frontend/PERFORMANCE.md` documents the budgets and the process to change them.

**Guidelines**
- Budgets are a baseline, not a ceiling to hit — document how to raise them responsibly.
- No new runtime dependencies beyond the size-limit tooling.

**Timeframe:** 48 hours

---

### Issue #12 — Third-Party Security Audit Preparation

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `security` `documentation` `audit`

> This is a security/documentation issue for the GrantFox FWC26 campaign (Stellar Wave). Prepare the contract for a third-party audit by formalising the threat model, invariant list, and audit test matrix.

**Requirements and Context**

The project already ships `SECURITY.md`, `docs/SECURITY_AUDIT_FRAMEWORK.md`, and on-chain invariant assertions (`assert_invariants` / `check_invariants` in `contracts/finchippay-contract/src/lib.rs`). The roadmap's "Third-party security audit of FinchippayContract" remains open. A real audit requires a professional firm, but a contributor can produce the *audit-ready artefacts* that make the engagement fast and credible.

**Objectives**
1. Write a threat model covering tips, escrow, streams, multi-sig, batch, yield escrow, and emergency withdrawal.
2. Consolidate the invariants (storage, arithmetic, authz, locked-balance) into a single checklist with the code that enforces each.
3. Produce an audit test matrix (attack → precondition → expected result → existing test).
4. Draft an audit scope statement for an external firm.

**Suggested Execution**
1. Fork and branch: `git checkout -b docs/audit-prep`.
2. Create `docs/audit/threat-model.md`, `docs/audit/invariants.md`, and `docs/audit/test-matrix.md`.
3. Cross-reference each invariant against `assert_invariants` and existing tests.
4. Link the docs from `docs/SECURITY_AUDIT_FRAMEWORK.md` and `SECURITY.md`.
5. Open a PR with `Closes #N`.

**Acceptance Criteria**
- [ ] Threat model covers all value-transferring entrypoints and actor roles.
- [ ] Invariant checklist maps every invariant to the enforcing code path and a test.
- [ ] Test matrix lists ≥10 attack scenarios with expected outcomes and links to tests.
- [ ] Audit scope statement is ready to hand to an external firm.
- [ ] Docs are linked from `SECURITY.md` and the audit framework.

**Guidelines**
- No secrets or private findings in the PR; report real vulnerabilities to `security@finchippay.dev` per `SECURITY.md`.
- Be precise and traceable — every claim links to a file/line.

**Timeframe:** 72 hours

---

## Summary

| # | Domain | Title | Difficulty |
|---|--------|-------|-----------|
| 1 | Contract | AMM/DeFi Integration for Yield Escrow | Advanced |
| 2 | Contract | Stream Pause / Resume Entrypoints | Intermediate |
| 3 | Contract | Migrate Contract Events to #[contractevent] | Intermediate |
| 4 | Frontend | Multi-Network Switching (Testnet ↔ Mainnet) | Intermediate |
| 5 | Frontend | SAC Token (USDC) Support Throughout the UI | Intermediate |
| 6 | Frontend | DAO Treasury Multi-Sig Management UI | Advanced |
| 7 | SDK | Multi-Language SDK Generation (Python, Go, Rust) | Advanced |
| 8 | DevOps | Mainnet Deployment + On-Chain Verification | Intermediate |
| 9 | QA | Integration Tests for Streaming & Multi-Sig Flows | Intermediate |
| 10 | QA | Raise Test Coverage to 80%+ | Good first issue |
| 11 | DevOps | Bundle Size Monitoring | Intermediate |
| 12 | Security | Third-Party Security Audit Preparation | Intermediate |
