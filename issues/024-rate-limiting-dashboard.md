# Issue #24 — Rate Limiting Dashboard and Analytics

**Labels:** `backend` `feature` `rate-limiting` `monitoring`

## Summary
Build a rate limiting dashboard that visualises rate limit usage, blocked requests, and allows dynamic rate limit configuration through an admin interface.

## Background
The backend has rate limiting middleware (`backend/src/middleware/rateLimit.js` and `rateLimitMetrics.js`) that applies different limits per route. The `rateLimitStats.js` route exposes some stats. Redis is available via `docker-compose.yml`. However, there's no visual dashboard, no historical data, and rate limits are hardcoded.

## Problem Statement
Operators cannot visualise rate limit usage patterns, identify abusive clients, or adjust rate limits dynamically. Hardcoded limits require redeployment to change.

## Objectives
1. Build a rate limiting analytics dashboard.
2. Add dynamic rate limit configuration via admin API.
3. Implement rate limit violation alerts.
4. Add historical rate limit data storage.
5. Write tests.

## Scope
- **In scope:** dashboard, dynamic config, alerts, historical data.
- **Out of scope:** distributed rate limiting across regions, WAF integration.

## Detailed Implementation Requirements

1. **Historical data storage:** Create `backend/migrations/022_rate_limit_events.js`:
   ```sql
   CREATE TABLE rate_limit_events (
     id SERIAL PRIMARY KEY,
     public_key VARCHAR(56),
     ip_address INET NOT NULL,
     route VARCHAR(128) NOT NULL,
     method VARCHAR(8) NOT NULL,
     blocked BOOLEAN DEFAULT FALSE,
     current_count INTEGER,
     max_count INTEGER,
     window_start TIMESTAMPTZ,
     occurred_at TIMESTAMPTZ DEFAULT NOW()
   );
   CREATE INDEX idx_rle_ip ON rate_limit_events(ip_address);
   CREATE INDEX idx_rle_route ON rate_limit_events(route);
   CREATE INDEX idx_rle_occurred ON rate_limit_events(occurred_at);
   ```

2. **Enhanced metrics:** Update `rateLimitMetrics.js` to record events to the database:
   - Record every rate limit block with metadata (route, IP, current count, limit).
   - Sample successful requests (1 in 10 sampling to reduce storage).
   - Expose Prometheus metrics: `rate_limit_blocks_total`, `rate_limit_requests_total`.

3. **Dynamic configuration:** Create `backend/src/services/rateLimitConfigService.js`:
   - Store rate limit rules in PostgreSQL: `{ route, method, limit, windowMs, enabled }`.
   - Default rules from current hardcoded values.
   - `GET /api/admin/rate-limits` — list current rules.
   - `PUT /api/admin/rate-limits` — update rules (admin-only, with audit log).
   - `POST /api/admin/rate-limits/test` — simulate a request to preview if it would be blocked.
   - Rules take effect immediately (no restart needed).

4. **Analytics dashboard:** Create `frontend/pages/admin/rate-limiting.tsx`:
   - Overview: requests/min, blocks/min, top blocked IPs, top blocked routes.
   - Time series chart: requests vs blocks over time (last 1h, 24h, 7d).
   - Top offenders table: IP, request count, block count, last blocked.
   - Rate limit rules editor: table with route/method/limit/window/enabled toggle.
   - "Test Rule" button to simulate.

5. **Alerts:** Create `backend/src/services/rateLimitAlertService.js`:
   - Alert when blocks/min exceeds threshold (configurable: `RL_ALERT_THRESHOLD`).
   - Alert channels: webhook (to configured URL), email to admin.
   - Cooldown: minimum 5 minutes between same-type alerts.

6. **Frontend navigation:** Add admin-only link in navbar (based on public key) to access admin pages.

7. **Tests:** Test dynamic config update, event recording, alert triggering, dashboard rendering.

## Expected Architecture

```
backend/
├── migrations/
│   └── 022_rate_limit_events.js  (NEW)
├── src/services/
│   ├── rateLimitConfigService.js (NEW)
│   └── rateLimitAlertService.js  (NEW)
├── src/middleware/
│   ├── rateLimit.js              (UPDATE: dynamic config lookup)
│   └── rateLimitMetrics.js       (UPDATE: DB recording)
├── src/routes/
│   └── adminRateLimits.js        (NEW)
└── __tests__/
    ├── rateLimitMetrics.test.js  (UPDATE)
    └── rateLimitConfig.test.js   (NEW)

frontend/
├── pages/
│   └── admin/
│       └── rate-limiting.tsx     (NEW)
└── components/
    └── admin/
        └── RateLimitRuleEditor.tsx (NEW)
```

## Acceptance Criteria
- [ ] Rate limit blocks are recorded in PostgreSQL with full metadata.
- [ ] Dynamic configuration allows updating rules without restart.
- [ ] Admin dashboard shows real-time and historical rate limit data.
- [ ] Top offenders view identifies abusive IPs and public keys.
- [ ] Alerts fire when block rate exceeds threshold.
- [ ] All existing tests pass.
