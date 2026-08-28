# GrantFox FWC26 (Stellar Wave) — Batch 2: 40 Implementation-Ready Issues

> 40 additional, genuinely-open issues for the FWC26 campaign. Numbered #13–#52 to continue the existing set (#1–#12 in `GRANTFOX_ISSUES.md`). Every issue references real files and follows the campaign format: **Description → Requirements and Context → Suggested Execution → Acceptance Criteria → Guidelines → Timeframe**.
>
> Campaign labels (required, applied verbatim): `Official Campaign | FWC26`, `Stellar Wave`, `GrantFox OSS`, `Maybe Rewarded`.

---

## SMART CONTRACTS (Issues #13–#25)

---

### Issue #13 — On-Chain Price Oracle for Yield Escrow

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `oracle` `defi` `help wanted`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Integrate a Stellar-native price oracle so `yield_escrow` can price LP shares and compute yield in real terms instead of the 1:1 placeholder.

**Requirements and Context**
`contracts/finchippay-contract/src/yield_escrow.rs` uses `shares = amount` (1:1 placeholder) because there is no price source on-chain. Soroban supports cross-contract calls to price-oracle contracts (e.g. Reflector/Stellar price feeds) plus a time-weighted median. Without a real price feed, yield accounting is incorrect once an AMM is wired in (Issue #1).

**Objectives**
1. Add a `DataKey::Oracle` storing a configurable oracle contract address + staleness threshold.
2. Add admin functions `set_oracle` / `unset_oracle`.
3. Add a `get_price(env, pair) -> i128` helper that calls the oracle and enforces a staleness bound.
4. Use the price to compute LP-share value in `claim_yield_escrow` / `cancel_yield_escrow`.

**Suggested Execution**
1. `git checkout -b feat/yield-oracle`.
2. Implement the oracle client + staleness check in `src/yield_escrow.rs`.
3. Add a mock oracle in tests; cover stale-price rejection and admin authz.
4. Run `cargo fmt --check && cargo clippy -- -D warnings && cargo test`.

**Acceptance Criteria**
- [ ] Admin can set/unset an oracle address; non-admin calls panic.
- [ ] `get_price` rejects data older than the staleness threshold.
- [ ] Yield escrow claim/cancel uses the oracle price when set, falling back to the 1:1 path only when no oracle is configured.
- [ ] ≥4 tests incl. stale oracle and authz; `cargo test` + `wasm32v1-none` build pass.

**Guidelines**
- ≥95% test coverage on the changed module; `require_auth` on state-changing entrypoints; no `unwrap()` in production paths; clear rustdoc.

**Timeframe:** 96 hours

---

### Issue #14 — Milestone-Based Escrow Releases

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `escrow` `feature`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Add multi-milestone escrows so a funder can release funds in tranches tied to deliverables, rather than a single all-or-nothing release.

**Requirements and Context**
`src/escrow.rs` supports a single `release_ledger` per escrow. There is no milestone/tranche model. Freelance and grant payouts need staged releases (e.g. 40/40/20). This is listed in the roadmap's "Ideas" ("Milestone-based escrow releases").

**Objectives**
1. Add `MilestoneEscrow` with `Vec<(amount, release_ledger)>` and per-tranche `claimed` flags.
2. Implement `create_milestone_escrow`, `claim_milestone(index)`, `cancel_milestone_escrow`.
3. Emit `milestone_created` / `milestone_claimed` / `milestone_cancelled`.
4. Refund unclaimed tranches on cancel; enforce locked-balance accounting per tranche.

**Suggested Execution**
1. `git checkout -b feat/milestone-escrow`.
2. Extend `src/escrow.rs` (or a new `src/milestone_escrow.rs`) reusing `increase/decrease_locked_balance`.
3. Add tests: out-of-order claim, double-claim, cancel-with-partial-claims.
4. Run `cargo fmt --check && cargo clippy -- -D warnings && cargo test`.

**Acceptance Criteria**
- [ ] A milestone escrow releases each tranche only after its `release_ledger`.
- [ ] Partial claims are tracked per tranche; double-claim panics.
- [ ] Cancel refunds only unreleased/ unclaimed tranches.
- [ ] Locked-balance accounting stays consistent (`check_invariants` passes).
- [ ] ≥6 tests; `cargo test` + `wasm32v1-none` build pass.

**Guidelines**
- ≥95% test coverage; overflow-safe math; `require_auth` on every state change; no `unwrap()`.

**Timeframe:** 96 hours

---

### Issue #15 — Recurring Subscription Streams (Auto-Renew)

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `streaming` `feature`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Extend payment streams with a subscription model: an authorised operator auto-tops-up a stream from the payer each period, enabling true on-chain subscriptions.

**Requirements and Context**
`src/streams.rs` supports open/claim/top-up/close but top-up requires the payer's signature each time. Subscriptions need a payer pre-authorised allowance so a trusted relayer can renew the stream per period. The roadmap lists "Subscription/recurring payments via Soroban streams".

**Objectives**
1. Add `DataKey::StreamAllowance(stream_id)` storing an authorised spender + per-period cap.
2. Implement `set_stream_allowance(stream_id, spender, max_per_period)` (payer-only).
3. Implement `renew_stream(stream_id, spender, amount)` that tops up within the cap.
4. Emit `stream_renewed`; track renewals so a period cap is enforced.

**Suggested Execution**
1. `git checkout -b feat/subscription-streams`.
2. Extend `src/streams.rs` with allowance + renew logic.
3. Add tests: over-cap rejection, non-spender rejection, allowance revocation, invariant checks.
4. Run `cargo fmt --check && cargo clippy -- -D warnings && cargo test`.

**Acceptance Criteria**
- [ ] Only an authorised spender can renew, up to the per-period cap.
- [ ] Payer can revoke or lower the allowance at any time.
- [ ] Renewal respects `MAX_STREAM_DEPOSIT` and locked-balance accounting.
- [ ] ≥5 tests; `cargo test` + `wasm32v1-none` build pass.

**Guidelines**
- ≥95% test coverage; `require_auth` on every state change; overflow-safe math; no `unwrap()`.

**Timeframe:** 96 hours

---

### Issue #16 — Gas Regression Guard in CI

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `performance` `ci`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Turn the existing gas-profile harness into a CI regression guard that fails PRs that increase any entrypoint's gas cost beyond a budget.

**Requirements and Context**
`contracts/finchippay-contract/tests/gas_profile.rs` produces gas numbers but there is no automated comparison against a baseline. A PR can silently regress gas. This adds the enforcement layer the profiling harness was built for.

**Objectives**
1. Emit `gas-report.json` deterministically (sorted keys, fixed input sizes).
2. Add `scripts/compare-gas.js` that diffs a PR's report against a committed `benchmarks/gas-baseline.json`.
3. Fail CI when any entrypoint regresses >5% without an explicit allowlist entry.
4. Add a `make gas:baseline` target to regenerate the baseline deliberately.

**Suggested Execution**
1. `git checkout -b feat/gas-regression-guard`.
2. Make `gas_profile.rs` emit JSON; commit a baseline from the current build.
3. Add the compare script + a CI step in `.github/workflows/ci-contracts.yml`.
4. Document the budget in `contracts/finchippay-contract/README.md`.

**Acceptance Criteria**
- [ ] `cargo test --test gas_profile` writes a deterministic `gas-report.json`.
- [ ] CI fails when a PR regresses any entrypoint >5% without an allowlist entry.
- [ ] `make gas:baseline` regenerates the committed baseline.
- [ ] The baseline is committed and reproducible.

**Guidelines**
- Deterministic output (no wall-clock data); document how to update the baseline.

**Timeframe:** 72 hours

---

### Issue #17 — Property-Based Tests for Escrow, Multi-Sig, and Batch

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `testing` `security`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Extend the property-testing harness beyond streaming to escrow, multi-sig, and batch send — the highest-value funds-handling paths.

**Requirements and Context**
Only `tests/property_streaming.rs` exists today. Escrow (claim/cancel/partial/dispute), multi-sig (threshold/approve/execute), and batch (multi-token fan-out) have hand-written tests but no randomized invariant checks. These are funds-critical and warrant property coverage.

**Objectives**
1. Add `tests/property_escrow.rs`, `tests/property_multisig.rs`, `tests/property_batch.rs`.
2. Define invariants: escrow never over-pays/over-refunds; multi-sig executes only at threshold; batch total outflow ≤ total input.
3. Run ≥100k cases per invariant using the existing `proptest` setup.

**Suggested Execution**
1. `git checkout -b test/property-expansion`.
2. Reuse the `proptest` dev-dependency and strategies from `property_streaming.rs`.
3. Keep each suite <30s in CI.
4. Run `cargo test`.

**Acceptance Criteria**
- [ ] Three new property suites cover escrow, multi-sig, and batch.
- [ ] Each runs ≥100k cases with documented invariants.
- [ ] All suites pass in CI under 30s each.
- [ ] Existing tests continue to pass.

**Guidelines**
- Document every invariant as a doc comment; no `unwrap()` in test invariants that could mask a violation.

**Timeframe:** 72 hours

---

### Issue #18 — Vesting Enhancements: Cliffs and Revocation

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `vesting` `feature`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Add cliff enforcement and funder revocation to the vesting schedule, matching standard token-vesting semantics.

**Requirements and Context**
`create_vesting`/`claim_vesting` in `src/lib.rs` and `src/batch_send.rs` implement linear vesting but no cliff (a minimum locked period before any claim) and no revocation path. Team allocations typically require a 12-month cliff and a clawback option.

**Objectives**
1. Add `cliff_ledger` to the vesting record and enforce "0 claimable before cliff".
2. Add `revoke_vesting(id)` (funder-only) that returns unvested tokens.
3. Emit `vesting_cliff_reached` / `vesting_revoked`.
4. Add tests for cliff boundary, partial claim after cliff, and revoke.

**Suggested Execution**
1. `git checkout -b feat/vesting-cliff-revoke`.
2. Extend the vesting struct + entrypoints; keep backward compatibility for existing tests.
3. Run `cargo fmt --check && cargo clippy -- -D warnings && cargo test`.

**Acceptance Criteria**
- [ ] Claiming before the cliff returns 0 without error.
- [ ] Claimable amount is 0 until the cliff, then linear to `end_ledger`.
- [ ] `revoke_vesting` is funder-only and returns unvested balance.
- [ ] ≥5 tests; `cargo test` + `wasm32v1-none` build pass.

**Guidelines**
- ≥95% test coverage; `require_auth` on every state change; overflow-safe math.

**Timeframe:** 72 hours

---

### Issue #19 — Batch Send Partial-Failure Refund

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `batch` `safety`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Make multi-token batch sends all-or-nothing: if any recipient transfer fails, refund the sender rather than leaving a partially-executed batch.

**Requirements and Context**
`src/batch_send.rs` fan-out is implemented but the failure semantics on a mid-batch revert are not covered. On Stellar, a contract panic reverts the whole invocation, but explicit refund-and-report behavior (rather than relying on revert) is clearer and safer, and needs test coverage for the multi-token path.

**Objectives**
1. Audit `batch_send` / `batch_send_multi` for any path that could leave a partial transfer without revert.
2. Add explicit validation-before-transfer so malformed inputs panic before any funds move.
3. Add tests proving atomicity: a failing Nth recipient leaves no partial state.
4. Document the atomicity guarantee in the contract README.

**Suggested Execution**
1. `git checkout -b fix/batch-atomicity`.
2. Refactor to validate the full recipient list up front; add atomicity tests incl. multi-token.
3. Run `cargo test` + property checks.

**Acceptance Criteria**
- [ ] Any failing transfer reverts the entire batch (no partial state).
- [ ] Validation happens before the first transfer.
- [ ] ≥4 atomicity tests incl. multi-token and duplicate-recipient cases.
- [ ] `check_invariants` stays consistent after a failed batch.

**Guidelines**
- ≥95% test coverage on the changed path; no `unwrap()`; document the guarantee.

**Timeframe:** 72 hours

---

### Issue #20 — Public TTL Sweep Entrypoint

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `storage` `performance`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Expose a permissionless, bounded TTL-bump sweep so storage entries nearing expiry can be extended without admin involvement.

**Requirements and Context**
The contract emits `ttl_bumped` during internal TTL sweeps, but there is no public way for a keeper/relayer to trigger extension of near-expiry keys. On Soroban, expired persistent entries are archived; a public bounded sweeper protects long-lived escrows/streams.

**Objectives**
1. Add `sweep_ttl(keys: Vec<DataKey>, limit: u32)` — permissionless, bounded per call.
2. Enforce a per-call gas/key cap and skip already-fresh keys.
3. Emit `ttl_bumped` for each extended key.
4. Add tests for the cap and for unknown-key handling.

**Suggested Execution**
1. `git checkout -b feat/ttl-sweep`.
2. Implement in `src/storage.rs` / `lib.rs`; add tests.
3. Run `cargo fmt --check && cargo clippy -- -D warnings && cargo test`.

**Acceptance Criteria**
- [ ] Any caller can sweep up to the per-call limit.
- [ ] The entrypoint is bounded and cannot be abused to exhaust the budget.
- [ ] `ttl_bumped` is emitted per key; unknown keys are skipped.
- [ ] ≥4 tests; `cargo test` + `wasm32v1-none` build pass.

**Guidelines**
- ≥95% test coverage; bound all loops; no `unwrap()`.

**Timeframe:** 48 hours

---

### Issue #21 — Invariant Matrix Expansion

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `security` `testing`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Extend the on-chain invariant checker to cover yield escrow, airdrop, vesting, and arbitrator state, and wire each new invariant to a regression test.

**Requirements and Context**
`assert_invariants` / `check_invariants` in `src/lib.rs` cover tips, escrows, streams, multi-sig, and global locked-balance — but not the newer `yield_escrow`, `airdrop`, vesting, or arbitrator registries. These are exactly where state-corruption bugs would hide.

**Objectives**
1. Add invariants for yield escrow (shares ≤ deposited), airdrop (claimed ≤ total, no double-claim), vesting (claimed ≤ total), and arbitrators (no duplicates).
2. Call `assert_invariants` at the end of each new module's state-changing functions.
3. Add a corruption test per invariant (mirroring the existing pattern).

**Suggested Execution**
1. `git checkout -b feat/invariant-expansion`.
2. Extend `assert_invariants`; add tests in `src/test.rs`.
3. Run `cargo test`.

**Acceptance Criteria**
- [ ] Invariants cover yield escrow, airdrop, vesting, and arbitrators.
- [ ] Each new invariant has a corruption test that panics as expected.
- [ ] All state-changing entrypoints call `assert_invariants`.
- [ ] `cargo test` + `wasm32v1-none` build pass.

**Guidelines**
- ≥95% test coverage; descriptive panic messages; no `unwrap()`.

**Timeframe:** 72 hours

---

### Issue #22 — Contract Upgrade State-Migration Test Suite

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `security` `testing`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Build a test suite that proves state written by older contract versions remains readable after an `upgrade()`, guarding the layout-version migration path.

**Requirements and Context**
The contract tracks `layout_version` and emits an `upgraded` event, but there is no test that deploys vN, seeds state, upgrades to vN+1, and asserts the data survives. State loss on upgrade is a catastrophic failure mode.

**Objectives**
1. Add an upgrade test that seeds tips/escrows/streams/multi-sig, calls `upgrade`, and re-reads every record.
2. Cover a layout-version bump with a no-op schema change and assert `get_version`/layout increment.
3. Test the failure path: `upgrade` by a non-admin panics.

**Suggested Execution**
1. `git checkout -b test/upgrade-migration`.
2. Add `contracts/finchippay-contract/tests/upgrade_migration.rs` using the testutils `deployer`.
3. Run `cargo test`.

**Acceptance Criteria**
- [ ] Seeded state survives an upgrade across all core data types.
- [ ] Layout version increments and is reported correctly.
- [ ] Non-admin upgrade panics.
- [ ] ≥5 tests; `cargo test` passes.

**Guidelines**
- Use the real `upgrade` path (not mocks); document the migration invariants.

**Timeframe:** 72 hours

---

### Issue #23 — Admin-Action Timelock (Veto Window)

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `governance` `security`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Add a configurable timelock between multi-sig admin-action approval and execution, giving signers a veto window before sensitive operations (upgrade, rescue) take effect.

**Requirements and Context**
`src/multi_sig.rs` auto-executes at threshold with no delay. For governance-grade safety, `pause`/`upgrade`/`rescue_tokens` should have a configurable `ADMIN_TIMELOCK_LEDGERS` so a compromised quorum can be countered before funds move.

**Objectives**
1. Add `DataKey::AdminTimelock` (default 0, admin-settable).
2. When non-zero, approved admin actions become executable only after `approval_ledger + timelock`.
3. Add `execute_admin_action` (auto + manual) and `cancel_admin_action`.
4. Emit `admin_action_scheduled` / `admin_action_cancelled`.

**Suggested Execution**
1. `git checkout -b feat/admin-timelock`.
2. Extend `src/multi_sig.rs`; add tests for the veto window and cancellation.
3. Run `cargo fmt --check && cargo clippy -- -D warnings && cargo test`.

**Acceptance Criteria**
- [ ] With a timelock set, approved actions cannot execute before the window closes.
- [ ] Any signer can cancel a pending action within the window.
- [ ] Timelock is admin-configurable with a sane upper bound.
- [ ] ≥5 tests; `cargo test` + `wasm32v1-none` build pass.

**Guidelines**
- ≥95% test coverage; `require_auth` on every state change; no `unwrap()`.

**Timeframe:** 72 hours

---

### Issue #24 — Fuzz Corpus Expansion + CI Fuzz Job

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `testing` `security`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Add fuzz targets for yield escrow, vesting, and airdrop, and run a short fuzz pass in CI so new panics surface early.

**Requirements and Context**
`contracts/finchippay-contract/fuzz/fuzz_targets/` covers escrow, multi-sig, batch, and streams, but not the newer `yield_escrow`, vesting, or `airdrop` modules. Fuzzing is only run manually.

**Objectives**
1. Add `fuzz_targets/yield_escrow.rs`, `vesting.rs`, `airdrop.rs` to `fuzz/Cargo.toml`.
2. Assert no panic on arbitrary inputs (all inputs should either succeed or return a clean error).
3. Add a CI job that runs each target for ~2 minutes.

**Suggested Execution**
1. `git checkout -b test/fuzz-expansion`.
2. Mirror the existing target patterns; register new `[[bin]]` entries in `fuzz/Cargo.toml`.
3. Add a fuzz step to `.github/workflows/ci-contracts.yml`.

**Acceptance Criteria**
- [ ] Three new fuzz targets compile and run.
- [ ] A short CI fuzz pass runs without new panics.
- [ ] Existing targets still compile.

**Guidelines**
- Fuzz targets must not `unwrap()` on attacker-controlled data; document corpus strategy.

**Timeframe:** 48 hours

---

### Issue #25 — Typed Event Schema + Indexer Contract Test

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `events` `testing`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Add a contract-side test that validates every emitted event against a documented schema, so the backend indexer and any SDK bindings can rely on stable event payloads.

**Requirements and Context**
`src/events.rs` documents the event catalog, but nothing asserts that the actual `env.events().publish(...)` payloads match the documented shapes. An event-shape drift silently breaks `backend/src/services/eventIndexer.js` and dashboards.

**Objectives**
1. Add a test that executes each state-changing entrypoint and decodes the emitted topic/data.
2. Assert each event's symbol + arity/types match the `events.rs` catalog.
3. Fail CI if a new event is added without a matching catalog entry.

**Suggested Execution**
1. `git checkout -b test/event-schema`.
2. Add `tests/event_schema.rs` that inspects `env.events().all()` after each operation.
3. Run `cargo test`.

**Acceptance Criteria**
- [ ] Every catalogued event is exercised and its payload shape verified.
- [ ] Adding an event without a catalog entry fails the test.
- [ ] `cargo test` passes.

**Guidelines**
- Keep the catalog as the single source of truth; document how to add an event.

**Timeframe:** 48 hours

---

## BACKEND (Issues #26–#38)

---

### Issue #26 — API Idempotency Keys for Payment Submission

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `safety` `api` `high-priority`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Add idempotency-key support to payment/transaction submission endpoints so a retried request can never submit (and pay) twice.

**Requirements and Context**
Webhook *delivery* already uses idempotency keys (`webhookService.js`), but payment submission endpoints have none. A client retry after a timeout can double-submit a transaction — a direct funds risk. Stripe-style idempotency keys are the standard mitigation.

**Objectives**
1. Add `Idempotency-Key` header handling to the payment/tip/submission routes.
2. Store `(public_key, idempotency_key) → result` in a DB table with a TTL.
3. Return the original result on repeat, and 409 on key reuse with a different payload.
4. Enforce key validation (length, charset).

**Suggested Execution**
1. `git checkout -b feat/api-idempotency`.
2. Add a middleware + `idempotency_keys` migration; wire into the submit routes.
3. Add tests: replay returns same result, conflicting reuse 409s, TTL expiry.

**Acceptance Criteria**
- [ ] A repeated request with the same key returns the stored result without re-executing.
- [ ] Same key + different body → 409.
- [ ] Keys are scoped per authenticated account and expire.
- [ ] ≥5 tests; `npm run lint` clean.

**Guidelines**
- Validate keys; use the existing knex + error-code patterns (`shared/errorCodes.js`).

**Timeframe:** 96 hours

---

### Issue #27 — GraphQL Subscriptions (WebSocket)

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `graphql` `realtime` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Add GraphQL subscriptions so clients can stream payment/stream/escrow events over WebSocket instead of polling.

**Requirements and Context**
The backend serves a query-only GraphQL API (`src/graphql/schema.js`, `resolvers.js`) on `@apollo/server` v5. There is no subscription support; the frontend polls or uses SSE. Subscriptions would unify real-time access through the same schema.

**Objectives**
1. Add subscription types (`paymentReceived`, `streamClaimed`, `escrowReleased`) to the schema.
2. Implement resolvers that subscribe to the existing event indexer/webhook pipeline.
3. Serve via `graphql-ws` WebSocket transport on `/api/graphql`.
4. Add auth on subscription establishment.

**Suggested Execution**
1. `git checkout -b feat/graphql-subscriptions`.
2. Add `graphql-ws` + `ws`; wire a subscription server alongside Express.
3. Publish events from `eventIndexer.js` / `webhookService.js` into the subscription bus.
4. Add integration tests with a WS client.

**Acceptance Criteria**
- [ ] Clients can subscribe to at least 3 event types over WebSocket.
- [ ] Subscription auth is enforced.
- [ ] Events are delivered with <1s latency from on-chain detection.
- [ ] ≥3 tests; `npm run lint` clean.

**Guidelines**
- Follow the existing GraphQL patterns; document the subscription protocol.

**Timeframe:** 96 hours

---

### Issue #28 — SEP-31 Cross-Border Payments

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `sep-31` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Implement the SEP-31 receiving flow so Finchippay can accept cross-border payments from other Stellar anchors and wallets.

**Requirements and Context**
The backend already implements SEP-12 (KYC), SEP-24 (deposit/withdraw), and SEP-38 (quotes). SEP-31 (cross-border receiving) is the missing piece for remittance use cases. It defines `/transactions` and `/transaction` endpoints for a receiving anchor.

**Objectives**
1. Implement `POST /sep31/transactions` and `GET /sep31/transactions/:id`.
2. Accept `sender_id`, `receiver_id`, `amount`, `asset`, and route via the existing SEP-38 quote service.
3. Persist transaction state and emit events for status transitions.
4. Document the flow in `docs/api.md`.

**Suggested Execution**
1. `git checkout -b feat/sep31`.
2. Add `src/routes/sep31.js` + a service; register in `server.js`.
3. Add integration tests against a mock receiving flow.

**Acceptance Criteria**
- [ ] SEP-31 create/read endpoints work per spec.
- [ ] Quotes are sourced from the existing SEP-38 service.
- [ ] State transitions are persisted and evented.
- [ ] ≥4 tests; `npm run lint` clean.

**Guidelines**
- Follow the existing SEP-* route/service patterns; validate all inputs with Zod.

**Timeframe:** 96 hours

---

### Issue #29 — API Key Management for Third-Party Integrators

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `api` `developer-experience` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Add scoped, revocable API keys so third-party integrators can call the REST/SDK without holding a JWT.

**Requirements and Context**
The SDK (`sdk/`) uses SEP-0010 JWTs. There is no server-issued, revocable API-key path for server-to-server integrations. API keys with scopes (read-only, payments, admin) and rotation are the standard approach.

**Objectives**
1. Add `api_keys` table (hash of key, owner, scopes, last_used, revoked).
2. Add `POST /api/keys`, `GET /api/keys`, `DELETE /api/keys/:id`.
3. Add `x-api-key` auth middleware with scope enforcement.
4. Hash keys at rest (never return the plaintext after creation).

**Suggested Execution**
1. `git checkout -b feat/api-keys`.
2. Add migration + middleware + routes; integrate with existing auth.
3. Add tests: scope enforcement, revocation, hashing.

**Acceptance Criteria**
- [ ] Keys are created, listed, and revoked by their owner.
- [ ] `x-api-key` auth enforces scopes per route.
- [ ] Keys are stored hashed; plaintext shown only once.
- [ ] ≥5 tests; `npm run lint` clean.

**Guidelines**
- Use the existing crypto/redaction utilities; never log keys.

**Timeframe:** 72 hours

---

### Issue #30 — Transaction Reconciliation Service

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `data` `reliability` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Build a reconciliation job that compares Horizon ledger history against internal records and surfaces discrepancies.

**Requirements and Context**
Tips, escrows, streams, and scheduled executions are tracked in PostgreSQL, but nothing systematically verifies that internal balances/state match Horizon. Drift from missed events or manual intervention would go unnoticed.

**Objectives**
1. Add a reconciliation service that walks a ledger window and compares Horizon ops to internal rows.
2. Detect: missing internal records, orphan internal records, and balance mismatches.
3. Emit a structured reconciliation report (metrics + log) and a `reconciliation_issues` table.
4. Run daily via the existing scheduler.

**Suggested Execution**
1. `git checkout -b feat/reconciliation`.
2. Add `src/services/reconciliationService.js` + migration; schedule it in `scheduledExecutor.js`.
3. Add tests with a mocked Horizon client.

**Acceptance Criteria**
- [ ] The service detects missing/orphaned records and balance drift.
- [ ] Findings are persisted and observable (metrics + logs).
- [ ] A daily run is scheduled.
- [ ] ≥4 tests; `npm run lint` clean.

**Guidelines**
- Use the existing Horizon client + knex; keep the window configurable.

**Timeframe:** 96 hours

---

### Issue #31 — Webhook Delivery Dashboard & Replay API

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `webhooks` `observability` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Add an API and a minimal dashboard to inspect and replay failed webhook deliveries (dead-letter entries).

**Requirements and Context**
`webhookService.js` already retries with exponential backoff and persists a `dead_letter_queue`. There is no way to list, inspect, or manually replay a dead delivery from the API — operators must dig into the DB.

**Objectives**
1. Add `GET /api/webhooks/:publicKey/deliveries` (filter by status).
2. Add `POST /api/webhooks/:publicKey/deliveries/:id/replay`.
3. Add a lightweight admin page listing deliveries with retry controls.
4. Expose delivery metrics (attempts, dead count) via the health/metrics endpoint.

**Suggested Execution**
1. `git checkout -b feat/webhook-delivery-dashboard`.
2. Extend `src/routes/webhooks.js` + `webhookService.js`; add a frontend admin view.
3. Add tests for listing and replay.

**Acceptance Criteria**
- [ ] Deliveries are listable/filterable by status.
- [ ] A dead delivery can be replayed via API and UI.
- [ ] Delivery metrics are exposed.
- [ ] ≥4 tests; `npm run lint` clean.

**Guidelines**
- Reuse the existing retry/DLQ machinery; scope queries per owner.

**Timeframe:** 72 hours

---

### Issue #32 — General-Purpose Audit Log for Admin & Security Events

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `security` `observability` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Expand the audit log (currently GDPR-only) into a general trail for admin, auth, and security-sensitive events.

**Requirements and Context**
`dataRetentionService.writeAuditLog` writes to an `audit_log` table but is only called for GDPR delete/export and data purge. Auth failures, admin actions, key rotation, and rate-limit events are not audited.

**Objectives**
1. Add an `audit()` helper and call it for: login success/failure, token revocation, API-key creation/revocation, admin mutations, and rate-limit trips.
2. Add `GET /api/audit` (owner/admin scoped, paginated).
3. Keep audit writes non-blocking and out of the request hot path.

**Suggested Execution**
1. `git checkout -b feat/audit-log`.
2. Generalize `writeAuditLog`; instrument the relevant services/controllers.
3. Add a read endpoint + tests.

**Acceptance Criteria**
- [ ] ≥6 security-relevant event types are audited.
- [ ] `GET /api/audit` is scoped and paginated.
- [ ] Audit writes don't fail or block the request on error.
- [ ] ≥4 tests; `npm run lint` clean.

**Guidelines**
- Never log secrets/tokens; correlate entries with the request ID.

**Timeframe:** 72 hours

---

### Issue #33 — Per-Account (Tiered) Rate Limiting

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `security` `rate-limiting` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Add per-account rate-limit tiers so trusted/institutional accounts get higher limits than new accounts.

**Requirements and Context**
The backend has IP-based (`rateLimit.js`) and identity-based (`userRateLimit.js`) limiters at fixed values. There is no per-account tier. A tiered model (default / elevated / privileged) with configurable limits reduces abuse while serving power users.

**Objectives**
1. Add an `account_tiers` table mapping `public_key → tier`.
2. Make `userRateLimit.js` resolve the tier and apply its limit.
3. Add admin endpoints to assign/change tiers.
4. Persist and expose rate-limit metrics per tier.

**Suggested Execution**
1. `git checkout -b feat/tiered-rate-limits`.
2. Add migration + config; wire into the user limiter; add admin routes.
3. Add tests: tier resolution, admin authz, limit differences.

**Acceptance Criteria**
- [ ] Different tiers enforce different per-account limits.
- [ ] Admin can assign/change tiers (admin-auth-gated).
- [ ] Unknown accounts fall back to the default tier.
- [ ] ≥5 tests; `npm run lint` clean.

**Guidelines**
- Keep defaults conservative; document tiers in `ENV.md`.

**Timeframe:** 72 hours

---

### Issue #34 — Backup Verification & Restore Drill

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `database` `reliability` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Add automated verification that database backups are restorable, plus a documented restore drill.

**Requirements and Context**
`src/services/backupService.js` creates backups, but there is no verification that a backup can actually be restored. An unverified backup is not a backup. This adds restore-testing and a runbook.

**Objectives**
1. Add a `verifyBackup(backupPath)` step that restores into a scratch DB and runs integrity checks.
2. Schedule a weekly restore-drill job.
3. Add metrics/alerts on backup + verification failures.
4. Document the restore procedure in `docs/`.

**Suggested Execution**
1. `git checkout -b feat/backup-verification`.
2. Extend `backupService.js`; add a drill script + scheduler hook.
3. Add tests with a temp DB.

**Acceptance Criteria**
- [ ] Backups are automatically restored-and-verified on a schedule.
- [ ] Failures surface via metrics/alerts.
- [ ] A restore runbook is documented.
- [ ] ≥3 tests; `npm run lint` clean.

**Guidelines**
- Restore into a scratch DB, never production; document recovery time objective.

**Timeframe:** 72 hours

---

### Issue #35 — Horizon SSE Resilience & Backpressure

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `reliability` `streaming` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Harden the Horizon SSE consumption path with reconnect, cursor persistence, and backpressure so no events are lost during outages.

**Requirements and Context**
`balanceStreamService.js` and the event pipeline consume Horizon SSE streams. A disconnect mid-cursor can drop or duplicate events. Robust streaming needs persisted cursors, idempotent processing, and backpressure under load.

**Objectives**
1. Persist the last-processed cursor per stream and resume from it on reconnect.
2. Add exponential-backoff reconnect with jitter.
3. Add a bounded processing queue to apply backpressure.
4. Add tests for disconnect/reconnect and cursor resumption.

**Suggested Execution**
1. `git checkout -b fix/horizon-sse-resilience`.
2. Harden `balanceStreamService.js` (and event cursor handling); add a queue.
3. Add tests simulating disconnects.

**Acceptance Criteria**
- [ ] Reconnects resume from the persisted cursor without loss/duplication.
- [ ] Backpressure bounds memory under load.
- [ ] Reconnect uses exponential backoff + jitter.
- [ ] ≥4 tests; `npm run lint` clean.

**Guidelines**
- Make processing idempotent; log cursor positions at debug level.

**Timeframe:** 96 hours

---

### Issue #36 — Multi-Currency / Forex Analytics

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `analytics` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Add multi-currency (fiat) reporting to analytics so totals can be viewed in USD/EUR, not just native assets.

**Requirements and Context**
`analyticsService.js` aggregates in native amounts. `priceFeedService.js` fetches XLM price only. Users need fiat-equivalent totals across mixed-asset activity, using historical rates at transaction time.

**Objectives**
1. Extend `priceFeedService.js` with a fiat-rate source and historical-rate lookup.
2. Add a `currency` parameter to the analytics endpoints (`summary`, `timeseries`).
3. Compute fiat-equivalent totals and per-asset breakdowns.
4. Cache rates and degrade gracefully when a source is down.

**Suggested Execution**
1. `git checkout -b feat/multi-currency-analytics`.
2. Extend `priceFeedService.js` + `analyticsService.js` + `routes/analytics.js`.
3. Add tests with mocked rate sources.

**Acceptance Criteria**
- [ ] Analytics endpoints accept a `currency` (USD/EUR/etc.) parameter.
- [ ] Totals are converted using historical rates at transaction time.
- [ ] Missing rates degrade gracefully (native fallback).
- [ ] ≥4 tests; `npm run lint` clean.

**Guidelines**
- Cache rates; document rate-source accuracy caveats.

**Timeframe:** 72 hours

---

### Issue #37 — OpenTelemetry Span Coverage & Sampling

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `observability` `tracing` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Deepen tracing coverage to DB queries, webhooks, and scheduled jobs, and add a coherent sampling strategy.

**Requirements and Context**
`src/config/tracing.js` + `middleware/tracing.js` wire basic HTTP spans, but DB queries, webhook deliveries, and cron/scheduled work are unspanned, and there is no sampling policy — traces can be noisy and costly.

**Objectives**
1. Add spans for knex queries, webhook deliveries, and scheduled executions.
2. Add tail-based or head-based sampling configured via env.
3. Propagate `traceparent` to Horizon/outbound calls.
4. Verify spans appear for a full request → Horizon → DB flow.

**Suggested Execution**
1. `git checkout -b feat/tracing-coverage`.
2. Instrument `db/connection.js`, `webhookService.js`, `scheduledExecutor.js`.
3. Add env-configurable sampling; test with a local collector.

**Acceptance Criteria**
- [ ] DB, webhook, and scheduled spans are present.
- [ ] Sampling is configurable and documented.
- [ ] `traceparent` propagates to Horizon calls.
- [ ] Tracing stays disabled when unconfigured.

**Guidelines**
- Keep span attributes free of secrets; negligible perf overhead.

**Timeframe:** 72 hours

---

### Issue #38 — Graceful Shutdown & Readiness Gating

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `backend` `reliability` `operations` `feature`

> This is a backend issue for the GrantFox FWC26 campaign (Stellar Wave). Harden shutdown so in-flight requests drain, background workers stop cleanly, and readiness flips only when all dependencies are up.

**Requirements and Context**
`src/services/shutdownState.js` exists, but the server's stop path, worker teardown (scheduled executor, event indexer, retry worker), and readiness semantics are not fully wired together. Abrupt kills can lose in-flight webhooks or scheduled executions.

**Objectives**
1. Implement a coordinated shutdown: stop accepting connections, drain in-flight requests, stop workers, close DB/Redis.
2. Add `/readyz` that reports dependency status and flips 503 during drain.
3. Add signal handling for SIGTERM/SIGINT with a timeout.
4. Test the drain/stop sequence.

**Suggested Execution**
1. `git checkout -b feat/graceful-shutdown`.
2. Wire `shutdownState.js` + `healthService.js` + server close hooks.
3. Add tests for readiness and drain.

**Acceptance Criteria**
- [ ] SIGTERM/SIGINT trigger a graceful drain with a timeout.
- [ ] Workers and DB/Redis close cleanly in order.
- [ ] `/readyz` returns 503 during drain and reflects dependency health.
- [ ] ≥4 tests; `npm run lint` clean.

**Guidelines**
- Document the shutdown ordering; no data loss on drain.

**Timeframe:** 72 hours

---

## FRONTEND (Issues #39–#52)

---

### Issue #39 — In-App Notification Center

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `notifications` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Build an in-app notification center (bell + drawer) aggregating payment, stream, escrow, and multi-sig events.

**Requirements and Context**
Push and email notifications exist (`pushNotifications.ts`, `notificationService.js`), but there is no in-app inbox. Users need a persistent, mark-as-read feed for events they missed while offline.

**Objectives**
1. Add `GET /api/notifications` backend endpoint backed by the event pipeline.
2. Create a `NotificationCenter` (bell with unread badge, drawer list, mark-read).
3. Persist read state per account.
4. Deep-link each notification to its entity page.

**Suggested Execution**
1. `git checkout -b feat/notification-center`.
2. Add the backend endpoint + frontend context (`lib/notifications.ts`) + UI.
3. Add tests and Storybook stories.

**Acceptance Criteria**
- [ ] Unread count is shown on the bell; opening marks items read.
- [ ] Notifications link to their entity (payment/tx/escrow/stream).
- [ ] Read state persists across reloads.
- [ ] Component tests + Storybook; `npm run lint && npm run type-check && npm test` pass.

**Guidelines**
- TypeScript strict; i18n via `t()`; WCAG 2.1 AA (keyboard, aria-live).

**Timeframe:** 96 hours

---

### Issue #40 — Recurring Payments Server Sync

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `scheduled` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Bridge the frontend recurring-payment schedules (currently localStorage) to the backend scheduled-transaction service.

**Requirements and Context**
`frontend/components/RecurringPayments.tsx` stores schedules in `localStorage`, while the backend `scheduledTransactionService.js` + `scheduledExecutor.js` already expose a full CRUD API. The UI and server are disconnected — schedules don't survive device changes or run server-side.

**Objectives**
1. Replace localStorage persistence with the backend `/api/scheduled-transactions` API.
2. Show server-executed schedules alongside any local-only fallback.
3. Handle sync conflicts and offline mode gracefully.

**Suggested Execution**
1. `git checkout -b feat/recurring-server-sync`.
2. Refactor `RecurringPayments.tsx` + a new `lib/scheduledTransactions.ts` client.
3. Add tests for sync, conflict, and offline fallback.

**Acceptance Criteria**
- [ ] Schedules are created/edited/deleted via the backend API.
- [ ] Server-side executions are reflected in the UI.
- [ ] Offline fallback to localStorage still works.
- [ ] Component tests; `npm run lint && npm run type-check && npm test` pass.

**Guidelines**
- TypeScript strict; i18n via `t()`; preserve existing UX.

**Timeframe:** 96 hours

---

### Issue #41 — Payment Links Management UI

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `payment-links` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Add a management page to create, list, and disable payment links backed by the existing `lib/paymentLinks.ts`.

**Requirements and Context**
`frontend/lib/paymentLinks.ts` provides link helpers, but there is no dedicated page to manage links (list active links, copy, disable). Payment links are a core acquisition surface and need first-class UI.

**Objectives**
1. Add `/payment-links` page: create link (amount, memo), list, copy, disable.
2. Persist links (local or backend) and show usage counts.
3. Add QR + share for each link.

**Suggested Execution**
1. `git checkout -b feat/payment-links-ui`.
2. Build the page + components reusing `lib/paymentLinks.ts` and the QR helper.
3. Add tests and Storybook stories.

**Acceptance Criteria**
- [ ] Users can create, list, copy, and disable payment links.
- [ ] Each link shows a QR and share action.
- [ ] Empty/loading/error states handled.
- [ ] Component tests; `npm run lint && npm run type-check && npm test` pass.

**Guidelines**
- TypeScript strict; i18n via `t()`; responsive at 375px.

**Timeframe:** 72 hours

---

### Issue #42 — Invoice Dashboard & Reminders

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `invoices` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Build a dashboard to list invoices by status, track payment, and send reminders.

**Requirements and Context**
`frontend/lib/invoices.ts` + `InvoiceModal.tsx`/`InvoiceDetail.tsx` exist, but there is no list/dashboard page with status filtering or reminders. Freelancers need to see outstanding vs paid invoices at a glance.

**Objectives**
1. Add `/invoices` page: list with status filter (draft/sent/paid/overdue), totals.
2. Add reminder action (email/push via existing services).
3. Deep-link to `InvoiceDetail`.

**Suggested Execution**
1. `git checkout -b feat/invoice-dashboard`.
2. Build the page + a status badge component; wire reminders.
3. Add tests and Storybook stories.

**Acceptance Criteria**
- [ ] Invoices are listed and filterable by status.
- [ ] Overdue invoices are visually flagged.
- [ ] A reminder can be triggered per invoice.
- [ ] Component tests; `npm run lint && npm run type-check && npm test` pass.

**Guidelines**
- TypeScript strict; i18n via `t()`; WCAG 2.1 AA.

**Timeframe:** 72 hours

---

### Issue #43 — Transaction Notes, Tags & Bookmarks

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `transactions` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Add private notes, tags, and bookmarks to transactions for personal bookkeeping.

**Requirements and Context**
The transaction detail page (`pages/tx/[txHash].tsx`) has no notes/tags. Contacts already support tags (`lib/contactsDB.ts`), so a similar pattern can be applied to transactions. This is listed in `FEATURE_CHECKLIST.md` as a future enhancement.

**Objectives**
1. Add a `lib/transactionNotes.ts` store (IndexedDB/localStorage) keyed by tx hash.
2. Add note/tag/bookmark controls to the transaction detail + list.
3. Add filtering by tag/bookmark in the transactions page.

**Suggested Execution**
1. `git checkout -b feat/tx-notes-tags`.
2. Add the store + UI controls + filters.
3. Add tests.

**Acceptance Criteria**
- [ ] Users can add/remove notes, tags, and bookmarks per transaction.
- [ ] Transactions can be filtered by tag or bookmark.
- [ ] Data persists across reloads.
- [ ] Component tests; `npm run lint && npm run type-check && npm test` pass.

**Guidelines**
- TypeScript strict; i18n via `t()`; keep data local/private.

**Timeframe:** 72 hours

---

### Issue #44 — Multi-Language PDF Receipts

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `i18n` `receipts` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Localize the PDF receipt generator to the active locale so receipts match the user's language.

**Requirements and Context**
`frontend/lib/generatePDF.ts` produces English-only PDFs. The app supports 6+ locales (`public/locales/{en,es,fr,ar,he,ja,pt}`). Receipts should follow the active language, including RTL for Arabic/Hebrew.

**Objectives**
1. Extract all PDF strings into locale files.
2. Localize `generatePDF.ts` using the active locale (dates, numbers, labels).
3. Handle RTL layout for Arabic/Hebrew PDFs.

**Suggested Execution**
1. `git checkout -b feat/multilang-pdf`.
2. Localize the PDF templates + date/number formatting via `intlFormat`.
3. Add tests for locale output and RTL.

**Acceptance Criteria**
- [ ] PDFs render in the active locale.
- [ ] Dates/numbers are locale-formatted.
- [ ] RTL locales produce right-aligned PDFs.
- [ ] Component tests; `npm run lint && npm run type-check && npm test` pass.

**Guidelines**
- TypeScript strict; reuse existing i18n infrastructure.

**Timeframe:** 72 hours

---

### Issue #45 — Portfolio Tax & Cost-Basis Reporting

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `portfolio` `analytics` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Add cost-basis and realized-gain reporting to the portfolio view for tax purposes.

**Requirements and Context**
`frontend/lib/portfolio.ts` and portfolio components exist, but there is no cost-basis or realized/unrealized gain tracking. Users need a defensible transaction history with gains for tax reporting.

**Objectives**
1. Compute cost basis (FIFO) and realized/unrealized gains per asset.
2. Add a "Tax report" view with a downloadable summary.
3. Handle token swaps and tips as taxable events.

**Suggested Execution**
1. `git checkout -b feat/portfolio-tax`.
2. Extend `lib/portfolio.ts` with FIFO cost-basis; add a report component + CSV export.
3. Add tests for cost-basis math.

**Acceptance Criteria**
- [ ] FIFO cost basis and realized gains are computed per asset.
- [ ] A tax summary can be exported (CSV).
- [ ] Swaps and tips are classified as taxable events.
- [ ] Component tests; `npm run lint && npm run type-check && npm test` pass.

**Guidelines**
- TypeScript strict; document assumptions (no tax advice).

**Timeframe:** 96 hours

---

### Issue #46 — Custom Accent Theme (Branding)

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `theme` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Add user-selectable accent colors on top of the existing dark/light themes.

**Requirements and Context**
`frontend/lib/ThemeContext.tsx` supports dark/light/system, but there is no accent-color customization. A small set of accent presets would let users/brands personalize the UI without a full theme system.

**Objectives**
1. Add accent presets (e.g. Stellar purple, teal, amber, rose) as CSS variables.
2. Extend `ThemeContext` with `accent` + persistence.
3. Add an accent picker to settings; apply the accent to buttons/links/highlights.

**Suggested Execution**
1. `git checkout -b feat/accent-theme`.
2. Add CSS variables in `globals.css`; extend the context + settings UI.
3. Add tests and Storybook stories.

**Acceptance Criteria**
- [ ] Users can pick an accent that applies app-wide.
- [ ] Accent persists and respects dark/light.
- [ ] Contrast remains WCAG AA for all presets.
- [ ] Component tests; `npm run lint && npm run type-check && npm test` pass.

**Guidelines**
- TypeScript strict; ensure every preset meets contrast requirements.

**Timeframe:** 48 hours

---

### Issue #47 — Trezor Hardware Wallet Support

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `wallet` `hardware` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Add Trezor support alongside the existing Freighter + Ledger options.

**Requirements and Context**
`frontend/lib/ledger.ts` and `wallet.ts` support Freighter and Ledger, but not Trezor. Trezor is the second-most-popular hardware wallet; its absence limits hardware-wallet users.

**Objectives**
1. Add Trezor Stellar signing via `@trezor/connect` (or the Stellar SDK's Trezor path).
2. Add a "Trezor" option to the wallet-selector modal.
3. Route signing through the active hardware-wallet type in `useWallet`.

**Suggested Execution**
1. `git checkout -b feat/trezor`.
2. Implement `lib/trezor.ts`; extend `WalletConnect.tsx` + `useWallet.tsx`.
3. Add tests with mocked Trezor transport.

**Acceptance Criteria**
- [ ] Wallet selector offers Freighter, Ledger, and Trezor.
- [ ] Trezor connects and signs payments/SEP-0010.
- [ ] Clear error guidance for connect/unlock flows.
- [ ] Component tests; `npm run lint && npm run type-check && npm test` pass.

**Guidelines**
- TypeScript strict; follow the existing Ledger integration pattern.

**Timeframe:** 96 hours

---

### Issue #48 — E2E Coverage: Tips, Trade, Tokens & Invoices

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `e2e` `testing`

> This is a testing issue for the GrantFox FWC26 campaign (Stellar Wave). Extend the Playwright suite to cover tips, trade/swap, token discovery, and invoice flows.

**Requirements and Context**
`frontend/e2e/` covers dashboard, escrow, multi-sig, transactions, offline, portfolio, a11y, and RTL, but not tips (`/tip/:username`), trade/swap, tokens, or invoices. These are user-facing flows with no end-to-end regression coverage.

**Objectives**
1. Add `tips.spec.ts`, `trade.spec.ts`, `tokens.spec.ts`, `invoices.spec.ts`.
2. Assert against real testnet state where applicable.
3. Keep tests hermetic and deterministic.

**Suggested Execution**
1. `git checkout -b test/e2e-expansion`.
2. Reuse `fixtures.ts`; add the four spec files.
3. Run `npm run test:e2e` twice to confirm no flakes.

**Acceptance Criteria**
- [ ] Four new spec files cover the named flows end-to-end.
- [ ] Tests pass consistently across two runs.
- [ ] Tests run against testnet (not mocked).

**Guidelines**
- Deterministic; reuse `fixtures.ts`; no hardcoded mainnet addresses.

**Timeframe:** 96 hours

---

### Issue #49 — Visual Regression Testing

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `testing` `visual` `feature`

> This is a testing issue for the GrantFox FWC26 campaign (Stellar Wave). Add Playwright screenshot baselines to catch unintended visual regressions in key pages/components.

**Requirements and Context**
There is no visual regression testing. Styling/theme changes can silently break layouts. Screenshot diffs on core pages would catch this at review time.

**Objectives**
1. Add screenshot assertions for dashboard, transactions, escrow, and settings (light + dark).
2. Store baselines in the repo; add a CI job that diffs against them.
3. Document how to update baselines deliberately.

**Suggested Execution**
1. `git checkout -b test/visual-regression`.
2. Add `e2e/visual.spec.ts` + baseline workflow.
3. Run and commit baselines.

**Acceptance Criteria**
- [ ] Core pages have screenshot baselines in light and dark.
- [ ] CI fails on visual diff beyond a threshold.
- [ ] Baseline update process is documented.

**Guidelines**
- Use a stable viewport + deterministic fixtures; document diff tolerance.

**Timeframe:** 72 hours

---

### Issue #50 — Route-Level Code Splitting & Bundle Budgets

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `performance` `feature`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Audit per-route bundle sizes, apply code splitting where heavy, and enforce budgets (complements Issue #11's CI size-limit).

**Requirements and Context**
The app uses dynamic imports in places, but several heavy routes (dashboard, trade) still ship large chunks. Issue #11 adds the size-limit CI check; this issue does the actual splitting/optimization to meet budgets.

**Objectives**
1. Measure per-route bundle sizes.
2. Split heavy dependencies (charts, PDF, QR) to load on demand.
3. Move rarely-used libraries to dynamic imports.
4. Reduce the largest route chunks below the budgets defined in Issue #11.

**Suggested Execution**
1. `git checkout -b perf/route-splitting`.
2. Apply `next/dynamic` to heavy components; verify with the bundle analyzer.
3. Add tests where behavior changes.

**Acceptance Criteria**
- [ ] Each heavy route's first-load JS is reduced measurably.
- [ ] No functional regression (tests + e2e pass).
- [ ] Bundle sizes are under the committed budgets.

**Guidelines**
- Keep SSR behavior intact; document splitting decisions.

**Timeframe:** 96 hours

---

### Issue #51 — WCAG AAA & Screen-Reader E2E

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `accessibility` `testing`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Push key flows toward WCAG 2.1 AAA and add screen-reader-driven E2E tests.

**Requirements and Context**
`e2e/a11y.spec.ts` + `jest-axe` cover AA violations, but AAA (higher contrast, larger target spacing, reduced-motion support) is not targeted, and no test drives a real screen reader.

**Objectives**
1. Audit key flows against AAA criteria (contrast ≥7:1, focus visibility, motion).
2. Remediate the highest-impact AAA gaps.
3. Add screen-reader E2E (e.g. via Playwright + a11y snapshot) for send and escrow.

**Suggested Execution**
1. `git checkout -b a11y/aaa`.
2. Remediate + add `e2e/screenreader.spec.ts`.
3. Run the a11y suites.

**Acceptance Criteria**
- [ ] Key flows meet AAA contrast and focus requirements.
- [ ] A screen-reader-driven E2E covers send + escrow.
- [ ] No AA regressions (existing a11y suite stays green).

**Guidelines**
- Follow WCAG 2.1; document any AAA items intentionally deferred.

**Timeframe:** 72 hours

---

### Issue #52 — Frontend API Layer Dogfooding (SDK)

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `frontend` `sdk` `refactor`

> This is a frontend issue for the GrantFox FWC26 campaign (Stellar Wave). Replace ad-hoc frontend HTTP calls with the typed `@finchippay/sdk` client so the SDK is the single, dogfooded integration path.

**Requirements and Context**
The `sdk/` workspace exposes a typed client, but frontend code still mixes direct fetch calls (`lib/api.ts`, `lib/stellar.ts`, service calls). Dogfooding the SDK surfaces its gaps and guarantees third-party integrators get a battle-tested client.

**Objectives**
1. Route frontend API calls through `sdk/src/client.ts`.
2. Fix any SDK gaps discovered (missing types, error mapping, auth).
3. Keep a thin `lib/api.ts` wrapper only for browser-specific concerns.

**Suggested Execution**
1. `git checkout -b refactor/sdk-dogfood`.
2. Swap calls incrementally; add tests for the migrated paths.
3. Run `npm run check:sdk` + frontend tests.

**Acceptance Criteria**
- [ ] Core data flows (accounts, payments, analytics, auth) use the SDK client.
- [ ] SDK types are the source of truth (no duplicated `any`-typed calls).
- [ ] No functional regression; `npm run lint && npm run type-check && npm test` pass.

**Guidelines**
- TypeScript strict; keep SDK changes backward-compatible.

**Timeframe:** 96 hours

---

## Batch 2 Summary

| # | Domain | Title |
|---|--------|-------|
| 13 | Contract | On-Chain Price Oracle for Yield Escrow |
| 14 | Contract | Milestone-Based Escrow Releases |
| 15 | Contract | Recurring Subscription Streams (Auto-Renew) |
| 16 | Contract | Gas Regression Guard in CI |
| 17 | Contract | Property-Based Tests for Escrow, Multi-Sig, Batch |
| 18 | Contract | Vesting Enhancements: Cliffs and Revocation |
| 19 | Contract | Batch Send Partial-Failure Refund |
| 20 | Contract | Public TTL Sweep Entrypoint |
| 21 | Contract | Invariant Matrix Expansion |
| 22 | Contract | Contract Upgrade State-Migration Test Suite |
| 23 | Contract | Admin-Action Timelock (Veto Window) |
| 24 | Contract | Fuzz Corpus Expansion + CI Fuzz Job |
| 25 | Contract | Typed Event Schema + Indexer Contract Test |
| 26 | Backend | API Idempotency Keys for Payment Submission |
| 27 | Backend | GraphQL Subscriptions (WebSocket) |
| 28 | Backend | SEP-31 Cross-Border Payments |
| 29 | Backend | API Key Management for Third-Party Integrators |
| 30 | Backend | Transaction Reconciliation Service |
| 31 | Backend | Webhook Delivery Dashboard & Replay API |
| 32 | Backend | General-Purpose Audit Log |
| 33 | Backend | Per-Account (Tiered) Rate Limiting |
| 34 | Backend | Backup Verification & Restore Drill |
| 35 | Backend | Horizon SSE Resilience & Backpressure |
| 36 | Backend | Multi-Currency / Forex Analytics |
| 37 | Backend | OpenTelemetry Span Coverage & Sampling |
| 38 | Backend | Graceful Shutdown & Readiness Gating |
| 39 | Frontend | In-App Notification Center |
| 40 | Frontend | Recurring Payments Server Sync |
| 41 | Frontend | Payment Links Management UI |
| 42 | Frontend | Invoice Dashboard & Reminders |
| 43 | Frontend | Transaction Notes, Tags & Bookmarks |
| 44 | Frontend | Multi-Language PDF Receipts |
| 45 | Frontend | Portfolio Tax & Cost-Basis Reporting |
| 46 | Frontend | Custom Accent Theme (Branding) |
| 47 | Frontend | Trezor Hardware Wallet Support |
| 48 | Frontend | E2E Coverage: Tips, Trade, Tokens, Invoices |
| 49 | Frontend | Visual Regression Testing |
| 50 | Frontend | Route-Level Code Splitting & Bundle Budgets |
| 51 | Frontend | WCAG AAA & Screen-Reader E2E |
| 52 | Frontend | Frontend API Layer Dogfooding (SDK) |
