import { Module } from '@nestjs/common';
import { AlertEmailService } from './alert-email.service';

// PrismaModule et ConfigModule sont globaux : aucun import nécessaire ici.
@Module({
  providers: [AlertEmailService],
  exports: [AlertEmailService],
})
export class AlertsModule {}
