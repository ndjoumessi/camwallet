import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { MerchantGuard } from './guards/merchant.guard';
import { MerchantService } from './merchant.service';

@ApiTags('merchant')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), MerchantGuard)
@Controller('merchant')
export class MerchantController {
  constructor(private merchantService: MerchantService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Statistiques du commerçant — CA jour / semaine / mois' })
  stats(@Request() req: any) {
    return this.merchantService.getStats(req.user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Historique paginé des paiements reçus (commerçant)' })
  transactions(
    @Request() req: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.merchantService.getTransactions(req.user.id, +page, +limit);
  }
}
