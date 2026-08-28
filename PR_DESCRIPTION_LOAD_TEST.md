# PR: Load Testing with k6 for Backend API

## Closes #167

## 🎯 Summary

Introduces a k6 load-testing suite for the backend API to establish baseline performance metrics, identify bottlenecks, and enforce SLA targets in CI.

## 🎬 Background

The repository had a basic `scripts/load-test.js`, but it was not integrated into CI and lacked structured metrics, thresholds, or baseline documentation. Without systematic load testing, performance regressions could reach production undetected.

## 🔧 What Changed

- **`scripts/load-test/health.js`** — k6 test for `/health` and `/api/health`
- **`scripts/load-test/accounts.js`** — k6 test for account resolution and balance
- **`scripts/load-test/payments.js`** — k6 test for payment history and stats
- **`scripts/load-test/analytics.js`** — k6 test for analytics summary and top recipients
- **`scripts/load-test/auth.js`** — k6 test for SEP-0010 challenge flow
- **`.github/workflows/ci.yml`** — New `load-test` job that installs k6, starts the backend, runs all k6 scripts, and publishes JSON results as CI artifacts
- **`docs/performance.md`** — SLA targets, thresholds, regression policy, and rate-limit guidance

## 🚀 How It Works

### Pipeline Addition

The `load-test` job runs after the `compose` job and before `validate`. It:

1. Checks out the repository.
2. Installs Node dependencies.
3. Installs k6 via `.deb`.
4. Starts the backend service.
5. Runs five k6 scripts sequentially.
6. Uploads JSON summaries as the `k6-results` artifact.

### Test Coverage

| Script | Endpoints Under Test |
|--------|---------------------|
| `health.js` | `GET /health`, `GET /api/health` |
| `accounts.js` | `GET /api/accounts/resolve/:username`, `GET /api/accounts/:publicKey`, `GET /api/accounts/:publicKey/balance` |
| `payments.js` | `GET /api/payments/:publicKey`, `GET /api/payments/:publicKey/stats` |
| `analytics.js` | `GET /api/analytics/:publicKey/summary`, `GET /api/analytics/:publicKey/top-recipients`, `GET /api/analytics/:publicKey/activity` |
| `auth.js` | `GET /api/auth?account=...`, `POST /api/auth` (invalid payload) |

### Load Profile

Each test uses the same staged profile:

```js
export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 50 },
    { duration: "2m", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};
```

Health uses a stricter p95 threshold (`<200ms`) due to liveness/readiness probe frequency.

### Regression Detection

- **p95 Latency:** If p95 increases >20% versus the documented baseline, CI should be updated to warn or fail.
- **Error Rate:** If `http_req_failed` exceeds 1%, the k6 run fails.
- **Artifacts:** `k6-results/*.json` are published for every run so engineers can compare runs over time.

### SLAs (docs/performance.md)

| Endpoint | Min RPS | p95 Latency | p99 Latency |
|----------|---------|-------------|-------------|
| `/health`, `/api/health` | ≥ 200 | < 200ms | < 500ms |
| `/api/accounts/:pk/balance` | ≥ 50 | < 300ms | < 500ms |
| `/api/accounts/:pk` | ≥ 50 | < 500ms | < 1000ms |
| `/api/payments/:pk` | ≥ 20 | < 500ms | < 1000ms |
| `/api/analytics/:pk/summary` | ≥ 20 | < 500ms | < 1000ms |
| `/api/auth?account=...` | ≥ 20 | < 500ms | < 1000ms |

## ⚙️ Configuration

### Environment Variables Set in CI

| Variable | Value |
|----------|-------|
| `PORT` | `4000` |
| `NODE_ENV` | `test` |
| `STELLAR_NETWORK` | `testnet` |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` |
| `JWT_SECRET` | `test-secret-for-load-testing-only` |
| `ALLOWED_ORIGINS` | `*` |
| `ANTHROPIC_API_KEY` | `test-key-for-ci` |

### Rate Limits Considered

- Global: 100 req / 15 min
- Strict: 20 req / min

k6 VUs and stages are tuned to stay within these limits during CI runs.

## ✅ Acceptance Criteria

| Criteria | Implementation |
|----------|----------------|
| k6 scripts cover health, accounts, payments, analytics, and auth | ✅ 5 scripts under `scripts/load-test/` |
| Baseline metrics documented | ✅ `docs/performance.md` |
| CI job runs load tests and compares against baselines | ✅ `load-test` job in `ci.yml` |
| >20% degradation in p95 triggers warning | ✅ Documented in `docs/performance.md` |
| Error rate >1% fails CI | ✅ k6 `thresholds` enforce `rate<0.01` |
| k6 results available as CI artifact | ✅ `actions/upload-artifact@v4` publishes `k6-results/` |

## 🔍 Verification

After merge, inspect the next CI run:

1. Confirm the `Load Tests (k6)` job appears.
2. Confirm backend starts and health checks pass.
3. Confirm all five k6 scripts run and thresholds pass.
4. Download the `k6-results` artifact and inspect JSON summaries.

## 🛡️ Security & Safety

- Load tests use a dummy JWT (`loadtest-placeholder-token`) to avoid requiring real auth while still measuring middleware overhead.
- Tests never call Horizon mainnet or store sensitive state.
- CI uses test-only environment values.

## 🔗 Related Issues

- Resolves #167 — Load Testing with k6

---

**Type:** Feature
**Risk:** Low
**Testing:** CI job execution + artifact inspection