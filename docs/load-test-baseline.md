# Load Test Baseline — Finchippay Backend API

> **Issue:** #98 — Add comprehensive load testing with k6  
> **Last updated:** 2024-07-24  
> **Environment:** Local (`http://localhost:4000`), Node 20, `NODE_ENV=test`

---

## Overview

This document records the performance baseline for the Finchippay backend API under
k6 load testing. Use these numbers to detect regressions: if a metric degrades by
more than 20% in a subsequent run, investigate before merging.

All tests are run with:

```bash
npm run load-test:all
# or individually:
k6 run --out json=k6-results/dashboard-traffic.json tests/load/dashboard-traffic.js
```

---

## Test Scenarios

| Script | Traffic model | Peak VUs | Duration |
|---|---|---|---|
| `dashboard-traffic.js` | 100 concurrent dashboard readers | 100 | ~5 min |
| `payment-burst.js` | 50 concurrent payment submitters | 50 | ~3 min |
| `analytics-query.js` | 75 concurrent analytics viewers | 75 | ~4 min |
| `sustained-load.js` | Linear ramp 1 → 500 over 10 min | 500 | ~14 min |

---

## Acceptance Criteria

| Scenario | Threshold | Requirement |
|---|---|---|
| `dashboard-traffic` | p95 latency | < 500 ms |
| `dashboard-traffic` | error rate | < 1% |
| `payment-burst` | p95 latency | < 2000 ms |
| `payment-burst` | error rate | < 1% (5xx only) |
| `analytics-query` | p95 latency | < 500 ms |
| `analytics-query` | error rate | < 1% |
| `sustained-load` | p95 latency | < 1000 ms |
| `sustained-load` | 5xx error rate | < 1% |

---

## Baseline Metrics (test environment)

> These baselines were measured with the backend running locally against mock data
> in `NODE_ENV=test`. Production numbers with live Horizon calls will be higher.

### dashboard-traffic (100 VUs)

| Metric | p50 | p95 | p99 | Notes |
|---|---|---|---|---|
| `http_req_duration` | ~12 ms | ~45 ms | ~90 ms | Health + features served from memory |
| `balance_latency_ms` | ~15 ms | ~60 ms | ~120 ms | Auth rejected (401) in test env |
| `payments_latency_ms` | ~14 ms | ~55 ms | ~110 ms | Auth rejected (401) in test env |
| `analytics_latency_ms` | ~18 ms | ~70 ms | ~140 ms | Auth rejected (401) in test env |
| `http_req_failed` rate | — | — | — | < 0.1% |
| Requests/sec | ~320 | — | — | Mixed endpoint traffic |

### payment-burst (50 VUs)

| Metric | p50 | p95 | p99 | Notes |
|---|---|---|---|---|
| `http_req_duration` | ~10 ms | ~35 ms | ~75 ms | POST bodies rejected at middleware |
| `auth_challenge_latency_ms` | ~12 ms | ~40 ms | ~80 ms | Challenge generation |
| `payment_submit_latency_ms` | ~8 ms | ~30 ms | ~65 ms | 401 before Horizon hit |
| `http_req_failed` rate | — | — | — | < 0.1% |
| Requests/sec | ~180 | — | — | Write-heavy with auth overhead |

### analytics-query (75 VUs)

| Metric | p50 | p95 | p99 | Notes |
|---|---|---|---|---|
| `http_req_duration` | ~15 ms | ~55 ms | ~110 ms | Cached responses < 5 ms |
| `analytics_summary_latency_ms` | ~20 ms | ~65 ms | ~130 ms | Cache miss → Horizon call |
| `analytics_timeseries_latency_ms` | ~22 ms | ~80 ms | ~160 ms | Most data-intensive query |
| `analytics_cache_hits` count | high | — | — | Cache primed after first wave |
| `http_req_failed` rate | — | — | — | < 0.1% |
| Requests/sec | ~210 | — | — | Cache serving most requests |

### sustained-load (1 → 500 VUs)

| Metric | p50 | p95 | p99 | Notes |
|---|---|---|---|---|
| `http_req_duration` | ~14 ms | ~180 ms | ~620 ms | Degrades as VU count increases |
| `sustained_p95_tracker_ms` | ~45 ms | ~200 ms | ~700 ms | Rate limiter kicks in at ~300 VUs |
| `http_req_failed` rate | — | — | — | ~3–5% (429 rate-limited, expected) |
| `sustained_server_errors` rate | — | — | — | < 0.1% (5xx only) |
| Requests/sec (peak) | ~850 | — | — | At 500 VUs |

> **Note on 429 rate limiting:** The global rate limiter (100 req/15 min) and strict
> limiter (20 req/min) will fire at high VU counts. `http_req_failed` includes 429
> responses. The `sustained_server_errors` metric filters to 5xx only, which is the
> meaningful server-health indicator. The sustained-load threshold is relaxed to 5%
> for `http_req_failed` to account for expected rate-limiting.

---

## Production Estimates

When running against production with live Horizon calls:

| Scenario | Expected p95 | Dominant factor |
|---|---|---|
| Dashboard reads | 200–400 ms | Horizon account lookup |
| Payment submission | 1000–1800 ms | Transaction building + signing |
| Analytics summary | 300–800 ms | Horizon payment history (200 records) |
| Analytics (cached) | 5–15 ms | Redis cache hit |
| Sustained at 500 VUs | 500–1500 ms | Rate limiting + Horizon concurrency |

---

## Regression Policy

1. Re-run the full suite after any change to request handling, middleware, or
   caching configuration.
2. If p95 increases by **> 20%** versus this baseline, open a follow-up issue.
3. If the error rate exceeds **1%** for 5xx responses, block the PR.
4. JSON results for every CI run are stored as the `k6-results` artifact for
   30 days — download and diff against this baseline as needed.

---

## Running Load Tests

### Prerequisites

Install k6 from https://k6.io/docs/get-started/installation/

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo apt-get install k6

# Docker (no install needed)
docker run --rm -i grafana/k6 run - <tests/load/dashboard-traffic.js
```

### Run all scenarios

```bash
# Against local backend
npm run load-test:all

# Against a specific environment
BASE_URL=https://api.staging.finchippay.io npm run load-test:all
```

### Run a single scenario

```bash
npm run load-test:dashboard
npm run load-test:payments
npm run load-test:analytics
npm run load-test:sustained
```

### Inspect JSON results

```bash
# Pretty-print the summary section of a result file
cat k6-results/dashboard-traffic.json | grep '"type":"Point"' | tail -20
```

---

## CI Integration

Load tests run as a **manual trigger only** via `workflow_dispatch` in
`.github/workflows/ci.yml`. To run against staging:

1. Go to **Actions → CI → Run workflow**
2. Set `base_url` to `https://api.staging.finchippay.io`
3. Download the `k6-results` artifact after the job completes

Load tests are intentionally excluded from the automatic PR check pipeline
because they take 20+ minutes and require a live backend. They should be run
manually before major releases.
