import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DecodeQrDto {
  @ApiProperty({ example: 'CW:STATIC:e795dac2-77ee-4f62-8a22-d75bc46a1226' })
  @IsString()
  @IsNotEmpty()
  payload: string;
}
