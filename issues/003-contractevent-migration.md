# Issue #3 — Migrate Contract Events from publish() to #[contractevent]

**Labels:** `Official Campaign | FWC26` `Stellar Wave` `GrantFox OSS` `Maybe Rewarded` `contract` `soroban` `events` `refactor`

> This is a smart-contract issue for the GrantFox FWC26 campaign (Stellar Wave). Migrate the contract's `env.events().publish(...)` calls to the modern `#[contractevent]` macro for typed, self-describing events.

## Requirements and Context

Every state change currently emits events via `env.events().publish((Symbol::new(...), id), (...))`. `src/events.rs` centralises the event symbol strings, and `lib.rs` carries a note that "the `#[contractevent]` macro is available in newer SDK versions". The roadmap lists "Contract event migration: `publish()` → `#[contractevent]` macro" as open. Typed events improve indexer reliability, SDK bindings, and auditability.

## Objectives
1. Define `#[contracttype]` event structs for each event in the `src/events.rs` catalog.
2. Replace `env.events().publish(...)` call sites with `#[contractevent]`-derived emission.
3. Keep the event symbol names backward-compatible so the existing indexer (`backend/src/services/eventIndexer.js`) keeps working.
4. Update the event catalog docs in `src/events.rs` and any SDK bindings that reference event shapes.

## Suggested Execution
1. Fork and branch: `git checkout -b refactor/contractevent-migration`.
2. Convert the event catalog in `src/events.rs` to typed `#[contracttype]` event structs + `#[contractevent]` impls.
3. Sweep `src/*.rs` replacing `env.events().publish(...)` with the new typed emitters.
4. Verify `cargo test` still passes and the indexer can still parse emitted topics/payloads.
5. Open a PR with `Closes #N`.

## Acceptance Criteria
- [ ] All state-changing entrypoints emit typed `#[contractevent]` events.
- [ ] Event topic names (`tip_sent`, `escrow_created`, `stream_opened`, …) are unchanged.
- [ ] `backend/src/services/eventIndexer.js` parses the migrated events without changes (or documents a minimal, justified change).
- [ ] `src/events.rs` catalog is updated to list the new typed event definitions.
- [ ] `cargo test` and `cargo build --release --target wasm32v1-none` pass; `cargo clippy -- -D warnings` clean.

## Guidelines
- Minimum 95% test coverage; no `unwrap()` in production paths.
- Keep event payloads ABI-stable unless a breaking change is explicitly documented in the PR.
- Clear `///` rustdoc on every event struct.

## Timeframe
48 hours
