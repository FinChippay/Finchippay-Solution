# Deployment Guide

Finchippay Solution supports multiple deployment strategies:

## Quick Deploy (Vercel + Docker)

### Frontend (Vercel)

```bash
vercel --prod
```

### Backend (Docker)

```bash
docker compose -f docker-compose.prod.yml up -d
```

## Production Deployment (Terraform + Kubernetes)

### Prerequisites

- DigitalOcean account
- Terraform CLI 1.5+
- kubectl
- Docker

### Infrastructure (Terraform)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your DO token and settings
terraform init
terraform plan
terraform apply
```

### Application (Kubernetes)

```bash
kubectl apply -f kubernetes/nginx/
kubectl apply -f kubernetes/backend/
kubectl apply -f kubernetes/frontend/
```

## Environment Variables

See [ENV.md](./ENV.md) for required environment variables.

## Monitoring

- **Grafana**: Import dashboards from `docs/grafana-*.json`
- **Prometheus**: Alert rules in `docs/prometheus-alerts.yml`
- **Sentry**: Error tracking configured via `SENTRY_DSN`

## Contract Verification

After deploying the Soroban contract to mainnet, verify the WASM hash against
the source code to ensure a reproducible build:

```bash
# 1. Build from source
cd contracts/finchippay-contract
cargo build --target wasm32v1-none --release

# 2. Compute the hash
soroban contract install \
  --wasm target/wasm32v1-none/release/finchippay_contract.wasm \
  --source admin \
  --network mainnet \
  --dry-run

# 3. Compare with deployed hash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network mainnet \
  -- get_version
```

### Reproducible Build Verification

Soroban WASM builds are deterministic when using the same Rust toolchain
version. Pin the toolchain in `rust-toolchain.toml` and verify:

```bash
# Pin exact toolchain
rustup show

# Build and compare hashes
sha256sum target/wasm32v1-none/release/finchippay_contract.wasm
```

Store the expected hash in the release notes for community verification.
