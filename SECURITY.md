# Security Policy

## Reporting a Vulnerability

Report security vulnerabilities privately to:
- **Email**: `security@finchippay.dev`
- **PGP Key**: `docs/security/pgp-key.asc` (coming soon)

**Do not open a public issue for security vulnerabilities.**

## Response Timeline

| Severity | Acknowledgment | Patch Release |
|---|---|---|
| **Critical** (direct loss of funds) | 24 hours | 7 days |
| **High** (potential loss, complex exploit) | 48 hours | 14 days |
| **Medium** (service disruption, info leak) | 1 week | 30 days |
| **Low** (minor issues) | 2 weeks | Next release |

## Scope

The following are in scope for vulnerability reports:
- Smart contract (`contracts/finchippay-contract/`)
- Backend API (`backend/src/`)
- Frontend application (`frontend/`)
- SDK (`sdk/`)

## Bug Bounty

We maintain a bug bounty program. Rewards range from $50–$25,000 depending on severity.
Contact `security@finchippay.dev` for details.

### Scope & Rewards

| Severity | Reward Range | Example |
|----------|-------------|---------|
| **Critical** | $10,000–$25,000 | Direct theft of contract funds, arbitrary token mint |
| **High** | $3,000–$10,000 | Unauthorized admin action, bypass of timelock |
| **Medium** | $500–$3,000 | DoS on streaming claims, information leak |
| **Low** | $50–$500 | Minor UI issues, documentation gaps |

### Rules

1. Report via `security@finchippay.dev` — never open a public issue.
2. Allow 90 days before public disclosure.
3. Do not exploit the vulnerability beyond proof-of-concept.
4. One reward per vulnerability (first reporter).
5. KYC required for rewards over $1,000.

### Safe Harbor

We will not pursue legal action against researchers who follow the rules above.

## Security Features

- **Smart contract**: Checked arithmetic, TTL management, emergency pause, M-of-N admin
- **Backend**: JWT auth, rate limiting, Helmet headers, SQL injection prevention, input validation
- **Frontend**: CSP headers, encrypted local storage, no private key exposure
- **Infrastructure**: Container scanning (Trivy), dependency auditing, SBOM generation

## Audit History

See [docs/audits/](./docs/audits/) and [docs/SECURITY_AUDIT_FRAMEWORK.md](./docs/SECURITY_AUDIT_FRAMEWORK.md).

## Disclosure Policy

We follow a coordinated disclosure process:
1. Reporter submits vulnerability
2. We acknowledge within published timeline
3. We develop and test a fix
4. We release the fix and publish an advisory
5. We credit the reporter (unless they prefer anonymity)

## Pre-Mainnet Security Checklist

Before deploying Finchippay contracts and backend to Stellar mainnet:

### Smart Contract
- [ ] All `publish()` calls migrated to `#[contractevent]` macro (Soroban SDK 22+)
- [ ] `checked_*` arithmetic verified on all storage math paths
- [ ] `require_auth()` present on every mutating entrypoint
- [ ] Storage TTL floor (`MIN_TTL_LEDGERS`) set to ≥ 1 week (120,960 ledgers at 5s/ledger)
- [ ] Pauser role held by a separate key from admin signers
- [ ] Multi-sig threshold ≥ 2 for admin operations
- [ ] Contract WASM hash verified against source in a reproducible build

### Backend
- [ ] `JWT_SECRET` ≥ 32 random alphanumeric characters
- [ ] `WEBHOOK_ENCRYPTION_KEY` ≥ 32 random bytes (base64-encoded)
- [ ] `RATE_LIMIT_IP_HASH_SALT` ≥ 16 random bytes
- [ ] VAPID keys configured for push notifications (or disabled intentionally)
- [ ] Redis cluster TLS enabled (`rediss://` protocol)
- [ ] Horizon URL points to mainnet (`https://horizon.stellar.org`)
- [ ] Soroban RPC URL points to mainnet
- [ ] Helmet CSP configured with `upgrade-insecure-requests`

### Infrastructure
- [ ] Docker images scanned with Trivy (no CRITICAL or HIGH vulnerabilities)
- [ ] SBOM generated and archived for every release
- [ ] Rate-limiting validated with production load (not just unit tests)
- [ ] Database backups configured with Point-in-Time Recovery
- [ ] Monitoring dashboards (Grafana) deployed with alerting (Prometheus)
- [ ] Secrets stored in a vault/secret-manager, not in environment files
