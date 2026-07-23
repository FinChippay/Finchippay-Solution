# Performance Runbook

This document defines baseline performance metrics, SLAs, and load testing targets for the Finchippay backend. It is intended for on-call engineers, QA, and release engineering.

## Baseline Test Policy

- **Health Checks:** Run during every CI pipeline execution on every push to `main` and `develop`, plus on every PR targeting `main`.
- **Performance Regression Thresholds:**
  - p95 latency increase > **20%** compared to the prior baseline triggers a CI warning.
  - Error rate > **1%** fails the run.
- **Artifacts:** Each k6 run emits a JSON summary under `k6-results/`. These are uploaded as GitHub Actions artifacts for post-run inspection.

## SLA Targets by Endpoint

| Endpoint | Method | Min RPS | p95 Latency | p99 Latency | Notes |
|----------|--------|---------|-------------|-------------|-------|
| `/health`, `/api/health` | GET | ≥ 200 | < 200ms | < 500ms | Read-only, cached |
| `/api/accounts/:pk/balance` | GET | ≥ 50 | < 300ms | < 500ms | Depends on Horizon latency |
| `/api/accounts/:pk` | GET | ≥ 50 | < 500ms | < 1000ms | Aggregates account + lines |
| `/api/payments/:pk` | GET | ≥ 20 | < 500ms | < 1000ms | Paginated via Horizon |
| `/api/analytics/:pk/summary` | GET | ≥ 20 | < 500ms | < 1000ms | Aggregates payment history |
| `/api/auth?account=...` | GET | ≥ 20 | < 500ms | < 1000ms | Challenge tx generation |
| `/api/auth` | POST | ≥ 20 | < 500ms | < 1000ms | JWT issuance |

## Load Profile

k6 tests follow a staged pattern to mimic real traffic:

1. Warm-up: ramp to 10 VUs for 30s
2. Ramp-up: increase to 50 VUs over 1m
3. Steady-state: maintain target VUs for 2m
4. Cool-down: taper to 0 VUs over 30s

This pattern reduces cold-start noise and surfaces sustained throughput limits clearly.

## Thresholds in CI

Each k6 script enforces:

```
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

Adjustments:
- Health tests use a stricter p95 target (`<200ms`) because health is hit by orchestrators and load balancers.
- Payment endpoints are tested at a lower steady-state target (20 VUs) due to stricter rate limits and downstream Horizon dependency.

## Rate Limits to Honor During Load Tests

| Region | Limit | Implication for Tests |
|--------|-------|-----------------------|
| Global | 100 req / 15 min | Spread load tests across distinct IPs if running distributed |
| Strict | 20 req / min | Keep sustained VU counts moderate in k6 to avoid 429s |

If tests return `429 Too Many Requests`, reduce target VUs or add randomized backoff between requests.

## Coordinate with Backend Team

Any change to backend middleware, rate limiting, caching, or Horizon proxying should be reviewed against this runbook. If a change increases p95 latency by more than **20%**, it must be flagged in the PR and load tests should be re-baselined.

## Regression Workflow

1. CI publishes `k6-results/*.json` artifacts.
2. Download the artifact and compare `http_req_duration` percentiles against `docs/performance.md` baselines.
3. If regression is detected:
   - Pause release promotion.
   - Investigate caching, DB queries, Horizon latency, and new middleware.
   - Re-run load tests with mitigations.

## Updating Baselines

When a deliberate change increases capacity or changes SLA, update:
- `docs/performance.md`
- `scripts/load-test/*.js` stages/thresholds

Do not widen thresholds to hide regressions.