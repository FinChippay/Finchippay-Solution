# Finchippay-Solution

> Instant, low-fee, non-custodial payments on the Stellar network — powered by Soroban smart contracts.

[![CI](https://github.com/FinChippay/Finchippay-Solution/actions/workflows/ci.yml/badge.svg)](https://github.com/FinChippay/Finchippay-Solution/actions/workflows/ci.yml)
[![CodeQL](https://github.com/FinChippay/Finchippay-Solution/actions/workflows/codeql.yml/badge.svg)](https://github.com/FinChippay/Finchippay-Solution/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview

Finchippay-Solution is a full-stack, production-grade decentralised payment platform built on [Stellar](https://stellar.org). It combines:

- A **Soroban smart contract** (`FinchippayContract`) with streaming payments, N-of-M multi-sig approvals, time-locked escrow, on-chain tips, immutable receipts, and batch sends.
- A **Next.js frontend** that lets users send payments, manage contacts, view analytics, create recurring schedules, and sign every transaction with their own Freighter wallet — private keys never leave the browser.
- An **Express backend API** providing account data, federation (SEP-0002), SEP-0010 auth, analytics, Turrets execution, webhooks, and Swagger docs.

## Architecture

```
flowchart LR
    user[User browser] --> frontend[Next.js frontend]
    frontend --> wallet[Freighter wallet]
    wallet --> frontend
    frontend --> backend[Express backend API]
    backend --> horizon[Stellar Horizon]
    frontend --> horizon
    frontend --> soroban[Soroban RPC]
    soroban --> contract[FinchippayContract]
    contract --> stellar[Stellar testnet / mainnet]
    horizon --> stellar
    backend -. tips · usernames · analytics · webhooks .-> frontend
    wallet -. signs XDR .-> stellar
```

| Layer | Tech | Role |
|---|---|---|
| Smart contract | Rust / Soroban SDK 20 | On-chain logic — streaming, escrow, multi-sig |
| Frontend | Next.js 14, TypeScript, Tailwind CSS | UI, wallet integration, Freighter signing |
| Backend | Node.js 20, Express, Pino, Swagger | Horizon proxy, federation, auth, analytics |
| Infrastructure | Docker, nginx, GitHub Actions | CI/CD, containerised deployment |

## Smart Contract Features

The `FinchippayContract` (in `contracts/finchippay-contract/`) exposes:

| Function | Description |
|---|---|
| `initialize(admin)` | One-time setup; stores admin address |
| `send_tip(token, from, to, amount)` | One-shot tip with on-chain aggregate stats |
| `mint_receipt(from, to, amount, memo)` | Immutable payment receipt NFT |
| `create_escrow(token, from, to, amount, release_ledger)` | Time-locked escrow |
| `claim_escrow(id)` | Recipient claims after release ledger |
| `cancel_escrow(id)` | Payer cancels before release ledger |
| `open_stream(token, payer, recipient, rate_per_ledger, deposit)` | Start a streaming payment |
| `claim_stream(stream_id, recipient)` | Drain accrued tokens from a stream |
| `top_up_stream(stream_id, payer, amount)` | Add funds to extend a stream |
| `close_stream(stream_id, payer)` | Early close with automatic refund |
| `create_multisig(token, proposer, recipient, amount, threshold, signers)` | N-of-M payment proposal |
| `approve_multisig(proposal_id, signer)` | Sign; auto-executes at threshold |
| `cancel_multisig(proposal_id, proposer)` | Cancel and refund |
| `batch_send(token, from, recipients[], amounts[])` | Fan-out to many recipients |

### Streaming payment maths

```
elapsed   = current_ledger − start_ledger
streamed  = rate_per_ledger × elapsed          (capped at deposited)
claimable = min(streamed, deposited) − claimed
```

## Repository Layout

```
Finchippay-Solution/
├── contracts/
│   └── finchippay-contract/   # Soroban Rust contract + tests
├── backend/
│   ├── src/
│   │   ├── config/            # Env validation, Horizon config
│   │   ├── controllers/       # Route handlers
│   │   ├── middleware/        # Auth, rate-limit, sanitisation
│   │   ├── routes/            # Express routers
│   │   ├── services/          # Business logic
│   │   ├── utils/             # Logger, webhook signature
│   │   ├── server.js          # Entry point
│   │   └── swagger.js         # OpenAPI 3.0 spec
│   └── __tests__/             # Jest test suite
├── frontend/
│   ├── components/            # React components
│   ├── lib/                   # Stellar SDK helpers, wallet, hooks
│   ├── pages/                 # Next.js pages
│   ├── utils/                 # Format, validate
│   ├── __tests__/             # Jest / React Testing Library
│   └── e2e/                   # Playwright end-to-end tests
├── docs/                      # API, architecture, deployment docs
├── scripts/                   # Dev setup, deploy, load-test
├── .github/workflows/         # CI and Docker publish
└── docker-compose.yml         # Local full-stack environment
```

## Quick Start

### Prerequisites

- Node.js 20+
- Docker + Docker Compose (optional but recommended)
- Rust + `wasm32-unknown-unknown` target (for contract builds)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli) (for contract deployment)
- [Freighter](https://freighter.app/) browser extension (for wallet signing)

### Local development

```bash
# Clone
git clone https://github.com/FinChippay/Finchippay-Solution.git
cd Finchippay-Solution

# Start everything with Docker
docker compose up

# Or run each service manually:
# Backend
cd backend && cp .env.example .env && npm install && npm run dev

# Frontend (new terminal)
cd frontend && cp .env.example .env && npm install && npm run dev
```

Frontend: http://localhost:3000  
Backend API: http://localhost:4000  
Swagger docs: http://localhost:4000/api/docs

### Build and test the smart contract

```bash
cd contracts/finchippay-contract
cargo test
cargo build --release --target wasm32v1-none
```

### Deploy the contract to Stellar testnet

```bash
bash scripts/deploy-contract.sh
```

### Export contract state

The `scripts/export-contract-state.js` tool connects to Soroban RPC and dumps all persistent storage from a deployed `FinchippayContract` into structured JSON — useful for audits, migration planning, and disaster recovery.

```bash
# Full export
node scripts/export-contract-state.js \
  --contract-id CA3QY5Y5F5R5K5B5N5P5T5V5X5Z5B5D5F5H5J5KM5P5R5T5V5X5Z5 \
  --rpc-url https://soroban-testnet.stellar.org \
  --output state.json

# Filter by storage type
node scripts/export-contract-state.js \
  --contract-id CA3Q... \
  --filter escrows,streams \
  --output escrows-and-streams.json
```

The export includes admin configuration, escrows, streaming payments, and multi-sig proposals with per-section counts in the summary.

## Freighter Wallet Setup

1. Install the [Freighter extension](https://freighter.app/).
2. Create or import a **development** wallet (never use a production wallet locally).
3. Switch Freighter to **Testnet**.
4. Copy your public key and fund it via Friendbot:
   ```
   https://friendbot.stellar.org/?addr=<YOUR_PUBLIC_KEY>
   ```
5. Connect Freighter in the app — the dashboard detects the funded account automatically.

## Environment Variables

Copy `.env.example` in both `backend/` and `frontend/` and fill in the values. See [ENV.md](ENV.md) for the full reference.

Key backend variables:

| Variable | Description |
|---|---|
| `STELLAR_NETWORK` | `testnet` or `mainnet` |
| `HORIZON_URL` | Horizon server URL |
| `JWT_SECRET` | Secret for SEP-0010 JWT signing |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |

## Documentation

| Doc | Description |
|---|---|
| [docs/api.md](docs/api.md) | Full REST API reference |
| [docs/architecture.md](docs/architecture.md) | System design and data flows |
| [docs/deployment.md](docs/deployment.md) | Production deployment guide |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Docker / cloud deployment |
| [ENV.md](ENV.md) | Environment variable reference |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

## Security

- All private key operations occur exclusively inside Freighter — keys never touch the server.
- Every contract entry-point calls `require_auth()` before mutating state.
- Stellar secret keys are redacted from all log output and Sentry events.
- Rate limiting (100 req/15 min globally, 20 req/min on sensitive routes, 10 req/min on account lookup) is applied at the Express layer.
- Helmet enforces a strict CSP; all API responses include `X-Content-Type-Options: nosniff`.
- Input sanitisation strips HTML/script injection from all user-supplied fields.
- Webhook payloads are signed with HMAC-SHA256 and verified before processing.
- **Emergency pause**: admin can freeze all contract value-transferring operations via `pause()` (circuit breaker pattern).
- **Upgradability**: deployed contract WASM can be hot-patched by admin without state migration.
- **Bounded inputs**: escrow timelocks, stream deposits/rates, and multi-sig amounts are capped to prevent griefing and permanent fund lock-up.
- **Checked arithmetic**: all Soroban math uses `checked_add`/`checked_sub`/`checked_mul` — overflows panic, never silently wrap.
- **Horizon timeout + retry**: backend Horizon requests use a 10 s timeout with exponential back-off (3 retries).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. In short:

```bash
git checkout -b feature/your-feature
# make changes
git commit -m "feat: short description"
git push origin feature/your-feature
# open a pull request
```

Please write tests for any new behaviour and ensure `npm test` passes before opening a PR.

## License

MIT — see [LICENSE](LICENSE).
