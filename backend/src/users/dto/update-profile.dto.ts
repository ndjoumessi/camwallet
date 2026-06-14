import {
  IsString,
  IsOptional,
  IsEmail,
  IsDateString,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiProperty({ example: 'Jean Dupont', required: false })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  fullName?: string;

  @ApiProperty({ example: 'jean@example.cm', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  // L'avatar n'est défini que via POST /users/avatar (upload validé). Pas de
  // champ URL libre ici, pour éviter toute injection (XSS / open redirect).

  @ApiProperty({ example: '1995-04-23', required: false })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiProperty({ example: 'Douala', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;
}
