# Community Governance Model

> **Finchippay Solution — Open-Source Governance Framework v1.0**

## Overview

Finchippay Solution is an open-source Stellar Web3 payments platform. This document defines how the project is governed, how decisions are made, and how the community can participate in shaping the project's future.

## Mission

To provide a **secure, open, and accessible payment infrastructure** on the Stellar network that empowers developers to build financial applications with confidence — from simple peer-to-peer transfers to complex multi-signature escrow flows.

---

## 1. Governance Structure

### 1.1 Roles and Responsibilities

| Role | Responsibility |
|---|---|
| **Core Maintainers** | Steward the project's technical direction. Merge PRs, manage releases, enforce code standards, and resolve conflicts. |
| **Contributors** | Submit code, documentation, tests, bug reports, and feature requests. All contributions are reviewed and acknowledged. |
| **Community Members** | Use Finchippay, report bugs, request features, write tutorials, and promote the project. |
| **Security Council** | A subset of maintainers with expertise in blockchain security. Review security-sensitive changes and coordinate vulnerability disclosures. |

### 1.2 Current Core Maintainers

> *Maintainers are listed in [CODEOWNERS](../.github/CODEOWNERS). The list is periodically reviewed.*

### 1.3 Becoming a Maintainer

Contributors who demonstrate sustained, high-quality contributions over **6+ months** may be nominated by an existing maintainer. A nomination requires:
- ✅ At least **10 meaningful merged PRs** (code, docs, or testing)
- ✅ Consistent adherence to coding standards
- ✅ Constructive participation in code reviews and discussions
- ✅ Approval by **2/3 majority** of existing core maintainers

---

## 2. Decision-Making Process

### 2.1 Consensus Model

Finchippay operates on a **rough consensus** model:

1. **Proposal**: An issue is created with a clear description and rationale.
2. **Discussion**: At least **7 days** of open discussion on the issue tracker.
3. **Decision**: If no sustained objections remain, the proposal is accepted. If consensus is not reached, a vote is held.
4. **Voting**: Core maintainers vote. Decisions require **2/3 majority** for architectural changes and **simple majority** for minor features.

### 2.2 RFC Process (for Major Changes)

For significant architectural changes, breaking API changes, or new major features:

1. Create an RFC document in `docs/rfc/` following the template
2. Open a discussion issue linking to the RFC
3. Allow **14 days** of community review
4. Core maintainers make the final decision

### 2.3 Veto Power

Any core maintainer may veto a change if it:
- Introduces a **security vulnerability**
- Violates the project's **core principles**
- Introduces an **unacceptable maintenance burden**

A veto must be accompanied by a written explanation and a suggested alternative.

---

## 3. Code of Conduct

All participants must adhere to the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Harassment, discrimination, or abusive behavior will not be tolerated.

### Enforcement
- First violation: Written warning
- Second violation: Temporary ban (30 days)
- Third violation: Permanent ban

Reports can be sent confidentially to the core maintainer team.

---

## 4. Contribution Workflow

### 4.1 Issue Triage

Issues are labeled:
- `good first issue` — suitable for new contributors
- `help wanted` — active need from maintainers
- `bug` / `enhancement` / `documentation` — standard labels
- `priority: critical` — needs immediate attention

### 4.2 Pull Request Process

1. Fork the repository
2. Create a feature branch (`feat/description`, `fix/description`, `docs/description`)
3. Submit a PR against the `main` branch
4. Ensure CI passes (lint, type-check, tests, build)
5. Address review feedback
6. A core maintainer merges after approval

### 4.3 Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation
- `refactor:` — code restructuring
- `test:` — adding/updating tests
- `chore:` — build/config/maintenance
- `security:` — security-sensitive changes

---

## 5. Release Process

### 5.1 Versioning

We follow [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward-compatible)
- **PATCH**: Bug fixes (backward-compatible)

### 5.2 Release Cadence

- **Patch releases**: As needed (security fixes within 24 hours)
- **Minor releases**: Every 4–6 weeks
- **Major releases**: After community discussion and RFC

### 5.3 Release Artifacts

- Docker images published to **ghcr.io**
- Frontend deployed to **Vercel**
- Smart contract WASM verified on-chain

---

## 6. Security Policy

### 6.1 Vulnerability Disclosure

Report security vulnerabilities privately to:
- **Email**: `security@finchippay.dev`
- **PGP**: See [SECURITY.md](../SECURITY.md)

Response timeline:
- Acknowledgment: Within **24 hours**
- Patch release: Within **7 days** (critical) or **30 days** (moderate)

### 6.2 Audit Policy

- All smart contract upgrades require a **third-party security audit** before mainnet deployment
- Audit reports are published in `docs/audits/`
- Bug bounties are managed via an external bounty platform

---

## 7. Community Channels

| Channel | Purpose |
|---|---|
| **GitHub Issues** | Bug reports, feature requests, technical discussions |
| **GitHub Discussions** | Questions, ideas, community building |
| **Discord** | Real-time community chat and support — join at [discord.gg/finchippay](https://discord.gg/finchippay) (planned Q4 2026) |
| **Telegram** | Announcements and release notifications (planned) |
| **Twitter/X (@finchippay)** | Announcements and project updates |

---

## 8. Licensing

Finchippay Solution is licensed under the **MIT License**. Contributions are accepted under the same license. See [LICENSE](../LICENSE) for full terms.

---

## 9. Amendment Process

This governance document may be amended by:
1. A proposal from any community member
2. **14-day** discussion period
3. **2/3 supermajority** vote of core maintainers

All amendments are documented in the [CHANGELOG.md](../CHANGELOG.md).

---

*Last updated: August 8, 2026*
