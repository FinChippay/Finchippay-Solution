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
const TEST_PUBLIC_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890';

export default function () {
  const authHeader = 'Bearer loadtest-placeholder-token';
  const headers = { Authorization: authHeader };

  const paymentsRes = http.get(`${BASE}/api/payments/${TEST_PUBLIC_KEY}?limit=20`, { headers });
  check(paymentsRes, {
    'payments status 401 or 200': (r) => r.status === 401 || r.status === 200,
  });

  const statsRes = http.get(`${BASE}/api/payments/${TEST_PUBLIC_KEY}/stats`, { headers });
  check(statsRes, {
    'payments stats status 401 or 200': (r) => r.status === 401 || r.status === 200,
  });

  sleep(1);
}