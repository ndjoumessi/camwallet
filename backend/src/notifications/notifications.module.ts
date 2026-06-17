import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SmsModule } from '../sms/sms.module';

// Global : injectable dans transactions / webhooks sans import explicite.
@Global()
@Module({
  imports: [SmsModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
