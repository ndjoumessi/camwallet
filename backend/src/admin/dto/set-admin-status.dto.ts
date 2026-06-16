import { IsBoolean } from 'class-validator';

// Active (true) ou désactive (false) un compte opérateur admin.
export class SetAdminStatusDto {
  @IsBoolean()
  active: boolean;
}
