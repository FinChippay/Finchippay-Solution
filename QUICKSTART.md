# Quickstart — Finchippay-Solution

Get from zero to running in under 10 minutes.

## Prerequisites

- **Node.js 20+** ([nvm](https://github.com/nvm-sh/nvm) recommended: `nvm use`)
- **Docker Desktop** ([download](https://www.docker.com/products/docker-desktop/))
- **Rust** (for contracts only: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)

## 1. Clone & Setup

```bash
git clone https://github.com/FinChippay/Finchippay-Solution.git
cd Finchippay-Solution
bash scripts/setup-dev.sh
```

This installs all dependencies, copies `.env.example` files, and starts Docker services.

## 2. Start Developing

```bash
# Everything at once (frontend + backend + Redis + Jaeger):
make dev
# or:
npm run dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:4000 |
| Jaeger Tracing | http://localhost:16686 |

## 3. Run Tests

```bash
# All tests
make test

# Individual components
cd frontend && npm test        # Frontend unit tests
cd frontend && npm run test:e2e # Playwright E2E tests
cd backend && npm test          # Backend unit + integration tests
cd contracts/finchippay-contract && cargo test  # Smart contract tests
```

## 4. Before Opening a PR

```bash
# Frontend
cd frontend && npm run lint && npm run type-check && npm test

# Backend
cd backend && npm run lint && npm test

# Contracts
cd contracts/finchippay-contract && cargo fmt --check && cargo clippy -- -D warnings && cargo test

# Error code docs (if you changed error codes)
npm run docs:errors
```

## 5. Project Layout

```
finchippay-solution/
├── frontend/          # Next.js (React) frontend
│   ├── pages/         # Page components and API routes
│   ├── components/    # Reusable UI components
│   └── lib/           # Utilities, SDK instance, auth
├── backend/           # Express.js API server
│   ├── src/routes/    # API route handlers
│   ├── src/services/  # Business logic services
│   └── __tests__/     # Backend tests
├── contracts/         # Soroban (Rust) smart contracts
├── sdk/               # TypeScript SDK for the API
├── shared/            # Shared error codes and utilities
├── terraform/         # DigitalOcean infrastructure
├── kubernetes/        # Kubernetes deployment manifests
├── .github/workflows/ # 15 CI/CD pipelines
└── docs/              # Architecture, API, deployment docs
```

## 6. Grantfox OSS Program

This project participates in the **Grantfox OSS** program. Contributors can earn rewards for completing issues in the **GrantFox FWC26 (Stellar Wave)** campaign.

1. Browse [Grantfox-tagged issues](https://github.com/FinChippay/Finchippay-Solution/issues?q=label%3A%22Official+Campaign+%7C+FWC26%22)
2. Look for `good first issue` or `help wanted` labels
3. Comment on the issue to express interest
4. Follow the PR workflow below

## 7. Need Help?

- **Architecture**: [docs/architecture.md](docs/architecture.md)
- **API Reference**: [docs/api.md](docs/api.md)
- **CI/CD Pipeline**: [CI_CD.md](CI_CD.md)
- **Contributing Guide**: [docs/CONTRIBUTOR_GUIDE.md](docs/CONTRIBUTOR_GUIDE.md)
- **Deployment**: [docs/deployment.md](docs/deployment.md)
