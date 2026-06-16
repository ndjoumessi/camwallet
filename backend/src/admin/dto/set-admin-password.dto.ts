import { IsString, MinLength, MaxLength } from 'class-validator';

// Définition d'un mot de passe pour la connexion par-utilisateur d'un admin.
export class SetAdminPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
