import { Module } from '@nestjs/common';
import { MerchantController } from './merchant.controller';
import { MerchantService } from './merchant.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MerchantController],
  providers: [MerchantService],
})
export class MerchantModule {}
