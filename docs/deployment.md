# Production Deployment — Finchippay-Solution

This guide covers deploying Finchippay-Solution to a production environment using Docker Compose and nginx.

## Architecture

```
Internet → frontend (nginx, port 80)
              ├── / → Next.js static export (built-in nginx)
              ├── /api/ → backend (Express, port 4000)
              └── /federation → backend federation route
```

Two Docker containers:
- **finchippay-frontend** — Next.js static export served by built-in nginx with API proxying
- **finchippay-backend** — Express API on port 4000

## Prerequisites

- Docker Engine 24+ and Docker Compose v2+
- A Linux host with ports 80 and 443 available
- Domain name pointing to your server (for TLS)
- Stellar mainnet/testnet credentials

## Step-by-step

### 1. Clone

```bash
git clone https://github.com/FinChippay/Finchippay-Solution.git
cd Finchippay-Solution
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Edit both files. Minimum required variables:

**`backend/.env`**
```env
STELLAR_NETWORK=mainnet
HORIZON_URL=https://horizon.stellar.org
JWT_SECRET=<long random secret — use: openssl rand -hex 32>
ALLOWED_ORIGINS=https://yourdomain.com
```

**`frontend/.env.local`**
```env
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_API_URL=https://yourdomain.com
NEXT_PUBLIC_CONTRACT_ID=<deployed FinchippayContract ID>
```

### 3. Deploy the smart contract (first time only)

```bash
bash scripts/deploy-contract.sh mainnet <your-identity>
# Copy the CONTRACT_ID output into frontend/.env.local
```

**Important**: After deployment, call `initialize(admin)` then `pause(admin)` to verify the circuit breaker works. Unpause before going live.

The contract includes emergency pause, upgradability, and deposit/timelock bounds. See `contracts/finchippay-contract/README.md` for the full security model.

### 4. Build and start

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

### 5. Verify

```bash
# All containers should be healthy
docker ps

# Backend health
curl http://localhost:4000/health

# Frontend
curl http://localhost
```

## nginx Configuration

The frontend container includes a built-in nginx (`frontend/nginx.conf`) that provides:
- Gzip compression for text, CSS, JS, and JSON
- Security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`
- Reverse proxy for `/api/` and `/federation` → backend
- Static file serving for the Next.js export

A standalone reference nginx config remains at `nginx/nginx.conf` for non-Docker reverse-proxy setups.

For TLS, front the frontend container with a load balancer that provides SSL termination (e.g., AWS ALB, Cloudflare, or a Certbot-managed nginx).

## Updating

```bash
git pull origin main
docker compose -f docker-compose.prod.yml up --build -d --no-deps backend frontend
```

## Distributed Tracing (OpenTelemetry)

The backend supports OpenTelemetry distributed tracing via OTLP. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, traces are automatically exported to any OTLP-compatible collector (Jaeger, Grafana Tempo, Honeycomb, Datadog, etc.).

### Enabling in production

```bash
# Set in backend/.env or docker-compose environment:
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-collector.example.com:4318
OTEL_SERVICE_NAME=finchippay-backend
```

### What is traced

- **Every HTTP request** — Express routes are auto-instrumented; spans include method, route, status code, and duration.
- **Every Horizon API call** (`loadAccount`, `getPayments`, `getTransaction`) — custom spans with attributes:
  - `horizon.url` — the Horizon server base URL
  - `horizon.operation` — operation name (e.g. `loadAccount`)
  - `http.status_code` — response status from Horizon
- **Outbound HTTP/fetch calls** — auto-instrumented via `@opentelemetry/auto-instrumentations-node`.

### Local development with Jaeger

```bash
docker compose up  # includes Jaeger at http://localhost:16686

# Make some requests, then open the Jaeger UI to see traces:
curl http://localhost:4000/health
curl http://localhost:4000/api/accounts/resolve/GABC...
```

### Connecting to a production collector

Most observability vendors provide OTLP ingestion endpoints:

| Vendor | Endpoint format |
|--------|----------------|
| Grafana Cloud Tempo | `https://tempo-<region>.grafana.net:443` |
| Honeycomb | `https://api.honeycomb.io:443` |
| Datadog | Use the Datadog Agent OTLP ingest |
| AWS X-Ray | Use the AWS Distro for OpenTelemetry |

You may need to set additional environment variables for authentication:

```bash
OTEL_EXPORTER_OTLP_HEADERS="x-api-key=your-key"
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Tracing is **disabled** when `NODE_ENV=test` (no test impact) and when `OTEL_EXPORTER_OTLP_ENDPOINT` is not set.

## Logs and Monitoring

```bash
# Tail all logs
docker compose -f docker-compose.prod.yml logs -f

# Frontend only
docker compose -f docker-compose.prod.yml logs -f frontend

# Backend only
docker compose -f docker-compose.prod.yml logs -f backend

# Filter Stellar key redaction check
docker compose -f docker-compose.prod.yml logs backend | grep -v REDACTED
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `CORS: origin ... not allowed` | Missing origin in `ALLOWED_ORIGINS` | Add the domain to `backend/.env` |
| 502 Bad Gateway | Backend container not healthy | `docker compose logs backend` |
| Account not found (404) | Wallet not funded | Use Friendbot (testnet) or fund on mainnet |
| JWT invalid | `JWT_SECRET` mismatch between frontend SEP-0010 and backend | Ensure both use the same value |
