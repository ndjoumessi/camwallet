import { Controller, Post, Body, Request, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TransactionsService } from '../transactions/transactions.service';

@ApiTags('disputes')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('disputes')
export class DisputesController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Contester une transaction' })
  openDispute(
    @Request() req: any,
    @Body() body: { transactionId: string; reason: string },
  ) {
    return this.transactionsService.openDispute(req.user.id, body.transactionId, body.reason);
  }
}
