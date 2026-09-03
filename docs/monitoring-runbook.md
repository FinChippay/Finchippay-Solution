# Monitoring Runbook

## Dashboard Quick Reference

| Dashboard | File | Purpose |
|---|---|---|
| Backend Metrics | `grafana-dashboard.json` | Request rate, latency, error rate, rate limiting, webhook delivery, contract event indexer |
| Business | `grafana-business.json` | Transaction volume, user signups |
| System | `grafana-system.json` | CPU, memory, disk, network |

## Key Alerts (prometheus-alerts.yml)

All alert rules live in `docs/prometheus-alerts.yml` and only reference metrics the
backend actually exposes (`/metrics`). Every rule below links to its response
section.

| Alert | Severity | Component |
|---|---|---|
| `HighErrorRate` | Critical | API |
| `HighErrorRateByEndpoint` | Critical | API |
| `HighLatency` | Critical | API |
| `BackendDown` | Critical | API |
| `RateLimitHigh` | Warning | Rate limiting |
| `WebhookDeliveryFailure` | Critical | Webhooks |
| `WebhookDeliverySlow` | Warning | Webhooks |
| `ContractEventBacklog` | Warning | Indexer |
| `ContractEventParseFailures` | Warning | Indexer |

## Incident Response

1. **Detect** — Alert fires or user reports
2. **Triage** — Check Grafana + Sentry
3. **Contain** — Pause the affected subsystem if needed
4. **Resolve** — Fix + deploy
5. **Post-mortem** — Document in `docs/incidents/`

## Prometheus Alert Rules

### Critical (PagerDuty)

## High Error Rate

- **Rule:** `HighErrorRate` — `sum(rate(http_requests_total{status_code=~"5.."}[5m])) / clamp_min(sum(rate(http_requests_total[5m])), 0.001) > 0.05` for `5m`.
- **Metric:** `http_requests_total` (labels: `method`, `route`, `status_code`).
- **Respond:** Open Sentry and the Operations dashboard; identify the failing
  route from `http_requests_total`. Check for a recent deploy or upstream
  dependency (Horizon, DB). Roll back the offending change; page the on-call
  engineer if the error rate does not recover within 15 minutes.

## High Latency

- **Rule:** `HighLatency` — `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) > 1` for `5m`.
- **Metric:** `http_request_duration_seconds` (histogram, labels: `method`, `route`, `status_code`).
- **Respond:** Check the API Latency Distribution (heatmap) panel. Identify
  slow routes and DB/`db_query_duration_seconds` or Horizon
  (`horizon_request_duration_seconds`) hotspots. Confirm `JWT_SECRET`-adjacent
  crypto or rate-limiter contention are not the cause, then profile the slow
  path and deploy the fix.

## Backend Down

- **Rule:** `BackendDown` — `up{job="finchippay-backend"} == 0`.
- **Respond:** The backend is unreachable from Prometheus. Check the container
  is running, the `/metrics` endpoint responds, and the process did not crash
  on startup (e.g. `validateEnv` FATAL). Restart and confirm the scrape target
  is healthy again.

### Warning (Slack)

## Rate Limit High

- **Rule:** `RateLimitHigh` — `sum(increase(rate_limit_hits_total[5m])) > 100`.
- **Metric:** `rate_limit_hits_total` (labels: `route`, `limiter_type`, `status`).
- **Respond:** Review the Rate-limit Decisions and Rate-limit Breaches panels.
  A burst on one `route`/`limiter_type` usually means a misbehaving client or a
  misconfigured limit; a global rise may indicate abuse. Check
  `rate_limit_breaches_total` for the offending client hashes, then adjust the
  relevant limit or block the client.

## Webhook Delivery Failure

- **Rule:** `WebhookDeliveryFailure` — `sum(rate(webhook_deliveries_total{status=~"failed|error"}[10m])) / clamp_min(sum(rate(webhook_deliveries_total[10m])), 0.001) > 0.2` for `10m`.
- **Metric:** `webhook_deliveries_total` (label: `status`).
- **Respond:** Open the Webhook Delivery Success Rate panel. Check the
  subscriber's endpoint health and the delivery retry queue; inspect
  `webhook_deliveries` rows for the failing webhook. If the subscriber is
  down, pause their webhook and notify them. Page if more than one subscriber
  is affected (possible platform-level cause).

## Webhook Delivery Slow

- **Rule:** `WebhookDeliverySlow` — `histogram_quantile(0.95, sum(rate(webhook_delivery_duration_seconds_bucket[10m])) by (le)) > 10` for `10m`.
- **Metric:** `webhook_delivery_duration_seconds` (histogram, label: `outcome`).
- **Respond:** The subscriber endpoint is slow to acknowledge. Inspect the
  delivery timings and the subscriber's timeout settings; raise the subscriber
  timeout or route deliveries through the retry queue. Escalate to the
  subscriber owner if it persists.

## Contract Event Backlog

- **Rule:** `ContractEventBacklog` — `contract_event_indexer_lag_ledgers > 1000`.
- **Metric:** `contract_event_indexer_lag_ledgers` (gauge).
- **Respond:** The indexer is falling behind the network tip. Check the
  Contract Event Processing Lag panel, the indexer logs for parse/DB errors,
  and confirm the `indexer_state` watermark is advancing. Restart the indexer
  if it is stuck; if lag persists, the indexer cannot keep up and needs
  throughput work.

## Contract Event Parse Failures

- **Rule:** `ContractEventParseFailures` — `sum(rate(contract_events_processed_total{outcome="parse_failed"}[15m])) > 0.1`.
- **Metric:** `contract_events_processed_total` (label: `outcome`).
- **Respond:** The indexer is failing to parse contract events. Inspect the
  Contract Events Processed panel and the indexer error logs; a sustained
  parse-failure rate usually means a schema/contract change the parser does
  not understand. Capture a failing payload and fix the parser or the
  event-whitelist config.

### Grafana Dashboards

Dashboards are provisioned from `docs/`:

- **Backend Metrics** (`grafana-dashboard.json`): request rate, latency,
  error rate, rate limiting, webhook delivery, contract event indexer lag and
  throughput.
- **Business** (`grafana-business.json`): payment volume, active users.
- **System** (`grafana-system.json`): CPU, memory, disk, network.
