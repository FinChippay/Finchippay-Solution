# Issue #2 — Stream Pause / Resume Entrypoints

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `streaming` `feature`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Add `pause_stream` and `resume_stream` entrypoints so a payer can freeze and unfreeze a payment stream without closing it.

## Requirements and Context

The `Stream` struct in `contracts/finchippay-contract/src/types.rs` and `lib.rs` already tracks pause state:

```rust
pub paused_at_ledger: u32,
pub total_paused_duration: u32,
```

…and `claimable_at()` (in `lib.rs`) already subtracts `total_paused_duration` from the elapsed time when `paused_at_ledger > 0`. The **accounting is in place, but there are no `pause_stream` / `resume_stream` entrypoints** — nothing ever sets these fields, so the feature is unreachable. The roadmap lists "Stream pause / resume (contract extension)" as open.

## Objectives
1. Implement `pause_stream(env, stream_id, payer)` — payer-only, sets `paused_at_ledger`, emits `stream_paused`.
2. Implement `resume_stream(env, stream_id, payer)` — payer-only, folds the paused duration into `total_paused_duration` and clears `paused_at_ledger`, emits `stream_resumed`.
3. Guard both against closed streams and non-payer callers.
4. Wire the events into `src/events.rs` and add tests for the pause/resume/claim arithmetic.

## Suggested Execution
1. Fork and branch: `git checkout -b feat/stream-pause-resume`.
2. Implement the two entrypoints in `contracts/finchippay-contract/src/streams.rs`, reusing the existing `claimable_at` semantics.
3. Add `stream_paused` / `stream_resumed` to `src/events.rs`.
4. Add tests: pause stops accrual, resume resumes it, claimable is correct across multiple pause/resume cycles, non-payer call panics.
5. Run `cargo fmt --check && cargo clippy -- -D warnings && cargo test`, then open a PR.

## Acceptance Criteria
- [ ] `pause_stream` is callable only by the payer and sets `paused_at_ledger`.
- [ ] `resume_stream` accumulates the paused span into `total_paused_duration` and clears `paused_at_ledger`.
- [ ] `claimable_at` returns 0 additional tokens while paused (no accrual during a pause).
- [ ] Multiple pause/resume cycles produce the same final claimable amount as an uninterrupted stream.
- [ ] Both entrypoints panic on closed streams and non-payer callers with descriptive messages.
- [ ] ≥5 new tests; `cargo test` and `cargo build --release --target wasm32v1-none` pass.

## Guidelines
- Minimum 95% test coverage on the changed module; `require_auth` on every state-changing entrypoint.
- Overflow-safe math (`checked_*`/`saturating_*`); no `unwrap()` in production paths.
- Clear `///` rustdoc on new public functions.

## Timeframe
72 hours
