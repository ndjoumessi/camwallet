import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { LoyaltyService } from './loyalty.service';

@ApiTags('loyalty')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('loyalty')
export class LoyaltyController {
  constructor(private loyalty: LoyaltyService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Solde de points, niveau et progression vers le suivant' })
  balance(@Request() req: any) {
    return this.loyalty.getBalance(req.user.id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Historique des gains de points' })
  history(@Request() req: any) {
    return this.loyalty.getHistory(req.user.id);
  }
}
