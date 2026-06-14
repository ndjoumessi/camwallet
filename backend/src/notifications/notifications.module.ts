import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

// Global : injectable dans transactions / webhooks sans import explicite.
@Global()
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
