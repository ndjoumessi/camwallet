import { IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  phone: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  pin: string;
}
