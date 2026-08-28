# Quick Reference — Finchippay Solution

## Essential Commands

| Task | Command |
|------|---------|
| Start all services | `make dev` |
| Run all tests | `make test` |
| Build all components | `make build` |
| Backend only | `cd backend && npm run dev` |
| Frontend only | `cd frontend && npm run dev` |
| Contract tests | `cd contracts/finchippay-contract && cargo test` |
| Run fuzz tests | `bash scripts/fuzz-contract.sh` |
| Run migrations | `cd backend && npm run migrate` |
| Check migration status | `cd backend && npm run migrate:status` |
| Generate error docs | `npm run docs:errors` |
| SBOM scan | `make sbom-scan` |

## Key Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `JWT_SECRET` | Production | SEP-0010 JWT signing (min 32 chars) |
| `HORIZON_URL` | Yes | Stellar Horizon API endpoint |
| `STELLAR_NETWORK` | Yes | `testnet` or `mainnet` |
| `DATABASE_URL` | Postgres | Database connection string |
| `REDIS_URL` | Optional | Redis for rate limiting cache |
| `SENTRY_DSN` | Optional | Error tracking |
| `VAPID_PUBLIC_KEY` | Optional | Push notifications (dev-only optional) |

## API Base URL

- Development: `http://localhost:4000`
- Swagger UI: `http://localhost:4000/api/docs`

## Stellar Networks

- Testnet Horizon: `https://horizon-testnet.stellar.org`
- Mainnet Horizon: `https://horizon.stellar.org`
- Testnet Soroban RPC: `https://soroban-testnet.stellar.org`
- Mainnet Soroban RPC: `https://soroban.stellar.org`
