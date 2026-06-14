import { Controller, Post, Body, Headers, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private webhooksService: WebhooksService) {}

  @Post('orange-money')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook Orange Money — confirmation paiement' })
  orangeMoney(
    @Body() payload: any,
    @Headers('x-signature') sig: string,
  ) {
    return this.webhooksService.handleOrangeMoney(payload, sig);
  }

  @Post('mtn-momo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook MTN MoMo — confirmation paiement' })
  mtnMomo(
    @Body() payload: any,
    @Headers('x-callback-token') token: string,
  ) {
    return this.webhooksService.handleMtnMomo(payload, token);
  }
}
