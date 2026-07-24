# Rate limiting analytics and monitoring

Finchippay applies layered request limits to protect the API and its upstream
Stellar services. This runbook describes the limiter thresholds, the
Prometheus metrics emitted by the backend, the admin analytics endpoint, and
the supplied Grafana panels.

## Limiter thresholds

| Limiter type | Window | Maximum | Typical scope |
|---|---:|---:|---|
| `global` | 15 minutes | 100 requests per client | All routes except `/health` and `/api/health` |
| `strict` | 1 minute | 20 requests per client | Accounts, payments, analytics, tips, turrets, federation, and other protected routes |
| `sensitive` | 1 minute | 10 requests per client | Higher-risk account lookup and SEP-12 identity operations |

The global limiter is evaluated before route-specific limiters. A request to a
strict or sensitive route can therefore produce one decision for `global` and
another decision for the route-specific limiter. Metrics count limiter
decisions, not unique HTTP requests.

The API returns HTTP `429` when a threshold is exceeded. Responses retain the
existing standardized error body and `RateLimit-*` headers.

## Metrics

All rate-limit metrics are registered in the backend's existing Prometheus
registry and are exposed by `GET /metrics`.

### `rate_limit_hits_total`

Counter incremented once for every limiter decision.

| Label | Values | Meaning |
|---|---|---|
| `route` | Normalized route such as `GET /api/payments/:publicKey` | Bounded route template; unresolved global requests use a route-family label such as `GET /api/payments/*` |
| `limiter_type` | `global`, `strict`, or `sensitive` | Limiter that made the decision |
| `status` | `allowed` or `blocked` | Whether the request was allowed downstream or rejected with `429` |

An allowed request increments the `allowed` series. Every rejected attempt
increments the `blocked` series, including repeated attempts in the same
limiter window.

### `rate_limit_breaches_total`

Counter incremented once for every request rejected by a limiter.

| Label | Meaning |
|---|---|
| `route` | Normalized route template |
| `ip` | Opaque HMAC-derived client hash; despite the label name, this is never a raw IP address |

The metric intentionally omits the raw address and request URL. The `ip` label
must contain only the stable digest produced by the privacy rules below.

### `rate_limit_bypassed_total`

Counter incremented once when an instrumented limiter allows a request to
continue downstream.

| Label | Meaning |
|---|---|
| `route` | Normalized route template |
| `limiter_type` | Limiter that allowed the request |

This records a successful limiter decision. It does **not** mean that the
downstream handler ultimately returned a 2xx response. A request evaluated by
both the global and strict limiters can increment this counter twice.

## express-rate-limit v7 integration

The backend uses `express-rate-limit` v7. The old `onLimitReached` option was
removed in v7 and must not be configured. Breach instrumentation belongs in a
custom `handler`:

```js
const limiter = rateLimit({
  // windowMs, limit/max, headers, store, and message...
  handler: (req, res, next, options) => {
    recordRateLimitBreach(req, "strict");
    res.status(options.statusCode).send(options.message);
  },
});
```

The handler runs for every blocked request. It must preserve each limiter's
configured status code, response body, and headers. Allowed decisions are
recorded by middleware that runs after the limiter and before the downstream
route handler.

## Client privacy

Raw IP addresses are operationally sensitive and must never appear in:

- Prometheus labels or metric help text
- the in-memory 24-hour breach history
- the admin endpoint response
- application logs produced by rate-limit analytics

The backend derives a stable identifier with HMAC-SHA256:

```text
client_hash = HMAC-SHA256(RATE_LIMIT_IP_HASH_SALT, normalized_client_ip)
```

Set `RATE_LIMIT_IP_HASH_SALT` to a long, random secret in every deployed
environment. Production startup requires at least 32 characters. Do not use an
unsalted SHA-256 digest: the IPv4 address space is small enough to brute-force.
Do not expose the salt to browsers, commit it, or reuse it as `JWT_SECRET`.
Rotating the salt deliberately breaks correlation with earlier hashes.

Use the same trusted-proxy configuration for hashing and enforcement so both
components identify the same client. Normalize IPv4 and IPv6 values before
hashing. Keep route labels bounded by using Express route templates rather than
`req.originalUrl`, public keys, transaction IDs, or query strings.

## Admin analytics endpoint

`GET /api/admin/rate-limit-stats` returns a rolling view of the last 24 hours.

The endpoint requires:

1. a valid SEP-0010 bearer JWT; and
2. a JWT `publicKey` listed in `ADMIN_PUBLIC_KEYS`.

