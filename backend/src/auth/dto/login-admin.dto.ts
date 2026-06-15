import { IsEmail, IsString, IsOptional, MinLength, Length } from 'class-validator';

export class LoginAdminDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  @Length(6, 6)
  totpCode?: string;
}
