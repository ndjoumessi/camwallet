// Spike test — montée brutale 0 → 500 VUs en 30s, redescente rapide.
// Usage : k6 run spike.js --env BASE_URL=http://localhost:3000
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  stages: [
    { duration: '30s', target: 500 },  // pic brutal
    { duration: '1m', target: 500 },   // maintien
    { duration: '30s', target: 0 },    // retour
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    errors: ['rate<0.1'],
  },
};

export default function () {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ phone: '+237677000001', pin: '123456' }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '15s' },
  );
  const ok = check(res, {
    'répond': (r) => r.status !== 0,
    'pas de 5xx': (r) => r.status < 500,
  });
  errorRate.add(!ok);

  sleep(0.2);
}
