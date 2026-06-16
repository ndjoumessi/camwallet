import { Controller, Get, Post, Patch, Param, Query, Body, Request, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../admin/guards/admin.guard';
import { SupportService } from './support.service';

@ApiTags('admin-support')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin/support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('stats')
  @ApiOperation({ summary: 'KPIs support (ouverts, en cours, résolus aujourd\'hui, temps moyen)' })
  stats() {
    return this.support.getStats();
  }

  @Get('tickets')
  @ApiOperation({ summary: 'Liste paginée des tickets avec filtres' })
  list(
    @Query('page') page = 1,
    @Query('limit') limit = 25,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('category') category?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('search') search?: string,
  ) {
    return this.support.listTickets({ page: +page, limit: +limit, status, priority, category, assignedTo, search });
  }

  @Get('tickets/:id')
  @ApiOperation({ summary: 'Détail d\'un ticket + fil de messages' })
  detail(@Param('id') id: string) {
    return this.support.getTicket(id);
  }

  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Créer un ticket manuellement' })
  create(
    @Request() req: any,
    @Body() body: { userId: string; title: string; description: string; category?: string; priority?: string; assignedTo?: string },
  ) {
    return this.support.createTicket(req.user.id, body);
  }

  @Patch('tickets/:id')
  @ApiOperation({ summary: 'Modifier statut / priorité / assignation' })
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { status?: string; priority?: string; assignedTo?: string | null },
  ) {
    return this.support.updateTicket(req.user.id, id, body);
  }

  @Post('tickets/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ajouter un message au ticket (réponse ou note interne)' })
  addMessage(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { content: string; internal?: boolean },
  ) {
    return this.support.addMessage(req.user.id, id, body.content, !!body.internal);
  }
}
