import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Request,
  Res,
  UseGuards,
  BadRequestException,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable, merge, interval } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SseService } from '../sse/sse.module';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from './guards/admin.guard';
import { PermissionsGuard } from './rbac/permissions.guard';
import { RequirePermission } from './rbac/require-permission.decorator';
import { AdminService } from './admin.service';
import { TransactionStatus, TransactionType, UserStatus } from '@prisma/client';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { SetUserStatusDto } from './dto/set-user-status.dto';
import { SetAdminRoleDto } from './dto/set-admin-role.dto';
import { SetAdminPasswordDto } from './dto/set-admin-password.dto';
import { CreateAdminOperatorDto } from './dto/create-admin-operator.dto';
import { SetAdminStatusDto } from './dto/set-admin-status.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminGuard, PermissionsGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private adminService: AdminService,
    private readonly sseService: SseService,
  ) {}

  @Get('stats')
  @RequirePermission('metrics:read')
  @ApiOperation({ summary: 'Statistiques globales de la plateforme' })
  stats() {
    return this.adminService.getStats();
  }

  @Get('stats/timeseries')
  @RequirePermission('metrics:read')
  @ApiOperation({ summary: 'Séries temporelles par jour (7d | 30d | 90d)' })
  timeseries(@Query('period') period = '7d') {
    return this.adminService.getTimeseries(period);
  }

  @Get('stats/operator-rates')
  @RequirePermission('metrics:read')
  @ApiOperation({ summary: 'Taux de succès par opérateur (30 derniers jours)' })
  operatorRates() {
    return this.adminService.getOperatorSuccessRate();
  }

  @Get('users')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Liste paginée des utilisateurs' })
  users(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('search') search?: string,
    @Query('status') status?: UserStatus,
    @Query('kycStatus') kycStatus?: string,
    @Query('role') role?: string,
  ) {
    return this.adminService.getUsers(+page, +limit, search, status, kycStatus, role);
  }

  @Get('users/stats')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Statistiques agrégées des utilisateurs (cartes + tendances)' })
  userStats() {
    return this.adminService.getUserStats();
  }

  @Get('users/:id')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Détail utilisateur (infos, KYC, transactions, audit)' })
  userDetail(@Param('id') id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Get('transactions')
  @RequirePermission('transactions:read')
  @ApiOperation({ summary: 'Liste paginée des transactions' })
  transactions(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: TransactionStatus,
    @Query('type') type?: TransactionType,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('amountMin') amountMin?: string,
    @Query('amountMax') amountMax?: string,
  ) {
    return this.adminService.getTransactions(+page, +limit, status, type, search, from, to, amountMin, amountMax);
  }

  @Patch('users/:id/status')
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Modifier le statut d"un utilisateur (bloquer / réactiver)' })
  setUserStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: SetUserStatusDto,
  ) {
    return this.adminService.setUserStatus(req.user.id, id, dto.status);
  }

  @Post('users/:id/reset-pin')
  @RequirePermission('users:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Forcer la réinitialisation du PIN d"un utilisateur' })
  resetPin(@Request() req: any, @Param('id') id: string) {
    return this.adminService.resetUserPin(req.user.id, id);
  }

  @Get('kyc')
  @RequirePermission('kyc:read')
  @ApiOperation({ summary: 'File d"attente KYC' })
  kyc() {
    return this.adminService.getKyc();
  }

  @Patch('kyc/:userId')
  @RequirePermission('kyc:write')
  @ApiOperation({ summary: 'Approuver / rejeter une demande KYC' })
  reviewKyc(
    @Request() req: any,
    @Param('userId') userId: string,
    @Body() dto: ReviewKycDto,
  ) {
    return this.adminService.reviewKyc(req.user.id, userId, dto);
  }

  @Post('kyc/:userId/analyze')
  @RequirePermission('kyc:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Relancer la pré-validation IA (Claude Vision) du dossier KYC' })
  analyzeKyc(@Request() req: any, @Param('userId') userId: string) {
    return this.adminService.analyzeKyc(req.user.id, userId);
  }

  @Get('alerts')
  @RequirePermission('dashboard:read')
  @ApiOperation({ summary: 'Alertes et transactions signalées (données réelles)' })
  alerts() {
    return this.adminService.getAlerts();
  }

  @Get('audit')
  @RequirePermission('audit:read')
  @ApiOperation({ summary: "Journal d'audit des actions admin avec filtres avancés" })
  audit(
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
    @Query('resource') resource?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
  ) {
    return this.adminService.getAudit({
      action,
      actorId,
      resource,
      from,
      to,
      take: take ? +take : undefined,
    });
  }

  // ─── ANIF ──────────────────────────────────────────────────────────────────

  @Get('anif/alerts')
  @RequirePermission('anif:read')
  @ApiOperation({ summary: "Alertes anti-blanchiment ANIF (transactions > seuil, fréquence anormale)" })
  anifAlerts() {
    return this.adminService.getAnifAlerts();
  }

  @Post('anif/cases')
  @RequirePermission('anif:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Ouvrir un dossier d'enquête ANIF pour une transaction" })
  openAnifCase(
    @Request() req: any,
    @Body() body: { transactionId: string; reason: string },
  ) {
    if (!body.transactionId || !body.reason) {
      throw new BadRequestException('transactionId et reason sont requis');
    }
    return this.adminService.openAnifCase(req.user.id, body.transactionId, body.reason);
  }

  @Get('anif/report')
  @RequirePermission('anif:read')
  @ApiOperation({ summary: 'Rapport ANIF structuré (30 derniers jours)' })
  anifReport() {
    return this.adminService.getAnifReport();
  }

  @Patch('anif/cases/:id/close')
  @RequirePermission('anif:write')
  @ApiOperation({ summary: "Clôturer un dossier ANIF (avec rapport optionnel)" })
  closeAnifCase(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { resolution: string; report?: string },
  ) {
    if (!body.resolution) {
      throw new BadRequestException('resolution est requis');
    }
    return this.adminService.closeAnifCase(req.user.id, id, body.resolution, body.report);
  }

  @Post('anif/cases/:id/assign')
  @RequirePermission('anif:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Assigner un dossier ANIF à un analyste" })
  assignAnifCase(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { analystId: string },
  ) {
    if (!body.analystId) {
      throw new BadRequestException('analystId est requis');
    }
    return this.adminService.assignAnifCase(req.user.id, id, body.analystId);
  }

  @Get('anif/stats')
  @RequirePermission('anif:read')
  @ApiOperation({ summary: 'Statistiques de conformité ANIF (cartes)' })
  anifStats() {
    return this.adminService.getAnifStats();
  }

  @Get('stats/alerts-timeline')
  @RequirePermission('dashboard:read')
  @ApiOperation({ summary: 'Alertes par heure sur 24 h (échecs + transactions > seuil)' })
  alertsTimeline() {
    return this.adminService.getAlertsTimeline();
  }

  @Get('audit/stats')
  @RequirePermission('audit:read')
  @ApiOperation({ summary: "Statistiques du journal d'audit (cartes)" })
  auditStats() {
    return this.adminService.getAuditStats();
  }

  @Get('team/:userId/activity')
  @RequirePermission('team:manage')
  @ApiOperation({ summary: "Activité récente + stats d'un opérateur admin" })
  memberActivity(@Param('userId') userId: string) {
    return this.adminService.getMemberActivity(userId);
  }

  @Patch('transactions/:id/resolve')
  @RequirePermission('transactions:write')
  @ApiOperation({ summary: 'Marquer une transaction signalée comme résolue' })
  resolveTransaction(@Request() req: any, @Param('id') id: string) {
    return this.adminService.resolveTransaction(req.user.id, id);
  }

  @Get('settings')
  @RequirePermission('settings:read')
  @ApiOperation({ summary: 'Lire les paramètres système' })
  getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings')
  @RequirePermission('settings:write')
  @ApiOperation({ summary: 'Mettre à jour les paramètres système' })
  updateSettings(
    @Request() req: any,
    @Body() body: { updates: Record<string, string> },
  ) {
    if (!body.updates || typeof body.updates !== 'object') {
      throw new BadRequestException('updates est requis (objet clé→valeur)');
    }
    // Cloisonnement par clé : hors SUPER_ADMIN, seules les clés anif_* sont permises.
    return this.adminService.updateSettings(req.user.id, body.updates, req.user.adminRole);
  }

  // ─── Opérations OM/MoMo ────────────────────────────────────────────────────

  @Get('operations')
  @RequirePermission('operations:read')
  @ApiOperation({ summary: 'Liste des recharges et retraits OM/MoMo avec statut webhook' })
  operations(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('operator') operator?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('period') period?: string,
  ) {
    return this.adminService.getOperations(+page, +limit, operator, status, type, search, period);
  }

  @Post('operations/:id/retry')
  @RequirePermission('operations:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Relancer une opération PENDING (incrément retryCount)' })
  retryOperation(@Request() req: any, @Param('id') id: string) {
    return this.adminService.retryOperation(req.user.id, id);
  }

  // ─── Santé des intégrations ────────────────────────────────────────────────

  @Get('health/integrations')
  @RequirePermission('dashboard:read')
  @ApiOperation({ summary: 'Statut des intégrations OM, MTN, SMS OTP, Push Expo' })
  healthIntegrations() {
    return this.adminService.getHealthIntegrations();
  }

  // ─── Équipe admin ─────────────────────────────────────────────────────────
  // GET team (liste) reste ouvert à tout admin : utilisé par les listes
  // déroulantes d'assignation (Support, modale transaction). La GESTION de
  // l'équipe (création/suppression/rôle/mot de passe/statut) est SUPER_ADMIN.

  @Get('team')
  @ApiOperation({ summary: 'Liste des membres de l\'équipe admin' })
  getAdminTeam() {
    return this.adminService.getAdminTeam();
  }

  @Post('team')
  @RequirePermission('team:manage')
  @ApiOperation({ summary: 'Créer un opérateur admin (SUPER_ADMIN)' })
  createAdminOperator(@Request() req: any, @Body() body: CreateAdminOperatorDto) {
    return this.adminService.createAdminOperator(req.user.id, body);
  }

  @Delete('team/:userId')
  @RequirePermission('team:manage')
  @ApiOperation({ summary: 'Supprimer un opérateur admin (SUPER_ADMIN)' })
  deleteAdmin(@Request() req: any, @Param('userId') userId: string) {
    return this.adminService.deleteAdmin(req.user.id, userId);
  }

  @Patch('team/:userId/status')
  @RequirePermission('team:manage')
  @ApiOperation({ summary: 'Activer / désactiver un opérateur admin (SUPER_ADMIN)' })
  setAdminStatus(
    @Request() req: any,
    @Param('userId') userId: string,
    @Body() body: SetAdminStatusDto,
  ) {
    return this.adminService.setAdminStatus(req.user.id, userId, body.active);
  }

  @Patch('team/:userId/role')
  @RequirePermission('team:manage')
  @ApiOperation({ summary: 'Attribuer un rôle admin à un utilisateur' })
  setAdminRole(
    @Request() req: any,
    @Param('userId') userId: string,
    @Body() body: SetAdminRoleDto,
  ) {
    return this.adminService.setAdminRole(req.user.id, userId, body.adminRole);
  }

  @Patch('team/:userId/password')
  @RequirePermission('team:manage')
  @ApiOperation({ summary: 'Définir le mot de passe de connexion d\'un admin' })
  setAdminPassword(
    @Request() req: any,
    @Param('userId') userId: string,
    @Body() body: SetAdminPasswordDto,
  ) {
    return this.adminService.setAdminPassword(req.user.id, userId, body.password);
  }

  // ─── Export CSV ──────────────────────────────────────────────────────────

  @Get('export/users')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Exporter les utilisateurs en CSV' })
  async exportUsers(@Res() res: any) {
    const csv = await this.adminService.exportUsersCsv({});
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="users.csv"',
    });
    res.send(csv);
  }

  @Get('export/transactions')
  @RequirePermission('transactions:read')
  @ApiOperation({ summary: 'Exporter les transactions en CSV' })
  async exportTransactions(@Res() res: any) {
    const csv = await this.adminService.exportTransactionsCsv({});
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="transactions.csv"',
    });
    res.send(csv);
  }

  // ─── Notes admin sur un utilisateur ──────────────────────────────────────

  @Get('users/:id/notes')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Lire les notes admin sur un utilisateur' })
  getAdminNotes(@Param('id') id: string) {
    return this.adminService.getAdminNotes(id);
  }

  @Post('users/:id/notes')
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Ajouter une note admin sur un utilisateur' })
  addAdminNote(
    @Request() req: any,
    @Param('id') id: string,
    @Body('content') content: string,
  ) {
    if (!content) throw new BadRequestException('content est requis');
    return this.adminService.addAdminNote(req.user.id, id, content);
  }

  @Delete('notes/:noteId')
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Supprimer une note admin' })
  deleteAdminNote(@Request() req: any, @Param('noteId') noteId: string) {
    return this.adminService.deleteAdminNote(req.user.id, noteId);
  }

  // ─── SSE temps réel ──────────────────────────────────────────────────────────
  // Pattern ticket opaque : le JWT ne transite jamais dans l'URL (qui est loguée
  // côté serveur, dans l'historique browser et les headers Referer).
  // 1. POST /admin/sse-ticket  (JWT Authorization header → ticket UUID 60s)
  // 2. GET  /admin/events?ticket=<uuid>  (ticket single-use, pas de JWT dans l'URL)

  @Post('sse-ticket')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Émet un ticket SSE opaque à usage unique (60 s)' })
  createSseTicket(@Request() req: any) {
    const ticket = this.sseService.createTicket(req.user.id);
    return { ticket };
  }

  @Get('events')
  @Sse()
  @ApiOperation({ summary: 'Flux SSE temps réel — authentifié par ticket opaque' })
  liveEvents(@Query('ticket') ticket: string): Observable<MessageEvent> {
    const userId = this.sseService.consumeTicket(ticket ?? '');
    if (!userId) {
      // Ticket inconnu, expiré ou déjà consommé → fermeture immédiate du flux.
      return new Observable(sub => {
        sub.next({ data: { error: 'Ticket SSE invalide ou expiré' } } as MessageEvent);
        sub.complete();
      });
    }

    const events$ = this.sseService.stream.pipe(map(e => ({ data: e } as MessageEvent)));
    const ping$ = interval(30000).pipe(map(() => ({ data: { type: 'ping' } } as MessageEvent)));
    return merge(events$, ping$);
  }
}
