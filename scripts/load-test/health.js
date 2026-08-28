import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '2m', target: 200 },
    { duration: '2m', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:4000';

export default function () {
  const endpoints = ['/health', '/api/health'];
  for (const path of endpoints) {
    const res = http.get(`${BASE}${path}`);
    check(res, {
      'status is 200': (r) => r.status === 200,
      'json status ok': (r) => r.json('status') === 'ok',
    });
  }
  sleep(1);
}