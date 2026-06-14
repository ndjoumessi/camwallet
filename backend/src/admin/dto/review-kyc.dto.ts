import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewKycDto {
  // On ne permet que les décisions terminales (l'enum KycStatus contient aussi
  // PENDING / SUBMITTED qui ne sont pas des décisions d'admin).
  @IsIn(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
