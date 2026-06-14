import { IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePinDto {
  @ApiProperty({ example: '123456', description: 'PIN actuel (6 chiffres)' })
  @IsString()
  @Length(6, 6, { message: 'Le PIN doit contenir exactement 6 chiffres' })
  @Matches(/^\d{6}$/, { message: 'Le PIN doit contenir uniquement des chiffres' })
  currentPin: string;

  @ApiProperty({ example: '654321', description: 'Nouveau PIN (6 chiffres)' })
  @IsString()
  @Length(6, 6, { message: 'Le nouveau PIN doit contenir exactement 6 chiffres' })
  @Matches(/^\d{6}$/, { message: 'Le nouveau PIN doit contenir uniquement des chiffres' })
  newPin: string;
}
