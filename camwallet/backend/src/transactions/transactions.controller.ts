import { Controller, Get, Post, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('transactions')
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Post('p2p')
  @ApiOperation({ summary: 'Envoi P2P vers un autre utilisateur CamWallet' })
  p2p(
    @Request() req: any,
    @Body() body: { phone: string; amount: number; description?: string },
  ) {
    return this.transactionsService.p2p(
      req.user.id,
      body.phone,
      BigInt(body.amount),
      body.description,
    );
  }

  @Post('pay-qr')
  @ApiOperation({ summary: 'Paiement via QR Code' })
  payQr(
    @Request() req: any,
    @Body() body: { qrPayload: string; amount?: number },
  ) {
    return this.transactionsService.payByQr(
      req.user.id,
      body.qrPayload,
      body.amount ? BigInt(body.amount) : undefined,
    );
  }

  @Get('history')
  @ApiOperation({ summary: 'Historique des transactions paginé' })
  history(
    @Request() req: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('type') type?: any,
  ) {
    return this.transactionsService.getHistory(req.user.id, +page, +limit, type);
  }
}
