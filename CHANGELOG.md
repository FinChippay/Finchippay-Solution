# Changelog

All notable changes to the Finchippay-Solution smart contract will be documented in this file.

## [Unreleased]

### Security

- **Hardened anchors config**: ANCHORS_CONFIG is now required in production. The dev-only testanchor default triggers a startup error in production environments instead of silently falling back to an insecure default.
- **Cryptographically random webhook seeds**: Development seed data now uses `crypto.randomBytes` for webhook secrets instead of a hardcoded value.
- **Structured frontend logging**: Replaced 67 scattered `console.error` calls across all pages and components with a centralized logger that forwards errors to Sentry in production and sanitizes sensitive context data (keys, tokens, passwords).

### Code Quality

- **TypeScript strictness**: Replaced 34 `any` type annotations with proper interfaces across all frontend source files (components, libs, hooks). Created `TransactionReceipt`, `PendingTransaction`, `LedgerTransport`, `LedgerStellarApp`, and `GlobalWithFetchPatch` types.
- **Contract module organization**: Extracted data types into `types.rs` and event symbols into `events.rs` to reduce the monolithic `lib.rs`.
- **TODO resolution**: Replaced 3 outstanding TODO comments with resolved architecture notes and clear upgrade paths.
- **ESLint strict mode**: Frontend now enforces `no-explicit-any: warn`, import ordering, and prefer-optional-chain rules.

### Documentation

- **Governance model** (GOVERNANCE.md): Complete community governance framework with roles, RFC process, voting mechanics, code of conduct, and release cadence.
- **Security audit framework** (docs/SECURITY_AUDIT_FRAMEWORK.md): Comprehensive checklist covering contracts, backend API, and frontend with incident response protocol.
- **Testing guide** (docs/testing.md): Multi-layer testing strategy with coverage targets.
- **RFC template** (docs/rfc/TEMPLATE.md): Standardized format for architectural proposals.

### Testing

- **Coverage thresholds**: Backend (60% lines, 50% branches) and Frontend (65% lines, 60% branches) via Istanbul/NYC.

### Added

