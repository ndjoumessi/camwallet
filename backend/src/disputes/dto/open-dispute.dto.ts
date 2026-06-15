import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OpenDisputeDto {
  @ApiProperty({ description: 'Identifiant de la transaction contestée' })
  @IsString()
  @IsNotEmpty()
  transactionId: string;

  @ApiProperty({ description: 'Motif de la contestation (60 caractères max)' })
  @IsString()
  @IsNotEmpty({ message: 'Le motif est obligatoire' })
  @MaxLength(60, { message: 'Le motif ne doit pas dépasser 60 caractères' })
  reason: string;
}
