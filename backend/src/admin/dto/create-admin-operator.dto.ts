import { IsEmail, IsString, IsIn, MinLength, MaxLength } from 'class-validator';
import { ADMIN_ROLES, AdminRole } from './set-admin-role.dto';

// Création d'un opérateur admin (login par-utilisateur) par un SUPER_ADMIN.
export class CreateAdminOperatorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  fullName: string;

  @IsEmail()
  email: string;

  @IsIn(ADMIN_ROLES)
  adminRole: AdminRole;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
