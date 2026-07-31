# Issue #30 — Load Testing Framework and Performance Baselines

**Labels:** `backend` `testing` `performance` `devops`

## Summary
Build a comprehensive load testing framework using k6/artillery, establish performance baselines for all critical API endpoints, integrate load tests into CI, and create a performance regression detection system.

## Background
The project has some load test scripts in `tests/load/` directory using a custom Node.js-based approach (`tests/load/analytics-query.js`, `payment-burst.js`, `sustained-load.js`, `dashboard-traffic.js`). There's also `scripts/load-test/` directory with `accounts.js`, `analytics.js`, `auth.js`, `health.js`, `payments.js`. The `benchmarks/` directory has `base.json`, `current.json`, and `summary.md`.

## Problem Statement
There's no automated performance regression detection in CI. Load tests require manual execution. Baselines are outdated. Without a proper framework, performance regressions can slip into production.

## Objectives
1. Adopt k6 as the standard load testing tool.
2. Create realistic load test scenarios for all critical user journeys.
3. Establish automated performance baselines in CI.
4. Add performance regression alerts.
5. Create a performance dashboard.

## Scope
- **In scope:** k6 test scenarios, CI integration, baselines, regression detection.
- **Out of scope:** distributed load testing across regions.

## Detailed Implementation Requirements

1. **Load testing tool adoption:** Install k6 (`brew install k6` / download binary). Create `tests/load/k6/` directory with:
   - `helpers.js` — shared functions for authentication, data generation.
   - `options.js` — shared test options (stages, thresholds, tags).
   - `scenarios/` — individual test scenarios.

2. **Test scenarios (7 scenarios):**
   - **Health check burst:** 1000 concurrent users hitting `/api/health` for 30s. Threshold: p95 < 50ms, error rate < 0.1%.
   - **Dashboard load:** Simulate 10 concurrent users loading dashboard data (balances, transactions, stats). Ramp-up over 2min, sustain 5min. Threshold: p95 < 2s.
   - **Payment submission:** Sequential payment submissions via Horizon mock. 50 iterations. Threshold: success rate > 99%.
   - **Webhook delivery:** Simulate webhook endpoint receiving payloads. 1000 deliveries. Threshold: p95 < 500ms.
   - **Analytics queries:** Complex analytics endpoints. 100 concurrent. Threshold: p95 < 3s.
   - **Account lookup:** Federation + account resolution. 200 concurrent. Threshold: p95 < 1s.
   - **Mixed workload:** Realistic mix of all endpoints based on expected traffic patterns.

3. **CI integration:** Create `.github/workflows/load-test.yml`:
   - Trigger: manual, on schedule (nightly), and optionally on PRs.
   - Steps: Start Docker Compose (test env), Run k6 tests, Compare results to baselines.
   - Uses `grafana/k6-action` GitHub Action.
   - Comment performance results on PRs.

4. **Baseline management:**
   - Store baselines in `benchmarks/` directory as JSON.
   - Each baseline: `{ scenario, timestamp, thresholds: { p50, p95, p99, error_rate, avg_requests_per_sec } }`.
   - `scripts/compare-benchmarks.js` — compares current run to baseline. Flags regressions > 10% on any threshold.
   - Update baselines on `master` branch after each successful nightly run.

5. **Performance dashboard:** Create `frontend/pages/admin/performance.tsx`:
   - Historical performance chart for each scenario.
   - Current vs baseline comparison.
   - Regression highlights.
   - Last N test runs table.
   - Admin-only (requires `requireAdmin` middleware on backend).

6. **Backend performance endpoint:** Add `GET /api/admin/performance/summary`:
   - Returns latest benchmarks, baselines, and regression status.
   - `/api/admin/performance/history?scenario=&days=` — historical data.

7. **Mock Horizon server:** Create `tests/load/mock-horizon.js`:
   - Lightweight Express server that responds like Horizon.
   - Configurable latency and error rates.
   - Used in load tests to avoid hitting real Horizon.

8. **Test harness:** Update existing `tests/load/run-all.sh` to run k6 scenarios.

## Expected Architecture

```
tests/
├── load/
│   ├── k6/
│   │   ├── helpers.js              (NEW)
│   │   ├── options.js              (NEW)
│   │   └── scenarios/
│   │       ├── health-check.js     (NEW)
│   │       ├── dashboard-load.js   (NEW)
│   │       ├── payments.js         (NEW)
│   │       ├── webhooks.js         (NEW)
│   │       ├── analytics.js        (NEW)
│   │       ├── account-lookup.js   (NEW)
│   │       └── mixed-workload.js   (NEW)
│   ├── mock-horizon.js             (NEW)
│   └── run-all.sh                  (UPDATE)

benchmarks/
├── base.json                       (UPDATE)
└── current.json                    (AUTO)

frontend/
├── pages/
│   └── admin/
│       └── performance.tsx         (NEW)

.github/workflows/
└── load-test.yml                   (NEW)
```

## Acceptance Criteria
- [ ] 7 k6 load test scenarios cover all critical API endpoints.
- [ ] CI runs load tests nightly and on-demand.
- [ ] Performance baselines are stored and compared automatically.
- [ ] Regressions > 10% are flagged in CI output.
- [ ] Performance dashboard shows historical trends and regression alerts.
- [ ] Mock Horizon server enables isolated load testing.
- [ ] All existing tests pass.
