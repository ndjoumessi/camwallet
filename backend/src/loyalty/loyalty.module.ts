import { Global, Module } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';

// Global : LoyaltyService injectable dans transactions/webhooks/kyc/admin pour
// l'attribution de points (fire-and-forget) sans réimport.
@Global()
@Module({
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
