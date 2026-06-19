import { BadRequestException } from '@nestjs/common';
import { IdempotencyMiddleware } from './idempotency.middleware';

// Cache mémoire synchrone (Map) — get/set/del comme CacheService.
const makeCache = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    set: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    del: jest.fn(async (...ks: string[]) => { ks.forEach((k) => store.delete(k)); }),
  };
};

const makeRes = () => {
  const res: any = { statusCode: 200, _body: undefined };
  res.status = jest.fn((c: number) => { res.statusCode = c; return res; });
  res.json = jest.fn((b: any) => { res._body = b; return res; });
  res.setHeader = jest.fn();
  return res;
};
const makeReq = (key?: string, opts: { method?: string; url?: string } = {}) => ({
  method: opts.method ?? 'POST',
  originalUrl: opts.url ?? '/api/v1/transactions/p2p',
  url: opts.url ?? '/api/v1/transactions/p2p',
  header: (h: string) => (h === 'Idempotency-Key' ? key : undefined),
}) as any;

const KEY = 'a1b2c3d4-0000-4000-8000-abcdefabcdef';

describe('IdempotencyMiddleware', () => {
  it('exécute le handler à la 1ère requête puis rejoue la réponse mémorisée au doublon (1 seule exécution)', async () => {
    const cache = makeCache();
    const mw = new IdempotencyMiddleware(cache as any);

    // 1ère requête : next() appelé, le handler répond 201 {id:'tx1'}.
    const res1 = makeRes(); const next1 = jest.fn();
    await mw.use(makeReq(KEY), res1, next1);
    expect(next1).toHaveBeenCalledTimes(1);
    res1.status(201); res1.json({ id: 'tx1' }); // simule le handler (passe par res.json patché)

    // 2e requête, même clé : pas de next() (pas de ré-exécution), réponse rejouée.
    const res2 = makeRes(); const next2 = jest.fn();
    await mw.use(makeReq(KEY), res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.statusCode).toBe(201);
    expect(res2.json).toHaveBeenCalledWith({ id: 'tx1' });
    expect(res2.setHeader).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
  });

  it('laisse passer deux clés différentes (2 transactions)', async () => {
    const cache = makeCache();
    const mw = new IdempotencyMiddleware(cache as any);
    const n1 = jest.fn(); const n2 = jest.fn();
    await mw.use(makeReq('key-aaaa-0001'), makeRes(), n1);
    await mw.use(makeReq('key-bbbb-0002'), makeRes(), n2);
    expect(n1).toHaveBeenCalledTimes(1);
    expect(n2).toHaveBeenCalledTimes(1);
  });

  it('traite une clé expirée (absente du cache) comme une nouvelle transaction', async () => {
    const cache = makeCache();
    const mw = new IdempotencyMiddleware(cache as any);
    const res1 = makeRes();
    await mw.use(makeReq(KEY), res1, jest.fn());
    res1.status(200); res1.json({ id: 'tx1' });
    // Simule l'expiration TTL 24h.
    cache.store.delete(`idempotency:${KEY}`);
    const next = jest.fn();
    await mw.use(makeReq(KEY), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1); // ré-exécution autorisée
  });

  it('un échec (4xx/5xx) libère la clé pour permettre une nouvelle tentative', async () => {
    const cache = makeCache();
    const mw = new IdempotencyMiddleware(cache as any);
    const res1 = makeRes();
    await mw.use(makeReq(KEY), res1, jest.fn());
    res1.status(400); res1.json({ message: 'Solde insuffisant' }); // échec → clé libérée
    expect(cache.store.has(`idempotency:${KEY}`)).toBe(false);
    const next = jest.fn();
    await mw.use(makeReq(KEY), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('renvoie 409 si un doublon arrive pendant le traitement (pending)', async () => {
    const cache = makeCache();
    cache.store.set(`idempotency:${KEY}`, JSON.stringify({ status: 'pending', createdAt: Date.now() }));
    const mw = new IdempotencyMiddleware(cache as any);
    const res = makeRes(); const next = jest.fn();
    await mw.use(makeReq(KEY), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
  });

  it('laisse passer sans clé (rétrocompat) et rejette une clé invalide', async () => {
    const cache = makeCache();
    const mw = new IdempotencyMiddleware(cache as any);
    const next = jest.fn();
    await mw.use(makeReq(undefined), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    await expect(mw.use(makeReq('short'), makeRes(), jest.fn())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ignore les routes non financières même avec une clé (filtre interne)', async () => {
    const cache = makeCache();
    const mw = new IdempotencyMiddleware(cache as any);
    const next = jest.fn();
    // GET, ou POST hors liste financière → passe tout droit, aucun accès cache.
    await mw.use(makeReq(KEY, { method: 'GET', url: '/api/v1/wallets/balance' }), makeRes(), next);
    await mw.use(makeReq(KEY, { method: 'POST', url: '/api/v1/users/avatar' }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(cache.get).not.toHaveBeenCalled();
  });
});
