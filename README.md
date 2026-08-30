# Finchippay Solution

> **Open-source Stellar Web3 payments platform** — send, stream, escrow, and batch payments on Stellar with a production-grade Soroban smart contract.

[![CI](https://github.com/FinChippay/Finchippay-Solution/actions/workflows/ci.yml/badge.svg)](https://github.com/FinChippay/Finchippay-Solution/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Stellar-Soroban-7B5BDE)](https://stellar.org/soroban)

---

## Quick Links

- 📖 **[Documentation](./docs/)**
- 🏛️ **[Governance Model](./GOVERNANCE.md)**
- 🔒 **[Security Policy](./SECURITY.md)**
- 📋 **[Contributing Guide](./CONTRIBUTING.md)**
- 🛡️ **[Audit Framework](./docs/SECURITY_AUDIT_FRAMEWORK.md)**

## Architecture

| Layer | Tech | Path |
|---|---|---|
| **Smart Contract** | Rust + Soroban SDK | `contracts/finchippay-contract/` |
| **Backend API** | Node.js + Express + PostgreSQL | `backend/` |
| **Frontend** | Next.js + Tailwind CSS | `frontend/` |
| **SDK** | TypeScript | `sdk/` |
| **Infrastructure** | Terraform + Kubernetes + Docker | `terraform/`, `kubernetes/` |

## Features

- 💸 **Send payments** — XLM, USDC, and custom Stellar assets
- 🔄 **Recurring & streaming** — Scheduled and per-ledger payment streams
- 🔐 **Escrow** — Time-locked custody with dispute resolution
- ✍️ **Multi-signature** — N-of-M threshold approvals
- 📦 **Batch sends** — Up to 50 recipients in one transaction
- 🔑 **Hardware wallet** — Ledger Nano S/X support via WebUSB
- 📊 **Analytics** — Spending charts, top recipients, portfolio tracking
- 🌐 **i18n** — Multi-language support

## Getting Started

```bash
# Clone and install
git clone https://github.com/FinChippay/Finchippay-Solution.git
cd Finchippay-Solution

# Development
make dev        # Start all services

# Testing
make test       # Run all tests

# Build
make build      # Build all components
```

See [QUICKSTART.md](./QUICKSTART.md) for detailed setup instructions.

## Security

Report vulnerabilities to `security@finchippay.dev`. See [SECURITY.md](./SECURITY.md) for our disclosure policy.

We maintain a [Security Audit Framework](./docs/SECURITY_AUDIT_FRAMEWORK.md) based on Stellar Smart Contract Security Guidelines and OWASP Top 10.

## Storage lifetime (TTL) retention policy

Soroban persistent entries expire unless their TTL is extended. The contract
sweeps enumerable storage in classes via `bump_all_ttls` (admin-orchestrated),
and every read/write bumps the keys it touches. The policy for the families
that matter to dashboards/analytics:

- **Airdrops** (`Airdrop(id)`, `AirdropCount`, claimed markers) are in the
  `Airdrop` sweep class so unclaimed — and locked — airdrop pools cannot
  silently expire and strand funds.
- **Tip records** (`TipTotal`/`TipCount`/`TipRecord`) are keyed by an arbitrary
  recipient address with **no on-chain index**, so they are **not** a sweep
  class. Their retention policy is *keep-alive*: `send_tip`, `batch_send*`,
  and the read views (`tip_total`/`tip_count`/`get_tip_record`) extend their
  TTL on access. An active recipient's on-chain numbers never silently vanish;
  cold keys for recipients never touched again simply age out. This decision is
  implemented in `src/lib.rs` and `contracts/finchippay-contract/src/storage.rs`
  (workstream 5 of issue #945).

## Community

- **Contributing**: See [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Governance**: See [GOVERNANCE.md](./GOVERNANCE.md)
- **RFCs**: Propose major changes via [docs/rfc/](./docs/rfc/)

## License

MIT © Finchippay contributors

## Quick Start (Local Development)

```bash
# 1. Clone and install dependencies
git clone https://github.com/FinChippay/Finchippay-Solution.git
cd Finchippay-Solution
npm install && cd backend && npm install && cd ../frontend && npm install && cd ..

# 2. Start development services (PostgreSQL, Redis, Horizon)
docker compose -f docker-compose.dev.yml up -d

# 3. Run migrations
cd backend && npm run migrate && cd ..

# 4. Start backend and frontend
npm run dev
```

The app will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:4000
- **Health Check**: http://localhost:4000/api/health
- **Swagger Docs**: http://localhost:4000/api-docs
