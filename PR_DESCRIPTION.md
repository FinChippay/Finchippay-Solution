## Summary

Emits complete, structured events for the contract entry points that were missing or under-specified them, so off-chain indexers can reconstruct escrow/stream/multisig/batch state without replaying every ledger or reading storage.

## Type of change

- [ ] Bug fix
- [x] New feature
- [x] Documentation update
- [ ] Refactor / chore
- [x] Smart contract change

## Related issue

Closes #55

## Changes

- `cancel_escrow`: renamed `escrow_cancel` → `escrow_cancelled`, topic reduced to `(escrow_cancelled,)`, data now `(id, from, amount)`.
- `top_up_stream`: renamed `stream_topup` → `stream_topped_up`, topic reduced to `(stream_topped_up,)`, data now `(id, payer, added, new_deposit)`.
- `cancel_multisig`: renamed `multisig_cancel` → `multisig_cancelled`, topic reduced to `(multisig_cancelled,)`, data now `(id, proposer, amount)`.
- `batch_send`: renamed `batch_send` event → `batch_sent`, topic reduced to `(batch_sent,)`, data now `(from, count, total_amount)` — `total_amount` is accumulated via `checked_add` across the fan-out loop.
- Verified `rescue_tokens` already emits `(rescue_tokens,)` with `(token_address, amount, to)`, matching the required single-symbol topic pattern — added a regression test since none previously existed.
- Added a "Event Catalogue" section to `docs/architecture.md` cataloguing every contract event (topics, data, emitting function), including the ones changed here.

## Testing

- [ ] Tested locally on Testnet
- [x] Added/updated unit tests
- [ ] Manually tested UI flow

Added 5 new unit tests in `contracts/finchippay-contract/src/lib.rs` that assert on `env.events().all().filter_by_contract(&contract_id)`, verifying exact topics and data for `escrow_cancelled`, `stream_topped_up`, `multisig_cancelled`, `batch_sent`, and `rescue_tokens`.

Note: `cargo test` currently fails to build in this environment even on a clean checkout of `master` (verified via `git stash`), due to an upstream dependency conflict — `soroban-env-host 27.0.0`'s test utilities pull in a `ChaCha20Rng` that no longer satisfies `ed25519_dalek::rand_core::CryptoRng` under the currently resolved `rand_core` versions. This is unrelated to this PR and wasn't addressed here. The non-test contract code was verified with `cargo check --lib`, which compiles cleanly (only pre-existing `#[deprecated]` warnings on `Events::publish`, consistent with the rest of the file).

## Screenshots (if UI change)

N/A — contract-only change.

## Checklist

- [x] My code follows the project style
- [x] I've updated docs if needed
- [ ] No console errors or warnings
- [x] I've rebased on latest `main`
