import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { KeepWarmService } from './keep-warm.service';

@Module({
  controllers: [HealthController],
  providers: [KeepWarmService],
})
export class HealthModule {}
