// Stress test — 500 VUs, 10 min, simulation pic de charge.
// Usage : k6 run stress.js --env BASE_URL=http://localhost:3000
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '2m', target: 500 },
    { duration: '2m', target: 500 },   // plateau max
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // seuil élargi sous stress
    errors: ['rate<0.05'],
  },
};

export default function () {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ phone: '+237677000001', pin: '123456' }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '10s' },
  );
  const ok = check(res, {
    'répond sans timeout': (r) => r.status !== 0,
    'pas de 5xx': (r) => r.status < 500,
  });
  errorRate.add(!ok);

  sleep(0.5);
}
