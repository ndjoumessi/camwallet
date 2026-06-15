import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { WithdrawalsExpiryService } from './withdrawals-expiry.service';
import { CamPayModule } from '../campay/campay.module';

@Module({
  imports: [CamPayModule],
  controllers: [WalletsController],
  providers: [WalletsService, WithdrawalsExpiryService],
  exports: [WalletsService],
})
export class WalletsModule {}
