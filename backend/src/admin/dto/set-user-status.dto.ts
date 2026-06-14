import { IsEnum } from 'class-validator';
import { UserStatus } from '@prisma/client';

export class SetUserStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;
}
