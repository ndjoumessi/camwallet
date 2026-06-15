// Smoke test — 5 VUs, 1 min, vérification des endpoints critiques.
// Usage : k6 run smoke.js --env BASE_URL=http://localhost:3000
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  vus: 5,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.01'],
  },
};

export default function () {
  // Health check / Swagger available
  const health = http.get(`${BASE_URL}/api/v1/auth/login`, {
    headers: { 'Content-Type': 'application/json' },
    timeout: '5s',
  });
  // 401 attendu (pas de body) — sert à vérifier que le serveur répond
  const ok = check(health, { 'serveur répond': (r) => r.status !== 0 });
  errorRate.add(!ok);

  // Test connexion avec identifiants valides
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ phone: '+237677000001', pin: '123456' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const loginOk = check(loginRes, {
    'login 200': (r) => r.status === 200,
    'accessToken présent': (r) => !!JSON.parse(r.body).accessToken,
  });
  errorRate.add(!loginOk);

  sleep(1);
}
