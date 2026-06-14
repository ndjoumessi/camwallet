import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionStatus, TransactionType, UserRole } from '@prisma/client';

@Injectable()
export class MerchantService {
  constructor(private prisma: PrismaService) {}

  private async assertMerchant(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || (user.role !== UserRole.MERCHANT && user.role !== UserRole.ADMIN)) {
      throw new ForbiddenException('Accès réservé aux commerçants');
    }
    return user;
  }

  async getStats(userId: string) {
    await this.assertMerchant(userId);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay.getTime() - 6 * 86400000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const receivedFilter = (gte: Date) => ({
      receiverId: userId,
      status: TransactionStatus.COMPLETED,
      type: { in: [TransactionType.QR_PAYMENT, TransactionType.P2P] },
      createdAt: { gte },
    });

    const [wallet, dayStats, weekStats, monthStats] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
      this.prisma.transaction.aggregate({
        _count: { _all: true },
        _sum: { amount: true, fee: true },
        where: receivedFilter(startOfDay),
      }),
      this.prisma.transaction.aggregate({
        _count: { _all: true },
        _sum: { amount: true },
        where: receivedFilter(startOfWeek),
      }),
      this.prisma.transaction.aggregate({
        _count: { _all: true },
        _sum: { amount: true },
        where: receivedFilter(startOfMonth),
      }),
    ]);

    return {
      balance: wallet?.balance ?? 0n,
      day: {
        count: dayStats._count._all,
        amount: dayStats._sum.amount ?? 0n,
        fees: dayStats._sum.fee ?? 0n,
      },
      week: {
        count: weekStats._count._all,
        amount: weekStats._sum.amount ?? 0n,
      },
      month: {
        count: monthStats._count._all,
        amount: monthStats._sum.amount ?? 0n,
      },
    };
  }

  async getTransactions(userId: string, page = 1, limit = 20) {
    await this.assertMerchant(userId);

    const skip = (page - 1) * limit;
    const where = {
      receiverId: userId,
      type: { in: [TransactionType.QR_PAYMENT, TransactionType.P2P] },
    };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: { select: { phone: true, fullName: true, avatarUrl: true } },
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
