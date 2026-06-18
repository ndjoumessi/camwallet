import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OtpService } from '../auth/otp.service';
import { SmsService } from '../sms/sms.service';
import { KycAiService } from '../kyc/kyc-ai.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  TransactionStatus,
  TransactionType,
  UserStatus,
  KycStatus,
} from '@prisma/client';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { ADMIN_ROLES } from './dto/set-admin-role.dto';
import { CreateAdminOperatorDto } from './dto/create-admin-operator.dto';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';

const ANIF_RISK_HIGH = 50_000_000n;  // 500 000 FCFA en centimes
const ANIF_RISK_MED  = 5_000_000n;   //  50 000 FCFA en centimes

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private otpService: OtpService,
    private sms: SmsService,
    private kycAi: KycAiService,
    private cloudinary: CloudinaryService,
    private config: ConfigService,
  ) {}

  // ─── Statistiques globales ──────────────────────────────────────────────────
  async getStats() {
    // Fenêtres glissantes pour les tendances (30 derniers jours vs 30 précédents).
    const now = Date.now();
    const d30 = new Date(now - 30 * 24 * 3600 * 1000);
    const d60 = new Date(now - 60 * 24 * 3600 * 1000);
    const completed = (gte: Date, lt?: Date) => ({
      status: TransactionStatus.COMPLETED,
      createdAt: lt ? { gte, lt } : { gte },
    });

    const [
      totalUsers,
      totalTransactions,
      pendingTransactions,
      volume,
      balances,
      byType,
      byStatus,
      byRole,
      usersCur,
      usersPrev,
      txCur,
      txPrev,
      volCur,
      volPrev,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.transaction.count(),
      this.prisma.transaction.count({
        where: { status: TransactionStatus.PENDING },
      }),
      this.prisma.transaction.aggregate({
        _sum: { amount: true, fee: true },
        where: { status: TransactionStatus.COMPLETED },
      }),
      this.prisma.wallet.aggregate({ _sum: { balance: true } }),
      this.prisma.transaction.groupBy({
        by: ['type'],
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({
        by: ['role'],
        _count: { _all: true },
      }),
      this.prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d60, lt: d30 } } }),
      this.prisma.transaction.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.transaction.count({ where: { createdAt: { gte: d60, lt: d30 } } }),
      this.prisma.transaction.aggregate({ _sum: { amount: true }, where: completed(d30) }),
      this.prisma.transaction.aggregate({ _sum: { amount: true }, where: completed(d60, d30) }),
    ]);

    // Variation en % (période courante vs précédente). null si pas de base de comparaison.
    const pct = (cur: number, prev: number): number | null =>
      prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : null;

    return {
      trends: {
        users: pct(usersCur, usersPrev),
        transactions: pct(txCur, txPrev),
        volume: pct(Number(volCur._sum.amount ?? 0), Number(volPrev._sum.amount ?? 0)),
      },
      users: {
        total: totalUsers,
        byRole: byRole.map((r) => ({ role: r.role, count: r._count._all })),
      },
      transactions: {
        total: totalTransactions,
        pending: pendingTransactions,
        byType: byType.map((t) => ({
          type: t.type,
          count: t._count._all,
          volume: t._sum.amount ?? 0n,
        })),
        byStatus: byStatus.map((s) => ({
          status: s.status,
          count: s._count._all,
        })),
      },
      volume: {
        completedAmount: volume._sum.amount ?? 0n,
        collectedFees: volume._sum.fee ?? 0n,
      },
      totalBalance: balances._sum.balance ?? 0n,
    };
  }

  // ─── Liste paginée des utilisateurs ─────────────────────────────────────────
  async getUsers(
    page = 1,
    limit = 20,
    search?: string,
    status?: UserStatus,
    kycStatus?: string,
    role?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (search) {
      where.OR = [
        { phone: { contains: search } },
        { fullName: { contains: search, mode: 'insensitive' as const } },
        { email: { contains: search, mode: 'insensitive' as const } },
      ];
    }
    if (status) where.status = status;
    if (kycStatus) where.kycStatus = kycStatus;
    if (role) where.role = role;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phone: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          kycStatus: true,
          createdAt: true,
          lastLoginAt: true,
          wallet: { select: { balance: true, currency: true } },
          kycDocument: { select: { reviewedAt: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Niveau de risque par utilisateur : volume COMPLETED (envoyé + reçu) sur
    // 30 j, mêmes seuils ANIF que le détail (cohérence liste ↔ fiche).
    const ids = users.map((u) => u.id);
    const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [sentVol, recvVol] = ids.length
      ? await Promise.all([
          this.prisma.transaction.groupBy({
            by: ['senderId'],
            where: { senderId: { in: ids }, status: TransactionStatus.COMPLETED, createdAt: { gte: d30 } },
            _sum: { amount: true },
          }),
          this.prisma.transaction.groupBy({
            by: ['receiverId'],
            where: { receiverId: { in: ids }, status: TransactionStatus.COMPLETED, createdAt: { gte: d30 } },
            _sum: { amount: true },
          }),
        ])
      : [[], []];

    const volMap = new Map<string, bigint>();
    for (const r of sentVol as any[]) if (r.senderId) volMap.set(r.senderId, (volMap.get(r.senderId) ?? 0n) + (r._sum.amount ?? 0n));
    for (const r of recvVol as any[]) if (r.receiverId) volMap.set(r.receiverId, (volMap.get(r.receiverId) ?? 0n) + (r._sum.amount ?? 0n));
    const riskOf = (id: string): 'Bas' | 'Moyen' | 'Élevé' => {
      const v = volMap.get(id) ?? 0n;
      return v >= ANIF_RISK_HIGH ? 'Élevé' : v >= ANIF_RISK_MED ? 'Moyen' : 'Bas';
    };

    const enriched = users.map((u) => ({
      ...u,
      kycReviewedAt: u.kycDocument?.reviewedAt ?? null,
      riskLevel: riskOf(u.id),
    }));

    return {
      data: enriched,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Statistiques de la page Utilisateurs ───────────────────────────────────
  async getUserStats() {
    const now = Date.now();
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const d30 = new Date(now - 30 * 24 * 3600 * 1000);
    const d60 = new Date(now - 60 * 24 * 3600 * 1000);

    const [
      total, activeToday, newToday, kycApproved, merchants,
      newCur, newPrev, kycCur, kycPrev, merchCur, merchPrev,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { lastLoginAt: { gte: startToday } } }),
      this.prisma.user.count({ where: { createdAt: { gte: startToday } } }),
      this.prisma.user.count({ where: { kycStatus: KycStatus.APPROVED } }),
      this.prisma.user.count({ where: { role: 'MERCHANT' } }),
      this.prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d60, lt: d30 } } }),
      this.prisma.user.count({ where: { kycStatus: KycStatus.APPROVED, createdAt: { gte: d30 } } }),
      this.prisma.user.count({ where: { kycStatus: KycStatus.APPROVED, createdAt: { gte: d60, lt: d30 } } }),
      this.prisma.user.count({ where: { role: 'MERCHANT', createdAt: { gte: d30 } } }),
      this.prisma.user.count({ where: { role: 'MERCHANT', createdAt: { gte: d60, lt: d30 } } }),
    ]);

    const pct = (c: number, p: number): number | null => (p > 0 ? Math.round(((c - p) / p) * 100) : c > 0 ? 100 : null);

    return {
      total,
      activeToday,
      newToday,
      kycApproved,
      merchants,
      trends: {
        total: pct(newCur, newPrev),
        kycApproved: pct(kycCur, kycPrev),
        merchants: pct(merchCur, merchPrev),
      },
    };
  }

  // ─── Liste paginée des transactions ─────────────────────────────────────────
  async getTransactions(
    page = 1,
    limit = 20,
    status?: TransactionStatus,
    type?: TransactionType,
    search?: string,
    from?: string,
    to?: string,
    amountMin?: string,
    amountMax?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;

    // Plage de montant (FCFA → centimes).
    if (amountMin || amountMax) {
      where.amount = {};
      if (amountMin) where.amount.gte = BigInt(Math.round(Number(amountMin) * 100));
      if (amountMax) where.amount.lte = BigInt(Math.round(Number(amountMax) * 100));
    }

    // Recherche libre : référence, ou nom/téléphone de l'émetteur/destinataire.
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { reference: { contains: q, mode: 'insensitive' } },
        { operatorRef: { contains: q, mode: 'insensitive' } },
        { sender: { fullName: { contains: q, mode: 'insensitive' } } },
        { sender: { phone: { contains: q } } },
        { receiver: { fullName: { contains: q, mode: 'insensitive' } } },
        { receiver: { phone: { contains: q } } },
      ];
    }

    // Plage de dates (période ou personnalisée).
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: { select: { phone: true, fullName: true } },
          receiver: { select: { phone: true, fullName: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data: transactions,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Audit ──────────────────────────────────────────────────────────────────
  // Trace une action admin. L'acteur est l'id du compte admin réel (sinon null
  // pour la sentinelle 'admin' — userId étant nullable).
  private async writeAudit(
    actorId: string | undefined,
    action: string,
    resource?: string,
    metadata?: Record<string, any>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: actorId && actorId !== 'admin' ? actorId : null,
        action,
        resource,
        metadata: metadata ?? undefined,
      },
    });
  }

  // Journal d'audit des actions admin avec filtres avancés.
  async getAudit(params?: {
    action?: string;
    actorId?: string;
    resource?: string;
    from?: string;
    to?: string;
    take?: number;
  }) {
    const take = Math.min(params?.take ?? 50, 200);
    const where: any = {};

    if (params?.action) {
      where.action = { contains: params.action, mode: 'insensitive' };
    } else {
      // Filtre par défaut : actions admin pertinentes
      where.OR = [
        { action: { startsWith: 'USER_STATUS_' } },
        { action: { startsWith: 'KYC_' } },
        { action: { startsWith: 'ANIF_' } },
        { action: { startsWith: 'OPERATION_' } },
        { action: { startsWith: 'TRANSACTION_' } },
        { action: { startsWith: 'ADMIN_' } },
        { action: { startsWith: 'SUPPORT_' } },
        { action: 'USER_PIN_RESET' },
        { action: 'SETTINGS_UPDATE' },
      ];
    }

    if (params?.actorId) where.userId = params.actorId;

    if (params?.resource) {
      where.resource = { contains: params.resource, mode: 'insensitive' };
    }

    if (params?.from || params?.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to)   where.createdAt.lte = new Date(params.to);
    }

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        action: true,
        resource: true,
        metadata: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        user: { select: { fullName: true, email: true, adminRole: true, role: true } },
      },
    });
  }

  // ─── Modération utilisateur ───────────────────────────────────────────────
  async setUserStatus(adminId: string, userId: string, status: UserStatus) {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Utilisateur introuvable');

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status,
        // Réactiver lève aussi le verrou anti-bruteforce éventuel.
        ...(status === UserStatus.ACTIVE ? { lockedUntil: null, pinAttempts: 0 } : {}),
      },
      select: { id: true, fullName: true, status: true },
    });
    await this.writeAudit(adminId, `USER_STATUS_${status}`, `User:${userId}`);
    return user;
  }

  // ─── KYC ──────────────────────────────────────────────────────────────────
  async getKyc() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rawQueue = await this.prisma.user.findMany({
      where: { kycDocument: { isNot: null } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phone: true,
        fullName: true,
        kycStatus: true,
        createdAt: true,
        kycDocument: {
          select: {
            status: true,
            submittedAt: true,
            idFrontUrl: true,
            idBackUrl: true,
            selfieUrl: true,
            reviewNote: true,
            reviewedAt: true,
            aiScore: true,
            aiSuggestion: true,
            aiIssues: true,
            aiAnalyzedAt: true,
          },
        },
      },
    });

    const queue = rawQueue.map((u) => ({
      ...u,
      complianceScore: this.computeKycScore(u.kycDocument),
    }));

    const [pendingCount, approvedToday, rejectedToday, resubmitCount, totalApproved, totalRejected] =
      await Promise.all([
        this.prisma.user.count({ where: { kycStatus: KycStatus.SUBMITTED } }),
        this.prisma.kycDocument.count({ where: { status: KycStatus.APPROVED, reviewedAt: { gte: today } } }),
        this.prisma.kycDocument.count({ where: { status: KycStatus.REJECTED, reviewedAt: { gte: today } } }),
        this.prisma.user.count({ where: { kycStatus: KycStatus.RESUBMIT_REQUIRED } }),
        this.prisma.kycDocument.count({ where: { status: KycStatus.APPROVED } }),
        this.prisma.kycDocument.count({ where: { status: KycStatus.REJECTED } }),
      ]);

    // null quand aucune décision n'a encore été prise — le frontend affiche « — »
    // plutôt qu'un « 0 % » trompeur.
    const approvalRate =
      totalApproved + totalRejected > 0
        ? Math.round((totalApproved / (totalApproved + totalRejected)) * 100)
        : null;

    return {
      queue,
      counts: { pending: pendingCount, approvedToday, rejectedToday, resubmitRequired: resubmitCount, approvalRate },
    };
  }

  private computeKycScore(
    doc: { idFrontUrl: string | null; idBackUrl: string | null; selfieUrl: string | null } | null,
  ): number {
    if (!doc) return 0;
    let score = 0;
    if (doc.idFrontUrl) score += 33;
    if (doc.idBackUrl) score += 33;
    if (doc.selfieUrl) score += 34;
    return score;
  }

  async reviewKyc(adminId: string, userId: string, dto: ReviewKycDto) {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Utilisateur introuvable');

    const newStatus = dto.decision as KycStatus;
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { kycStatus: newStatus },
        select: { id: true, fullName: true, kycStatus: true },
      });
      await tx.kycDocument.updateMany({
        where: { userId },
        data: {
          status: newStatus,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: dto.comment,
        },
      });
      return u;
    });

    await this.writeAudit(adminId, `KYC_${dto.decision}`, `User:${userId}`, {
      comment: dto.comment,
    });

    // Notifications push + SMS selon la décision — fire-and-forget
    const pushConfig: Record<string, { title: string; body: string; sms: string }> = {
      APPROVED: {
        title: 'KYC approuvé ✓',
        body: 'Votre identité a été vérifiée. Votre compte est maintenant complet.',
        sms: 'CamWallet: Votre KYC est approuvé ! Votre compte est maintenant vérifié.',
      },
      REJECTED: {
        title: 'KYC rejeté',
        body: `Votre dossier KYC a été rejeté.${dto.comment ? ' Motif : ' + dto.comment : ''}`,
        sms: "CamWallet: Votre dossier KYC a été rejeté. Reconnectez-vous pour plus d'infos.",
      },
      RESUBMIT_REQUIRED: {
        title: 'Nouveau document requis',
        body: `Veuillez soumettre de nouveaux documents KYC.${dto.comment ? ' Motif : ' + dto.comment : ''}`,
        sms: 'CamWallet: Nouveau document requis pour votre KYC. Reconnectez-vous pour soumettre.',
      },
    };
    const notif = pushConfig[dto.decision];
    if (notif) {
      void this.notifications.sendToUser(userId, notif.title, notif.body, { type: 'KYC', status: newStatus });
      const smsUser = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
      if (smsUser) void this.sms.sendSms(smsUser.phone, notif.sms);
    }

    return user;
  }

  // Relance manuelle de la pré-validation IA (Claude Vision) sur un dossier KYC.
  // Utile pour les dossiers soumis avant l'activation de l'IA (champs aiScore
  // nuls) : un agent peut déclencher l'analyse à la demande depuis la modale.
  async analyzeKyc(adminId: string, userId: string) {
    if (!this.kycAi.isConfigured()) {
      throw new BadRequestException('Analyse IA non configurée (ANTHROPIC_API_KEY absente).');
    }

    const doc = await this.prisma.kycDocument.findUnique({
      where: { userId },
      select: { idFrontUrl: true, idBackUrl: true, selfieUrl: true },
    });
    if (!doc?.idFrontUrl || !doc.idBackUrl || !doc.selfieUrl) {
      throw new NotFoundException('Documents KYC introuvables ou incomplets.');
    }

    const [idFront, idBack, selfie] = await Promise.all([
      this.imageUrlToBase64(doc.idFrontUrl),
      this.imageUrlToBase64(doc.idBackUrl),
      this.imageUrlToBase64(doc.selfieUrl),
    ]);

    const res = await this.kycAi.analyzeSubmission({ idFront, idBack, selfie });

    const updated = await this.prisma.kycDocument.update({
      where: { userId },
      data: {
        aiScore: res.score,
        aiSuggestion: res.suggestion,
        aiIssues: res.issues,
        aiAnalyzedAt: new Date(),
      },
      select: { aiScore: true, aiSuggestion: true, aiIssues: true, aiAnalyzedAt: true },
    });

    await this.writeAudit(adminId, 'KYC_AI_ANALYZE', `User:${userId}`, {
      score: res.score,
      suggestion: res.suggestion,
    });

    return updated;
  }

  // Convertit une URL d'image (data URI dev ou URL Cloudinary) en base64 brut.
  // Anti-SSRF : les URLs KYC sont produites par CloudinaryService (data URI ou
  // secure_url Cloudinary) ; on n'autorise donc QUE le data URI ou un hôte
  // Cloudinary en https, et on bloque les redirections (rebond interne).
  private async imageUrlToBase64(url: string): Promise<string> {
    const dataUri = url.match(/^data:image\/[a-z]+;base64,(.+)$/i);
    if (dataUri) return dataUri[1];

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('URL image invalide.');
    }
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const allowedHost = host === 'res.cloudinary.com' || host.endsWith('.cloudinary.com');
    if (parsed.protocol !== 'https:' || !allowedHost) {
      throw new BadRequestException('Source image non autorisée.');
    }

    // redirect: 'error' → empêche un 3xx de rebondir vers un hôte interne.
    const resp = await fetch(url, { redirect: 'error' });
    if (!resp.ok) throw new BadRequestException(`Image inaccessible (${resp.status})`);
    if (!(resp.headers.get('content-type') ?? '').toLowerCase().startsWith('image/')) {
      throw new BadRequestException('Contenu non-image refusé.');
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 10 * 1024 * 1024) throw new BadRequestException('Image trop volumineuse (max 10 Mo).');
    return buf.toString('base64');
  }

  // ─── Alertes (dérivées des données réelles) ───────────────────────────────
  async getAlerts() {
    const d7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
    const LARGE = 5_000_000n; // 50 000 FCFA en centimes

    const [failedCount, stalePending, restrictedUsers, flagged] = await Promise.all([
      this.prisma.transaction.count({
        where: { status: TransactionStatus.FAILED, createdAt: { gte: d7 } },
      }),
      this.prisma.transaction.count({
        where: { status: TransactionStatus.PENDING, createdAt: { lt: oneHourAgo } },
      }),
      this.prisma.user.count({
        where: { status: { in: [UserStatus.LOCKED, UserStatus.SUSPENDED] } },
      }),
      this.prisma.transaction.findMany({
        where: {
          createdAt: { gte: d7 },
          OR: [{ status: TransactionStatus.FAILED }, { amount: { gte: LARGE } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          sender: { select: { phone: true, fullName: true } },
          receiver: { select: { phone: true, fullName: true } },
        },
      }),
    ]);

    const alerts: { id: string; type: 'error' | 'warn' | 'info'; title: string; desc: string }[] = [];
    if (failedCount > 0)
      alerts.push({
        id: 'failed',
        type: 'error',
        title: 'Transactions échouées',
        desc: `${failedCount} échec(s) sur les 7 derniers jours`,
      });
    if (stalePending > 0)
      alerts.push({
        id: 'pending',
        type: 'warn',
        title: 'Transactions en attente',
        desc: `${stalePending} transaction(s) bloquée(s) depuis plus d'une heure`,
      });
    if (restrictedUsers > 0)
      alerts.push({
        id: 'users',
        type: 'warn',
        title: 'Comptes restreints',
        desc: `${restrictedUsers} compte(s) bloqué(s) ou suspendu(s)`,
      });
    if (alerts.length === 0)
      alerts.push({
        id: 'ok',
        type: 'info',
        title: 'Aucune anomalie',
        desc: 'Aucune alerte active sur la période',
      });

    return { alerts, flagged };
  }

  // ─── Séries temporelles (graphiques dashboard) ────────────────────────────
  // Données réelles agrégées par jour sur la période. Les jours sans activité
  // sont remplis à 0 pour une courbe continue. Montants en centimes FCFA.
  async getTimeseries(period: string) {
    const days = period === '90d' ? 90 : period === '30d' ? 30 : 7;
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(todayUtc - (days - 1) * 86400000);

    const txRows = await this.prisma.$queryRaw<
      Array<{ day: Date; tx: number; volume: bigint; fees: bigint }>
    >`
      SELECT date_trunc('day', "createdAt")::date AS day,
             COUNT(*)::int AS tx,
             COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN amount ELSE 0 END), 0)::bigint AS volume,
             COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN fee ELSE 0 END), 0)::bigint AS fees
      FROM "transactions"
      WHERE "createdAt" >= ${start}
      GROUP BY day
    `;
    const userRows = await this.prisma.$queryRaw<Array<{ day: Date; users: number }>>`
      SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS users
      FROM "users"
      WHERE "createdAt" >= ${start}
      GROUP BY day
    `;

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const txMap = new Map(txRows.map((r) => [key(new Date(r.day)), r]));
    const userMap = new Map(userRows.map((r) => [key(new Date(r.day)), Number(r.users)]));

    const series = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const k = key(d);
      const t = txMap.get(k);
      series.push({
        date: k,
        volume: t ? t.volume : 0n,
        fees: t ? t.fees : 0n,
        transactions: t ? Number(t.tx) : 0,
        users: userMap.get(k) ?? 0,
      });
    }

    return { period, days, series };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Analytique avancée (page « Analytique » du dashboard admin)
  // Tous les montants sont retournés en centimes (BigInt → Number par le
  // sérialiseur global). Requêtes SQL brutes calquées sur getTimeseries().
  // ═══════════════════════════════════════════════════════════════════════════

  // Rétention + volumes moyens.
  async getAnalyticsRetention() {
    const now = Date.now();
    const d7 = new Date(now - 7 * 86400000);
    const d30 = new Date(now - 30 * 86400000);

    const [total, active7Rows, active30Rows, aggRows] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.$queryRaw<Array<{ c: number }>>`
        SELECT COUNT(DISTINCT u)::int AS c FROM (
          SELECT "senderId" AS u FROM "transactions" WHERE status='COMPLETED' AND "createdAt">=${d7} AND "senderId" IS NOT NULL
          UNION
          SELECT "receiverId" AS u FROM "transactions" WHERE status='COMPLETED' AND "createdAt">=${d7} AND "receiverId" IS NOT NULL
        ) x`,
      this.prisma.$queryRaw<Array<{ c: number }>>`
        SELECT COUNT(DISTINCT u)::int AS c FROM (
          SELECT "senderId" AS u FROM "transactions" WHERE status='COMPLETED' AND "createdAt">=${d30} AND "senderId" IS NOT NULL
          UNION
          SELECT "receiverId" AS u FROM "transactions" WHERE status='COMPLETED' AND "createdAt">=${d30} AND "receiverId" IS NOT NULL
        ) x`,
      this.prisma.$queryRaw<Array<{ avgtx: bigint; totalvol: bigint; vol30: bigint }>>`
        SELECT
          COALESCE(AVG(CASE WHEN status='COMPLETED' THEN amount END), 0)::bigint AS avgtx,
          COALESCE(SUM(CASE WHEN status='COMPLETED' THEN amount ELSE 0 END), 0)::bigint AS totalvol,
          COALESCE(SUM(CASE WHEN status='COMPLETED' AND "createdAt">=${d30} THEN amount ELSE 0 END), 0)::bigint AS vol30
        FROM "transactions"`,
    ]);

    const active7d = active7Rows[0]?.c ?? 0;
    const active30d = active30Rows[0]?.c ?? 0;
    const totalVol = Number(aggRows[0]?.totalvol ?? 0n);
    return {
      total,
      active7d,
      active30d,
      retention7d: total > 0 ? Math.round((active7d / total) * 100) : 0,
      retention30d: total > 0 ? Math.round((active30d / total) * 100) : 0,
      avgPerTransaction: Number(aggRows[0]?.avgtx ?? 0n),
      avgPerUser: total > 0 ? Math.round(totalVol / total) : 0,
      avgPerDay: Math.round(Number(aggRows[0]?.vol30 ?? 0n) / 30),
    };
  }

  // Inscriptions par jour + cumul (le cumul inclut les inscriptions antérieures
  // à la fenêtre, donc le premier point part du total existant).
  async getAnalyticsAcquisition(period: string) {
    const days = period === '90d' ? 90 : period === '30d' ? 30 : 7;
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(todayUtc - (days - 1) * 86400000);

    const [rows, baseRow] = await Promise.all([
      this.prisma.$queryRaw<Array<{ day: Date; signups: number }>>`
        SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS signups
        FROM "users" WHERE "createdAt" >= ${start} GROUP BY day`,
      this.prisma.$queryRaw<Array<{ c: number }>>`
        SELECT COUNT(*)::int AS c FROM "users" WHERE "createdAt" < ${start}`,
    ]);

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const map = new Map(rows.map((r) => [key(new Date(r.day)), Number(r.signups)]));
    let cumulative = baseRow[0]?.c ?? 0;
    const series = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const k = key(d);
      const signups = map.get(k) ?? 0;
      cumulative += signups;
      series.push({ date: k, signups, cumulative });
    }
    return { period, days, series };
  }

  // Top marchands (par volume reçu, tout l'historique).
  async getAnalyticsTopMerchants(limit = 10) {
    const take = Math.min(50, Math.max(1, +limit || 10));
    const rows = await this.prisma.$queryRaw<Array<{ userId: string; fullName: string | null; phone: string; volume: bigint; count: number }>>`
      SELECT u.id AS "userId", u."fullName" AS "fullName", u.phone AS phone,
             SUM(t.amount)::bigint AS volume, COUNT(*)::int AS count
      FROM "transactions" t JOIN "users" u ON u.id = t."receiverId"
      WHERE t.status='COMPLETED' AND t."receiverId" IS NOT NULL
      GROUP BY u.id, u."fullName", u.phone
      ORDER BY volume DESC LIMIT ${take}`;
    return { merchants: rows.map((r) => ({ userId: r.userId, fullName: r.fullName, phone: r.phone, volume: r.volume, count: Number(r.count) })) };
  }

  // Top utilisateurs (par volume envoyé, tout l'historique).
  async getAnalyticsTopUsers(limit = 10) {
    const take = Math.min(50, Math.max(1, +limit || 10));
    const rows = await this.prisma.$queryRaw<Array<{ userId: string; fullName: string | null; phone: string; volume: bigint; count: number }>>`
      SELECT u.id AS "userId", u."fullName" AS "fullName", u.phone AS phone,
             SUM(t.amount)::bigint AS volume, COUNT(*)::int AS count
      FROM "transactions" t JOIN "users" u ON u.id = t."senderId"
      WHERE t.status='COMPLETED' AND t."senderId" IS NOT NULL
      GROUP BY u.id, u."fullName", u.phone
      ORDER BY volume DESC LIMIT ${take}`;
    return { users: rows.map((r) => ({ userId: r.userId, fullName: r.fullName, phone: r.phone, volume: r.volume, count: Number(r.count) })) };
  }

  // Heatmap activité : jour de semaine (0=dimanche) × heure, sur 30 jours.
  async getAnalyticsHeatmap() {
    const d30 = new Date(Date.now() - 30 * 86400000);
    const rows = await this.prisma.$queryRaw<Array<{ dow: number; hour: number; count: number }>>`
      SELECT EXTRACT(DOW FROM "createdAt")::int AS dow,
             EXTRACT(HOUR FROM "createdAt")::int AS hour,
             COUNT(*)::int AS count
      FROM "transactions" WHERE "createdAt" >= ${d30}
      GROUP BY dow, hour`;
    return { cells: rows.map((r) => ({ dow: Number(r.dow), hour: Number(r.hour), count: Number(r.count) })) };
  }

  // Entonnoir KYC : PENDING → SUBMITTED → APPROVED.
  async getAnalyticsKycFunnel() {
    const rows = await this.prisma.user.groupBy({ by: ['kycStatus'], _count: { _all: true } });
    const cnt = (s: string) => rows.find((r) => r.kycStatus === s)?._count._all ?? 0;
    const pending = cnt('PENDING');
    const submitted = cnt('SUBMITTED');
    const approved = cnt('APPROVED');
    const rejected = cnt('REJECTED') + cnt('RESUBMIT_REQUIRED');
    const total = rows.reduce((s, r) => s + r._count._all, 0);
    const processed = submitted + approved + rejected;
    return {
      pending,
      submitted,
      approved,
      rejected,
      total,
      submittedRate: total > 0 ? Math.round((processed / total) * 100) : 0,
      approvedRate: processed > 0 ? Math.round((approved / processed) * 100) : 0,
    };
  }

  // Répartition géographique par RÉGION du Cameroun (carte choroplèthe admin).
  // On agrège les villes des émetteurs vers les 10 régions ; ville principale
  // retournée pour l'étiquette.
  async getAnalyticsGeo() {
    const d30 = new Date(Date.now() - 30 * 86400000);
    const rows = await this.prisma.$queryRaw<Array<{ city: string; count: number; volume: bigint }>>`
      SELECT COALESCE(NULLIF(TRIM(u.city), ''), '') AS city,
             COUNT(*)::int AS count, SUM(t.amount)::bigint AS volume
      FROM "transactions" t JOIN "users" u ON u.id = t."senderId"
      WHERE t.status='COMPLETED' AND t."createdAt" >= ${d30} AND t."senderId" IS NOT NULL
      GROUP BY 1`;

    // Ville → région (clé normalisée : minuscules, sans accents).
    const REGION_CITY: Record<string, string> = {
      Adamaoua: 'Ngaoundéré', Centre: 'Yaoundé', Est: 'Bertoua', 'Extrême-Nord': 'Maroua',
      Littoral: 'Douala', Nord: 'Garoua', 'Nord-Ouest': 'Bamenda', Ouest: 'Bafoussam',
      Sud: 'Ebolowa', 'Sud-Ouest': 'Buea',
    };
    const CITY_TO_REGION: Record<string, string> = {
      douala: 'Littoral', edea: 'Littoral', nkongsamba: 'Littoral',
      yaounde: 'Centre', mbalmayo: 'Centre', obala: 'Centre',
      bafoussam: 'Ouest', dschang: 'Ouest', mbouda: 'Ouest', bandjoun: 'Ouest',
      garoua: 'Nord', guider: 'Nord',
      maroua: 'Extrême-Nord', kousseri: 'Extrême-Nord', kaele: 'Extrême-Nord',
      ngaoundere: 'Adamaoua', tibati: 'Adamaoua',
      bertoua: 'Est', batouri: 'Est', abongmbang: 'Est',
      ebolowa: 'Sud', kribi: 'Sud', sangmelima: 'Sud',
      buea: 'Sud-Ouest', limbe: 'Sud-Ouest', kumba: 'Sud-Ouest', tiko: 'Sud-Ouest',
      bamenda: 'Nord-Ouest', kumbo: 'Nord-Ouest', wum: 'Nord-Ouest',
    };
    const norm = (c: string) => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

    const byRegion = new Map<string, { transactions: number; volume: bigint }>();
    for (const r of rows) {
      const region = CITY_TO_REGION[norm(r.city)];
      if (!region) continue;
      const cur = byRegion.get(region) ?? { transactions: 0, volume: 0n };
      cur.transactions += Number(r.count);
      cur.volume += r.volume;
      byRegion.set(region, cur);
    }

    const regions = Object.keys(REGION_CITY)
      .map((name) => {
        const d = byRegion.get(name);
        return { name, city: REGION_CITY[name], transactions: d?.transactions ?? 0, volume: d?.volume ?? 0n };
      })
      .filter((r) => r.transactions > 0)
      .sort((a, b) => Number(b.volume - a.volume));

    return { regions };
  }

  // Volume par jour ventilé par type (pour le BarChart groupé du dashboard).
  async getVolumeByType(period: string) {
    const days = period === '90d' ? 90 : period === '30d' ? 30 : 7;
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(todayUtc - (days - 1) * 86400000);

    const rows = await this.prisma.$queryRaw<Array<{ day: Date; type: string; volume: bigint }>>`
      SELECT date_trunc('day', "createdAt")::date AS day, type::text AS type,
             COALESCE(SUM(amount), 0)::bigint AS volume
      FROM "transactions"
      WHERE status='COMPLETED' AND "createdAt" >= ${start}
        AND type IN ('P2P','QR_PAYMENT','RECHARGE','WITHDRAWAL')
      GROUP BY day, type`;

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const map = new Map<string, Record<string, bigint>>();
    for (const r of rows) {
      const k = key(new Date(r.day));
      if (!map.has(k)) map.set(k, {});
      map.get(k)![r.type] = r.volume;
    }
    const series = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const m = map.get(key(d)) ?? {};
      series.push({
        date: key(d),
        P2P: m.P2P ?? 0n,
        QR_PAYMENT: m.QR_PAYMENT ?? 0n,
        RECHARGE: m.RECHARGE ?? 0n,
        WITHDRAWAL: m.WITHDRAWAL ?? 0n,
      });
    }
    return { period, days, series };
  }

  // ─── Détail utilisateur (vue admin) ───────────────────────────────────────
  async getUserDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        phone: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        dateOfBirth: true,
        city: true,
        role: true,
        status: true,
        kycStatus: true,
        lastLoginAt: true,
        createdAt: true,
        wallet: { select: { balance: true, currency: true, isActive: true } },
        kycDocument: {
          select: {
            idFrontUrl: true,
            idBackUrl: true,
            selfieUrl: true,
            status: true,
            reviewNote: true,
            reviewedAt: true,
            submittedAt: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [transactions, audit, sent, received, monthlyVolume] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { OR: [{ senderId: id }, { receiverId: id }] },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          sender: { select: { phone: true, fullName: true } },
          receiver: { select: { phone: true, fullName: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: { resource: `User:${id}` },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          action: true,
          metadata: true,
          createdAt: true,
          user: { select: { fullName: true, email: true } },
        },
      }),
      this.prisma.transaction.aggregate({
        _count: { _all: true },
        _sum: { amount: true },
        where: { senderId: id, status: TransactionStatus.COMPLETED },
      }),
      this.prisma.transaction.aggregate({
        _count: { _all: true },
        _sum: { amount: true },
        where: { receiverId: id, status: TransactionStatus.COMPLETED },
      }),
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: {
          OR: [{ senderId: id }, { receiverId: id }],
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: d30 },
        },
      }),
    ]);

    const monthlyVol = monthlyVolume._sum.amount ?? 0n;
    const anifRisk =
      monthlyVol >= ANIF_RISK_HIGH ? 'Élevé'
      : monthlyVol >= ANIF_RISK_MED ? 'Moyen'
      : 'Bas';

    return {
      user,
      transactions,
      audit,
      stats: {
        transactionsCount: sent._count._all + received._count._all,
        totalSent: sent._sum.amount ?? 0n,
        totalReceived: received._sum.amount ?? 0n,
        monthlyVolume: monthlyVol,
        anifRisk,
      },
    };
  }

  // ─── Conformité ANIF ──────────────────────────────────────────────────────
  // Transactions dépassant les seuils réglementaires + dossiers ouverts.
  async getAnifAlerts() {
    const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const d24h = new Date(Date.now() - 24 * 3600 * 1000);
    const ANIF_THRESHOLD    = 50_000_000n;  // 500 000 FCFA en centimes
    const SMURFING_UNIT_MAX = 5_000_000n;   //  50 000 FCFA en centimes (seuil par transaction)
    const SMURFING_TOTAL    = 30_000_000n;  // 300 000 FCFA en centimes (total agrégé)
    const UNUSUAL_LOW       = 49_000_000n;  // 490 000 FCFA — juste sous le seuil
    const UNUSUAL_HIGH      = 50_000_000n;  // 500 000 FCFA — exclu (géré par highValue)

    const [largeTx, frequentSenders, cases, unusualTx] = await Promise.all([
      // Transactions dépassant le seuil ANIF sur 30 jours
      this.prisma.transaction.findMany({
        where: { amount: { gte: ANIF_THRESHOLD }, createdAt: { gte: d30 } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          sender: { select: { phone: true, fullName: true, kycStatus: true } },
          receiver: { select: { phone: true, fullName: true } },
        },
      }),
      // Émetteurs avec fréquence anormale (> 10 tx en 24h)
      this.prisma.transaction.groupBy({
        by: ['senderId'],
        where: {
          createdAt: { gte: d24h },
          status: { not: TransactionStatus.FAILED },
          senderId: { not: null },
        },
        _count: { _all: true },
        having: { senderId: { _count: { gt: 10 } } },
      }),
      // Dossiers ANIF (ouverts et fermés)
      this.prisma.auditLog.findMany({
        where: { action: { startsWith: 'ANIF_CASE_' } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true, action: true, resource: true, metadata: true, createdAt: true,
          user: { select: { fullName: true, email: true } },
        },
      }),
      // Montants inhabituels : juste sous le seuil ANIF (contournement probable)
      this.prisma.transaction.findMany({
        where: {
          amount: { gte: UNUSUAL_LOW, lt: UNUSUAL_HIGH },
          createdAt: { gte: d30 },
          status: { not: TransactionStatus.FAILED },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          sender: { select: { phone: true, fullName: true } },
          receiver: { select: { phone: true, fullName: true } },
        },
      }),
    ]);

    // Récupère les détails utilisateurs des émetteurs fréquents
    const frequentSenderIds = frequentSenders
      .filter((s) => s.senderId !== null)
      .map((s) => s.senderId as string);
    const frequentUserDetails = frequentSenderIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: frequentSenderIds } },
          select: { id: true, phone: true, fullName: true },
        })
      : [];
    const frequentWithDetails = frequentSenders.map((s) => {
      const u = frequentUserDetails.find((u) => u.id === s.senderId);
      return {
        senderId: s.senderId,
        count: s._count._all,
        phone: u?.phone ?? '—',
        fullName: u?.fullName ?? null,
      };
    });

    // ── Détection smurfing ──────────────────────────────────────────────────
    // Utilisateurs ayant envoyé > 10 tx en 24h, chacune < 50 000 FCFA,
    // mais dont le total dépasse 300 000 FCFA.
    const smurfingCandidates = frequentSenders.filter(
      (s) => s.senderId !== null && s._count._all > 10,
    );

    let smurfingAlerts: {
      senderId: string;
      count: number;
      totalAmount: bigint;
      phone: string;
      fullName: string | null;
    }[] = [];

    if (smurfingCandidates.length > 0) {
      const smurfingChecks = await Promise.all(
        smurfingCandidates.map(async (s) => {
          const agg = await this.prisma.transaction.aggregate({
            _sum: { amount: true },
            _count: { _all: true },
            where: {
              senderId: s.senderId!,
              createdAt: { gte: d24h },
              status: { not: TransactionStatus.FAILED },
              amount: { lt: SMURFING_UNIT_MAX },
            },
          });
          const total = agg._sum.amount ?? 0n;
          const count = agg._count._all;
          return { senderId: s.senderId!, count, total };
        }),
      );

      const matchedIds = smurfingChecks
        .filter((c) => c.count > 10 && c.total > SMURFING_TOTAL)
        .map((c) => c.senderId);

      const smurfUsers = matchedIds.length
        ? await this.prisma.user.findMany({
            where: { id: { in: matchedIds } },
            select: { id: true, phone: true, fullName: true },
          })
        : [];

      smurfingAlerts = smurfingChecks
        .filter((c) => c.count > 10 && c.total > SMURFING_TOTAL)
        .map((c) => {
          const u = smurfUsers.find((u) => u.id === c.senderId);
          return {
            senderId: c.senderId,
            count: c.count,
            totalAmount: c.total,
            phone: u?.phone ?? '—',
            fullName: u?.fullName ?? null,
          };
        });
    }

    return {
      highValue: largeTx.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        type: tx.type,
        status: tx.status,
        sender: tx.sender,
        receiver: tx.receiver,
        createdAt: tx.createdAt,
      })),
      frequentSenders: frequentWithDetails,
      smurfing: smurfingAlerts,
      unusualAmounts: unusualTx.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        type: tx.type,
        status: tx.status,
        sender: tx.sender,
        receiver: tx.receiver,
        createdAt: tx.createdAt,
        flag: 'JUSTE_SOUS_SEUIL',
      })),
      cases,
      threshold: ANIF_THRESHOLD.toString(),
    };
  }

  async openAnifCase(adminId: string, transactionId: string, reason: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { id: true, reference: true, amount: true },
    });

    await this.writeAudit(adminId, 'ANIF_CASE_OPEN', `Transaction:${transactionId}`, {
      reason,
      reference: tx?.reference ?? transactionId,
      amount: tx?.amount?.toString(),
      caseRef: `ANIF-${Date.now()}`,
    });

    return { ok: true, caseRef: `ANIF-${Date.now()}` };
  }

  // ─── Opérations OM/MoMo (Recharges & Retraits) ───────────────────────────
  async getOperations(
    page = 1,
    limit = 20,
    operator?: string,
    status?: string,
    type?: string,
    search?: string,
    period?: string,
  ) {
    const skip = (page - 1) * limit;

    // Filtres de la liste paginée (recharges + retraits uniquement).
    const txWhere: any = {
      type: { in: [TransactionType.RECHARGE, TransactionType.WITHDRAWAL] },
    };
    if (operator) txWhere.operator = operator;
    if (status) txWhere.status = status;
    if (type === 'RECHARGE' || type === 'WITHDRAWAL') txWhere.type = type;
    if (search?.trim()) {
      const q = search.trim();
      txWhere.OR = [
        { operatorRef: { contains: q, mode: 'insensitive' } },
        { reference: { contains: q, mode: 'insensitive' } },
        { sender: { fullName: { contains: q, mode: 'insensitive' } } },
        { sender: { phone: { contains: q } } },
        { receiver: { fullName: { contains: q, mode: 'insensitive' } } },
        { receiver: { phone: { contains: q } } },
      ];
    }
    // Période de la liste : 7/30/90 jours (par défaut : pas de borne).
    const periodDays = period === '90d' ? 90 : period === '30d' ? 30 : period === '7d' ? 7 : 0;
    if (periodDays > 0) {
      txWhere.createdAt = { gte: new Date(Date.now() - periodDays * 86400000) };
    }

    const whWhere: any = {};
    if (operator) whWhere.operator = operator;

    const now = Date.now();
    const d7 = new Date(now - 7 * 86400000);
    const d14 = new Date(now - 14 * 86400000);
    // Début de journée UTC il y a 6 jours → fenêtre glissante de 7 jours pour le graphe.
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const chartStart = new Date(todayUtc - 6 * 86400000);

    const completedRecharge = { type: TransactionType.RECHARGE, status: TransactionStatus.COMPLETED };
    const completedWithdrawal = { type: TransactionType.WITHDRAWAL, status: TransactionStatus.COMPLETED };

    const [
      operations,
      total,
      rechargeVol,
      withdrawalVol,
      prevRechargeVol,
      prevWithdrawalVol,
      completed7d,
      failed7d,
      webhookEvents,
      pendingWebhooks,
      chartRows,
    ] = await Promise.all([
      this.prisma.transaction.findMany({
        where: txWhere,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: { select: { phone: true, fullName: true } },
          receiver: { select: { phone: true, fullName: true } },
        },
      }),
      this.prisma.transaction.count({ where: txWhere }),
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: { ...completedRecharge, createdAt: { gte: d7 } },
      }),
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: { ...completedWithdrawal, createdAt: { gte: d7 } },
      }),
      // Fenêtre précédente (J-14 → J-7) pour calculer la tendance.
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { ...completedRecharge, createdAt: { gte: d14, lt: d7 } },
      }),
      this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { ...completedWithdrawal, createdAt: { gte: d14, lt: d7 } },
      }),
      // Taux de succès sur 7 j : complétées vs (complétées + échouées).
      this.prisma.transaction.count({
        where: { type: { in: [TransactionType.RECHARGE, TransactionType.WITHDRAWAL] }, status: TransactionStatus.COMPLETED, createdAt: { gte: d7 } },
      }),
      this.prisma.transaction.count({
        where: { type: { in: [TransactionType.RECHARGE, TransactionType.WITHDRAWAL] }, status: TransactionStatus.FAILED, createdAt: { gte: d7 } },
      }),
      // 50 derniers événements webhook (toutes opérations MoMo)
      this.prisma.webhookEvent.findMany({
        where: whWhere,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          operator: true,
          eventType: true,
          payload: true,
          processed: true,
          processedAt: true,
          error: true,
          createdAt: true,
        },
      }),
      this.prisma.webhookEvent.count({ where: { ...whWhere, processed: false } }),
      // Graphe : volume complété par jour et par type, sur 7 jours glissants.
      this.prisma.$queryRaw<Array<{ day: Date; type: string; total: bigint }>>`
        SELECT date_trunc('day', "createdAt")::date AS day, type,
               COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN amount ELSE 0 END), 0)::bigint AS total
        FROM "transactions"
        WHERE type IN ('RECHARGE', 'WITHDRAWAL') AND "createdAt" >= ${chartStart}
        GROUP BY day, type
      `,
    ]);

    // Reconstruit la série continue de 7 jours (jours vides à 0).
    const keyOf = (d: Date) => d.toISOString().slice(0, 10);
    const chartMap = new Map<string, { recharge: number; withdrawal: number }>();
    for (const r of chartRows) {
      const k = keyOf(new Date(r.day));
      const e = chartMap.get(k) ?? { recharge: 0, withdrawal: 0 };
      if (r.type === 'RECHARGE') e.recharge = Number(r.total);
      else if (r.type === 'WITHDRAWAL') e.withdrawal = Number(r.total);
      chartMap.set(k, e);
    }
    const chart = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(chartStart.getTime() + i * 86400000);
      const k = keyOf(d);
      const e = chartMap.get(k) ?? { recharge: 0, withdrawal: 0 };
      chart.push({ date: k, recharge: e.recharge, withdrawal: e.withdrawal });
    }

    // Tendance en % (volume 7 j vs 7 j précédents) ; null si pas de base.
    const trend = (cur: bigint, prev: bigint): number | null => {
      const p = Number(prev);
      if (p <= 0) return null;
      return Math.round(((Number(cur) - p) / p) * 100);
    };

    const completedTotal = completed7d + failed7d;
    const successRate = completedTotal > 0 ? Math.round((completed7d / completedTotal) * 100) : null;

    return {
      data: operations,
      total,
      page,
      limit,
      stats: {
        rechargeCount: rechargeVol._count._all,
        rechargeTotal: rechargeVol._sum.amount ?? 0n,
        rechargeTrend: trend(rechargeVol._sum.amount ?? 0n, prevRechargeVol._sum.amount ?? 0n),
        withdrawalCount: withdrawalVol._count._all,
        withdrawalTotal: withdrawalVol._sum.amount ?? 0n,
        withdrawalTrend: trend(withdrawalVol._sum.amount ?? 0n, prevWithdrawalVol._sum.amount ?? 0n),
        pendingWebhooks,
        successRate,
      },
      chart,
      webhookEvents,
    };
  }

  async retryOperation(adminId: string, id: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id },
      select: { id: true, status: true, type: true, retryCount: true },
    });
    if (!tx) throw new NotFoundException('Opération introuvable');
    if (tx.status !== TransactionStatus.PENDING && tx.status !== TransactionStatus.FAILED) {
      throw new NotFoundException('Seules les opérations PENDING ou FAILED peuvent être relancées');
    }

    await this.prisma.transaction.update({
      where: { id },
      // Une opération échouée repart en attente d'un nouveau callback opérateur.
      data: {
        retryCount: { increment: 1 },
        ...(tx.status === TransactionStatus.FAILED ? { status: TransactionStatus.PENDING, failureReason: null } : {}),
      },
    });

    await this.writeAudit(adminId, 'OPERATION_RETRY', `Transaction:${id}`, {
      previousRetryCount: tx.retryCount,
    });
    return { ok: true };
  }

  // ─── Santé des intégrations ───────────────────────────────────────────────
  // Mesure la latence réseau réelle vers une URL (n'importe quelle réponse HTTP
  // compte comme « joignable » : on mesure le round-trip, pas le code retour).
  private async pingLatency(url: string, timeoutMs = 4000): Promise<{ latency: number | null; reachable: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    try {
      await fetch(url, { method: 'GET', signal: controller.signal });
      return { latency: Date.now() - start, reachable: true };
    } catch {
      return { latency: null, reachable: false };
    } finally {
      clearTimeout(timer);
    }
  }

  // Santé d'un opérateur Mobile Money à partir des transactions des 7 derniers
  // jours : UP si au moins une COMPLETED, DEGRADED si uniquement des FAILED,
  // sinon UNKNOWN (« Non testé » côté UI), ou DOWN si la passerelle est injoignable.
  private async operatorHealth(operator: 'ORANGE_MONEY' | 'MTN_MOMO', since: Date, reachable: boolean) {
    const [completed, failed, lastSuccessTx] = await Promise.all([
      this.prisma.transaction.count({ where: { operator, status: TransactionStatus.COMPLETED, createdAt: { gte: since } } }),
      this.prisma.transaction.count({ where: { operator, status: TransactionStatus.FAILED, createdAt: { gte: since } } }),
      this.prisma.transaction.findFirst({
        where: { operator, status: TransactionStatus.COMPLETED },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, processedAt: true },
      }),
    ]);

    const txCount7d = completed + failed;
    const uptime = txCount7d > 0 ? Math.round((completed / txCount7d) * 100) : null;
    const lastSuccess = lastSuccessTx ? (lastSuccessTx.processedAt ?? lastSuccessTx.createdAt) : null;
    const status =
      completed > 0 ? 'UP' : failed > 0 ? 'DEGRADED' : reachable ? 'UNKNOWN' : 'DOWN';

    return { txCount7d, completed, failed, uptime, lastSuccess, status };
  }

  async getHealthIntegrations() {
    const now = Date.now();
    const d24h = new Date(now - 24 * 3600 * 1000);
    const d7d = new Date(now - 7 * 24 * 3600 * 1000);
    const d1h = new Date(now - 3600 * 1000);

    // Ping réel de la passerelle CamPay (agrégateur OM + MTN) → latence partagée.
    const campayUrl = this.config.get<string>('CAMPAY_BASE_URL') || 'https://demo.campay.net/api';
    const [gateway, stalePending, failedWebhooks] = await Promise.all([
      this.pingLatency(campayUrl),
      this.prisma.transaction.count({ where: { status: TransactionStatus.PENDING, createdAt: { lt: d1h } } }),
      this.prisma.webhookEvent.count({ where: { processed: false, createdAt: { gte: d24h } } }),
    ]);

    // Santé opérateur sur 7 jours (le sandbox a peu de trafic sur 24h → souvent « Non testé »).
    // Pings AfricasTalking + Anthropic en parallèle (no-op si clé non configurée).
    const [om, mtn, smsPing, aiPing, cloudPing] = await Promise.all([
      this.operatorHealth('ORANGE_MONEY', d7d, gateway.reachable),
      this.operatorHealth('MTN_MOMO', d7d, gateway.reachable),
      this.sms.ping(),
      this.kycAi.ping(),
      this.cloudinary.ping(),
    ]);
    const smsConfigured = this.sms.isConfigured();
    const aiConfigured = this.kycAi.isConfigured();
    const cloudConfigured = this.cloudinary.isConfigured;

    return {
      integrations: [
        {
          name: 'Orange Money',
          key: 'orange_money',
          status: om.status,
          latency: gateway.latency,
          txCount7d: om.txCount7d,
          lastSuccess: om.lastSuccess,
          uptime: om.uptime,
          pendingWebhooks: failedWebhooks,
          note: gateway.reachable ? 'Via passerelle CamPay' : 'Passerelle CamPay injoignable',
        },
        {
          name: 'MTN MoMo',
          key: 'mtn_momo',
          status: mtn.status,
          latency: gateway.latency,
          txCount7d: mtn.txCount7d,
          lastSuccess: mtn.lastSuccess,
          uptime: mtn.uptime,
          note: gateway.reachable ? 'Via passerelle CamPay' : 'Passerelle CamPay injoignable',
        },
        {
          name: 'SMS OTP',
          key: 'sms_otp',
          // Configuré (AT_API_KEY présent) → « UP » si le ping répond, sinon
          // « DOWN ». Non configuré → « SIMULATED » (log console, aucun envoi).
          status: smsConfigured ? (smsPing.reachable ? 'UP' : 'DOWN') : 'SIMULATED',
          latency: smsPing.latency,
          txCount7d: null,
          lastSuccess: null,
          uptime: null,
          note: smsConfigured
            ? smsPing.reachable
              ? smsPing.sandbox
                ? 'AfricasTalking sandbox (pas de livraison réelle)'
                : 'AfricasTalking opérationnel'
              : 'AfricasTalking injoignable'
            : 'Simulation (AfricasTalking non configuré)',
        },
        {
          name: 'Push Expo',
          key: 'expo_push',
          status: 'UP',
          latency: null,
          txCount7d: null,
          lastSuccess: null,
          uptime: null,
          note: 'Expo Push API',
        },
        {
          name: 'IA KYC (Claude Vision)',
          key: 'anthropic_kyc',
          // Configuré (ANTHROPIC_API_KEY présent) → « UP » si le ping répond,
          // sinon « DOWN ». Non configuré → « SIMULATED » (analyse désactivée).
          status: aiConfigured ? (aiPing.reachable ? 'UP' : 'DOWN') : 'SIMULATED',
          latency: aiPing.latency,
          txCount7d: null,
          lastSuccess: null,
          uptime: null,
          note: aiConfigured
            ? aiPing.reachable
              ? 'Anthropic opérationnel (pré-validation KYC)'
              : 'Anthropic injoignable / clé invalide'
            : 'Pré-validation IA désactivée (clé non configurée)',
        },
        {
          name: 'Cloudinary KYC',
          key: 'cloudinary_kyc',
          // Configuré (credentials présents) → « UP » si le ping répond, sinon
          // « DOWN ». Non configuré → « SIMULATED » (stockage local base64).
          status: cloudConfigured ? (cloudPing.reachable ? 'UP' : 'DOWN') : 'SIMULATED',
          latency: cloudPing.latency,
          txCount7d: null,
          lastSuccess: null,
          uptime: null,
          note: cloudConfigured
            ? cloudPing.reachable
              ? 'Cloudinary opérationnel (stockage documents KYC)'
              : 'Cloudinary injoignable / credentials invalides'
            : 'Stockage local base64 (Cloudinary non configuré)',
        },
      ],
      stalePendingTx: stalePending,
      checkedAt: new Date().toISOString(),
    };
  }

  // ─── Rapport ANIF structuré (JSON) ──────────────────────────────────────
  async getAnifReport() {
    const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const ANIF_THRESHOLD    = 50_000_000n;
    const SMURFING_UNIT_MAX = 5_000_000n;
    const SMURFING_TOTAL    = 30_000_000n;
    const UNUSUAL_LOW       = 49_000_000n;

    const [highValueTx, frequentSenders, openCases, unusualTx] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { amount: { gte: ANIF_THRESHOLD }, createdAt: { gte: d30 } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          sender: { select: { phone: true, fullName: true } },
          receiver: { select: { phone: true, fullName: true } },
        },
      }),
      this.prisma.transaction.groupBy({
        by: ['senderId'],
        where: {
          createdAt: { gte: d30 },
          status: { not: TransactionStatus.FAILED },
          senderId: { not: null },
        },
        _count: { _all: true },
        _sum: { amount: true },
        having: { senderId: { _count: { gt: 10 } } },
      }),
      this.prisma.auditLog.findMany({
        where: { action: 'ANIF_CASE_OPEN' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, action: true, resource: true, metadata: true, createdAt: true,
          user: { select: { fullName: true, email: true } },
        },
      }),
      this.prisma.transaction.findMany({
        where: {
          amount: { gte: UNUSUAL_LOW, lt: ANIF_THRESHOLD },
          createdAt: { gte: d30 },
          status: { not: TransactionStatus.FAILED },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          sender: { select: { phone: true, fullName: true } },
          receiver: { select: { phone: true, fullName: true } },
        },
      }),
    ]);

    // Identifier les cas de smurfing parmi les émetteurs fréquents
    const senderIds = frequentSenders
      .filter((s) => s.senderId !== null)
      .map((s) => s.senderId as string);

    const smurfingCount = senderIds.length
      ? (
          await Promise.all(
            frequentSenders.map(async (s) => {
              const agg = await this.prisma.transaction.aggregate({
                _sum: { amount: true },
                _count: { _all: true },
                where: {
                  senderId: s.senderId!,
                  createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
                  status: { not: TransactionStatus.FAILED },
                  amount: { lt: SMURFING_UNIT_MAX },
                },
              });
              return (agg._count._all > 10 && (agg._sum.amount ?? 0n) > SMURFING_TOTAL)
                ? 1
                : 0;
            }),
          )
        ).reduce((a, b) => a + b, 0)
      : 0;

    const senderUsers = senderIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: senderIds } },
          select: { id: true, phone: true, fullName: true },
        })
      : [];

    const frequentSendersList = frequentSenders.map((s) => {
      const u = senderUsers.find((u) => u.id === s.senderId);
      return {
        senderId: s.senderId,
        count: s._count._all,
        totalAmount: s._sum.amount ?? 0n,
        phone: u?.phone ?? '—',
        fullName: u?.fullName ?? null,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      period: '30 derniers jours',
      summary: {
        highValueCount: highValueTx.length,
        smurfingCount,
        frequentSendersCount: frequentSenders.length,
        unusualAmountsCount: unusualTx.length,
        totalOpenCases: openCases.length,
      },
      highValueTransactions: highValueTx.map((tx) => ({
        id: tx.id,
        amount: tx.amount,
        type: tx.type,
        status: tx.status,
        sender: tx.sender,
        receiver: tx.receiver,
        createdAt: tx.createdAt,
      })),
      suspiciousPatterns: {
        smurfers: frequentSendersList.filter(
          (s) => s.count > 10 && s.totalAmount > SMURFING_TOTAL,
        ),
        unusualAmounts: unusualTx.map((tx) => ({
          id: tx.id,
          amount: tx.amount,
          sender: tx.sender,
          receiver: tx.receiver,
          createdAt: tx.createdAt,
          flag: 'JUSTE_SOUS_SEUIL',
        })),
      },
      openCases,
      frequentSenders: frequentSendersList,
    };
  }

  // ─── Paramètres système ──────────────────────────────────────────────────
  private readonly SETTINGS_DEFAULTS: Record<string, string> = {
    daily_limit_fcfa:        '500000',
    monthly_limit_fcfa:      '5000000',
    p2p_fee_rate:            '0',
    session_duration_minutes: '15',
    anif_threshold_fcfa:     '500000',
    // Règles de détection ANIF (activées/désactivées + seuils)
    anif_rule_highvalue:     'on',     // alerte transaction > seuil
    anif_rule_smurfing:      'on',     // fractionnement (>10 tx <50k, total >300k / 24h)
    anif_rule_frequency:     'on',     // fréquence anormale (>10 tx / 24h)
    anif_frequency_max:      '10',     // seuil fréquence tx/24h
    // Sécurité
    require_2fa:             'off',    // 2FA obligatoire pour les admins
    // KYC — auto-approbation par IA (si score IA ≥ seuil)
    kyc_auto_approve:           'off', // approuver sans agent quand l'IA recommande APPROVE
    kyc_auto_approve_threshold: '95',  // seuil de score IA (70-100) ; prioritaire sur l'env
    // Notifications (événements déclenchant alertes email/SMS)
    notify_kyc_submitted:    'on',
    notify_high_value:       'on',
    notify_failed_payment:   'off',
    // Alertes email automatiques (surveillance cron — AlertEmailService).
    // Clés non-anif_ → modifiables SUPER_ADMIN uniquement (cloisonnement existant).
    email_alerts_enabled:     'off', // interrupteur maître
    email_alert_high_value:   'off', // transaction > seuil ANIF
    email_alert_failure_rate: 'off', // taux d'échec recharge/retrait > 10% sur 1h
    email_alert_signups:      'off', // inscriptions > 50/h
    email_alert_kyc_score:    'off', // score IA moyen < 60 sur 24h
    email_alert_admin_failed: 'off', // > 5 connexions admin échouées en 15 min
    alert_email:              '',    // destinataire des alertes (sinon env ALERT_EMAIL)
  };

  async getSettings(): Promise<Record<string, string>> {
    const rows = await this.prisma.systemSettings.findMany();
    const result = { ...this.SETTINGS_DEFAULTS };
    for (const row of rows) {
      result[row.key] = row.value;
    }

    // Seuil d'auto-approbation KYC — priorité : base > env > défaut (95).
    // Si aucune ligne en base, on reflète la variable d'env pour l'affichage.
    if (!rows.some((r) => r.key === 'kyc_auto_approve_threshold')) {
      const envThreshold = this.config.get<string>('KYC_AUTO_APPROVE_THRESHOLD');
      if (envThreshold) result['kyc_auto_approve_threshold'] = envThreshold;
    }

    // Vérification expiration mot de passe admin (rotation 90 jours).
    const changedAtRow = rows.find((r) => r.key === 'admin_password_changed_at');
    if (changedAtRow) {
      const changedAt = new Date(changedAtRow.value);
      const daysSince = (Date.now() - changedAt.getTime()) / (24 * 3600 * 1000);
      if (daysSince > 90) {
        result['admin_password_expired'] = 'true';
      }
    }

    return result;
  }

  async updateSettings(adminId: string, updates: Record<string, string>, adminRole?: string) {
    const allowedKeys = Object.keys(this.SETTINGS_DEFAULTS);
    let entries = Object.entries(updates).filter(([k]) => allowedKeys.includes(k));

    // Cloisonnement par clé : hors SUPER_ADMIN (et token legacy sans sous-rôle),
    // seules les clés de conformité anif_* sont modifiables (page ANIF). Toute
    // tentative sur une autre clé est refusée explicitement (pas d'ignorance
    // silencieuse) pour rester traçable.
    const fullAccess = adminRole == null || adminRole === 'SUPER_ADMIN';
    if (!fullAccess) {
      const forbidden = entries.filter(([k]) => !k.startsWith('anif_')).map(([k]) => k);
      if (forbidden.length) {
        throw new ForbiddenException(
          `Ce sous-rôle ne peut modifier que les paramètres ANIF (clés refusées : ${forbidden.join(', ')})`,
        );
      }
      entries = entries.filter(([k]) => k.startsWith('anif_'));
    }

    // Validation : le seuil d'auto-approbation KYC doit être un entier 70-100.
    const thr = entries.find(([k]) => k === 'kyc_auto_approve_threshold');
    if (thr) {
      const n = Number(thr[1]);
      if (!Number.isInteger(n) || n < 70 || n > 100) {
        throw new BadRequestException('Le seuil d\'auto-approbation doit être un entier entre 70 et 100.');
      }
    }

    await Promise.all(
      entries.map(([key, value]) =>
        this.prisma.systemSettings.upsert({
          where: { key },
          create: { key, value, updatedBy: adminId },
          update: { value, updatedBy: adminId },
        }),
      ),
    );

    void this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'SETTINGS_UPDATE',
        resource: 'SystemSettings',
        metadata: { updates: Object.fromEntries(entries) },
      },
    });

    return this.getSettings();
  }

  // ─── Taux de succès par opérateur ────────────────────────────────────────
  async getOperatorSuccessRate() {
    const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const operators = ['ORANGE_MONEY', 'MTN_MOMO'] as const;

    const results = await Promise.all(
      operators.map(async (op) => {
        const [total, completed] = await Promise.all([
          this.prisma.transaction.count({
            where: { operator: op, createdAt: { gte: d30 } },
          }),
          this.prisma.transaction.count({
            where: {
              operator: op,
              status: TransactionStatus.COMPLETED,
              createdAt: { gte: d30 },
            },
          }),
        ]);
        return {
          name: op === 'ORANGE_MONEY' ? 'Orange Money' : 'MTN MoMo',
          key: op,
          total,
          completed,
          rate: total > 0 ? Math.round((completed / total) * 10000) / 100 : 0,
        };
      }),
    );

    return { operators: results, period: '30j' };
  }

  // ─── Clôture de dossier ANIF ─────────────────────────────────────────────
  async closeAnifCase(adminId: string, caseId: string, resolution: string, report?: string) {
    const existing = await this.prisma.auditLog.findFirst({
      where: { id: caseId, action: 'ANIF_CASE_OPEN' },
      select: { id: true, resource: true },
    });
    if (!existing) {
      throw new NotFoundException('Dossier ANIF introuvable ou déjà traité');
    }

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'ANIF_CASE_CLOSE',
        resource: `AuditLog:${caseId}`,
        metadata: { resolution, report: report ?? null, closedBy: adminId, originalResource: existing.resource },
      },
    });

    return { ok: true, caseId, resolution };
  }

  // Assigne un dossier ANIF à un analyste (membre de l'équipe). Tracé en audit.
  async assignAnifCase(adminId: string, caseId: string, analystId: string) {
    const existing = await this.prisma.auditLog.findFirst({
      where: { id: caseId, action: 'ANIF_CASE_OPEN' },
      select: { id: true, resource: true },
    });
    if (!existing) throw new NotFoundException('Dossier ANIF introuvable');

    const analyst = await this.prisma.user.findFirst({
      where: { id: analystId, role: 'ADMIN', deletedAt: null },
      select: { id: true, fullName: true, email: true },
    });
    if (!analyst) throw new NotFoundException("Analyste introuvable ou n'est pas un opérateur");

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'ANIF_CASE_ASSIGN',
        resource: `AuditLog:${caseId}`,
        metadata: { analystId, analystName: analyst.fullName ?? analyst.email, assignedBy: adminId },
      },
    });
    return { ok: true, caseId, analyst };
  }

  // Marque une transaction signalée comme résolue (revue conformité).
  async resolveTransaction(adminId: string, txId: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId }, select: { id: true, resolved: true } });
    if (!tx) throw new NotFoundException('Transaction introuvable');

    await this.prisma.transaction.update({
      where: { id: txId },
      data: { resolved: true, resolvedAt: new Date(), resolvedBy: adminId },
    });
    await this.writeAudit(adminId, 'TRANSACTION_RESOLVE', `Transaction:${txId}`, {});
    return { ok: true, id: txId, resolved: true };
  }

  // Statistiques de la page Conformité ANIF.
  async getAnifStats() {
    const d30 = new Date(Date.now() - 30 * 86400000);
    const [overThreshold, opens, closes, highValueRecent] = await Promise.all([
      this.prisma.transaction.count({ where: { amount: { gte: ANIF_RISK_HIGH }, createdAt: { gte: d30 } } }),
      this.prisma.auditLog.count({ where: { action: 'ANIF_CASE_OPEN' } }),
      this.prisma.auditLog.count({ where: { action: 'ANIF_CASE_CLOSE' } }),
      this.prisma.auditLog.count({ where: { action: 'ANIF_HIGH_VALUE_ALERT', createdAt: { gte: d30 } } }),
    ]);
    const openCases = Math.max(0, opens - closes);
    const resolutionRate = opens > 0 ? Math.round((closes / opens) * 100) : null;
    return {
      activeAlerts: highValueRecent + openCases,
      openCases,
      overThreshold30d: overThreshold,
      resolutionRate,
    };
  }

  // Timeline des alertes par heure sur 24 h (échecs + transactions > seuil).
  async getAlertsTimeline() {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const rows = await this.prisma.$queryRaw<Array<{ hour: Date; failed: bigint; highvalue: bigint }>>`
      SELECT date_trunc('hour', "createdAt") AS hour,
             COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed,
             COUNT(*) FILTER (WHERE amount >= ${ANIF_RISK_HIGH})::bigint AS highvalue
      FROM "transactions"
      WHERE "createdAt" >= ${since}
      GROUP BY hour
    `;
    const map = new Map<string, { failed: number; highValue: number }>();
    for (const r of rows) {
      map.set(new Date(r.hour).toISOString().slice(0, 13), { failed: Number(r.failed), highValue: Number(r.highvalue) });
    }
    const series = [];
    const now = Date.now();
    const base = new Date(now - 23 * 3600 * 1000);
    base.setMinutes(0, 0, 0);
    for (let i = 0; i < 24; i++) {
      const d = new Date(base.getTime() + i * 3600 * 1000);
      const k = d.toISOString().slice(0, 13);
      const e = map.get(k) ?? { failed: 0, highValue: 0 };
      series.push({ hour: d.toISOString(), label: d.getHours() + 'h', failed: e.failed, highValue: e.highValue, total: e.failed + e.highValue });
    }
    return { series };
  }

  // Statistiques de la page Journal d'audit.
  async getAuditStats() {
    const d30 = new Date(Date.now() - 30 * 86400000);
    const [total, actorsRows, last, criticalCount] = await Promise.all([
      this.prisma.auditLog.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.auditLog.findMany({ where: { createdAt: { gte: d30 }, userId: { not: null } }, select: { userId: true }, distinct: ['userId'] }),
      this.prisma.auditLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { action: true, createdAt: true } }),
      this.prisma.auditLog.count({
        where: {
          createdAt: { gte: d30 },
          OR: [
            { action: { startsWith: 'USER_STATUS_' } },
            { action: { contains: 'PIN_RESET' } },
            { action: { startsWith: 'ADMIN_' } },
            { action: { contains: 'ANIF' } },
          ],
        },
      }),
    ]);
    return {
      total30d: total,
      criticalActions: criticalCount,
      uniqueActors: actorsRows.length,
      lastAction: last ? { action: last.action, at: last.createdAt } : null,
    };
  }

  // Activité d'un opérateur admin : 5 dernières actions + stats 30 j.
  async getMemberActivity(userId: string) {
    const d30 = new Date(Date.now() - 30 * 86400000);
    const [recent, actions30d, kycHandled, member] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, action: true, resource: true, createdAt: true },
      }),
      this.prisma.auditLog.count({ where: { userId, createdAt: { gte: d30 } } }),
      this.prisma.auditLog.count({ where: { userId, action: { startsWith: 'KYC_' }, createdAt: { gte: d30 } } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { lastLoginAt: true, lastLoginIp: true } }),
    ]);
    return {
      recent,
      stats: { actions30d, kycHandled },
      lastLoginAt: member?.lastLoginAt ?? null,
      lastLoginIp: member?.lastLoginIp ?? null,
    };
  }

  // Force la réinitialisation du PIN : le hash est vidé (l'utilisateur doit
  // repasser par le flux « PIN oublié » / OTP) et les verrous sont levés.
  async resetUserPin(adminId: string, userId: string) {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Utilisateur introuvable');

    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: '', pinAttempts: 0, lockedUntil: null },
    });
    await this.writeAudit(adminId, 'USER_PIN_RESET', `User:${userId}`);
    return { ok: true };
  }

  // ─── Équipe admin (rôles multiples) ─────────────────────────────────────

  async getAdminTeam() {
    return this.prisma.user.findMany({
      where: { role: 'ADMIN', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        adminRole: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        totpEnabled: true,
      },
    });
  }

  async setAdminRole(actorId: string, userId: string, adminRole: string | null) {
    const ALLOWED_ROLES = new Set<string | null>([...ADMIN_ROLES, null]);

    if (!ALLOWED_ROLES.has(adminRole)) {
      throw new BadRequestException(`Rôle invalide : ${adminRole}`);
    }
    if (actorId === userId) {
      throw new ForbiddenException('Un admin ne peut pas modifier son propre rôle');
    }

    // L'acteur doit être SUPER_ADMIN (lu depuis la DB, pas depuis le JWT).
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { adminRole: true } });
    if (actor?.adminRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Seul un SUPER_ADMIN peut modifier les rôles');
    }

    // La cible doit être un admin.
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (target?.role !== 'ADMIN') {
      throw new BadRequestException('La cible n\'est pas un compte administrateur');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { adminRole },
    });
    void this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'ADMIN_ROLE_CHANGE',
        metadata: { targetId: userId, newRole: adminRole } as any,
      },
    });
    return updated;
  }

  // Définit le mot de passe de connexion par-utilisateur d'un admin (SUPER_ADMIN
  // uniquement). Le mot de passe est haché en bcrypt ; jamais renvoyé.
  async setAdminPassword(actorId: string, userId: string, password: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { adminRole: true } });
    if (actor?.adminRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Seul un SUPER_ADMIN peut définir un mot de passe');
    }
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (target?.role !== 'ADMIN') {
      throw new BadRequestException('La cible n\'est pas un compte administrateur');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    void this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'ADMIN_PASSWORD_SET',
        metadata: { targetId: userId } as any,
      },
    });
    return { ok: true };
  }

  // Vérifie que l'acteur est SUPER_ADMIN (autorité sur l'équipe).
  private async assertSuperAdmin(actorId: string, message: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { adminRole: true } });
    if (actor?.adminRole !== 'SUPER_ADMIN') throw new ForbiddenException(message);
  }

  // Crée un opérateur admin (login par-utilisateur). SUPER_ADMIN uniquement.
  async createAdminOperator(actorId: string, dto: CreateAdminOperatorDto) {
    await this.assertSuperAdmin(actorId, 'Seul un SUPER_ADMIN peut créer un opérateur');
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new BadRequestException('Cet email est déjà utilisé');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const created = await this.prisma.user.create({
      data: {
        phone: `op-${randomUUID()}`, // téléphone synthétique (admin = login email)
        fullName: dto.fullName,
        email: dto.email,
        pinHash: '',
        passwordHash,
        role: 'ADMIN',
        adminRole: dto.adminRole,
        status: 'ACTIVE',
        kycStatus: 'APPROVED',
        wallet: { create: {} },
      },
      select: { id: true, fullName: true, email: true, adminRole: true, status: true, lastLoginAt: true, createdAt: true },
    });
    void this.prisma.auditLog.create({
      data: { userId: actorId, action: 'ADMIN_CREATE', metadata: { targetId: created.id, email: dto.email, role: dto.adminRole } as any },
    });
    return created;
  }

  // Supprime (soft delete) un opérateur admin. SUPER_ADMIN uniquement.
  async deleteAdmin(actorId: string, userId: string) {
    await this.assertSuperAdmin(actorId, 'Seul un SUPER_ADMIN peut supprimer un opérateur');
    if (actorId === userId) throw new ForbiddenException('Un admin ne peut pas se supprimer lui-même');
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (target?.role !== 'ADMIN') throw new BadRequestException('La cible n\'est pas un compte administrateur');

    await this.prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date(), status: 'DELETED' } });
    void this.prisma.auditLog.create({ data: { userId: actorId, action: 'ADMIN_DELETE', metadata: { targetId: userId } as any } });
    return { ok: true };
  }

  // Active / désactive un opérateur admin. SUPER_ADMIN uniquement.
  async setAdminStatus(actorId: string, userId: string, active: boolean) {
    await this.assertSuperAdmin(actorId, 'Seul un SUPER_ADMIN peut modifier le statut');
    if (actorId === userId) throw new ForbiddenException('Un admin ne peut pas se désactiver lui-même');
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (target?.role !== 'ADMIN') throw new BadRequestException('La cible n\'est pas un compte administrateur');

    const status = active ? 'ACTIVE' : 'SUSPENDED';
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
    void this.prisma.auditLog.create({ data: { userId: actorId, action: active ? 'ADMIN_ACTIVATE' : 'ADMIN_DEACTIVATE', metadata: { targetId: userId } as any } });
    return { ok: true, status };
  }

  // ─── Export CSV ──────────────────────────────────────────────────────────

  // Échappe une valeur CSV et préfixe par ' les formules potentielles (CSV injection).
  private csvCell(v: unknown): string {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  }

  async exportUsersCsv(_params: any): Promise<string> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      include: { wallet: true },
      orderBy: { createdAt: 'desc' },
    });
    const header = 'id,phone,fullName,email,role,status,kycStatus,balance,createdAt';
    const rows = users.map((u) =>
      [
        u.id,
        u.phone,
        u.fullName ?? '',
        u.email ?? '',
        u.role,
        u.status,
        u.kycStatus,
        u.wallet ? Number(u.wallet.balance) / 100 : 0,
        u.createdAt.toISOString(),
      ]
        .map((v) => this.csvCell(v))
        .join(','),
    );
    return [header, ...rows].join('\n');
  }

  async exportTransactionsCsv(_params: any): Promise<string> {
    const txs = await this.prisma.transaction.findMany({
      include: {
        sender: { select: { phone: true } },
        receiver: { select: { phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const header =
      'id,reference,type,status,amount_fcfa,fee_fcfa,senderPhone,receiverPhone,operator,createdAt';
    const rows = txs.map((t) =>
      [
        t.id,
        t.reference ?? '',
        t.type,
        t.status,
        Number(t.amount) / 100,
        Number(t.fee) / 100,
        t.sender?.phone ?? '',
        t.receiver?.phone ?? '',
        t.operator ?? '',
        t.createdAt.toISOString(),
      ]
        .map((v) => this.csvCell(v))
        .join(','),
    );
    return [header, ...rows].join('\n');
  }

  // ─── Notes admin ─────────────────────────────────────────────────────────

  async getAdminNotes(userId: string) {
    return this.prisma.adminNote.findMany({
      where: { targetId: userId },
      include: { author: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addAdminNote(authorId: string, targetId: string, content: string) {
    return this.prisma.adminNote.create({
      data: { authorId, targetId, content },
    });
  }

  async deleteAdminNote(authorId: string, noteId: string) {
    const note = await this.prisma.adminNote.findUnique({ where: { id: noteId } });
    if (!note || note.authorId !== authorId) {
      throw new NotFoundException('Note introuvable ou non autorisé');
    }
    return this.prisma.adminNote.delete({ where: { id: noteId } });
  }
}
