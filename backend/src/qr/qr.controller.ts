import { Controller, Get, Post, Body, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { QrService } from './qr.service';
import { CreateDynamicQrDto } from './dto/create-dynamic-qr.dto';
import { DecodeQrDto } from './dto/decode-qr.dto';

@ApiTags('qr')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('qr')
export class QrController {
  constructor(private qrService: QrService) {}

  @Get('static')
  @ApiOperation({ summary: 'QR statique du compte (créé si absent)' })
  static(@Request() req: any) {
    return this.qrService.getStatic(req.user.id);
  }

  @Post('dynamic')
  @ApiOperation({ summary: 'Générer un QR dynamique avec montant' })
  dynamic(@Request() req: any, @Body() dto: CreateDynamicQrDto) {
    return this.qrService.createDynamic(
      req.user.id,
      BigInt(dto.amount),
      dto.expiresInMinutes,
    );
  }

  @Post('decode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Décoder un QR scanné' })
  decode(@Body() dto: DecodeQrDto) {
    return this.qrService.decode(dto.payload);
  }
}
