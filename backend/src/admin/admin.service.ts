import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  TransactionStatus,
  TransactionType,
  UserStatus,
  KycStatus,
} from '@prisma/client';
import { ReviewKycDto } from './dto/review-kyc.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

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
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;

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

  // 50 dernières actions admin (blocages, décisions KYC).
  async getAudit(limit = 50) {
    return this.prisma.auditLog.findMany({
      where: {
        OR: [
          { action: { startsWith: 'USER_STATUS_' } },
          { action: { startsWith: 'KYC_' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
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
    const pending = await this.prisma.user.findMany({
      where: { kycStatus: { in: [KycStatus.PENDING, KycStatus.SUBMITTED] } },
      orderBy: { createdAt: 'asc' },
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
          },
        },
      },
    });

    const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [approved30, rejected30] = await Promise.all([
      this.prisma.kycDocument.count({
        where: { status: KycStatus.APPROVED, reviewedAt: { gte: d30 } },
      }),
      this.prisma.kycDocument.count({
        where: { status: KycStatus.REJECTED, reviewedAt: { gte: d30 } },
      }),
    ]);

    return {
      pending,
      counts: { pending: pending.length, approved30, rejected30 },
    };
  }

  async reviewKyc(adminId: string, userId: string, dto: ReviewKycDto) {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Utilisateur introuvable');

    const newStatus = dto.decision as KycStatus; // APPROVED | REJECTED
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { kycStatus: newStatus },
        select: { id: true, fullName: true, kycStatus: true },
      });
      // Le document peut ne pas exister (flux d'upload non encore branché).
      await tx.kycDocument.updateMany({
        where: { userId },
        data: {
          status: newStatus,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          reviewNote: dto.note,
        },
      });
      return u;
    });

    await this.writeAudit(adminId, `KYC_${dto.decision}`, `User:${userId}`, {
      note: dto.note,
    });
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

    const [transactions, audit, sent, received] = await Promise.all([
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
    ]);

    return {
      user,
      transactions,
      audit,
      stats: {
        transactionsCount: sent._count._all + received._count._all,
        totalSent: sent._sum.amount ?? 0n,
        totalReceived: received._sum.amount ?? 0n,
      },
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
}
