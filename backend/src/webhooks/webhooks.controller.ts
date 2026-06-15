import { Controller, Post, Body, Headers, HttpCode, Req, RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private webhooksService: WebhooksService) {}

  @Post('campay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook CamPay — confirmation paiement/retrait (signature sha256 vérifiée)' })
  campay(@Body() payload: any) {
    return this.webhooksService.handleCamPay(payload);
  }

  @Post('orange-money')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook Orange Money — confirmation paiement (signature HMAC-SHA256 vérifiée)' })
  orangeMoney(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: any,
    @Headers('x-signature') sig: string,
  ) {
    return this.webhooksService.handleOrangeMoney(payload, req.rawBody ?? Buffer.alloc(0), sig);
  }

  @Post('mtn-momo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook MTN MoMo — confirmation paiement (token x-callback-token vérifié)' })
  mtnMomo(
    @Body() payload: any,
    @Headers('x-callback-token') token: string,
  ) {
    return this.webhooksService.handleMtnMomo(payload, token);
  }
}
