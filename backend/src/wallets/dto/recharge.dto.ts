import { IsInt, IsPositive, IsEnum, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MobileOperator } from '@prisma/client';

export class RechargeDto {
  @ApiProperty({ example: 1000000, description: 'Montant en centimes FCFA (10 000 FCFA)' })
  @IsInt()
  @IsPositive()
  amount: number;

  @ApiProperty({ enum: MobileOperator, example: MobileOperator.MTN_MOMO })
  @IsEnum(MobileOperator)
  operator: MobileOperator;

  @ApiProperty({ example: '+237677123456', required: false, description: 'Numéro mobile money débité' })
  @IsOptional()
  @IsString()
  phone?: string;
}
