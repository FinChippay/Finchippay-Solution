# Deployment Guide for Finchippay-Solution Streaming Payment Contract

## Overview

This guide provides step-by-step instructions for deploying the Finchippay-Solution streaming payment contract to the Stellar network and creating a pull request to the forked repository.

## Prerequisites

1. **Rust and Soroban SDK**: Install Rust and add Soroban target
   ```bash
   rustup target add wasm32v1-none
   cargo install soroban-cli
   ```

2. **Stellar Account**: Have a funded Stellar account for deployment
3. **Git**: For version control and PR creation

## Build Instructions

### 1. Build the Contract

```bash
# Navigate to project directory
cd Finchippay-Solution

# Build for WebAssembly target
cargo build --release --target wasm32v1-none

# The contract will be available at:
# target/wasm32v1-none/release/finchippay_contract.wasm
```

### 2. Run Tests

```bash
# Run all tests to verify implementation
cargo test

# Run specific test
cargo test test_open_stream
```

## Contract Deployment

### 1. Setup Environment

```bash
# Set network (testnet or mainnet)
export STELLAR_NETWORK="testnet"

# Set contract parameters
export SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
```

### 2. Deploy Contract

```bash
# Deploy the contract
soroban contract deploy \
  --wasm target/wasm32v1-none/release/finchippay_contract.wasm \
  --source <YOUR_STELLAR_SECRET_KEY> \
  --network $STELLAR_NETWORK

# Note the contract ID for future use
```

### 3. Initialize Contract (if needed)

```bash
# Initialize contract with any required parameters
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <YOUR_STELLAR_SECRET_KEY> \
  --network $STELLAR_NETWORK \
  -- function_name \
  --args ...
```

## Usage Examples

### Opening a Stream

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <PAYER_SECRET_KEY> \
  --network $STELLAR_NETWORK \
  open_stream \
  --args \
    "<PAYER_ADDRESS>" \
    "<RECIPIENT_ADDRESS>" \
    "1000" \
    "1000000"
```

### Claiming from a Stream

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <RECIPIENT_SECRET_KEY> \
  --network $STELLAR_NETWORK \
  claim_stream \
  --args \
    "1" \
    "<RECIPIENT_ADDRESS>"
```

### Topping Up a Stream

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <PAYER_SECRET_KEY> \
  --network $STELLAR_NETWORK \
  top_up_stream \
  --args \
    "1" \
    "<PAYER_ADDRESS>" \
    "500000"
```

### Closing a Stream

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <PAYER_SECRET_KEY> \
  --network $STELLAR_NETWORK \
  close_stream \
  --args \
    "1" \
    "<PAYER_ADDRESS>"
```

## Creating a Pull Request

### 1. Fork the Repository

1. Go to the original repository: https://github.com/FinChippay/Finchippay-Solution
2. Click "Fork" to create your own copy
3. Clone your fork locally:
   ```bash
   git clone https://github.com/<YOUR_USERNAME>/Finchippay-Solution.git
   cd Finchippay-Solution
   ```

### 2. Add Your Changes

1. Copy the implementation files to your local repository
2. Stage and commit your changes:
   ```bash
   git add .
   git commit -m "Implement streaming payment channels using Soroban"
   ```

### 3. Create Pull Request

1. Push to your fork:
   ```bash
   git push origin main
   ```

2. Create a pull request on GitHub with:
   - **Title**: "Implement streaming payment channels using Soroban"
   - **Description**: 
     ```
     This PR implements streaming payment channels using Soroban smart contracts.
     
     ## Features Implemented
     - ✅ Stream struct with all required fields (payer, recipient, rate_per_ledger, deposited, claimed, start_ledger)
     - ✅ open_stream function for creating new payment streams
     - ✅ claim_stream function for recipients to claim available funds
     - ✅ top_up_stream function for adding more funds to existing streams
     - ✅ close_stream function for stopping streams and refunding unstreamed portions
     - ✅ Comprehensive test suite covering all functionality
     - ✅ Proper authorization and validation checks
     - ✅ Accurate claim calculations at any ledger offset
     
     ## Acceptance Criteria Met
     - ✅ cargo test passes for all streaming tests
     - ✅ Claim amount calculated correctly at any ledger offset
     - ✅ Top-up increases the stream duration
     - ✅ Close refunds the correct unclaimed amount
     - ✅ Only the recipient can claim, only the payer can close
     
     ## Testing
     All tests pass and cover edge cases including:
     - Basic stream operations
     - Multiple claims over time
     - Deposit limits and overflow handling
     - Authorization validation
     - Error conditions
     
     ## Files Modified
     - `contracts/finchippay-contract/src/lib.rs` - Main contract implementation
     - `Cargo.toml` - Workspace configuration
     - `contracts/finchippay-contract/Cargo.toml` - Contract dependencies
     - `README.md` - Documentation
     - `DEPLOYMENT_GUIDE.md` - Deployment instructions
     ```

