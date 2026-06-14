import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionStatus, TransactionType } from '@prisma/client';

const DEFAULT_TIMEOUT_MIN = 10;

type StaleWithdrawal = {
  id: string;
  amount: bigint;
  fee: bigint;
  senderId: string | null;
  operatorRef: string | null;
};

// Balaye périodiquement les retraits restés PENDING au-delà du délai imparti
// (opérateur muet) : on les marque FAILED et on recrédite le portefeuille,
// exactement comme un webhook d'échec. Indispensable car sans cela les fonds
// réservés resteraient bloqués indéfiniment.
@Injectable()
export class WithdrawalsExpiryService {
  private readonly logger = new Logger(WithdrawalsExpiryService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'expire-pending-withdrawals' })
  async sweep() {
    const timeoutMin = Number(
      this.config.get('WITHDRAWAL_TIMEOUT_MINUTES', DEFAULT_TIMEOUT_MIN),
    );
    const cutoff = new Date(Date.now() - timeoutMin * 60 * 1000);

    const stale: StaleWithdrawal[] = await this.prisma.transaction.findMany({
      where: {
        type: TransactionType.WITHDRAWAL,
        status: TransactionStatus.PENDING,
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        amount: true,
        fee: true,
        senderId: true,
        operatorRef: true,
      },
    });

    if (stale.length === 0) return;

    let expired = 0;
    for (const w of stale) {
      if (await this.expireOne(w)) expired++;
    }

    if (expired > 0) {
      this.logger.warn(
        `⏱️ ${expired} retrait(s) PENDING expiré(s) et remboursé(s) ` +
          `(délai ${timeoutMin} min dépassé)`,
      );
    }
  }

  // Marque un retrait FAILED et recrédite le portefeuille, de façon atomique.
  // Le passage PENDING→FAILED via updateMany fait office de "claim" : si un
  // webhook (ou un autre tick) a déjà finalisé la transaction, count vaut 0 et
  // on n'effectue aucun remboursement — pas de double crédit.
  private expireOne(w: StaleWithdrawal): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.transaction.updateMany({
        where: { id: w.id, status: TransactionStatus.PENDING },
        data: {
          status: TransactionStatus.FAILED,
          operatorStatus: 'TIMEOUT',
          failureReason: 'Délai de traitement opérateur dépassé',
          processedAt: new Date(),
        },
      });
      if (claimed.count === 0) return false;

      if (w.senderId) {
        await tx.wallet.update({
          where: { userId: w.senderId },
          data: { balance: { increment: w.amount + w.fee } },
        });
      }

      this.logger.log(
        `Retrait ${w.operatorRef} expiré → remboursé ${w.amount + w.fee} XAF`,
      );
      return true;
    });
  }
}
