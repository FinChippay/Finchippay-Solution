import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const TEST_USERNAME = 'loadtest_user_1';
const TEST_PUBLIC_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890';

export default function () {
  // Public endpoint: resolve username
  const resolveRes = http.get(`${BASE}/api/accounts/resolve/${TEST_USERNAME}`);
  check(resolveRes, {
    'resolve status 200 or 404': (r) => r.status === 200 || r.status === 404,
  });

  // Protected endpoints with a placeholder JWT to measure auth middleware overhead
  const authHeader = 'Bearer loadtest-placeholder-token';
  const authHeaders = { Authorization: authHeader };

  const accountRes = http.get(`${BASE}/api/accounts/${TEST_PUBLIC_KEY}`, { headers: authHeaders });
  check(accountRes, {
    'account status 401 or 200': (r) => r.status === 401 || r.status === 200,
  });

  const balanceRes = http.get(`${BASE}/api/accounts/${TEST_PUBLIC_KEY}/balance`, { headers: authHeaders });
  check(balanceRes, {
    'balance status 401 or 200': (r) => r.status === 401 || r.status === 200,
  });

  sleep(1);
}