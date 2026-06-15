import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

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
    if (!this.allowedIps) { next(); return; } // Aucune restriction configurée
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress
      ?? '';
    if (!this.allowedIps.has(ip)) {
      throw new ForbiddenException(`Accès refusé depuis ${ip}`);
    }
    next();
  }
}
