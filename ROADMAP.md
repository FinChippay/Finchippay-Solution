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

- [ ] Migrate tips/username storage from in-memory to SQLite/PostgreSQL
- [ ] Refresh token rotation for SEP-0010 sessions
- [ ] Soroban RPC abstraction layer in the frontend
- [ ] Contract upgrade path (admin transfer + re-initialization guard)
- [ ] Stream pause / resume (contract extension)
- [ ] Integration tests for streaming and multi-sig UI flows

---

## 📋 v2.0 — Mainnet Readiness

- [ ] Formal security audit of `FinchippayContract`
- [ ] Mainnet contract deployment + verification
- [ ] USDC and other SAC token support throughout the UI
- [ ] Multi-network switching (testnet ↔ mainnet) per-session
- [ ] Fiat on-ramp integration (MoneyGram, Stellar Anchor)
- [ ] Mobile-responsive PWA improvements
- [ ] Push notification webhooks via web-push

---

## 💡 Ideas / Community Requests

- Milestone-based escrow releases
- Subscription/recurring payments via Soroban streams
- DAO treasury multi-sig management UI
- CSV export of payment history
- NFT receipt display in wallet dashboard

---

Have an idea? [Open an issue](https://github.com/FinChippay/Finchippay-Solution/issues) or see [CONTRIBUTING.md](CONTRIBUTING.md).
