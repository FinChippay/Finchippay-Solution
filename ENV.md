# Environment Variables — Finchippay-Solution

This document describes every environment variable used by the backend and frontend.

Copy the `.env.example` files and fill in the values:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

---

## Backend (`backend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|---|
| `STELLAR_NETWORK` | ✅ | — | `testnet` or `mainnet` |
| `HORIZON_URL` | ✅ | — | Stellar Horizon base URL |
| `JWT_SECRET` | ✅ | — | Secret for SEP-0010 JWT signing (min 32 chars) |
| `WEBHOOK_ENCRYPTION_KEY` | ✅ (production) | — | AES-256 key (hex, 64 chars) for encrypting webhook secrets at rest. Generate: `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` | ✅ | — | Comma-separated list of CORS-allowed origins |
| `PORT` | ❌ | `4000` | HTTP port to listen on |
| `NODE_ENV` | ❌ | `development` | `development`, `test`, or `production` |
| `SENTRY_DSN` | ❌ | — | Sentry DSN for error tracking (disabled if unset) |
| `USER_RATE_LIMIT_MAX` | ❌ | `30` | Maximum requests allowed per user within the window |
| `USER_RATE_LIMIT_WINDOW_MS` | ❌ | `60000` | Window size in milliseconds for user rate limiting |
| `FEDERATION_DOMAIN` | ❌ | — | Domain used in SEP-0002 TOML discovery |
| `FEDERATION_SERVER_URL` | ❌ | — | Override federation server URL |
| `TURRETS_PORT` | ❌ | `4100` | Port for the Turrets side-server |
| `TURRETS_EVALUATION_INTERVAL_MS` | ❌ | `30000` | Interval (ms) between txFunction evaluation runs |
| `SERVER_PRIVATE_KEY` | ❌ | — | Stellar secret key for SEP-0010 challenge signing (generated on startup if unset) |
| `ANTHROPIC_API_KEY` | ❌ | — | Anthropic API key for the AI payment parsing feature (`/api/parse-payment`). Returns 501 if unset. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ❌ | — | OTLP collector endpoint for OpenTelemetry traces (e.g. `http://jaeger:4318`). Tracing is disabled when unset or in `NODE_ENV=test`. |
| `OTEL_SERVICE_NAME` | ❌ | `finchippay-backend` | Service name reported in trace spans. |
| `VAPID_PUBLIC_KEY` | ❌ | — | Web Push VAPID public key. Notifications stay disabled unless both keys are set; generate a pair with `npx web-push generate-vapid-keys`. |
| `VAPID_PRIVATE_KEY` | ❌ | — | Web Push VAPID private key. Required whenever `VAPID_PUBLIC_KEY` is set. |
| `VAPID_SUBJECT` | ❌ | `mailto:support@finchippay.com` | Sender contact passed to the push service; must be a `mailto:` or `https://` URI (RFC 8292). |

### Example `backend/.env`

```env
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
JWT_SECRET=change-me-to-a-long-random-secret
ALLOWED_ORIGINS=http://localhost:3000,https://finchippay.vercel.app
PORT=4000
NODE_ENV=development
# Web Push (optional) — omit both to leave notifications disabled
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:support@finchippay.com
```

---

## Frontend (`frontend/.env.local`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | ✅ | — | `testnet` or `mainnet` |
| `NEXT_PUBLIC_HORIZON_URL` | ✅ | — | Stellar Horizon base URL |
| `NEXT_PUBLIC_API_URL` | ✅ | — | Backend API base URL |
| `NEXT_PUBLIC_CONTRACT_ID` | ❌ | — | Deployed `FinchippayContract` contract ID (v2 with pause/upgrade/bounds) |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | ❌ | — | Soroban RPC endpoint |
| `NEXT_PUBLIC_SENTRY_DSN` | ❌ | — | Sentry DSN for client-side error tracking |
| `NEXT_PUBLIC_SOROBAN_NETWORK_PASSPHRASE` | ❌ | — | Soroban network passphrase (auto-set from network) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | ❌ | — | Web Push VAPID public key, matching the backend's. Optional: the client falls back to fetching it from `GET /api/push/public-key`, and skips the notification prompt when neither is available. |

### Example `frontend/.env.local`

```env
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

---

## Production Notes

- `JWT_SECRET` must be at least 32 random characters. Generate one with:
  ```bash
  openssl rand -hex 32
  ```
- `ALLOWED_ORIGINS` should list only your actual frontend domain(s). Wildcards are not supported.
- Never commit real `.env` files to git. They are listed in `.gitignore`.
- In Docker / CI, inject secrets via environment variables or a secrets manager — not via files.
- For production deployments, configure `ANTHROPIC_API_KEY` as a [GitHub repository secret](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions) and reference it in your deployment workflow as `${{ secrets.ANTHROPIC_API_KEY }}`.
- Similarly, configure `JWT_SECRET`, `SERVER_PRIVATE_KEY`, `SENTRY_DSN`, and `NEXT_PUBLIC_SENTRY_DSN` as repository secrets for production CI/CD. Never hardcode secrets in workflow files.

> **Note:** `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are optional in development and test environments. When not configured, push notification features degrade gracefully to a no-op.

## Production Configuration

### Required for Mainnet

```bash
NODE_ENV=production
STELLAR_NETWORK=mainnet
HORIZON_URL=https://horizon.stellar.org
SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
DATABASE_URL=postgresql://user:pass@host:5432/finchippay
REDIS_URL=rediss://user:pass@host:6379
JWT_SECRET=<random-64-chars>
WEBHOOK_ENCRYPTION_KEY=<random-32-bytes-base64>
RATE_LIMIT_IP_HASH_SALT=<random-16-bytes-hex>
```

### Optional Features

| Variable | Effect when unset |
|----------|------------------|
| `VAPID_PUBLIC_KEY` | Push notifications disabled |
| `SENTRY_DSN` | Error reporting disabled |
| `ANALYTICS_ENABLED` | Business metrics disabled |
| `REDIS_URL` | Rate limiting uses in-memory fallback |

### Secrets Management

In production, all secrets should be injected via a secrets manager
(HashiCorp Vault, AWS Secrets Manager, or Kubernetes Secrets). Never
commit `.env` files containing production secrets.
