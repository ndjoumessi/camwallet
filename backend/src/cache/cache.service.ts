import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Cache applicatif clé→valeur avec TTL. Backend Redis si REDIS_URL est défini,
// sinon repli automatique sur un cache en mémoire (process local). Toutes les
// opérations Redis sont tolérantes aux pannes : en cas d'erreur réseau, on bascule
// silencieusement sur la mémoire pour ne jamais casser une requête métier.
//
// NB : on sérialise en JSON. Le `BigInt.prototype.toJSON` global (main.ts) convertit
// les BigInt en Number — cohérent avec la sérialisation des réponses HTTP, donc les
// valeurs lues du cache ont la même forme que la réponse directe.
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;
  private readonly mem = new Map<string, { value: string; expiresAt: number }>();

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    const placeholder = (v?: string) => !v || /^(your_|changeme|placeholder|redis:\/\/host)/i.test(v);
    if (!placeholder(url)) {
      try {
        this.redis = new Redis(url as string, {
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
          lazyConnect: false,
        });
        this.redis.on('error', (e) =>
          this.logger.warn(`Redis indisponible (repli mémoire) : ${e.message}`),
        );
        this.logger.log('Cache Redis activé');
      } catch (e) {
        this.logger.warn(
          `Init Redis échouée — repli cache mémoire : ${e instanceof Error ? e.message : String(e)}`,
        );
        this.redis = null;
      }
    } else {
      this.logger.log('REDIS_URL absent — cache en mémoire (process local)');
    }
  }

  async onModuleDestroy() {
    try {
      await this.redis?.quit();
    } catch {
      /* ignore */
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.redis) {
      try {
        return await this.redis.get(key);
      } catch {
        /* bascule mémoire */
      }
    }
    const e = this.mem.get(key);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      this.mem.delete(key);
      return null;
    }
    return e.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.set(key, value, 'EX', ttlSeconds);
        return;
      } catch {
        /* bascule mémoire */
      }
    }
    this.mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    if (this.redis) {
      try {
        await this.redis.del(...keys);
      } catch {
        /* bascule mémoire */
      }
    }
    keys.forEach((k) => this.mem.delete(k));
  }

  // Lit la valeur en cache (clé) ou exécute `fn`, met en cache le résultat (TTL) et
  // le renvoie. Une valeur corrompue est ignorée (recalcul). Un échec du cache ne
  // doit jamais empêcher le calcul de la valeur fraîche.
  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get(key).catch(() => null);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        /* valeur corrompue → recalcul */
      }
    }
    const fresh = await fn();
    await this.set(key, JSON.stringify(fresh), ttlSeconds).catch(() => undefined);
    return fresh;
  }
}

// Constantes de clés/TTL centralisées (évite les fautes de frappe et documente le
// plan de cache).
export const CacheKeys = {
  walletBalance: (userId: string) => `wallet:balance:${userId}`,
  userMe: (userId: string) => `user:me:${userId}`,
  adminStats: 'admin:stats',
  adminHealthIntegrations: 'admin:health:integrations',
};
export const CacheTtl = {
  walletBalance: 30,
  userMe: 300,
  adminStats: 60,
  adminHealthIntegrations: 30,
};
