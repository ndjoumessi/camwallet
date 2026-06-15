// Load test — 100 VUs, 5 min, flux mixte (login + solde + P2P).
// Usage : k6 run load.js --env BASE_URL=http://localhost:3000
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration');
const balanceDuration = new Trend('balance_duration');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PHONE = __ENV.TEST_PHONE || '+237677000001';
const PIN = __ENV.TEST_PIN || '123456';

export const options = {
  stages: [
    { duration: '1m', target: 100 },   // montée
    { duration: '3m', target: 100 },   // plateau
    { duration: '1m', target: 0 },     // descente
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.01'],
    login_duration: ['p(95)<600'],
    balance_duration: ['p(95)<300'],
  },
};

export default function () {
  let accessToken = '';

  group('login', () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/v1/auth/login`,
      JSON.stringify({ phone: PHONE, pin: PIN }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    loginDuration.add(Date.now() - start);
    const ok = check(res, {
      'login 200': (r) => r.status === 200,
      'token présent': (r) => !!JSON.parse(r.body || '{}').accessToken,
    });
    errorRate.add(!ok);
    if (ok) accessToken = JSON.parse(res.body).accessToken;
  });

  if (!accessToken) return;

  group('solde', () => {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/v1/wallets/balance`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    balanceDuration.add(Date.now() - start);
    const ok = check(res, { 'solde 200': (r) => r.status === 200 });
    errorRate.add(!ok);
  });

  group('historique', () => {
    const res = http.get(`${BASE_URL}/api/v1/transactions/history?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const ok = check(res, { 'historique 200': (r) => r.status === 200 });
    errorRate.add(!ok);
  });

  sleep(1);
}
