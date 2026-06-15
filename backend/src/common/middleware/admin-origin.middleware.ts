import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AdminOriginMiddleware implements NestMiddleware {
  private readonly allowedOrigins: Set<string> | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('ADMIN_ALLOWED_ORIGINS');
    if (!raw || raw.trim() === '') {
      this.allowedOrigins = null;
    } else {
      this.allowedOrigins = new Set(
        raw.split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean),
      );
    }
  }

  use(req: Request, _res: Response, next: NextFunction) {
    if (!this.allowedOrigins) { next(); return; }

    const origin = req.headers['origin'];
    // Pas d'Origin = requête serveur-à-serveur, scripts, Swagger → autoriser
    if (!origin) { next(); return; }

    if (!this.allowedOrigins.has(origin)) {
      throw new ForbiddenException(`Origine non autorisée`);
    }
    next();
  }
}
