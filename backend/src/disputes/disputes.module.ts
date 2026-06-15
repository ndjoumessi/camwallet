import { Module } from '@nestjs/common';
import { DisputesController } from './disputes.controller';
import { TransactionsModule } from '../transactions/transactions.module';

@Module({
  imports: [TransactionsModule],
  controllers: [DisputesController],
})
export class DisputesModule {}