- **Automated storage TTL management** — audited every persistent storage operation in `FinchippayContract` for TTL coverage and closed the gaps. Entries are now created at a `MIN_TTL_LEDGERS` floor (535,680 ledgers, ≈31 days) and refreshed by any read or update that finds them below `MIN_TTL_THRESHOLD` (100,000 ledgers), so live escrows, streams, vesting schedules, and multi-sig proposals cannot expire while in use. Read paths that previously returned data without extending its TTL — `is_paused`, `get_escrow_count`, `get_stream_count`, `get_multisig_count`, `get_emergency_withdrawal_count`, `get_arbitrators`, `verify_receipt`, `get_claimable_vesting`, `list_streams_by_payer`, `locked_balance`, `get_contract_balance`, and the escrow claim/cancel paths' recipient lookup — now bump the entries they touch. Added `bump_all_ttls(admin, max_keys)`, an admin-only sweep for cold entries that nobody reads: it walks the enumerable key classes, processes at most `min(max_keys, 100)` keys per call, and persists a cursor so repeated calls complete a pass without exceeding one transaction's resource budget. Added `get_min_ttl()` → `(ledgers, class)` reporting the lowest lifetime the contract can still prove, for off-chain alerting. Tip records, locked balances, and cached contract balances are keyed by arbitrary addresses with no on-chain registry, so they are not sweepable and rely on the per-operation bumps; this is documented on `bump_all_ttls`.
- **SBOM generation & supply-chain vulnerability scanning** — added Software Bill of Materials generation in both SPDX and CycloneDX formats for the frontend (npm), backend (npm), and Soroban contract (cargo) via [syft](https://github.com/anchore/syft), exposed through new `make sbom` / `make sbom-scan` targets. CI now generates SBOMs on every build, uploads them as the `sboms` artifact, and **fails on CRITICAL/HIGH vulnerabilities** via [grype](https://github.com/anchore/grype) (`SBOM & Vulnerability Scan` job in `ci.yml`). Container images are scanned with Trivy in `docker-publish.yml` (build → scan → push, so a vulnerable image never reaches ghcr.io). A new scheduled `sbom-scan.yml` workflow regenerates and scans SBOMs weekly and opens a tracking issue on new CRITICAL vulnerabilities. Releases now attach all SBOMs as assets (`release.yml`), and `SECURITY.md` documents SBOM availability (for Executive Order 14028 compliance).
- **#240 (Issue #74): Server-side cursor pagination for list endpoints** — standardized cursor-based pagination across the backend list APIs. New `middleware/pagination.js` parses `?limit=` (default 20, capped at 100 server-side) and an opaque `?cursor=`, and a new `utils/paginate.js` helper builds pages, applies Knex keyset predicates, and emits RFC 5988 `Link` (`rel="next"`) plus `X-Total-Count` headers. Applied to tips (received/sent, true keyset), webhooks (list + failures), scheduled-transactions, and events (offset retained, opaque cursor added); the events router is now mounted. The reference `payments` endpoint was fully aligned to emit the same `Link` (from Horizon's native paging token) and `X-Total-Count` headers — the payments total is an approximate, bounded count (Horizon exposes no exact total; floored at 200 via `stellarService.countPaymentsApprox`). Analytics endpoints (`/summary`, `/top-recipients`, `/activity`) are documented as intentionally excluded — they are bounded aggregations, not unbounded lists. Added `VAL_INVALID_CURSOR` error code, Swagger docs (reusable `limit`/`cursor` params + pagination headers), and `__tests__/pagination.test.js` (16 cases).

### Accessibility Fixes

- Improved screen reader support in the `MultiSigFlow` component by replacing generic `div` elements with semantic `<ol>`/`<li>` lists and adding `aria-current="step"`.
- Added `role="alert"` and `aria-live="polite"` to `MultiSigFlow` error containers to ensure validation messages are announced immediately.
- Added programmatic accessibility testing using `jest-axe` to the `MultiSigFlow` test suite.

### Security Fixes

- **Client-side encryption for contacts, payment templates & federation cache** — the address book (`frontend/lib/addressBook.ts`), the federation-resolution cache (`finchippay:federation-cache`, which links a federation address to the Stellar account it resolves to) and a new payment-template store (`frontend/lib/paymentTemplates.ts`) are now encrypted at rest in `localStorage` using AES-GCM via the Web Crypto API (`frontend/lib/encryption.ts` + a generic `frontend/lib/encryptedStorage.ts`). The key is derived (PBKDF2) from the connected Stellar public key plus a random salt, held in memory only for the active wallet session, and cleared on disconnect; stored data is a Base64 `{v,owner,data}` envelope. Switching wallets is detected and surfaces a re-encryption prompt, and the contacts page shows a lock indicator. Legacy plaintext contacts are migrated to ciphertext on first unlock. Also repaired the frontend Jest runner (removed a duplicate `jest.config.js` that collided with `jest.config.ts`, and moved `jest.setup.ts` to `setupFilesAfterEnv`) and added `__tests__/encryption.test.ts` + `__tests__/encryptedStorage.test.ts` (11 cases).
- **#58: Pauser role enforcement** — `pause` and `unpause` now accept either the stored admin or the designated pauser address (set via `set_pauser`), so the separate pause-only role is actually consulted instead of being ignored. This lets a low-exposure "hot key" trigger the emergency circuit breaker during an incident without bringing the admin key online. The pauser remains strictly pause-only — it cannot `upgrade`, `transfer_admin`, `set_pauser`, or `rescue_tokens`. Added unit tests covering pauser pause/unpause, stranger rejection, and pauser being denied upgrade/admin-transfer, and documented both roles in `docs/architecture.md`.
- **#54: Mandatory multi-sig expiration** — `create_multisig` now requires `expiration_ledger` to be strictly greater than the current ledger sequence, and rejects a TTL longer than the new `MAX_MULTISIG_TTL` (518,400 ledgers, ≈ 30 days). The `expiration_ledger == 0` escape hatch ("no expiration") has been removed from `approve_multisig`, so every proposal now has a bounded lifetime and can no longer accumulate approvals indefinitely from signers whose keys may have since been rotated or compromised.
- **#678: Remove legacy single-admin `rescue_tokens()`** — the deprecated `rescue_tokens()` entry point could be called by a single compromised admin key to sweep all unlocked funds instantly, with no timelock or multi-sig approval. It has been deleted, together with the instant `rescue_tokens` admin-governance action. Funds rescue now goes exclusively through the time-delayed, M-of-N-gated `initiate_emergency_withdrawal` → `approve_emergency_withdrawal` → `execute_emergency_withdrawal` flow.

### Breaking Changes

- **#678: `rescue_tokens()` removed** — the legacy single-admin `rescue_tokens` entry point and the `rescue_tokens` admin action no longer exist. Callers must migrate to the time-delayed emergency-withdrawal flow (`initiate_emergency_withdrawal` → `approve_emergency_withdrawal` → `execute_emergency_withdrawal`).
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

## [v3.1.1] - 2026-08-11

### Fixed

- **Critical**: health.test.js syntax error (missing closing braces in disk-space and postgres test blocks).
- **Critical**: validateEnv.js duplicated SMTP comment blocks from merge artifact removed.
- **Critical**: VAPID keys made optional in non-production environments; app no longer fails to start without push notification config.
- **High**: GraphQL context no longer falls back to insecure `finchippay_secret_key` default when JWT_SECRET is unset.
- **High**: Webhook restoration now awaited at startup instead of fire-and-forget.
- **Medium**: Contract Cargo.toml version bumped from 0.0.0 to 3.1.0 to match on-chain CONTRACT_VERSION.
- **Medium**: Stellar SDK updates re-enabled in Renovate (previously ignored), with minor/major requiring review.
- **Medium**: Test coverage thresholds raised to 70% lines / 60% branches.
- **Medium**: Better CONTRACT_ID error messaging via `requireContractId()` helper with setup instructions.
- **Low**: Replaced bare `console.log` with `console.info` in SEP-0007 protocol handler; documented rationale.

### Changed

- Documentation: ROADMAP updated with v1.4 quality & stability milestones.
- Documentation: Audit status page added with self-audit preparation checklist.
- Documentation: PGP key section updated with key discovery instructions.
- Documentation: VAPID keys documented as optional in non-production environments.
