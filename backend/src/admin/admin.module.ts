import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { SseModule } from '../sse/sse.module';
import { KycModule } from '../kyc/kyc.module';
import { SupportController } from '../support/support.controller';
import { SupportService } from '../support/support.service';

@Module({
  imports: [AuthModule, SseModule, KycModule],
  controllers: [AdminController, SupportController],
  providers: [AdminService, SupportService],
})
export class AdminModule {}