## Contract Features Summary

### Core Functionality
- **Stream Creation**: Create payment streams with custom rates and deposits
- **Claim Payments**: Recipients can claim available funds based on ledger progression
- **Stream Management**: Top-up existing streams or close them for refunds
- **Query Functions**: Get stream information and calculate claimable amounts

### Security Features
- **Authorization**: Only designated recipients can claim, only payers can manage streams
- **Input Validation**: Positive rates and deposits required
- **Overflow Protection**: Safe arithmetic operations
- **Access Control**: Proper authentication for all operations

### Mathematical Accuracy
- **Ledger-based Calculation**: Claims calculated using ledger progression
- **Deposit Limits**: Cannot claim more than deposited amount
- **Refund Logic**: Accurate refund calculations for unstreamed portions
- **Multiple Claims**: Proper tracking of claimed amounts over time

## Testing Coverage

The implementation includes 13 comprehensive test functions:

1. **test_open_stream** - Basic stream creation
2. **test_claim_stream_basic** - Single claim operation
3. **test_claim_stream_multiple_times** - Multiple claims over time
4. **test_claim_stream_exceeds_deposit** - Deposit limit enforcement
5. **test_top_up_stream** - Stream top-up functionality
6. **test_close_stream_with_refund** - Stream closure with refund
7. **test_close_stream_after_claims** - Closure after partial claims
8. **test_get_claimable** - Query claimable amount
9. **test_claim_nonexistent_stream** - Error handling for invalid streams
10. **test_unauthorized_claim** - Authorization for claims
11. **test_unauthorized_close** - Authorization for closures
12. **test_invalid_rate** - Input validation for rates
13. **test_invalid_deposit** - Input validation for deposits

## Security Features (v2 Contract)

The `FinchippayContract` v2 includes:
- **Emergency pause**: admin can freeze all value-transferring operations
- **Upgradability**: admin can hot-patch the contract WASM without state migration
- **Deposit/timelock bounds**: prevents griefing and permanent fund lock-up
- **Cumulative top-up caps**: stream deposit limits enforced across top-ups
- **Version tracking**: on-chain version counter incremented on each upgrade

## Next Steps

1. **Deploy to Testnet**: Test the contract on Stellar testnet
2. **Integration Testing**: Test with real Stellar accounts
3. **Security Audit**: Review for potential vulnerabilities
4. **Mainnet Deployment**: Deploy to production after testing
5. **Documentation**: Create user guides and API documentation

## Canary Deployment Strategy

