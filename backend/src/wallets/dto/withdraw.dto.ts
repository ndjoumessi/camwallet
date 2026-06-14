import { IsInt, IsPositive, IsEnum, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MobileOperator } from '@prisma/client';

export class WithdrawDto {
  @ApiProperty({ example: 500000, description: 'Montant en centimes FCFA (5 000 FCFA)' })
  @IsInt()
  @IsPositive()
  amount: number;

  @ApiProperty({ enum: MobileOperator, example: MobileOperator.ORANGE_MONEY })
  @IsEnum(MobileOperator)
  operator: MobileOperator;

  @ApiProperty({ example: '+237699123456', required: false, description: 'Numéro mobile money crédité' })
  @IsOptional()
  @IsString()
  phone?: string;
}
