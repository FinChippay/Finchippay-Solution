# Production Deployment — Finchippay-Solution

This guide covers deploying Finchippay-Solution to a production environment using Docker Compose and nginx.

## Architecture

```
Internet → nginx (port 80/443)
              ├── / → frontend (Next.js static export)
              ├── /api/ → backend (Express, port 4000)
              └── /federation → backend federation route
```

Three Docker containers:
- **finchippay-frontend** — Next.js static export served by nginx
- **finchippay-backend** — Express API on port 4000
- **nginx** — Reverse proxy + SSL termination

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

`nginx/nginx.conf` includes:
- Gzip compression for text, CSS, JS, and JSON
- Security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`
- Reverse proxy for `/api/` and `/federation` → backend
- Static file serving for the Next.js export

For TLS, add a Certbot/Let's Encrypt block to `nginx.conf` or front nginx with a load balancer.

## Updating

```bash
git pull origin main
docker compose -f docker-compose.prod.yml up --build -d --no-deps backend frontend
```

## Logs and Monitoring

```bash
# Tail all logs
docker compose -f docker-compose.prod.yml logs -f

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
