import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '2m', target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const TEST_ACCOUNT = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890';

export default function () {
  // Challenge flow: GET returns a challenge transaction for an account
  const challengeRes = http.get(`${BASE}/api/auth?account=${TEST_ACCOUNT}`);
  check(challengeRes, {
    'auth challenge status 200': (r) => r.status === 200,
    'has transaction': (r) => r.json('transaction') !== undefined,
  });

  // Intentionally send invalid POST to keep tests safe/read-only
  const verifyRes = http.post(`${BASE}/api/auth`, JSON.stringify({ transaction: 'invalid' }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(verifyRes, {
    'auth verify handled': (r) => r.status === 400 || r.status === 401,
  });

  sleep(1);
}