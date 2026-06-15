import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthModule } from '../auth/auth.module';

// Global : injectable dans transactions / webhooks sans import explicite.
@Global()
@Module({
  imports: [AuthModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
