import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from './guards/admin.guard';
import { AdminService } from './admin.service';
import { TransactionStatus, TransactionType, UserStatus } from '@prisma/client';

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
}
