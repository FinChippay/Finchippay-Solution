# Changelog

All notable changes to the Finchippay-Solution smart contract will be documented in this file.

## [Unreleased]

### Security Fixes

- **#54: Mandatory multi-sig expiration** — `create_multisig` now requires `expiration_ledger` to be strictly greater than the current ledger sequence, and rejects a TTL longer than the new `MAX_MULTISIG_TTL` (518,400 ledgers, ≈ 30 days). The `expiration_ledger == 0` escape hatch ("no expiration") has been removed from `approve_multisig`, so every proposal now has a bounded lifetime and can no longer accumulate approvals indefinitely from signers whose keys may have since been rotated or compromised.

### Breaking Changes

- Callers of `create_multisig` that previously passed `expiration_ledger = 0` to mean "never expires" must now pass an explicit ledger sequence in the future, no more than `MAX_MULTISIG_TTL` (518,400) ledgers out. Passing `0`, a past/current ledger, or a value beyond the cap now panics.

## [v3.1.0] - 2026-07-26

### Dependency Upgrades

- **#69: soroban-sdk v20 → v27.0.1** — Upgraded the Soroban SDK to the latest stable release.
  - Updated build target to `wasm32v1-none` (required by soroban-sdk v27+).
  - Migrated `register_contract` → `register` with new signature `(contract, salt)`.
  - Migrated `register_stellar_asset_contract` → `register_stellar_asset_contract_v2` which returns `StellarAssetContract` instead of `Address`.
  - Added `testutils::Ledger` import for `with_mut` on test ledger.
  - Guarded `bump()` call in `require_not_paused` with `.has()` check — soroban-env-host v27 panics on `extend_ttl` for non-existent keys.

### Test Fixes

- Updated escrow test amounts to meet `MIN_ESCROW_AMOUNT` (1,000 base units).
- Fixed stream overflow safety test to advance enough ledgers for full deposit coverage.

### Known Issues

- **Deprecation warnings**: 25 `publish` deprecation warnings remain from pre-existing code. Migration to `#[contractevent]` macro is tracked separately; suppressed with `#[allow(deprecated)]` on the test module.
- **Testnet deployment**: Not verified in this environment; pending manual verification via `scripts/deploy-contract.sh`.

---

## [v3.0.0] - 2026-07-14

### Security Fixes

- **#1: Initialization guard** — Added `require_initialized()` guard to all operational entry points (`send_tip`, `mint_receipt`, `create_escrow`, `open_stream`, `create_multisig`, `batch_send`). Prevents use of the contract before `initialize()` is called.
- **#2: Batch size enforcement** — Added `MAX_BATCH_SIZE` constant (50 recipients) and validation in `batch_send` to prevent DoS via oversized batch operations.
- **#3: Duplicate signer detection** — `create_multisig` now rejects signer lists containing duplicate addresses, preventing threshold spoofing attacks.
- **#4: Self-tipping prevention** — `send_tip` now rejects transfers where `from == to`, preventing on-chain stat inflation.
- **#5: Self-escrowing prevention** — `create_escrow` now rejects transfers where `from == to`, preventing state bloat from self-escrows.
- **#6: Atomic batch pre-validation** — `batch_send` validates all amounts are positive before initiating any token transfers, ensuring atomicity.
- **#16: Self-streaming prevention** — `open_stream` now rejects streams where `payer == recipient`.
- **#17: Self-multisig prevention** — `create_multisig` now rejects proposals where `proposer == recipient`.
- **#18: Minimum amount enforcement** — Added `MIN_ESCROW_AMOUNT` and `MIN_MULTISIG_AMOUNT` (1,000 base units) to prevent dust attacks.
- **#22: Empty input validation** — Rejects empty signers lists in `create_multisig` and empty recipient arrays in `batch_send`.
- **#23: Memo length validation** — Added `MAX_MEMO_LENGTH` (32 chars) and enforcement in `mint_receipt`.

### New Features

- **#7: RBAC pauser role** — Introduced a separate `Pauser` role via `set_pauser()` / `get_pauser()`. The pauser can call `pause()` and `unpause()` without holding admin upgrade rights.
- **#12: Approval progress in events** — `multisig_approve` event now emits `(signer, current_approvals, threshold)` for real-time indexer tracking.
- **#13: Escrow recipient index** — Added `get_user_escrows(recipient)` and `EscrowByRecipient` storage key for querying all escrows directed to an address.
- **#14: Multi-sig expiration** — Added `expiration_ledger` field and `timeout_multisig()` function. Expired proposals can be closed by anyone, refunding locked funds.
- **#15: Recipient stream rejection** — Added `reject_stream()` allowing recipients to opt out of incoming streams for compliance or personal reasons.
- **#19: Partial escrow claims** — Added `claim_escrow_partial(id, amount)` supporting incremental withdrawals from escrows.
- **#20: Memo support** — Added optional `memo: Symbol` field to `TipRecord`, `Escrow`, `send_tip()`, and `create_escrow()`.
- **#21: Admin token rescue** — Added `rescue_tokens()` to sweep accidentally-sent tokens from the contract address.
- **#25: Stream recipient transfer** — Added `transfer_stream()` allowing recipients to reassign incoming streams to a new address.
- **Diagnostic endpoint** — Added `get_contract_stats()` returning `(escrow_count, stream_count, multisig_count)` for monitoring dashboards.

### Code Quality & Refactoring

- **#8: Extended error enum** — Added `SelfTransfer`, `BatchTooLarge`, `DuplicateSigner`, and `ProposalExpired` variants to `ContractError`.
- **#9/#10: DRY helpers** — Introduced `get_token_client()` helper for token client instantiation, adopted across all 15+ call sites in production code.
- **#11: Iterator usage** — Replaced manual for-loop indexing in `approve_multisig` with idiomatic `.iter().any()` closures.

### Test Coverage

- **#21: Pause/circuit-breaker tests** — Added 3 tests verifying `send_tip`, `create_escrow`, and `open_stream` are blocked when paused.
- **#22/#24: Batch send & stream rejection tests** — Added success and error-path tests for `batch_send` and `reject_stream`.
- **#23: Stream overflow safety** — Added test verifying claimable amount caps at deposit for extreme ledger values.
- **#24: Escrow boundary tests** — Added tests for `MAX_ESCROW_LEDGERS` enforcement and minimum amount rejection.
- **#25: Initialization guard tests** — Added tests verifying `send_tip` and `create_escrow` panic before initialization.
- **Multi-sig tests** — Added tests for duplicate signer rejection, proposal timeout/expiry, and minimum amount enforcement.
- **Partial escrow tests** — Added test verifying incremental claim lifecycle from Pending to Released.
- **Contract stats test** — Added test verifying aggregate counts are correctly reported.
- **Self-transfer tests** — Added tests verifying self-tipping and self-escrowing panics.

### Breaking Changes

- `send_tip()` now requires a `memo: Symbol` parameter.
- `create_escrow()` now requires a `memo: Symbol` parameter.
- `create_multisig()` now requires an `expiration_ledger: u32` parameter (pass 0 for no expiration).
- `pause()` and `unpause()` parameter renamed from `admin` to `caller` (supports either admin or pauser).
- `CONTRACT_VERSION` bumped from 2 to 3.

### Documentation

- Updated `contracts/finchippay-contract/README.md` with all new functions, security features, and event emissions.

---

## [v2.0.0] - Previous release

- Initial production-grade Soroban contract with tips, receipts, escrow, streaming, multi-sig, batch send, pause/unpause, and upgrade functionality.
