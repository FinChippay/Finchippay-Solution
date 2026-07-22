# Finchippay-Solution — GrantFox OSS Issues Index

> **50 implementation-ready issues** for OSS grant contributors.  
> Created: July 22, 2026 | Repo: [FinChippay/Finchippay-Solution](https://github.com/FinChippay/Finchippay-Solution)

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| **P0** | Critical — blocks production deployment or is foundational for other issues |
| **P1** | High — important feature needed in the near term |
| **P2** | Medium — valuable enhancement that can wait |
| **P3** | Low — nice-to-have, futures |

**Grant Suitability (1–5):** How attractive this issue is for an OSS grant program (5 = perfect: self-contained, measurable, visible impact).

---

## Contract / Soroban (8 issues)

| # | Title | Priority | Grant | Labels |
|---|-------|----------|-------|--------|
| 1 | Gas Profiling & Optimisation for FinchippayContract | P1 | 4 | contract, optimization, soroban |
| 2 | Property-Based Fuzz Testing for Streaming Payment Arithmetic | P1 | 4 | contract, testing, security |
| 3 | Contract Event Indexer Service | P0 | 5 | backend, indexer, new-service |
| 4 | Vesting Schedule Contract Extension | P2 | 4 | contract, feature, vesting |
| 5 | Merkle-Tree Airdrop Contract Extension | P2 | 3 | contract, feature, airdrop |
| 6 | Admin Multi-Sig for Contract Governance | P1 | 4 | contract, security, governance |
| 7 | Contract Deployment & Verification Automation | P1 | 3 | devops, automation, contract |
| 8 | Contract State Export / Migration Tool | P2 | 3 | contract, tooling, data |

## Backend (12 issues)

| # | Title | Priority | Grant | Labels |
|---|-------|----------|-------|--------|
| 9 | Migrate In-Memory Storage to SQLite/PostgreSQL | P0 | 5 | backend, database, persistence |
| 10 | Refresh Token Rotation for SEP-0010 Sessions | P0 | 5 | backend, security, auth |
| 11 | Redis Caching Layer for Horizon Queries | P1 | 4 | backend, performance, caching |
| 12 | Webhook Retry with Dead Letter Queue | P1 | 4 | backend, webhooks, reliability |
| 13 | Rate Limiting by Authenticated Identity | P1 | 4 | backend, security, rate-limiting |
| 14 | Database-Backed Turrets with Price Feed Fallbacks | P1 | 4 | backend, turrets, persistence |
| 15 | Stellar Anchor Integration (SEP-24) | P2 | 3 | backend, sep-24, fiat |
| 16 | KYC Integration via SEP-12 | P2 | 3 | backend, sep-12, compliance |
| 17 | GraphQL API Layer | P2 | 3 | backend, graphql, api |
| 18 | Input Validation with Zod Schemas | P1 | 4 | backend, validation, refactor |
| 19 | Scheduled Transaction Execution (Cron-Based) | P1 | 4 | backend, scheduled, cron |
| 20 | OpenTelemetry Distributed Tracing | P1 | 3 | backend, observability, tracing |

## Frontend (18 issues)

| # | Title | Priority | Grant | Labels |
|---|-------|----------|-------|--------|
| 21 | Soroban RPC Client Abstraction Layer | P0 | 5 | frontend, soroban, refactor |
| 22 | Dark Mode with System Preference Detection | P2 | 4 | frontend, ui, dark-mode |
| 23 | Accessibility (a11y) Audit & Remediation | P1 | 5 | frontend, accessibility, a11y |
| 24 | Offline Transaction Queue with Background Sync | P1 | 5 | frontend, pwa, offline |
| 25 | Multi-Account Management | P2 | 4 | frontend, wallet, multi-account |
| 26 | CSV Export of Transaction History | P2 | 4 | frontend, export, csv |
| 27 | Advanced Analytics Dashboard with Date Range Filtering | P2 | 4 | frontend, analytics, charts |
| 28 | Network Fee Estimator | P2 | 4 | frontend, fees, ux |
| 29 | Transaction Simulation Before Signing | P1 | 5 | frontend, soroban, safety |
| 30 | Ledger Hardware Wallet Support | P1 | 5 | frontend, wallet, hardware |
| 31 | NFT Receipt Gallery | P2 | 4 | frontend, nft, receipts |
| 32 | Push Notification Webhooks via Web Push API | P1 | 5 | frontend, notifications, push |
| 33 | Mobile-Responsive PWA Improvements | P1 | 4 | frontend, mobile, pwa |
| 34 | Complete i18n Translation Coverage | P2 | 3 | frontend, i18n, internationalization |
| 35 | Real-Time Balance via Server-Sent Events (SSE) | P1 | 4 | frontend, realtime, sse |
| 36 | Address Book Import/Export (CSV & vCard) | P2 | 4 | frontend, contacts, import-export |
| 37 | Token List Browser with Asset Discovery | P2 | 4 | frontend, tokens, assets |
| 38 | RTL Language Support (Arabic, Hebrew) | P3 | 3 | frontend, rtl, i18n |

## DevOps / QA (8 issues)

| # | Title | Priority | Grant | Labels |
|---|-------|----------|-------|--------|
| 39 | End-to-End Test Coverage: Escrow Flow | P1 | 4 | e2e, testing, escrow |
| 40 | End-to-End Test Coverage: Multi-Sig Flow | P1 | 4 | e2e, testing, multi-sig |
| 41 | Lighthouse CI Performance Budget | P1 | 4 | devops, performance, ci |
| 42 | Bundle Size Monitoring | P2 | 3 | devops, performance, bundle-size |
| 43 | Dependency Vulnerability Scanning | P1 | 4 | devops, security, dependencies |
| 44 | Contract Verification on Stellar Explorer | P1 | 4 | devops, contract, transparency |
| 45 | Load Testing with k6 | P1 | 4 | devops, testing, load-test |
| 46 | Canary Deployment Workflow for Vercel | P2 | 3 | devops, deployment, vercel |

## Cross-Cutting (4 issues)

| # | Title | Priority | Grant | Labels |
|---|-------|----------|-------|--------|
| 47 | Error Standardisation with Error Codes | P0 | 5 | cross-cutting, errors, api |
| 48 | Feature Flags System | P1 | 4 | cross-cutting, configuration |
| 49 | SDK / Client Library Generation | P2 | 4 | cross-cutting, sdk, dx |
| 50 | Structured Logging with Correlation IDs | P1 | 4 | cross-cutting, logging, observability |

---

## Top 10 by Impact (for Grant Programs)

| Rank | # | Title | Reason |
|------|---|-------|--------|
| 1 | 9 | Migrate In-Memory Storage to SQLite/PostgreSQL | Foundational — unblocks all persistence-dependent features |
| 2 | 47 | Error Standardisation with Error Codes | Cross-cutting DX improvement affecting every layer |
| 3 | 21 | Soroban RPC Client Abstraction Layer | Unblocks all contract interaction UI features |
| 4 | 3 | Contract Event Indexer Service | Enables on-chain auditing and contract activity visibility |
| 5 | 10 | Refresh Token Rotation for SEP-0010 Sessions | Critical security hardening for production auth |
| 6 | 23 | Accessibility (a11y) Audit & Remediation | Compliance requirement + broad user impact |
| 7 | 24 | Offline Transaction Queue with Background Sync | Unique differentiator for emerging markets |
| 8 | 29 | Transaction Simulation Before Signing | User safety — prevents costly mistakes |
| 9 | 32 | Push Notification Webhooks via Web Push API | Core engagement feature for recurring users |
| 10 | 30 | Ledger Hardware Wallet Support | Adoption blocker for security-conscious users |

---

## Quick Links

- [All GrantFox Issues](https://github.com/FinChippay/Finchippay-Solution/issues?q=label%3A%22GrantFox+OSS%22)
- [P0 Issues](https://github.com/FinChippay/Finchippay-Solution/issues?q=label%3A%22GrantFox+OSS%22+is%3Aissue+is%3Aopen+%22P0%22)
- [Full Issue Specs](GRANTFOX_ISSUES.md)
- [Top 10 PR Descriptions](pr-descriptions/)
