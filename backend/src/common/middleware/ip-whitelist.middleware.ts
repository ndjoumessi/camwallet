import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

// IPv4-mapped IPv6 : ::ffff:192.168.1.1 → 192.168.1.1
function normalizeIp(raw: string): string {
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

@Injectable()
export class IpWhitelistMiddleware implements NestMiddleware {
  private readonly allowedIps: Set<string> | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('ADMIN_IP_WHITELIST');
    if (!raw || raw.trim() === '') {
      this.allowedIps = null; // Pas de restriction (développement)
    } else {
      this.allowedIps = new Set(raw.split(',').map(ip => ip.trim()).filter(Boolean));
    }
  }

  use(req: Request, _res: Response, next: NextFunction) {
    if (!this.allowedIps) { next(); return; }

    // req.ip est calculé par Express en tenant compte du réglage trust proxy
    // (configuré dans main.ts via TRUST_PROXY). Quand trust proxy est désactivé
    // (défaut), req.ip = req.socket.remoteAddress — le client ne peut pas le
    // falsifier. On ne lit jamais X-Forwarded-For directement.
    const raw = req.ip ?? req.socket.remoteAddress ?? '';
    const ip = normalizeIp(raw);

    if (!this.allowedIps.has(ip)) {
      throw new ForbiddenException(`Accès refusé`);
    }
    next();
  }
}
