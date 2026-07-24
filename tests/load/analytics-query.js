/**
 * tests/load/analytics-query.js
 * k6 load test — Heavy analytics query traffic (#98)
 *
 * Simulates read-heavy analytics usage:
 *   - Summary stats
 *   - Top recipients
 *   - Activity by day of week
 *   - 30-day timeseries volume
 *   - Feature flags (fetched alongside every analytics load)
 *
 * Designed to surface cache-miss storms, Horizon timeout cascades, and
 * DB/memory pressure under concurrent analytics readers.
 *
 * Run:
 *   k6 run tests/load/analytics-query.js
 *   k6 run --out json=k6-results/analytics-query.json tests/load/analytics-query.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── Custom metrics ──────────────────────────────────────────────────────────

const serverErrorRate  = new Rate('analytics_server_errors');
const cacheHitCounter  = new Counter('analytics_cache_hits');
const summaryTrend     = new Trend('analytics_summary_latency_ms', true);
const timeseriesTrend  = new Trend('analytics_timeseries_latency_ms', true);

// ─── Options ─────────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '30s', target: 25 },   // warm up — first wave primes the cache
    { duration: '1m',  target: 75 },   // mid-load
    { duration: '2m',  target: 75 },   // sustain
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration:           ['p(95)<500', 'p(99)<1000'],
    http_req_failed:             ['rate<0.01'],
    analytics_server_errors:     ['rate<0.01'],
    analytics_summary_latency_ms:    ['p(95)<500'],
    analytics_timeseries_latency_ms: ['p(95)<1000'],
  },
};

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE            = __ENV.BASE_URL        || 'http://localhost:4000';
const TEST_PUBLIC_KEY = __ENV.TEST_PUBLIC_KEY || 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJLVXKJ46ZGFWTTNQNXNHTJXW';
const AUTH_HEADER     = { Authorization: 'Bearer loadtest-placeholder-token' };

// ─── Default function — one virtual user's analytics session ─────────────────

export default function () {

  // 1. Analytics summary (the heaviest query — calls Horizon for 200 payments)
  group('analytics_summary', () => {
    const res = http.get(
      `${BASE}/api/analytics/${TEST_PUBLIC_KEY}/summary`,
      { headers: AUTH_HEADER }
    );
    check(res, {
      'summary 200 or 401': (r) => r.status === 200 || r.status === 401,
      'summary not 5xx':    (r) => r.status < 500,
    });
    summaryTrend.add(res.timings.duration);
    serverErrorRate.add(res.status >= 500);

    // Detect cache hit: cached responses are typically much faster.
    if (res.timings.duration < 50) cacheHitCounter.add(1);
  });

  // 2. Top recipients (secondary analytics view)
  group('top_recipients', () => {
    const res = http.get(
      `${BASE}/api/analytics/${TEST_PUBLIC_KEY}/top-recipients`,
      { headers: AUTH_HEADER }
    );
    check(res, {
      'top-recipients 200 or 401': (r) => r.status === 200 || r.status === 401,
      'top-recipients not 5xx':    (r) => r.status < 500,
    });
    serverErrorRate.add(res.status >= 500);
  });

  // 3. Activity by day of week (bar chart data)
  group('activity_by_day', () => {
    const res = http.get(
      `${BASE}/api/analytics/${TEST_PUBLIC_KEY}/activity`,
      { headers: AUTH_HEADER }
    );
    check(res, {
      'activity 200 or 401': (r) => r.status === 200 || r.status === 401,
      'activity not 5xx':    (r) => r.status < 500,
    });
    serverErrorRate.add(res.status >= 500);
  });

  // 4. Timeseries (30-day volume chart — most data-intensive)
  group('timeseries', () => {
    const res = http.get(
      `${BASE}/api/analytics/${TEST_PUBLIC_KEY}/timeseries`,
      { headers: AUTH_HEADER }
    );
    check(res, {
      'timeseries 200 or 401': (r) => r.status === 200 || r.status === 401,
      'timeseries not 5xx':    (r) => r.status < 500,
    });
    timeseriesTrend.add(res.timings.duration);
    serverErrorRate.add(res.status >= 500);
  });

  // 5. Feature flags (fetched alongside every page load)
  group('features', () => {
    const res = http.get(`${BASE}/api/features`);
    check(res, {
      'features 200': (r) => r.status === 200,
    });
    serverErrorRate.add(res.status >= 500);
  });

  // Analytics users browse slowly — simulate tab reading / chart rendering
  sleep(2 + Math.random() * 2);
}
