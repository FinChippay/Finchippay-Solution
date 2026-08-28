/**
 * tests/load/dashboard-traffic.js
 * k6 load test — Dashboard read traffic (#98)
 *
 * Simulates 100 concurrent users browsing the dashboard:
 *   - Balance / account info lookup
 *   - Payment history (most recent 20)
 *   - Payment stats
 *   - Analytics summary
 *   - Feature flags
 *   - Health check
 *
 * Acceptance criteria:
 *   p95 latency < 500ms under 100 concurrent users
 *   Error rate < 1%
 *
 * Run:
 *   k6 run tests/load/dashboard-traffic.js
 *   k6 run --out json=k6-results/dashboard-traffic.json tests/load/dashboard-traffic.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Custom metrics ──────────────────────────────────────────────────────────

const errorRate   = new Rate('dashboard_errors');
const balanceTrend = new Trend('balance_latency_ms', true);
const paymentsTrend = new Trend('payments_latency_ms', true);
const analyticsTrend = new Trend('analytics_latency_ms', true);

// ─── Options ─────────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // ramp up to 20 users
    { duration: '1m',  target: 100 },  // ramp up to 100 users
    { duration: '3m',  target: 100 },  // sustain 100 users (acceptance criteria window)
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    // Acceptance criteria: p95 < 500ms under 100 concurrent dashboard users
    http_req_duration:         ['p(95)<500', 'p(99)<1000'],
    http_req_failed:           ['rate<0.01'],   // < 1% error rate
    dashboard_errors:          ['rate<0.01'],
    balance_latency_ms:        ['p(95)<500'],
    payments_latency_ms:       ['p(95)<500'],
    analytics_latency_ms:      ['p(95)<500'],
  },
};

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE           = __ENV.BASE_URL        || 'http://localhost:4000';
const TEST_PUBLIC_KEY = __ENV.TEST_PUBLIC_KEY || 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJLVXKJ46ZGFWTTNQNXNHTJXW';
const AUTH_HEADER    = { Authorization: 'Bearer loadtest-placeholder-token' };
const JSON_HEADER    = { 'Content-Type': 'application/json' };

// ─── Default function — one virtual user's dashboard session ─────────────────

export default function () {

  // 1. Health check (liveness probe — always the first call)
  group('health', () => {
    const res = http.get(`${BASE}/api/health`);
    check(res, { 'health 200': (r) => r.status === 200 });
    errorRate.add(res.status >= 500);
  });

  // 2. Feature flags (fetched on every app load)
  group('features', () => {
    const res = http.get(`${BASE}/api/features`);
    check(res, {
      'features 200':            (r) => r.status === 200,
      'features has success key': (r) => r.json('success') === true,
    });
    errorRate.add(res.status >= 500);
  });

  // 3. Account balance (most read-heavy dashboard card)
  group('balance', () => {
    const res = http.get(
      `${BASE}/api/accounts/${TEST_PUBLIC_KEY}`,
      { headers: AUTH_HEADER }
    );
    check(res, {
      'account 200 or 401': (r) => r.status === 200 || r.status === 401,
    });
    balanceTrend.add(res.timings.duration);
    errorRate.add(res.status >= 500);
  });

  // 4. Payment history (transaction list widget)
  group('payments', () => {
    const res = http.get(
      `${BASE}/api/payments/${TEST_PUBLIC_KEY}?limit=20`,
      { headers: AUTH_HEADER }
    );
    check(res, {
      'payments 200 or 401': (r) => r.status === 200 || r.status === 401,
    });
    paymentsTrend.add(res.timings.duration);
    errorRate.add(res.status >= 500);
  });

  // 5. Payment stats (summary stats cards)
  group('payment_stats', () => {
    const res = http.get(
      `${BASE}/api/payments/${TEST_PUBLIC_KEY}/stats`,
      { headers: AUTH_HEADER }
    );
    check(res, {
      'payment stats 200 or 401': (r) => r.status === 200 || r.status === 401,
    });
    errorRate.add(res.status >= 500);
  });

  // 6. Analytics summary (charts section)
  group('analytics', () => {
    const res = http.get(
      `${BASE}/api/analytics/${TEST_PUBLIC_KEY}/summary`,
      { headers: AUTH_HEADER }
    );
    check(res, {
      'analytics 200 or 401': (r) => r.status === 200 || r.status === 401,
    });
    analyticsTrend.add(res.timings.duration);
    errorRate.add(res.status >= 500);
  });

  // Realistic user think time between dashboard renders (1–3 seconds)
  sleep(1 + Math.random() * 2);
}