Finchippay-Solution uses a canary release strategy to minimize deployment risk.
New versions are gradually exposed to a subset of traffic while health metrics
are monitored. If metrics degrade, the deployment is automatically rolled back.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Canary Deployment Flow                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  Deploy  │───▶│ Health Check │───▶│ Monitor (5 min)  │  │
│  │  Staging │    │   (30 retries)│    │                  │  │
│  └──────────┘    └──────────────┘    └───────┬──────────┘  │
│                                               │             │
│                              ┌────────────────┼──────────┐  │
│                              │                │          │  │
│                              ▼                ▼          │  │
│                        ┌──────────┐    ┌──────────┐      │  │
│                        │ Promote  │    │ Rollback │      │  │
│                        │ 10→50→100│    │ Auto     │      │  │
│                        └──────────┘    └──────────┘      │  │
└─────────────────────────────────────────────────────────────┘
```

### Two-Target Strategy

| Target    | Strategy        | Mechanism                                      |
|-----------|-----------------|------------------------------------------------|
| Frontend  | Blue-Green      | Vercel staging alias → health check → promote   |
| Backend   | Weighted Canary | AWS ALB listener rules: 10% → 50% → 100%       |

**Frontend (Vercel):** The frontend uses a Blue-Green pattern. A new deployment
is built and assigned a staging alias (`canary-<sha>.finchippay.vercel.app`).
Health checks verify the staging deployment, then `vercel promote` promotes it
to production. Production traffic is never split — the flip is atomic.

**Backend (ECS/ALB):** The backend uses true weighted traffic routing. A new
ECS task set is registered alongside the existing one, and the ALB listener
rule is modified to shift traffic gradually:

- **Stage 1:** 10% of traffic → new version (monitor 5 min)
- **Stage 2:** 50% of traffic → new version (monitor 5 min)
- **Stage 3:** 100% of traffic → new version (monitor 5 min)

At any stage, if health thresholds are breached, traffic is immediately routed
back to 100% on the old target group.

### Health Metric Monitoring

During each canary stage, `scripts/canary-monitor.js` polls the following:

| Metric            | Source             | Threshold                    | Action              |
|-------------------|--------------------|------------------------------|---------------------|
| Error rate        | Health endpoint    | > 1% 5xx responses           | Degraded → rollback |
| 5xx count         | Health endpoint    | > 5 per minute               | Critical → rollback |
| Latency (p95)     | Health endpoint    | > 2× baseline p50            | Degraded → rollback |
| Sentry error rate | Sentry API         | > 50% increase vs baseline   | Degraded → rollback |
| Consecutive fails | Health endpoint    | ≥ 3 consecutive failures     | Critical → rollback |

### Scripts

| Script                        | Purpose                                                   |
|-------------------------------|-----------------------------------------------------------|
| `scripts/canary-deploy.sh`    | Orchestrates canary deployment for frontend or backend     |
| `scripts/canary-monitor.js`   | Polls health metrics and Sentry during canary window       |
| `scripts/canary-check.js`     | One-shot Sentry error rate comparison (legacy)             |
| `scripts/rollback.sh`         | Reverts to previous stable version                        |

### Triggering a Canary Deployment

**Automatic:** Publishing a GitHub Release triggers the canary workflow for
both frontend and backend.

**Manual:** Run the workflow with custom parameters:

1. Go to **Actions → Canary Deploy → Run workflow**
2. Select target: `backend`, `frontend`, or `both`
3. Set `canary_duration` (minutes per stage, default: 5)
4. Set `canary_weight_start` (initial traffic %, backend only, default: 10)

### Rollback

Rollback is automatic when health metrics degrade. It can also be triggered
manually:

```bash
# Rollback frontend (Vercel)
bash scripts/rollback.sh frontend <commit-sha>

# Rollback backend (ECS ALB)
bash scripts/rollback.sh backend <commit-sha>
```

The rollback script:
- **Frontend:** Removes the canary alias. Production remains on the previous
deployment.
- **Backend:** Immediately routes 100% ALB traffic to the old target group,
reverts ECS service to the old task definition, and cleans up the canary
target group and task definition.

### Required GitHub Secrets

| Secret                  | Used By    | Purpose                                 |
|-------------------------|------------|-----------------------------------------|
| `VERCEL_TOKEN`          | Frontend   | Vercel API authentication               |
| `VERCEL_ORG_ID`         | Frontend   | Vercel organization identifier          |
| `VERCEL_PROJECT_ID`     | Frontend   | Vercel project identifier               |
| `AWS_ACCESS_KEY_ID`     | Backend    | AWS IAM access key                      |
| `AWS_SECRET_ACCESS_KEY` | Backend    | AWS IAM secret key                      |
| `AWS_REGION`            | Backend    | AWS region for ECS/ALB                  |
| `ECS_CLUSTER`           | Backend    | ECS cluster name                        |
| `ECS_SERVICE`           | Backend    | ECS service name                        |
| `ALB_LISTENER_ARN`      | Backend    | ALB listener ARN for traffic routing    |
| `SENTRY_AUTH_TOKEN`     | Monitoring | Sentry API auth token                   |
| `SENTRY_ORG`            | Monitoring | Sentry organization slug                |
| `SENTRY_PROJECT`        | Monitoring | Sentry project slug                     |

### Local Testing

```bash
# Test canary deploy script (dry-run mode checks prereqs)
bash scripts/canary-deploy.sh frontend

# Test monitor standalone against local backend
node scripts/canary-monitor.js \
  --duration 1 \
  --health-url http://localhost:4000/health \
  --stage local-test

