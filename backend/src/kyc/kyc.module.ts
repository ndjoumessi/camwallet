import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycAiService } from './kyc-ai.service';

@Module({
  controllers: [KycController],
  providers: [KycService, KycAiService],
})
export class KycModule {}
