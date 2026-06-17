import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// Ping périodique pour garder le service « chaud » : toutes les 5 minutes on
// exécute un SELECT 1 qui maintient le pool de connexions Prisma et le pooler
// PgBouncer (Supabase) actifs, évitant le coût de reconnexion sur la première
// requête après une période d'inactivité.
//
// NB : ceci ne réveille PAS un conteneur Railway réellement mis en veille — un
// cron interne ne s'exécute pas pendant la veille. Pour empêcher la veille, un
// moniteur EXTERNE (UptimeRobot / cron-job.org) doit appeler GET /api/v1/health
// toutes les ~5 min. Ce service complète cette approche côté connexions DB.
@Injectable()
export class KeepWarmService {
  private readonly logger = new Logger(KeepWarmService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'keep-warm' })
  async ping() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      this.logger.debug('Keep-warm ping OK (SELECT 1)');
    } catch (err: any) {
      this.logger.warn(`Keep-warm ping échoué : ${err?.message ?? err}`);
    }
  }
}
