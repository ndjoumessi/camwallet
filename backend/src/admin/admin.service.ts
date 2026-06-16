import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OtpService } from '../auth/otp.service';
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
  async getUsers(page = 1, limit = 20, search?: string, status?: UserStatus) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (search) {
      where.OR = [
        { phone: { contains: search } },
        { fullName: { contains: search, mode: 'insensitive' as const } },
      ];
    }
    if (status) where.status = status;

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
          wallet: { select: { balance: true, currency: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
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
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;

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
        { action: 'USER_PIN_RESET' },
        { action: 'SETTINGS_UPDATE' },
        { action: 'ANIF_CASE_CLOSE' },
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
        createdAt: true,
        user: { select: { fullName: true, email: true } },
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
      if (smsUser) void this.otpService.sendSms(smsUser.phone, notif.sms);
    }

    return user;
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
  async getHealthIntegrations() {
    const d24h = new Date(Date.now() - 24 * 3600 * 1000);
    const d1h = new Date(Date.now() - 3600 * 1000);

    const [omCompleted, mtnCompleted, failedWebhooks, stalePending] = await Promise.all([
      this.prisma.transaction.count({
        where: { operator: 'ORANGE_MONEY', status: TransactionStatus.COMPLETED, createdAt: { gte: d24h } },
      }),
      this.prisma.transaction.count({
        where: { operator: 'MTN_MOMO', status: TransactionStatus.COMPLETED, createdAt: { gte: d24h } },
      }),
      this.prisma.webhookEvent.count({ where: { processed: false, createdAt: { gte: d24h } } }),
      this.prisma.transaction.count({ where: { status: TransactionStatus.PENDING, createdAt: { lt: d1h } } }),
    ]);

    const omStatus = omCompleted > 0 ? 'UP' : failedWebhooks > 3 ? 'DOWN' : 'UNKNOWN';
    const mtnStatus = mtnCompleted > 0 ? 'UP' : failedWebhooks > 3 ? 'DOWN' : 'UNKNOWN';

    return {
      integrations: [
        {
          name: 'Orange Money',
          key: 'orange_money',
          status: omStatus,
          completedTx24h: omCompleted,
          pendingWebhooks: failedWebhooks,
        },
        {
          name: 'MTN MoMo',
          key: 'mtn_momo',
          status: mtnStatus,
          completedTx24h: mtnCompleted,
          pendingWebhooks: 0,
        },
        {
          name: 'SMS OTP',
          key: 'sms_otp',
          status: 'SIMULATED',
          note: 'Simulation (AfricasTalking en prod)',
          completedTx24h: null,
        },
        {
          name: 'Push Expo',
          key: 'expo_push',
          status: 'UP',
          note: 'Expo Push API',
          completedTx24h: null,
        },
      ],
      stalePendingTx: stalePending,
      updatedAt: new Date().toISOString(),
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
  };

  async getSettings(): Promise<Record<string, string>> {
    const rows = await this.prisma.systemSettings.findMany();
    const result = { ...this.SETTINGS_DEFAULTS };
    for (const row of rows) {
      result[row.key] = row.value;
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

  async updateSettings(adminId: string, updates: Record<string, string>) {
    const allowedKeys = Object.keys(this.SETTINGS_DEFAULTS);
    const entries = Object.entries(updates).filter(([k]) => allowedKeys.includes(k));

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
  async closeAnifCase(adminId: string, caseId: string, resolution: string) {
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
        metadata: { resolution, closedBy: adminId, originalResource: existing.resource },
      },
    });

    return { ok: true, caseId, resolution };
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
