# Monitoring runbook

Response procedures for every alert Finchippay defines. Each alert's `runbook`
annotation links directly to its section here, so the notification a responder
receives already contains the link to what to do about it.

- Dashboard: **Finchippay Solution — Backend Metrics** (`finchippay-backend-metrics`)
- Alert rules: [`prometheus-alerts.yml`](prometheus-alerts.yml)
- Scrape config: [`prometheus.yml`](prometheus.yml)
- Notification channels: [`grafana-notifiers.yml`](grafana-notifiers.yml)
- Error codes referenced below: [`error-codes.md`](error-codes.md)

## Contents

- [Setup](#setup)
- [Metrics reference](#metrics-reference)
- [Alert summary](#alert-summary)
- [HighErrorRate](#higherrorrate)
- [HighLatency](#highlatency)
- [BackendDown](#backenddown)
- [RateLimitHigh](#ratelimithigh)
- [WebhookDeliveryFailure](#webhookdeliveryfailure)
- [WebhookDeliverySlow](#webhookdeliveryslow)
- [ContractEventBacklog](#contracteventbacklog)
- [ContractEventParseFailures](#contracteventparsefailures)
- [Tuning thresholds](#tuning-thresholds)

## Setup

Mount the configuration into the Prometheus and Grafana containers:

```yaml
prometheus:
  volumes:
    - ./docs/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    - ./docs/prometheus-alerts.yml:/etc/prometheus/alerts.yml:ro

grafana:
  volumes:
    - ./docs/grafana-datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml:ro
    - ./docs/grafana-notifiers.yml:/etc/grafana/provisioning/alerting/notifiers.yml:ro
  environment:
    - ALERT_EMAIL_TO=ops@example.com
    - SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
    - SLACK_ALERT_CHANNEL=#finchippay-alerts
```

Import the dashboard with **Dashboards > New > Import > Upload JSON file** and
select `docs/grafana-dashboard.json`, or provision it alongside the datasource.

Verify before relying on any of it:

```bash
# Rules parse and the expressions are valid.
promtool check rules docs/prometheus-alerts.yml

# Prometheus loaded them: all nine rules should be listed.
curl -s localhost:9090/api/v1/rules | jq '.data.groups[].rules[].name'

# The backend is exposing the metrics the rules read.
curl -s localhost:4000/metrics | grep -E '^(rate_limit_hits|webhook_deliveries|contract_events_processed|contract_event_indexer_lag)'
```

Then send a test notification from **Alerting > Contact points > Test** for both
the email and Slack channels. A contact point that has never been tested is not
a configured channel.

## Metrics reference

| Metric | Type | Labels | Emitted from |
| --- | --- | --- | --- |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | `middleware/metrics.js` |
| `http_request_duration_seconds` | Histogram | `method`, `route` | `middleware/metrics.js` |
| `horizon_requests_total` | Counter | `operation`, `status` | `services/stellarService.js` |
| `active_webhook_streams` | Gauge | — | `services/webhookService.js` |
| `rate_limit_hits_total` | Counter | `limiter`, `route` | `middleware/rateLimit.js` |
| `webhook_deliveries_total` | Counter | `outcome`, `status_code` | `services/webhookService.js` |
| `webhook_delivery_duration_seconds` | Histogram | `outcome` | `services/webhookService.js` |
| `contract_events_processed_total` | Counter | `outcome` | `services/eventIndexer.js` |
| `contract_event_indexer_lag_ledgers` | Gauge | — | `services/eventIndexer.js` |

Two label conventions worth knowing before reading a graph:

- **Webhook `outcome`** distinguishes `success` (2xx), `failed` (the receiver
  responded with a non-2xx), and `error` (no response at all — DNS, timeout,
  connection refused). `failed` is the receiver's problem; `error` may be ours.
- **Rate limit `limiter`** is `global` (100 req / 15 min), `sensitive`
  (10 req / min), or `strict` (20 req / min), so a spike can be attributed to a
  specific limiter rather than to "429s in general".

## Alert summary

| Alert | Severity | Condition | For | Channel |
| --- | --- | --- | --- | --- |
| [HighErrorRate](#higherrorrate) | critical | 5xx > 5% of requests | 5m | Slack + email |
| [HighErrorRateByEndpoint](#higherrorrate) | warning | 5xx > 5% on one route | 10m | Slack |
| [HighLatency](#highlatency) | warning | p95 > 1s | 5m | Slack |
| [BackendDown](#backenddown) | critical | scrape failing | 2m | Slack + email |
| [RateLimitHigh](#ratelimithigh) | warning | > 100 rejections / 5m | 5m | Slack |
| [WebhookDeliveryFailure](#webhookdeliveryfailure) | critical | failure rate > 20% | 10m | Slack + email |
| [WebhookDeliverySlow](#webhookdeliveryslow) | warning | p95 delivery > 10s | 10m | Slack |
| [ContractEventBacklog](#contracteventbacklog) | critical | lag > 1000 ledgers | 10m | Slack + email |
| [ContractEventParseFailures](#contracteventparsefailures) | warning | > 0.1 parse failures/s | 15m | Slack |

---

## HighErrorRate

**Fires when** 5xx responses exceed 5% of all requests for 5 minutes.
**Severity** critical. **Impact** users are seeing failures; payments may not be
completing.

### Triage

1. Open **5xx Error Rate by Endpoint** on the dashboard. One route spiking is a
   different problem from all routes spiking.
2. Pull the correlation ID of a recent failure and find the request in the logs:

   ```bash
   # Errors in the last 15 minutes, grouped by code.
   docker compose logs backend --since 15m | grep '"level":"ERROR"' | jq -r '.errorCode' | sort | uniq -c | sort -rn

   # Everything about one request.
   docker compose logs backend --since 1h | grep '<correlationId>'
   ```

3. Read the dominant `errorCode` against [`error-codes.md`](error-codes.md).

### Common causes

| Dominant code | Cause | Action |
| --- | --- | --- |
| `SRV_HORIZON_UNAVAILABLE`, `PAY_HORIZON_ERROR` | Horizon is degraded | Check [status.stellar.org](https://status.stellar.org). Usually resolves without action; consider failing over `HORIZON_URL` |
| `SRV_INTERNAL` on one route | Bug in a recent deploy | Compare the spike's start time against the deploy history; roll back if they line up |
| Errors across every route | Backend saturated or a dependency down | Check **CPU Usage** and **Heap Memory** panels, then Redis and Postgres connectivity |

### Resolution

- **Horizon degraded** — no code change; the alert clears when Horizon recovers.
  Silence it while the upstream incident is open so it does not mask a second
  problem.
- **Bad deploy** — roll back, then reproduce against the previous build.
- **Saturation** — scale the backend out; if heap is climbing steadily rather
  than sawtoothing, suspect a leak and capture a heap snapshot before restarting.

### Escalate

If the error rate stays above 5% for 30 minutes with no identified cause, or if
payment submission specifically is failing.

---

## HighLatency

**Fires when** p95 request duration exceeds 1 second for 5 minutes.
**Severity** warning. **Impact** the app feels slow; some clients may time out.

### Triage

1. Open **API Latency Distribution (heatmap)**. A band shifting upward means a
   subset of traffic is slow; the whole surface shifting means everything is.
2. Check **Horizon Request Rate** — most Finchippay latency is Horizon latency.
3. Check **CPU Usage** and event-loop lag (`finchippay_nodejs_eventloop_lag_seconds`).

### Common causes

| Signal | Cause | Action |
| --- | --- | --- |
| Horizon rate flat, latency up | Horizon is slow | Wait it out or switch `HORIZON_URL` |
| Event-loop lag climbing | CPU-bound work blocking the loop | Look for a synchronous hot path in the recent diff |
| Cache hit rate down | Redis unavailable, so every read hits Horizon | Check Redis; the backend degrades to LRU-only and gets slower |
| Latency only on `/api/analytics/*` | Expensive aggregation over a large history | Expected for large accounts; raise the threshold for that route rather than chasing it |

### Resolution

Restore the cache or scale out. If the cause is a genuinely expensive endpoint,
tune the alert per route instead of leaving a permanently firing global rule.

### Escalate

If p95 exceeds 3 seconds, or if latency and error rate rise together — that
combination usually means saturation rather than slowness.

---

## BackendDown

**Fires when** Prometheus cannot scrape the backend for 2 minutes.
**Severity** critical. **Impact** total outage, or a broken metrics endpoint.

This rule exists because every other rule in this file is silent when the target
is unreachable: no scrape means no samples, and a ratio with no samples never
crosses its threshold. Without `BackendDown`, a completely dead backend produces
no alerts at all.

### Triage

```bash
curl -sS -o /dev/null -w '%{http_code}\n' localhost:4000/health
curl -sS -o /dev/null -w '%{http_code}\n' localhost:4000/metrics
docker compose ps backend
docker compose logs backend --tail 200
```

### Common causes

| Symptom | Cause | Action |
| --- | --- | --- |
| Container not running | Crash loop | Read the last 200 log lines for the startup failure — usually a missing required env var |
| `/health` 200 but `/metrics` 401 | `METRICS_TOKEN` set without updating the scrape config | Add the `authorization` block in `prometheus.yml` |
| Both endpoints fine | Network path between Prometheus and the backend | Check the compose network and the `targets` entry |

### Escalate

Immediately if the container will not stay up. This is a full outage.

---

## RateLimitHigh

**Fires when** more than 100 requests are rejected by rate limiters in 5 minutes.
**Severity** warning. **Impact** depends entirely on who is being rejected —
legitimate users, or an abusive client.

### Triage

1. Open **Rate Limit Hits Over Time** and read the `limiter` and `route` labels.
2. Identify the source:

   ```bash
   docker compose logs backend --since 15m | grep '"status_code":429' | jq -r '.req.remoteAddress' | sort | uniq -c | sort -rn | head
   ```

### Interpretation

| Pattern | Meaning | Action |
| --- | --- | --- |
| One IP, one route | Scraping or a misconfigured client | Block at the edge; contact the integrator if it is a known partner |
| Many IPs, one route | The limit is too tight for real usage | Raise `max` for that limiter and redeploy |
| `limiter="global"` broadly | Traffic growth | Raise the global limit and plan capacity |
| Sudden spike from many IPs | Possible credential stuffing on `/api/auth/*` | Escalate to security |

### Resolution

Adjust the limit in `backend/src/middleware/rateLimit.js` (per-route limiters)
or in `backend/src/server.js` (the global limiter). Raising a limit is the right
call when real users are being blocked; it is the wrong call when one client is
misbehaving.

### Escalate

If the pattern looks like an attack rather than a misconfiguration.

---

## WebhookDeliveryFailure

**Fires when** more than 20% of webhook deliveries fail for 10 minutes.
**Severity** critical. **Impact** merchants are not being notified of payments
they have received — they may ship goods late or not at all.

### Triage

1. Open **Webhook Delivery Outcomes** and read the split:
   - mostly `failed` — receivers are rejecting our requests;
   - mostly `error` — we cannot reach the receivers.
2. Identify which endpoints:

   ```bash
   docker compose logs backend --since 30m | grep -E 'webhook_delivery_(failed|error)' | jq -r '.url' | sort | uniq -c | sort -rn
   ```

### Common causes

| Split | Cause | Action |
| --- | --- | --- |
| `failed`, one URL | That merchant's endpoint is down or returning 4xx | Contact the merchant; consider disabling the hook until it recovers |
| `failed` with 401/403 across URLs | Signature verification breaking | Check that `X-Webhook-Signature` generation has not changed — a signing change breaks every receiver at once |
| `error`, all URLs | Outbound network or DNS failure on our side | Check egress from the backend container |
| `error`, one URL | Receiver unreachable | Merchant-side; notify them |

### Resolution

- One bad receiver: notify the merchant. A single high-volume merchant can push
  the global rate over 20% on their own — check the per-URL breakdown before
  treating it as a platform incident.
- Signature or egress problem: platform-side, fix immediately. Every merchant is
  affected.

### Escalate

Immediately if `error` dominates across all URLs, or if signature verification is
implicated — both mean no merchant is receiving notifications.

---

## WebhookDeliverySlow

**Fires when** p95 webhook delivery exceeds 10 seconds for 10 minutes.
**Severity** warning. **Impact** delivery throughput drops; often the precursor
to `WebhookDeliveryFailure`.

### Triage

Check whether the latency is concentrated in a few receivers (normal — third
party endpoints vary) or spread across all of them (ours). If deliveries are
also erroring, treat it as [WebhookDeliveryFailure](#webhookdeliveryfailure).

### Resolution

Slow individual receivers are the merchant's to fix; notify them. If every
receiver is slow, check outbound network and DNS resolution times from the
backend container.

---

## ContractEventBacklog

**Fires when** the indexer is more than 1000 ledgers behind for 10 minutes.
**Severity** critical. **Impact** the silent degradation this monitoring exists
to catch: the API keeps returning 200s, but on-chain data is stale. Escrow and
stream state shown to users no longer matches the chain.

At roughly 5 seconds per ledger, 1000 ledgers is about 80 minutes of drift.

### Triage

1. Open **Contract Event Processing Lag**. A steadily climbing line means the
   indexer is running but cannot keep up; a flat line at a high value means it
   has stopped.
2. Check it is alive:

   ```bash
   docker compose logs backend --since 15m | grep -i 'event indexer'
   curl -s localhost:4000/api/health | jq '.dependencies'
   ```

### Common causes

| Symptom | Cause | Action |
| --- | --- | --- |
| "Event indexer poll failed" repeating | Soroban RPC unreachable | Check `SOROBAN_RPC_URL` and the provider's status |
| Lag climbing steadily, no errors | Poll interval too slow for event volume | Lower `EVENT_INDEXER_POLL_INTERVAL_MS` |
| Lag jumped after a restart | Catching up from the stored cursor | Expected — confirm it is falling before acting |
| Postgres errors in `storeEvents` | Database unavailable or disk full | Restore the database |

### Resolution

Fix the underlying dependency; the indexer resumes from its stored cursor and
the lag falls on its own. Do **not** reset the cursor to skip the backlog — that
permanently drops the events in the gap.

### Escalate

If lag exceeds 5000 ledgers, or if it is still climbing 30 minutes after the
dependency was restored.

---

## ContractEventParseFailures

**Fires when** the indexer skips more than 0.1 events/s it cannot decode, for
15 minutes.
**Severity** warning. **Impact** specific events are missing from the index,
while everything else looks healthy.

### Triage

```bash
docker compose logs backend --since 30m | grep 'Failed to parse individual Soroban event' | head
```

The log line carries the `eventId`; look it up on the explorer to see the shape
that was emitted.

### Common causes

Almost always a contract that emits an event shape this indexer build does not
know about — a contract deployed ahead of the backend that reads it.

### Resolution

Update `parseEvent` in `backend/src/services/eventIndexer.js` to handle the new
shape, deploy, and replay the affected ledger range. Check the contract's deploy
history against the alert's start time to confirm the correlation before writing
any parsing code.

---

## Tuning thresholds

The thresholds here are starting points chosen to be meaningful on a service
this size. Tune them against observed behaviour rather than leaving an alert
firing continuously — an alert that is always on is an alert nobody reads.

When changing a threshold, change it in all three places so the dashboard, the
rules, and this document stay consistent:

1. `docs/prometheus-alerts.yml` — the `expr` and the `for` duration.
2. `docs/grafana-dashboard.json` — the threshold line drawn on the panel.
3. This runbook — the alert summary table and the section heading text.

Guidance on `for` durations: it is the single most effective control against
noise. A rule that fires on a 30-second blip will be muted within a week. Prefer
lengthening `for` over raising the threshold, because raising the threshold
hides genuine sustained degradation while lengthening `for` only delays the page.
