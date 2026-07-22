/**
 * docs/logging.md
 * Structured logging and correlation ID propagation (#172).
 */

# Structured Logging & Correlation IDs

Finchippay uses **Pino** on the backend for structured JSON logs and
propagates **correlation IDs** across the browser, API, outbound HTTP,
Horizon/Soroban call sites, and Sentry.

## Identifiers

| ID | Header | Lifetime | Purpose |
|----|--------|----------|---------|
| **Request / action ID** | `X-Request-ID` | Single user action or inbound HTTP request | Join all log lines + Sentry events for one operation |
| **Session ID** | `X-Session-ID` | Browser tab (generated once in `frontend/lib/correlation.ts`) | Group multiple actions from the same session |

Both IDs are **UUID v4** strings (RFC 4122), e.g.
`550e8400-e29b-41d4-a716-446655440000`.

If a client sends `X-Request-ID`, the API **reuses** it. Otherwise the API
generates a new UUID and returns it on the response.

## Propagation path

```
Browser action
  └─ createActionId() + sessionId
       └─ fetch / SDK  →  X-Request-ID + X-Session-ID
            └─ backend requestIdMiddleware
                 ├─ req.id / req.log (Pino child)
                 ├─ AsyncLocalStorage (getRequestId)
                 ├─ response header X-Request-ID
                 ├─ Sentry tag correlationId
                 ├─ axios interceptor → outbound HTTP
                 └─ stellarService → logs requestId with each Horizon call
```

Horizon and Soroban public APIs do not reliably accept custom client headers
through `@stellar/stellar-sdk`. For those calls we **log** the correlation ID
alongside the operation (backend: `stellarService.withTracedSpan`; frontend:
`logRpcCorrelation` in `lib/correlation.ts`).

## Backend

| Piece | Path |
|-------|------|
| Request ID middleware | `backend/src/middleware/requestId.js` |
| ALS helpers | `backend/src/utils/correlationId.js` |
| Shared logger (+ mixin) | `backend/src/utils/logger.js` |
| Horizon correlation logs | `backend/src/services/stellarService.js` |
| Outbound axios headers | `backend/src/config/axiosInterceptors.js` |

### Using the request logger in route handlers

```js
router.get("/example", (req, res) => {
  req.log.info({ foo: 1 }, "handling example");
  res.json({ ok: true });
});
```

Root `logger.info(...)` calls also include `requestId` automatically via the
Pino mixin while inside a request context.

### Response headers

Every response includes `X-Request-ID`. When the client sent `X-Session-ID`,
it is echoed back as well. CORS exposes both headers to the browser.

## Frontend

| Piece | Path |
|-------|------|
| Correlation helpers + fetch wrapper | `frontend/lib/correlation.ts` |
| Global fetch install | `frontend/pages/_app.tsx` → `installCorrelationFetch()` |
| Sentry tags | `frontend/sentry.client.config.ts`, `sentry.server.config.ts` |

```ts
import {
  createActionId,
  getSessionId,
  logRpcCorrelation,
} from "@/lib/correlation";

// Manual action boundary (optional — fetch wrapper already creates IDs)
const actionId = createActionId();

// When calling Horizon / Soroban via the Stellar SDK:
logRpcCorrelation("soroban", "simulateTransaction", { contractId });
```

## Sentry

- **Backend:** `correlationId` tag/extra set in `beforeSend` and on the
  request scope inside `requestIdMiddleware`.
- **Frontend:** `correlationId` + `sessionId` tags set in Sentry
  `beforeSend` hooks.

Search Sentry by tag `correlationId:<uuid>` then grep the same UUID in
application logs.

## Example log line

```json
{
  "level": "INFO",
  "time": "2026-07-22T17:00:00.000Z",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "sessionId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "horizonOperation": "loadAccount",
  "msg": "Horizon API call"
}
```

## Out of scope

Log aggregation platforms (ELK, Loki, Datadog pipelines) and retention
policies are intentionally out of scope for #172.
