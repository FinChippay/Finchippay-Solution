/**
 * tests/load/payment-burst.js
 * k6 load test — Payment write burst (#98)
 *
 * Simulates 50 concurrent users submitting payments in a burst:
 *   - Auth challenge fetch (SEP-0010)
 *   - Payment submission (POST /api/payments — expects 400/401/422 in test env)
 *   - Batch payment attempt
 *   - Scheduled transaction creation
 *   - Receipt minting
 *
 * Acceptance criteria:
 *   p95 latency < 2000ms under 50 concurrent payment submissions
 *   Error rate < 1% (5xx only — 4xx are expected for invalid test payloads)
 *
 * Run:
 *   k6 run tests/load/payment-burst.js
 *   k6 run --out json=k6-results/payment-burst.json tests/load/payment-burst.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Custom metrics ──────────────────────────────────────────────────────────

const serverErrorRate  = new Rate('payment_server_errors');
const authTrend        = new Trend('auth_challenge_latency_ms', true);
const paymentTrend     = new Trend('payment_submit_latency_ms', true);

// ─── Options ─────────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '15s', target: 10 },   // warm-up
    { duration: '30s', target: 50 },   // ramp to burst level
    { duration: '2m',  target: 50 },   // sustain burst (acceptance criteria window)
    { duration: '15s', target: 0 },    // ramp down
  ],
  thresholds: {
    // Acceptance criteria: p95 < 2s for payment submissions under 50 VUs
    http_req_duration:    ['p(95)<2000', 'p(99)<3000'],
    http_req_failed:      ['rate<0.01'],
    payment_server_errors: ['rate<0.01'],
    auth_challenge_latency_ms:  ['p(95)<500'],
    payment_submit_latency_ms:  ['p(95)<2000'],
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

// Minimal invalid-but-structurally-valid payloads — the server should return
// 400/401/422, not 500. We measure middleware + handler latency, not business
// logic success.
const PAYMENT_BODY = JSON.stringify({
  destination: 'GBXXXXINVALIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  amount:      '10',
  asset:       'XLM',
  memo:        'load-test',
});

const BATCH_BODY = JSON.stringify({
  destinations: [
    { address: 'GBXXXXINVALIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', amount: '5' },
    { address: 'GCYYYYINVALIDYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY', amount: '5' },
  ],
  asset: 'XLM',
});

const SCHEDULED_BODY = JSON.stringify({
  destination:   'GBXXXXINVALIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  amount:        '1',
  asset:         'XLM',
  frequency:     'weekly',
  nextExecution: new Date(Date.now() + 86400000).toISOString(),
});

// ─── Default function — one virtual user's payment burst cycle ───────────────

export default function () {

  // 1. Fetch auth challenge (happens before every payment)
  group('auth_challenge', () => {
    const res = http.get(`${BASE}/api/auth?account=${TEST_PUBLIC_KEY}`);
    check(res, {
      'auth challenge 200': (r) => r.status === 200,
      'has transaction':    (r) => r.json('transaction') !== undefined,
    });
    authTrend.add(res.timings.duration);
    serverErrorRate.add(res.status >= 500);
  });

  // 2. Single payment submit (will be rejected — measures handler overhead)
  group('payment_submit', () => {
    const res = http.post(
      `${BASE}/api/payments`,
      PAYMENT_BODY,
      { headers: JSON_HEADERS }
    );
    check(res, {
      'payment not 5xx': (r) => r.status < 500,
      'payment rejected cleanly': (r) => [400, 401, 422].includes(r.status),
    });
    paymentTrend.add(res.timings.duration);
    serverErrorRate.add(res.status >= 500);
  });

  // 3. Batch payment attempt (measures batch handler overhead)
  group('batch_payment', () => {
    const res = http.post(
      `${BASE}/api/payments/batch`,
      BATCH_BODY,
      { headers: JSON_HEADERS }
    );
    check(res, {
      'batch not 5xx': (r) => r.status < 500,
    });
    serverErrorRate.add(res.status >= 500);
  });

  // 4. Scheduled transaction create (measures scheduling handler overhead)
  group('scheduled_transaction', () => {
    const res = http.post(
      `${BASE}/api/scheduled-transactions`,
      SCHEDULED_BODY,
      { headers: JSON_HEADERS }
    );
    check(res, {
      'scheduled not 5xx': (r) => r.status < 500,
    });
    serverErrorRate.add(res.status >= 500);
  });

  // Short think time between burst cycles (users submit then check result)
  sleep(0.5 + Math.random());
}
