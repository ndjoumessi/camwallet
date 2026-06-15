import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const levels = (process.env.DATABASE_LOG_LEVEL ?? (process.env.NODE_ENV === 'development' ? 'query,info,warn,error' : 'error'))
      .split(',')
      .map(l => l.trim()) as ('query' | 'info' | 'warn' | 'error')[];
    super({ log: levels });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Base de données PostgreSQL connectée');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
