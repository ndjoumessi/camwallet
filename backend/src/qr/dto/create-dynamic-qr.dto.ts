import { IsInt, IsPositive, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDynamicQrDto {
  @ApiProperty({ example: 850000, description: 'Montant en centimes FCFA (8 500 FCFA)' })
  @IsInt()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 15, required: false, description: 'Durée de validité en minutes (défaut 15)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  expiresInMinutes?: number;
}
