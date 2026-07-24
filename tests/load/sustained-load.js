/**
 * tests/load/sustained-load.js
 * k6 load test — Sustained ramp from 1 → 500 users over 10 minutes (#98)
 *
 * Models the full traffic lifecycle:
 *   - Cold start (1 VU) → baseline measurement
 *   - Linear ramp to 500 VUs over 10 minutes
 *   - Sustained peak for 2 minutes
 *   - Graceful ramp-down
 *
 * Mixes all endpoint categories to represent real production traffic shape:
 *   50% dashboard reads, 30% analytics queries, 20% write operations
 *
 * Run:
 *   k6 run tests/load/sustained-load.js
 *   k6 run --out json=k6-results/sustained-load.json tests/load/sustained-load.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── Custom metrics ──────────────────────────────────────────────────────────

const serverErrorRate = new Rate('sustained_server_errors');
const p95Trend        = new Trend('sustained_p95_tracker_ms', true);
const requestCounter  = new Counter('sustained_total_requests');

// ─── Options ─────────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '30s', target: 1   },  // baseline: 1 user
    { duration: '10m', target: 500 },  // linear ramp to 500 users over 10 min
    { duration: '2m',  target: 500 },  // sustain peak load
    { duration: '1m',  target: 0   },  // graceful ramp-down
  ],
  thresholds: {
    http_req_duration:        ['p(50)<200', 'p(95)<1000', 'p(99)<3000'],
    http_req_failed:          ['rate<0.05'],  // slightly relaxed at 500 VUs — rate limiting expected
    sustained_server_errors:  ['rate<0.01'],  // 5xx must stay under 1%
    sustained_p95_tracker_ms: ['p(95)<1000'],
  },
};

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE            = __ENV.BASE_URL        || 'http://localhost:4000';
const TEST_PUBLIC_KEY = __ENV.TEST_PUBLIC_KEY || 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJLVXKJ46ZGFWTTNQNXNHTJXW';
const AUTH_HEADER     = { Authorization: 'Bearer loadtest-placeholder-token' };
const JSON_HEADERS    = {
  Authorization:   'Bearer loadtest-placeholder-token',
  'Content-Type':  'application/json',
};

// ─── Traffic distribution helpers ────────────────────────────────────────────

function dashboardRead() {
  const endpoints = [
    `${BASE}/api/health`,
    `${BASE}/api/features`,
    `${BASE}/api/accounts/${TEST_PUBLIC_KEY}`,
    `${BASE}/api/payments/${TEST_PUBLIC_KEY}?limit=10`,
    `${BASE}/api/payments/${TEST_PUBLIC_KEY}/stats`,
  ];
  const url = endpoints[Math.floor(Math.random() * endpoints.length)];
  const useAuth = url.includes('/api/accounts') || url.includes('/api/payments');
  return http.get(url, useAuth ? { headers: AUTH_HEADER } : {});
}

function analyticsRead() {
  const endpoints = [
    `${BASE}/api/analytics/${TEST_PUBLIC_KEY}/summary`,
    `${BASE}/api/analytics/${TEST_PUBLIC_KEY}/top-recipients`,
    `${BASE}/api/analytics/${TEST_PUBLIC_KEY}/activity`,
    `${BASE}/api/analytics/${TEST_PUBLIC_KEY}/timeseries`,
  ];
  const url = endpoints[Math.floor(Math.random() * endpoints.length)];
  return http.get(url, { headers: AUTH_HEADER });
}

function writeOperation() {
  // POST with intentionally invalid payloads — we measure middleware overhead.
  // The server should return 400/401/422, not 500.
  const writes = [
    () => http.get(`${BASE}/api/auth?account=${TEST_PUBLIC_KEY}`),
    () => http.post(`${BASE}/api/payments`, JSON.stringify({
      destination: 'GBXXXXINVALIDXXX',
      amount:      '10',
      asset:       'XLM',
    }), { headers: JSON_HEADERS }),
    () => http.post(`${BASE}/api/scheduled-transactions`, JSON.stringify({
      destination:   'GBXXXXINVALIDXXX',
      amount:        '1',
      asset:         'XLM',
      frequency:     'weekly',
      nextExecution: new Date(Date.now() + 86400000).toISOString(),
    }), { headers: JSON_HEADERS }),
  ];
  return writes[Math.floor(Math.random() * writes.length)]();
}

// ─── Default function — one virtual user's mixed activity ────────────────────

export default function () {
  const roll = Math.random();

  let res;

  if (roll < 0.50) {
    // 50% — dashboard read
    group('dashboard_read', () => {
      res = dashboardRead();
      check(res, {
        'dashboard not 5xx': (r) => r.status < 500,
        'dashboard ok':      (r) => [200, 401, 404, 429].includes(r.status),
      });
    });
  } else if (roll < 0.80) {
    // 30% — analytics query
    group('analytics_query', () => {
      res = analyticsRead();
      check(res, {
        'analytics not 5xx': (r) => r.status < 500,
      });
    });
  } else {
    // 20% — write attempt
    group('write_operation', () => {
      res = writeOperation();
      check(res, {
        'write not 5xx': (r) => r.status < 500,
      });
    });
  }

  if (res) {
    p95Trend.add(res.timings.duration);
    requestCounter.add(1);
    // Only count 5xx as server errors (429 rate-limiting is expected at scale)
    serverErrorRate.add(res.status >= 500);
  }

  // Variable think time — models realistic user pacing at scale
  sleep(0.5 + Math.random() * 1.5);
}
