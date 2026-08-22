# Roadmap — Finchippay-Solution

This document tracks what's shipped, what's in progress, and what's planned.

---

## ✅ v1.0 — Foundation (Shipped)

- [x] Freighter wallet connection (non-custodial)
- [x] Send XLM or any Stellar asset
- [x] Paginated transaction history with filters
- [x] Next.js 14 frontend with Tailwind CSS
- [x] Express backend with Horizon proxy, auth, rate limiting
- [x] Docker Compose local dev environment
- [x] GitHub Actions CI (frontend + backend + contracts + Playwright)

---

## ✅ v1.1 — Smart Contract (Shipped)

- [x] `FinchippayContract` Soroban WASM contract
- [x] Tips with on-chain aggregate stats
- [x] Immutable payment receipts
- [x] Time-locked escrow (create / claim / cancel)
- [x] Streaming payments (open / claim / top-up / close)
- [x] N-of-M multi-sig payment proposals (auto-execute at threshold)
- [x] Batch fan-out sends
- [x] Full test suite (15+ tests, checked arithmetic, TTL management)

---

## ✅ v1.2 — Platform Features (Shipped)

- [x] SEP-0002 federation (username → Stellar address)
- [x] SEP-0010 JWT auth
- [x] Analytics dashboard (volume charts, top recipients, activity by day)
- [x] Recurring payment schedules (client-side)
- [x] Batch payment form
- [x] Payment link generator + QR codes
- [x] Creator tipping dashboard + `/tip/:username` pages
- [x] AI payment assistant
- [x] Address book with federation resolution
- [x] Stellar DEX trading interface
- [x] PWA manifest + service worker offline support
- [x] Storybook component library
- [x] Sentry error tracking (secret key redaction)
- [x] Webhook delivery with HMAC-SHA256 signatures
- [x] Turrets txFunction deployment and monitoring

---

## 🔄 v1.3 — Hardening (In Progress)

- [x] Emergency pause mechanism (circuit breaker) on the Soroban contract
- [x] Contract upgradability (`upgrade(new_wasm_hash)`) with version tracking
- [x] Deposit/timelock upper bounds to prevent griefing and permanent lock-up
- [x] Cumulative top-up cap enforcement in streaming payments
- [x] Cross-dialect migrations (SQLite + PostgreSQL) (#027)
- [x] JWT_SECRET fallback removed — hard error on missing config
- [x] Frontend eslint-disable cleanup with documented rationales
- [x] Console.* replaced with structured logger across all components
- [x] Contract AMM/yield escrow TODOs linked to GitHub issue tracker
- [x] Legacy `rescue_tokens` removed; the time-delayed emergency withdrawal flow is the sole funds-rescue path (#678)
- [x] Stellar SDK v16 upgrade in frontend package.json
- [x] Coverage thresholds raised to 80% lines / 70% branches
- [ ] Third-party security audit of FinchippayContract
- [ ] Migrate tips/username storage from in-memory to SQLite/PostgreSQL
- [ ] Refresh token rotation for SEP-0010 sessions
- [ ] Soroban RPC abstraction layer in the frontend
- [ ] Stream pause / resume (contract extension)
- [ ] Integration tests for streaming and multi-sig UI flows

---

## 📋 v2.0 — Mainnet Readiness

- [x] Bug bounty program details documented in SECURITY.md
- [x] Audit preparation roadmap with auditor shortlist
- [x] Community channels expanded (Discord planned, GitHub Discussions active)
- [x] Benchmark regression detection added to CI pipeline
- [ ] Formal security audit of `FinchippayContract`
- [ ] Mainnet contract deployment + verification
- [ ] Contract event migration: `publish()` → `#[contractevent]` macro
- [ ] USDC and other SAC token support throughout the UI
- [ ] Multi-network switching (testnet ↔ mainnet) per-session
- [ ] Fiat on-ramp integration (MoneyGram, Stellar Anchor)
- [ ] Mobile-responsive PWA improvements
- [ ] Multi-language SDKs (Python, Go, Rust) with generated bindings
- [ ] Push notification webhooks via web-push

---

## 💡 Ideas / Community Requests

- Multi-language i18n support (English, Spanish, French) ✅
- RTL language support (Arabic, Hebrew) — noted as future work
- Milestone-based escrow releases
- Subscription/recurring payments via Soroban streams
- DAO treasury multi-sig management UI
- CSV export of payment history
- NFT receipt display in wallet dashboard

---

Have an idea? [Open an issue](https://github.com/FinChippay/Finchippay-Solution/issues) or see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 📋 v1.4 — Quality & Stability (Current)

- [x] Cross-dialect migration support (SQLite + PostgreSQL)
- [x] Error code documentation drift checks in CI
- [x] Code quality improvements (unused imports removed, logger deduplication)
- [x] Stellar SDK Renovate updates re-enabled for automated version tracking
- [x] Contract version in Cargo.toml aligned with on-chain CONTRACT_VERSION
- [x] VAPID keys made optional in non-production environments
- [x] Health test suite fixed (missing braces, ESLint globals)
- [x] Better CONTRACT_ID error messaging with requireContractId helper
- [x] JWT_SECRET fallback default removed — hard error when missing
- [x] Console.* calls replaced with structured logger in ErrorBoundary, TransactionActions
- [x] AMM integration TODOs linked to GitHub issue tracker with detailed roadmap
- [x] Stellar SDK v16 upgrade in frontend dependencies
- [x] Coverage thresholds raised to 80% lines / 70% branches / 75% functions
- [x] Benchmark regression detection added to CI pipeline
- [ ] Contract event migration: `publish()` → `#[contractevent]` macro
- [ ] AMM/DeFi integration (yield_escrow TODOs)
- [ ] Third-party security audit
- [ ] Increase test coverage to 80%+ across all components

---

*Last updated: August 11, 2026*
