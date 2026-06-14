import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { WalletsService } from './wallets.service';
import { RechargeDto } from './dto/recharge.dto';
import { WithdrawDto } from './dto/withdraw.dto';

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('wallets')
export class WalletsController {
  constructor(private walletsService: WalletsService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Solde du portefeuille' })
  balance(@Request() req: any) {
    return this.walletsService.getBalance(req.user.id);
  }

  @Post('recharge')
  @ApiOperation({ summary: 'Recharger le portefeuille depuis OM/MoMo' })
  recharge(@Request() req: any, @Body() dto: RechargeDto) {
    return this.walletsService.recharge(
      req.user.id,
      BigInt(dto.amount),
      dto.operator,
      dto.phone,
    );
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Retirer vers un compte OM/MoMo' })
  withdraw(@Request() req: any, @Body() dto: WithdrawDto) {
    return this.walletsService.withdraw(
      req.user.id,
      BigInt(dto.amount),
      dto.operator,
      dto.phone,
    );
  }
}
