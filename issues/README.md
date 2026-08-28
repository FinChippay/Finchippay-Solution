# OSS Grant Program — FWC26 (Stellar Wave) Implementation-Ready Issues

This directory holds **12 implementation-ready issues** for the Finchippay-Solution project, prepared for the **GrantFox FWC26 campaign (Stellar Wave)**. Each issue targets **4–10 hours** of engineering work and is scoped so an experienced contributor can complete it without clarification.

The canonical full-text source is [`GRANTFOX_ISSUES.md`](../GRANTFOX_ISSUES.md) (parsed by `scripts/create-grantfox-issues.js` to create the GitHub issues). The per-issue files below are kept in sync with it.

> ⚠️ **Superseded:** a previous 50-issue set and an earlier 30-issue set were pruned in this refresh — most of those issues had already been implemented in the codebase. This set is rebuilt against the *current* code and reflects only genuinely-open work.

## Campaign labels (required)

To appear inside the FWC26 campaign, every issue must carry the campaign tag **exactly**:

```
Official Campaign | FWC26, Stellar Wave, GrantFox OSS, Maybe Rewarded
```

## Issue Index

### Smart Contract (Rust / Soroban)
- **#1** — [AMM/DeFi Integration for Yield Escrow](001-amm-yield-escrow.md) — *advanced*
- **#2** — [Stream Pause / Resume Entrypoints](002-stream-pause-resume.md) — *intermediate*
- **#3** — [Migrate Contract Events to #[contractevent]](003-contractevent-migration.md) — *intermediate*

### Frontend (Next.js / TypeScript)
- **#4** — [Multi-Network Switching (Testnet ↔ Mainnet)](004-multi-network-switching.md) — *intermediate*
- **#5** — [SAC Token (USDC) Support Throughout the UI](005-sac-token-support.md) — *intermediate*
- **#6** — [DAO Treasury Multi-Sig Management UI](006-dao-treasury-multisig-ui.md) — *advanced*

### SDK / Cross-cutting
- **#7** — [Multi-Language SDK Generation (Python, Go, Rust)](007-multilang-sdk.md) — *advanced*

### DevOps / QA / Security
- **#8** — [Mainnet Deployment + On-Chain Verification](008-mainnet-deploy-verification.md) — *intermediate*
- **#9** — [Integration Tests for Streaming & Multi-Sig Flows](009-streaming-multisig-e2e.md) — *intermediate*
- **#10** — [Raise Test Coverage to 80%+](010-test-coverage-80.md) — *good first issue*
- **#11** — [Bundle Size Monitoring](011-bundle-size-monitoring.md) — *intermediate*
- **#12** — [Third-Party Security Audit Preparation](012-security-audit-prep.md) — *intermediate*

## Structure

Each issue follows the GrantFox FWC26 campaign format:
- **Description** — one-line campaign framing (`This is a … issue for the GrantFox FWC26 campaign (Stellar Wave)`)
- **Requirements and Context** — background, why it matters, concrete objectives
- **Suggested Execution** — fork → branch → implement → test → PR
- **Acceptance Criteria** — verifiable, quantitative checklist
- **Guidelines** — domain-specific quality bars
- **Timeframe** — target hours (48 / 72 / 96)

## How to Use

1. Pick an issue from the index above.
2. Fork the repository: `https://github.com/FinChippay/Finchippay-Solution`
3. Implement following the issue's requirements and acceptance criteria.
4. Open a PR referencing the issue number (`Closes #N`).

---

*Prepared for the GrantFox FWC26 (Stellar Wave) campaign. Issues are grounded in the current codebase — each references real files, TODOs, and roadmap items.*