`ADMIN_PUBLIC_KEYS` is a comma-separated allowlist of Stellar public keys:

```dotenv
ADMIN_PUBLIC_KEYS=GADMIN_ACCOUNT_1,GADMIN_ACCOUNT_2
```

The endpoint fails closed when the allowlist is empty. Missing or invalid
authentication returns `401`; an authenticated account outside the allowlist
returns `403 AUTH_FORBIDDEN`.

Example response:

```json
{
  "success": true,
  "data": {
    "topLimitedIps": [
      {
        "ipHash": "9ff7f95e27f15a33...",
        "breaches": 18
      }
    ],
    "perRouteHitRates": [
      {
        "route": "GET /api/payments/:publicKey",
        "limiterType": "strict",
        "allowed": 240,
        "blocked": 12,
        "total": 252,
        "breachRate": 0.0476
      }
    ],
    "breachHistory": [
      {
        "timestamp": "2026-07-24T11:58:15.000Z",
        "route": "GET /api/payments/:publicKey",
        "limiterType": "strict",
        "ipHash": "9ff7f95e27f15a33..."
      }
    ]
  }
}
```

`topLimitedIps` is sorted by breach count and capped at 10 entries.
`perRouteHitRates` aggregates allowed and blocked limiter decisions by
normalized route and limiter type. `breachHistory` is ordered newest first and
excludes entries older than 24 hours.

The process keeps at most 10,000 recent decisions by default, so the endpoint is
a bounded rolling view rather than a durable ledger. Set
`RATE_LIMIT_METRICS_MAX_EVENTS` between 100 and 100,000 to tune that cap for
traffic volume and memory budget. The in-memory view resets on process restart;
Prometheus remains the source for durable, cross-instance trends.

## Prometheus

The sample scrape configuration is in [`docs/prometheus.yml`](prometheus.yml).
It scrapes `/metrics` every 15 seconds. If `METRICS_TOKEN` is enabled, configure
the matching bearer token in Prometheus as described in that file.

Useful queries:

```promql
# Decisions per second by limiter and outcome
sum by (limiter_type, status) (
  rate(rate_limit_hits_total[5m])
)

# Per-route decision rate
sum by (route, status) (
  rate(rate_limit_hits_total[5m])
)

# Breaches in rolling five-minute buckets
sum by (route) (
  increase(rate_limit_breaches_total[5m])
)

# Top ten client hashes over the last 24 hours
topk(10,
  sum by (ip) (
    increase(rate_limit_breaches_total[24h])
  )
)

# Allowed limiter decisions per second
sum by (route, limiter_type) (
  rate(rate_limit_bypassed_total[5m])
)

# Percentage of decisions blocked over five minutes
100 *
(sum(rate(rate_limit_hits_total{status="blocked"}[5m])) or vector(0))
/
clamp_min(
  sum(rate(rate_limit_hits_total[5m])) or vector(0),
  1e-9
)
```

## Grafana dashboard

Import [`docs/grafana-dashboard.json`](grafana-dashboard.json) and select the
provisioned Prometheus datasource with UID `prometheus`. The rate-limit section
contains:

- decision rates split by limiter and outcome;
- five-minute breach counts per route;
- the current five-minute blocked-decision percentage;
- the ten most-limited client hashes over 24 hours; and
- successful limiter decisions split by route and limiter.

The blocked-ratio panel uses these initial operational thresholds:

| State | Blocked decision percentage |
|---|---:|
| Green | below 1% |
| Yellow | 1% to below 5% |
| Red | 5% or higher |

These are starting points, not universal SLOs. Tune them after observing at
least one normal traffic cycle. Use a longer query window (for example, 15
minutes) for low-volume routes to reduce noise. During load tests, correlate
expected `429` responses with the breach panels before treating a high ratio as
an incident.

Suggested alert condition:

```promql
(
  100 *
  sum(rate(rate_limit_hits_total{status="blocked"}[5m]))
  /
  clamp_min(sum(rate(rate_limit_hits_total[5m])), 1e-9)
) >= 5
```

Require the condition to remain true for at least five minutes. Add a minimum
traffic condition when request volume is sparse so a single rejected request
does not page an operator.

## Validation

Validate the dashboard JSON and Prometheus configuration before deployment:

```bash
node -e "JSON.parse(require('fs').readFileSync('docs/grafana-dashboard.json', 'utf8'))"
promtool check config docs/prometheus.yml
```

After starting the backend, exercise allowed and blocked requests, then verify
that `/metrics` contains all three counters and that no raw test IP appears in
the exposition or in `GET /api/admin/rate-limit-stats`.
