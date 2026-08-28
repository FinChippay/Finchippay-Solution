# Monitoring Runbook

## Dashboard Quick Reference

| Dashboard | File | Purpose |
|---|---|---|
| System | `grafana-system.json` | CPU, memory, disk, network |
| Operations | `grafana-operations.json` | API latency, error rates, DB pool |
| Business | `grafana-business.json` | Transaction volume, user signups |
| Stellar | `grafana-dashboard.json` | Horizon health, fee levels |

## Key Alerts (prometheus-alerts.yml)

| Alert | Severity | Respond |
|---|---|---|
| `HighErrorRate` | Critical | Check Sentry + logs |
| `ContractMinTTL` | Warning | Call `bump_all_ttls` |
| `HorizonUnreachable` | Critical | Check Stellar network status |
| `DBConnectionPoolExhausted` | Critical | Scale DB or check queries |
| `RedisUnavailable` | Warning | Cache degraded; app still works |

## Incident Response

1. **Detect** — Alert fires or user reports
2. **Triage** — Check Grafana + Sentry
3. **Contain** — Pause contract if needed
4. **Resolve** — Fix + deploy
5. **Post-mortem** — Document in `docs/incidents/`

## Prometheus Alert Rules

Alert rules are defined in `docs/prometheus-alerts.yml` and cover:

### Critical (PagerDuty)

| Alert | Threshold | Description |
|-------|-----------|-------------|
| `HighErrorRate` | > 5% of requests in 5 min | Elevated 5xx responses |
| `HighLatency` | p95 > 2000ms for 5 min | Degraded API performance |
| `DatabaseDown` | Connection failures > 0 | PostgreSQL unavailable |
| `RedisDown` | Connection failures > 0 | Redis unavailable |
| `WebhookDeliveryFailure` | > 10% failures in 10 min | Webhook delivery degraded |

### Warning (Slack)

| Alert | Threshold | Description |
|-------|-----------|-------------|
| `HighMemoryUsage` | > 85% of container limit | Potential memory leak |
| `HighDiskUsage` | > 80% of volume | Disk space running low |
| `RateLimitTriggered` | > 50/minute | Unusual traffic pattern |
| `ContractEventLag` | > 100 blocks behind | Event indexer falling behind |

### Grafana Dashboards

Three dashboards are provisioned:
- **Operations** (`grafana-operations.json`): Service health, latency, errors
- **Business** (`grafana-business.json`): Payment volume, active users, revenue
- **System** (`grafana-system.json`): CPU, memory, disk, network
