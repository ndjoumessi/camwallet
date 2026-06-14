import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Request,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { KycService } from './kyc.service';

const MAX_BYTES = 5 * 1024 * 1024; // 5 Mo / image

@ApiTags('kyc')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('kyc')
export class KycController {
  constructor(private kyc: KycService) {}

  @Get('status')
  @ApiOperation({ summary: 'Statut KYC de l’utilisateur connecté' })
  status(@Request() req: any) {
    return this.kyc.getMyStatus(req.user.id);
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Soumission KYC : CNI recto + verso + selfie' })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'idFront', maxCount: 1 },
        { name: 'idBack', maxCount: 1 },
        { name: 'selfie', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_BYTES } },
    ),
  )
  submit(
    @Request() req: any,
    @UploadedFiles() files: { idFront?: any[]; idBack?: any[]; selfie?: any[] },
  ) {
    return this.kyc.submit(req.user.id, {
      idFront: files?.idFront?.[0]?.buffer,
      idBack: files?.idBack?.[0]?.buffer,
      selfie: files?.selfie?.[0]?.buffer,
    });
  }
}
