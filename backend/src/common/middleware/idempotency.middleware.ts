import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CacheService } from '../../cache/cache.service';

// Idempotence des écritures financières : un client peut renvoyer la même requête
// (retry réseau) sans risque de double exécution. Le client fournit un en-tête
// `Idempotency-Key` (UUID) ; on mémorise la réponse dans le cache (Redis en prod,
// partagé entre instances) et on la rejoue à l'identique sur un doublon.
//
// Pas d'en-tête → flux normal (rétrocompat). Échec (4xx/5xx) → la clé est libérée
// pour autoriser une vraie nouvelle tentative.
const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;
const TTL_DONE_S = 24 * 3600; // réponse mémorisée 24h
const TTL_PENDING_S = 90; // verrou court (anti-blocage si le process meurt en plein traitement)

interface IdemRecord {
  status: 'pending' | 'done';
  httpStatus?: number;
  body?: unknown;
  createdAt: number;
}

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  constructor(private readonly cache: CacheService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const key = req.header('Idempotency-Key');
    if (!key) return next(); // rétrocompat : aucune clé → exécution normale
    if (!KEY_RE.test(key)) throw new BadRequestException('Idempotency-Key invalide');

    const cacheKey = `idempotency:${key}`;
    const existingRaw = await this.cache.get(cacheKey).catch(() => null);
    if (existingRaw) {
      let rec: IdemRecord | null = null;
      try {
        rec = JSON.parse(existingRaw);
      } catch {
        rec = null;
      }
      if (rec?.status === 'done') {
        // Rejoue la réponse mémorisée → aucune ré-exécution de la transaction.
        res.setHeader('Idempotent-Replayed', 'true');
        res.status(rec.httpStatus ?? 200).json(rec.body);
        return;
      }
      if (rec?.status === 'pending') {
        // Doublon concurrent encore en cours de traitement.
        res.status(409).json({ statusCode: 409, message: 'Requête déjà en cours de traitement (idempotency)' });
        return;
      }
    }

    // Pose un verrou « pending », puis capture la réponse du handler via res.json.
    await this.cache
      .set(cacheKey, JSON.stringify({ status: 'pending', createdAt: Date.now() }), TTL_PENDING_S)
      .catch(() => undefined);

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      const httpStatus = res.statusCode;
      if (httpStatus >= 200 && httpStatus < 300) {
        // Succès → mémorise la réponse pour rejouer un éventuel retry (24h).
        void this.cache.set(
          cacheKey,
          JSON.stringify({ status: 'done', httpStatus, body, createdAt: Date.now() }),
          TTL_DONE_S,
        );
      } else {
        // Échec (validation, solde insuffisant, 5xx…) → libère la clé : la
        // transaction n'a pas eu lieu, une nouvelle tentative doit pouvoir réussir.
        void this.cache.del(cacheKey);
      }
      return originalJson(body);
    };
    next();
  }
}
