import { Controller, Get, Post, Body, Request, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TransactionsService } from '../transactions/transactions.service';
import { OpenDisputeDto } from './dto/open-dispute.dto';

@ApiTags('disputes')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('disputes')
export class DisputesController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Contester une transaction' })
  openDispute(@Request() req: any, @Body() dto: OpenDisputeDto) {
    return this.transactionsService.openDispute(req.user.id, dto.transactionId, dto.reason);
  }

  @Get('me')
  @ApiOperation({ summary: 'Lister mes contestations' })
  myDisputes(@Request() req: any) {
    return this.transactionsService.getUserDisputes(req.user.id);
  }
}
