# GrantFox FWC26 (Stellar Wave) — Issue Ranking & Reward-Worthiness

> Ranking of **all 52 campaign issues**: #1–#12 from `GRANTFOX_ISSUES.md` (Batch 1) and #13–#52 from `GRANTFOX_ISSUES_BATCH2.md` (Batch 2). Each issue is scored on a combined 10-point scale weighing **criticality** (funds/security/governance/data-integrity impact), **strength & quality** (grounded in real code, verifiable acceptance criteria, bounded scope, concrete execution path), and **reward-worthiness** (how well it satisfies the GrantFox FWC26 / Stellar Wave evaluation bars: clear scope, testable outcomes, real project need, defined timeframe).

---

## Top 5 — Most Critical & Qualitative (Highest Reward-Worthiness)

### 🥇 1. Issue #26 — API Idempotency Keys for Payment Submission (Backend)
**Score: 9.7 / 10**
**Why it wins:** Direct, immediate funds risk — a client retry after a timeout can double-submit a payment. This is the classic "money bug" that rewards are designed to fix. The scope is surgically bounded (middleware + one table + three routes), the acceptance criteria are unambiguous (same key → same result; same key + different body → 409; scoped + TTL), and it follows the existing webhook idempotency precedent, so the contributor has a proven in-repo pattern to mirror.

### 🥈 2. Issue #23 — Admin-Action Timelock / Veto Window (Contract)
**Score: 9.6 / 10**
**Why it wins:** Governance-grade security on a funds-holding contract. A compromised (or malicious) multi-sig quorum can currently `upgrade`/`rescue_tokens` instantly; a configurable veto window is the difference between a contained incident and a total loss. It directly exercises the highest-value contract surface (multi-sig + `require_auth` + overflow-safe math), which is exactly what GrantFox rewards weight most heavily for smart contracts.

### 🥉 3. Issue #22 — Contract Upgrade State-Migration Test Suite (Contract)
**Score: 9.5 / 10**
**Why it wins:** State loss on upgrade is a catastrophic, *permanent* failure mode (user funds become unrecoverable). The contract already tracks `layout_version`, but nothing proves vN → vN+1 preserves seeded state. High criticality, a crisp verifiable deliverable (seed → upgrade → re-read → assert), and it forces contributors to understand the full contract data model — a strong signal of senior work.

### 4. Issue #17 — Property-Based Tests for Escrow, Multi-Sig & Batch (Contract)
**Score: 9.4 / 10**
**Why it wins:** Escrow, multi-sig, and batch are the three funds-critical paths, and only streaming has property coverage today. Randomized invariant checks (never over-pay/over-refund; execute only at threshold; outflow ≤ input) are the strongest available evidence of correctness. This also raises the contract's overall test-coverage quality bar, compounding the project's reward-worthiness.

### 5. Issue #8 — Mainnet Deploy + Verification (Contract / DevOps)
**Score: 9.3 / 10**
**Why it wins:** The highest-leverage "make it real" issue. The contract deploys to testnet only; a reproducible mainnet deploy + on-chain verification + public artifacts is the single biggest step toward production credibility — and it validates *everything else* (multi-sig governance, upgrade path, oracle wiring). Production-readiness is a decisive reward signal.

---

## Full Ordered Ranking (1–52)

