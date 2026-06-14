import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from './guards/admin.guard';
import { AdminService } from './admin.service';
import { TransactionStatus, TransactionType, UserStatus } from '@prisma/client';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Statistiques globales de la plateforme' })
  stats() {
    return this.adminService.getStats();
  }

  @Get('stats/timeseries')
  @ApiOperation({ summary: 'Séries temporelles par jour (7d | 30d | 90d)' })
  timeseries(@Query('period') period = '7d') {
    return this.adminService.getTimeseries(period);
  }

  @Get('users')
  @ApiOperation({ summary: 'Liste paginée des utilisateurs' })
  users(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('search') search?: string,
    @Query('status') status?: UserStatus,
  ) {
    return this.adminService.getUsers(+page, +limit, search, status);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Détail utilisateur (infos, KYC, transactions, audit)' })
  userDetail(@Param('id') id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Liste paginée des transactions' })
  transactions(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: TransactionStatus,
    @Query('type') type?: TransactionType,
  ) {
    return this.adminService.getTransactions(+page, +limit, status, type);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Modifier le statut d’un utilisateur (bloquer / réactiver)' })
  setUserStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: SetUserStatusDto,
  ) {
    return this.adminService.setUserStatus(req.user.id, id, dto.status);
  }

  @Post('users/:id/reset-pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Forcer la réinitialisation du PIN d’un utilisateur' })
  resetPin(@Request() req: any, @Param('id') id: string) {
    return this.adminService.resetUserPin(req.user.id, id);
  }

  @Get('kyc')
  @ApiOperation({ summary: 'File d’attente KYC' })
  kyc() {
    return this.adminService.getKyc();
  }

  @Patch('kyc/:userId')
  @ApiOperation({ summary: 'Approuver / rejeter une demande KYC' })
  reviewKyc(
    @Request() req: any,
    @Param('userId') userId: string,
    @Body() dto: ReviewKycDto,
  ) {
    return this.adminService.reviewKyc(req.user.id, userId, dto);
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Alertes et transactions signalées (données réelles)' })
  alerts() {
    return this.adminService.getAlerts();
  }

  @Get('audit')
  @ApiOperation({ summary: 'Journal d’audit des actions admin' })
  audit() {
    return this.adminService.getAudit();
  }
}
