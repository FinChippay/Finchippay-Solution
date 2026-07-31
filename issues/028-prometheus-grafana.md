# Issue #28 — Prometheus Metrics Export and Grafana Dashboard

**Labels:** `backend` `feature` `monitoring` `devops`

## Summary
Add comprehensive Prometheus metrics export to the backend and build production-ready Grafana dashboards for monitoring system health, performance, and business metrics.

## Background
The backend has a `metricsService.js` and `backend/src/middleware/metrics.js` middleware that collect some metrics. The `docs/` directory has `prometheus.yml` and `grafana-dashboard.json` but these are basic. The `metrics.js` route exposes `/api/metrics`. The Kubernetes and Docker Compose configurations reference Prometheus.

## Problem Statement
Operators lack visibility into system health, API performance, error rates, and business metrics. The existing dashboards are basic and don't cover contract events, webhook delivery, or user-facing business metrics.

## Objectives
1. Add comprehensive Prometheus metrics for all backend services.
2. Build production Grafana dashboards for operations, business, and contract monitoring.
3. Add RED metrics (Rate, Errors, Duration) for all API routes.
4. Add business metrics (active users, payments volume, contract events).
5. Write tests for metric collection.

## Scope
- **In scope:** Prometheus metrics, Grafana dashboards, RED metrics, business metrics.
- **Out of scope:** alerting rules (can be added separately), distributed tracing.

## Detailed Implementation Requirements

1. **Prometheus metrics enhancement:** Update `backend/src/services/metricsService.js`:
   - Add `http_requests_total{method, route, status_code}` counter.
   - Add `http_request_duration_seconds{method, route}` histogram (buckets: 0.01, 0.05, 0.1, 0.5, 1, 2, 5).
   - Add `http_requests_in_flight{method, route}` gauge.
   - Add `db_query_duration_seconds{operation}` histogram.
   - Add `horizon_request_duration_seconds{operation}` histogram.
   - Add `horizon_requests_total{operation, status}` counter.
   - Add `webhook_deliveries_total{status}` counter.
   - Add `contract_events_indexed_total{event_type}` counter (from Issue #8).
   - Add `active_users gauge` (updated every 5 minutes via cron).
   - Add `payments_volume_total{asset}` counter.
   - Add `error_count_total{service, error_code}` counter.

2. **Metrics middleware:** Update `backend/src/middleware/metrics.js`:
   - Record HTTP request duration, method, route, and status code for every request.
   - Track in-flight requests.
   - Use `on-finished` or `res.on('finish')` to capture response time accurately.
   - Exclude `/api/metrics` path from self-recording.

3. **Grafana dashboards:** Create comprehensive JSON models:
   - **Operations Dashboard** (`docs/grafana-operations.json`):
     - API request rate, error rate, latency (p50, p95, p99) per route.
     - Horizon request rate and error rate.
     - Database query performance.
     - Rate limit blocks.
     - Webhook delivery success/failure rate.
   - **Business Dashboard** (`docs/grafana-business.json`):
     - Active users (daily unique public keys).
     - Payment volume (XLM and USDC) over time.
     - Transaction count over time.
     - Top recipients.
     - Contract event counts by type.
   - **System Dashboard** (`docs/grafana-system.json`):
     - CPU, memory, disk usage (from node_exporter).
     - Node.js event loop lag.
     - Heap usage and GC pauses.
     - HTTP connection count.

4. **Prometheus config update:** Update `docs/prometheus.yml` to scrape at 15s intervals with proper relabeling for Kubernetes service discovery.

5. **Key business metrics endpoint:** Add `GET /api/metrics/business` for quick health checks:
   - Returns: `{ activeUsers24h, paymentsToday, volumeTodayXLM, totalEvents, webhookSuccessRate, averageResponseTime }`.

6. **Tests:** Test metric recording in controllers (verify counters increment). Test `/api/metrics` endpoint returns valid Prometheus format.

## Expected Architecture

```
backend/
├── src/
│   ├── services/
│   │   └── metricsService.js       (UPDATE: comprehensive metrics)
│   └── middleware/
│       └── metrics.js              (UPDATE: RED metrics)
├── docs/
│   ├── prometheus.yml              (UPDATE)
│   ├── grafana-operations.json     (NEW)
│   ├── grafana-business.json       (NEW)
│   └── grafana-system.json         (NEW)
└── __tests__/
    ├── metrics.test.js             (NEW)
    └── middleware-metrics.test.js  (NEW)
```

## Acceptance Criteria
- [ ] All API routes have RED metrics (Rate, Errors, Duration) with histogram buckets.
- [ ] Horizon, database, and webhook operations have dedicated metrics.
- [ ] Business metrics (active users, payment volume, contract events) are collected.
- [ ] `/api/metrics` returns valid Prometheus text format.
- [ ] 3 Grafana dashboards (operations, business, system) are importable and functional.
- [ ] Prometheus config updated for 15s scrape interval.
- [ ] All existing tests pass.
