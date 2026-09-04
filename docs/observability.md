# Observability: Distributed Tracing

## Overview

Finchippay's backend uses OpenTelemetry (OTel) for distributed tracing. Tracing is
disabled by default and only activates when `OTEL_EXPORTER_OTLP_ENDPOINT` is set,
so local development and CI run without tracing overhead.

Traces are exported in OTLP format to any compatible collector - Jaeger, Grafana
Tempo, Honeycomb, etc.

## Instrumented paths

| Layer | Location | Span name(s) | Attributes |
|---|---|---|---|
| HTTP / Express | auto-instrumented via @opentelemetry/auto-instrumentations-node | HTTP GET /api/... | standard HTTP semantic conventions |
| Database (knex) | src/db/connection.js | db.query.<method> | db.system, db.operation, db.table |
| Redis / cache | src/services/cacheService.js | db.query.get/set/del/delPattern/setIfNotExists | cache key patterns |
| Webhook delivery | src/services/webhookService.js | webhook.delivery, webhook.retry | delivery outcome, target URL host |
| Webhook SSE ingestion | src/services/webhookService.js (onmessage handler) | webhook.sse.receive | webhook.public_key, stellar.payment_id |
| Scheduled transaction execution | src/services/scheduledExecutor.js | scheduler.execute_due_transaction | schedule.id, schedule.recipient |

Every span created inside a request handler automatically becomes a child of the
parent HTTP span through OTel's context propagation - no manual linking is needed
as long as spans are started within the same async execution context.

## Sampling

Configured in src/config/tracing.js via a custom PathBasedSampler:

- Payment-critical endpoints (/api/payments, /api/scheduled-transactions,
  /api/sep24, /api/sep38): sampled at 100% (rate = 1.0).
- Health/metrics endpoints (/health, /metrics): sampled at 10% by
  default (OTEL_SAMPLE_RATE_HEALTH, default 0.1) to avoid flooding the
  collector with high-frequency, low-value traces.
- Everything else: sampled at a configurable default rate
  (OTEL_SAMPLE_RATE_DEFAULT, default 0.5).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| OTEL_EXPORTER_OTLP_ENDPOINT | unset (tracing disabled) | Base URL of the OTLP collector |
| OTEL_SERVICE_NAME | finchippay-backend | Service name reported in traces |
| OTEL_SAMPLE_RATE_HEALTH | 0.1 | Sampling rate for health/metrics endpoints |
| OTEL_SAMPLE_RATE_DEFAULT | 0.5 | Sampling rate for all other traffic |

## Adding a new span

```js
const tracer = require("../config/tracing").getTracer("my-service");

async function doWork() {
  const span = tracer.startSpan("my_service.do_work");
  try {
    // ...
  } catch (err) {
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}
```

Always end spans in a `finally` block so an unexpected exception doesn't leave a
dangling, never-closed span.
