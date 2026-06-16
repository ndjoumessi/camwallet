import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewKycDto {
  @IsIn(['APPROVED', 'REJECTED', 'RESUBMIT_REQUIRED'])
  decision: 'APPROVED' | 'REJECTED' | 'RESUBMIT_REQUIRED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
