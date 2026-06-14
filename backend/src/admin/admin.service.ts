import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionStatus, TransactionType, UserStatus } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // ─── Statistiques globales ──────────────────────────────────────────────────
  async getStats() {
    const [
      totalUsers,
      totalTransactions,
      pendingTransactions,
      volume,
      balances,
      byType,
      byStatus,
      byRole,
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
    ]);

    return {
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
}