| Rank | Issue | Domain | Score | One-line rationale |
|---|---|---|---|---|
| 1 | #26 API Idempotency Keys | Backend | 9.7 | Prevents double-pay; bounded scope; in-repo precedent |
| 2 | #23 Admin-Action Timelock | Contract | 9.6 | Veto window blocks compromised-quorum fund drain |
| 3 | #22 Upgrade State-Migration Test | Contract | 9.5 | Proves funds survive upgrades (catastrophic-failure guard) |
| 4 | #17 Property Tests (escrow/multisig/batch) | Contract | 9.4 | Randomized invariants on funds-critical paths |
| 5 | #8 Mainnet Deploy + Verification | Contract | 9.3 | Production readiness; validates all governance paths |
| 6 | #35 Horizon SSE Resilience & Backpressure | Backend | 9.2 | No lost/duplicated events = financial reconciliation integrity |
| 7 | #19 Batch Send Partial-Failure Atomicity | Contract | 9.1 | All-or-nothing multi-token fan-out safety |
| 8 | #30 Transaction Reconciliation Service | Backend | 9.0 | Detects ledger drift / missed funds before users notice |
| 9 | #12 Security Audit Preparation | Backend/QA | 8.9 | Removes the "never audited" blocker; hardens everything |
| 10 | #1 AMM/DeFi Yield Escrow | Contract | 8.8 | Real DeFi feature; well-scoped with existing TODOs |
| 11 | #21 Invariant Matrix Expansion | Contract | 8.7 | Extends on-chain invariants to newer modules |
| 12 | #24 Fuzz Corpus Expansion + CI | Contract | 8.6 | Catches panics in yield/vesting/airdrop early |
| 13 | #32 General-Purpose Audit Log | Backend | 8.6 | Security-event trail; observable + non-blocking |
| 14 | #5 SAC Token (USDC) Support | Contract | 8.5 | Adoption-critical; real-world asset support |
| 15 | #10 Test Coverage 80% | Contract | 8.5 | Raises the whole contract quality bar |
| 16 | #29 API Key Management | Backend | 8.4 | Scoped/revocable keys; hashed at rest |
| 17 | #2 Stream Pause / Resume Entrypoints | Contract | 8.3 | Struct already tracks it; entrypoints missing |
| 18 | #14 Milestone-Based Escrow Releases | Contract | 8.2 | Tranched releases for freelance/grant payouts |
| 19 | #15 Recurring Subscription Streams | Contract | 8.2 | True on-chain subscriptions via allowance + renew |
| 20 | #9 Streaming & Multi-Sig E2E | Contract | 8.1 | Cross-module integration coverage |
| 21 | #34 Backup Verification & Restore Drill | Backend | 8.0 | A backup that isn't restore-tested isn't a backup |
| 22 | #18 Vesting Cliffs & Revocation | Contract | 8.0 | Standard vesting semantics (cliff + clawback) |
| 23 | #3 ContractEvent Migration | Contract | 7.9 | Typed events; keeps indexer/dashboards correct |
| 24 | #25 Typed Event Schema + Indexer Test | Contract | 7.8 | Prevents silent event-shape drift |
| 25 | #13 On-Chain Price Oracle | Contract | 7.8 | Real yield pricing; staleness enforcement |
| 26 | #27 GraphQL Subscriptions | Backend | 7.7 | Real-time events over WS instead of polling |
| 27 | #28 SEP-31 Cross-Border Payments | Backend | 7.7 | Completes the SEP-12/24/38 anchor suite |
| 28 | #33 Tiered Rate Limiting | Backend | 7.6 | Reduces abuse while serving power users |
| 29 | #40 Recurring Payments Server Sync | Frontend | 7.6 | Brides localStorage → server executor |
| 30 | #52 SDK Dogfooding | Frontend | 7.5 | Battle-tests the public client surface |
| 31 | #38 Graceful Shutdown & Readiness | Backend | 7.5 | Clean drain; no lost in-flight work |
| 32 | #48 E2E Coverage (tips/trade/tokens/invoices) | Frontend | 7.4 | Regression coverage for user-facing flows |
| 33 | #4 Multi-Network Switching | Frontend | 7.3 | Testnet↔mainnet UX foundation |
| 34 | #6 DAO Treasury Multi-Sig UI | Frontend | 7.3 | Governance UI on the new multi-sig contract |
| 35 | #47 Trezor Hardware Wallet Support | Frontend | 7.3 | Second-most-popular hardware wallet |
| 36 | #16 Gas Regression Guard in CI | Contract | 7.2 | Fails PRs that regress entrypoint gas |
| 37 | #45 Portfolio Tax & Cost-Basis | Frontend | 7.1 | FIFO cost basis + realized gains |
| 38 | #20 Public TTL Sweep Entrypoint | Contract | 7.0 | Keeper-driven storage extension |
| 39 | #39 In-App Notification Center | Frontend | 7.0 | Persistent inbox + mark-read + deep links |
| 40 | #42 Invoice Dashboard & Reminders | Frontend | 6.9 | Status-filtered invoice management |
| 41 | #41 Payment Links Management UI | Frontend | 6.9 | Create/list/disable payment links |
| 42 | #43 Transaction Notes, Tags & Bookmarks | Frontend | 6.8 | Private bookkeeping on transactions |
| 43 | #44 Multi-Language PDF Receipts | Frontend | 6.8 | Localized + RTL receipts |
| 44 | #36 Multi-Currency / Forex Analytics | Backend | 6.7 | Fiat-equivalent totals with historical rates |
| 45 | #37 OpenTelemetry Span Coverage | Backend | 6.7 | DB/webhook/scheduler spans + sampling |
| 46 | #31 Webhook Delivery Dashboard & Replay | Backend | 6.6 | Inspect/replay dead-letter deliveries |
| 47 | #50 Route-Level Code Splitting | Frontend | 6.6 | Meets bundle budgets (complements #11) |
| 48 | #51 WCAG AAA & Screen-Reader E2E | Frontend | 6.5 | AAA contrast + screen-reader flows |
| 49 | #7 Multi-Language SDKs | SDK | 6.5 | Python/Go/Rust bindings |
| 50 | #49 Visual Regression Testing | Frontend | 6.4 | Screenshot baselines for core pages |
| 51 | #11 Bundle Size Monitoring | Frontend | 6.3 | Size-limit CI enforcement |
| 52 | #46 Custom Accent Theme | Frontend | 6.0 | Branding polish; low risk |

---

## Scoring Legend

- **9.0+ (S-tier):** Direct funds/security/governance impact, or production-readiness unlock. Highest reward potential. Recommend surfacing these first to contributors and the GrantFox maintainer review.
- **8.0–8.9 (A-tier):** Strong funds-adjacent, data-integrity, or security hardening with crisp, verifiable criteria.
- **7.0–7.9 (B-tier):** Real features/infrastructure with clear value and good quality, moderate criticality.
- **6.0–6.9 (C-tier):** Polish, UX, and supporting work — valuable but lower criticality, suitable for newer contributors.

> **Note:** the ranking weights *criticality + quality + reward-worthiness*, not effort. A 7.x issue may be a great "first PR" even though it isn't top-ranked for reward.