# Test rollback script (requires Vercel/AWS credentials)
bash scripts/rollback.sh frontend
```

### CI Workflow

The canary deployment workflow (`.github/workflows/canary-deploy.yml`)
includes:

- **Environment gating:** Requires `production` environment approval
- **Result reporting:** Posts deployment status as issue/PR comments
- **Workflow summaries:** Results written to GitHub Actions step summary
- **State persistence:** Saves deployment info to temp files for rollback

## Docker Compose Production Hardening

`docker-compose.prod.yml` runs every service non-root where the underlying
image supports it, with resource limits, health-check gating, a read-only
root filesystem, and secrets mounted from files rather than passed as plain
environment variables.

### Production Secrets

Real secret values are never committed. `secrets/.gitignore` excludes
everything in that directory except `.gitignore` itself and `*.example`
templates. Before running `docker compose -f docker-compose.prod.yml up`,
copy each template and fill in a real value:

```bash
cd secrets
cp jwt_secret.txt.example jwt_secret.txt                     # openssl rand -hex 32
cp webhook_encryption_key.txt.example webhook_encryption_key.txt  # openssl rand -hex 32
cp rate_limit_ip_hash_salt.txt.example rate_limit_ip_hash_salt.txt  # openssl rand -hex 32, independent of jwt_secret
cp database_url.txt.example database_url.txt                 # only used when DB_PROVIDER=postgres
cp anthropic_api_key.txt.example anthropic_api_key.txt        # optional — leave empty to disable AI payment parsing
```

`database_url.txt` and `anthropic_api_key.txt` can be left empty (or
`touch`ed) if unused — Compose requires the referenced file to exist, but the
backend only reads it when `DB_PROVIDER=postgres` / when the AI parsing
feature is invoked, via `backend/src/config/dockerSecrets.js`, which resolves
any `<NAME>_FILE` environment variable (the standard `/run/secrets/<name>`
mount) into the corresponding plain `<NAME>` variable before the rest of the
app starts. An explicit non-`_FILE` env var always wins if both are set.

Note: the compose secret names (`jwt_secret`, `database_url`,
`webhook_encryption_key`, `rate_limit_ip_hash_salt`, `anthropic_api_key`) are
named after the actual environment variables this backend reads (see
`backend/.env.example` and `backend/src/config/validateEnv.js`) rather than
a generic `db_password` / `api_keys` split — this codebase authenticates to
Postgres via a single `DATABASE_URL` connection string, not a separate
password field, and has exactly one external API key (Anthropic).

### Non-root Execution

- **backend** runs as the built-in `node` user (`user: "node"` in compose,
  `USER node` in `backend/Dockerfile.prod`, with `COPY --chown=node:node`).
- **frontend** serves static files via `nginxinc/nginx-unprivileged`, not the
  stock `nginx` image — the stock image has no non-root user capable of
  binding to a low port, so it defaults to root. `nginxinc/nginx-unprivileged`
  is purpose-built to run as the non-root `nginx` user (uid 101) and listens
  on 8080 internally instead of 80 (mapped to host port 80 in compose).
- **redis** and **jaeger** are left running as their image defaults (root).
  Neither official image documents a supported non-root UID for this exact
  volume/entrypoint setup, and guessing one risks silently breaking the
  container's own privilege-drop or volume-permission logic. They still get
  the filesystem/capability hardening below (`read_only`, `cap_drop: [ALL]`,
  `no-new-privileges`) — least-privilege in every dimension that doesn't
  require verifying image-internal behavior we can't check in this repo.

### Read-only Root Filesystem

All four services set `read_only: true` with `tmpfs` mounts for paths each
process needs to write at runtime (nginx's cache/pid/temp dirs, `/tmp`
generally) and named volumes for anything that must survive a restart
(`redis_data`, `jaeger_data`, and the new `backend_data` / `backend_backups`
covering the backend's SQLite DB + token-metadata cache and DB backup
archives — see `backend/src/services/backupService.js` and
`backend/src/services/tokenMetadataService.js`).

### Docker Content Trust

Docker Content Trust is a client-side setting, not something a compose file
can declare — it's controlled by the `DOCKER_CONTENT_TRUST` environment
variable wherever `docker pull` / `docker build` / `docker compose` runs:

```bash
export DOCKER_CONTENT_TRUST=1
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml build
```

This only works for images with published Notary trust data. `node`,
`nginx`/`nginxinc/nginx-unprivileged`, and `redis` are Docker Official
Images and are signed. `jaegertracing/all-in-one` is **not** — pulling it
with `DOCKER_CONTENT_TRUST=1` set will fail with "remote trust data does not
exist". Either verify trust data for every image you pin before enabling
this project-wide in CI/CD, or pull/build the jaeger image in a separate
step with `DOCKER_CONTENT_TRUST=0`.

## Support

For questions or issues:
- Review the contract implementation in `lib.rs`
- Check the test cases for usage examples
- Refer to Soroban documentation: https://docs.rs/soroban-sdk/latest/soroban_sdk/
- Stellar documentation: https://developers.stellar.org/

> **Pre-production checklist:** Before deploying to mainnet, ensure:
> 1. All critical and high-priority issues identified in `CODE_REVIEW.md` are resolved.
> 2. The contract has been migrated from deprecated `publish()` to `#[contractevent]`.
> 3. `JWT_SECRET`, `WEBHOOK_ENCRYPTION_KEY`, and `RATE_LIMIT_IP_HASH_SALT` are all set to production-strength values.
> 4. A formal third-party security audit has been completed (see `docs/audits/README.md`).
