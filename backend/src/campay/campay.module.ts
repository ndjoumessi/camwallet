import { Module } from '@nestjs/common';
import { CamPayService } from './campay.service';

@Module({
  providers: [CamPayService],
  exports: [CamPayService],
})
export class CamPayModule {}
