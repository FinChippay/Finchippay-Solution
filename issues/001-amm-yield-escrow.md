# Issue #1 — AMM/DeFi Integration for Yield Escrow

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `defi` `amm` `help wanted`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Turn the feature-gated `yield_escrow` scaffold into a real AMM integration: deposit escrowed funds into a liquidity pool for LP shares and return principal plus accrued yield at release.

## Requirements and Context

`contracts/finchippay-contract/src/yield_escrow.rs` implements the full escrow lifecycle (`create_yield_escrow`, `claim_yield_escrow`, `cancel_yield_escrow`, `get_yield_escrow`) but the yield logic is stubbed out:

- `create_yield_escrow` records `shares = amount` (a 1:1 placeholder) instead of depositing into a pool.
- `pool_address` is set to `token_a.clone()` — a placeholder, not a real AMM contract.
- `claim_yield_escrow` / `cancel_yield_escrow` return principal only; no LP share withdrawal or yield computation.

The module header tracks the remaining work under `TODO(#amm-integration, #yield-escrow-v2)`. This is the highest-value open item on the roadmap ("AMM/DeFi integration (yield_escrow TODOs)").

## Objectives
1. Replace the placeholder `pool_address` with a configurable AMM pool address stored on the escrow record.
2. In `create_yield_escrow`, transfer token A into the pool and record the actual LP `shares_received`.
3. In `claim_yield_escrow` / `cancel_yield_escrow`, withdraw the LP shares and pay out principal plus accrued yield (or refund the funder).
4. Add a mock AMM contract for tests and integration tests for the full lifecycle.

## Suggested Execution
1. Fork the repo and create a branch: `git checkout -b feat/amm-yield-escrow`.
2. Implement pool deposit/withdraw in `contracts/finchippay-contract/src/yield_escrow.rs`, replacing the `// TODO(#amm-integration, ...)` markers.
3. Add a mock AMM (a minimal token-pair pool) under `contracts/finchippay-contract/tests/` or `src/test.rs`.
4. Add integration + fuzz tests for the yield escrow lifecycle (create → accrue → claim/cancel).
5. Run `cargo fmt --check && cargo clippy -- -D warnings && cargo test` and commit.
6. Open a PR with `Closes #N` in the description.

## Acceptance Criteria
- [ ] `create_yield_escrow` deposits into a real (mock-testable) AMM pool and stores actual `shares_received`, not `amount`.
- [ ] `claim_yield_escrow` returns principal + accrued yield computed from LP share value.
- [ ] `cancel_yield_escrow` refunds the funder with principal + accrued yield.
- [ ] `pool_address` is validated and cannot be a placeholder/zero address.
- [ ] ≥5 new tests cover create/claim/cancel with a mock AMM, including a no-yield and a partial-withdraw case.
- [ ] `cargo test` and `cargo build --release --target wasm32v1-none` pass with no warnings.

## Guidelines
- Minimum 95% test coverage on the changed module (`cargo test`).
- `require_auth` on every state-changing entrypoint; overflow-safe math via `checked_*` (no `unwrap()` in production paths).
- Clear `///` rustdoc on new public functions and events.

## Timeframe
96 hours
