import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class SetPinDto {
  @IsUUID()
  userId: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'Le PIN doit contenir 6 chiffres' })
  pin: string;
}
