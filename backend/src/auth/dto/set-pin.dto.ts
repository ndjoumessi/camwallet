import { IsNotEmpty, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class SetPinDto {
  // Conservé pour compatibilité des clients qui l'envoient encore, mais NON
  // autoritatif : set-pin dérive le compte cible du registrationToken (cf. service).
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'Le PIN doit contenir 6 chiffres' })
  pin: string;

  // Jeton d'enregistrement émis par verify-otp (purpose: 'set_pin'). OBLIGATOIRE :
  // c'est la seule preuve d'identité acceptée (l'OTP a bien été validé pour ce
  // compte) ; le backend en dérive le userId.
  @IsNotEmpty()
  @IsString()
  registrationToken: string;
}
