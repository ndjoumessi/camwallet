import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CacheService, CacheKeys } from '../cache/cache.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { normalizeCameroonPhone } from '../common/phone.util';
import { TransactionType, TransactionStatus } from '@prisma/client';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly cache: CacheService,
    private readonly loyalty: LoyaltyService,
  ) {}

  // ─── Paiement P2P (CamWallet → CamWallet) ────────────────────────────────
  async p2p(senderId: string, receiverPhone: string, amount: bigint, description?: string) {
    if (amount <= 0n) throw new BadRequestException('Montant invalide');

    const phone = normalizeCameroonPhone(receiverPhone) ?? receiverPhone;
    const receiver = await this.prisma.user.findUnique({
      where: { phone },
    });
    if (!receiver) throw new NotFoundException('Destinataire introuvable');
    if (receiver.id === senderId) throw new BadRequestException('Vous ne pouvez pas vous envoyer de l\'argent');

    // Transaction ACID — débit/crédit atomique
    const transaction = await this.prisma.$transaction(async (tx) => {
      const senderWallet = await tx.wallet.findUnique({
        where: { userId: senderId },
      });
      if (!senderWallet) throw new NotFoundException('Portefeuille introuvable');
      if (senderWallet.balance < amount) {
        throw new BadRequestException('Solde insuffisant');
      }

      // Instantanés de solde émetteur (avant/après débit).
      const balanceBefore = senderWallet.balance;
      const balanceAfter = balanceBefore - amount;

      // Débit expéditeur
      await tx.wallet.update({
        where: { userId: senderId },
        data: { balance: { decrement: amount } },
      });

      // Crédit destinataire
      await tx.wallet.update({
        where: { userId: receiver.id },
        data: { balance: { increment: amount } },
      });

      // Enregistrement transaction
      const created = await tx.transaction.create({
        data: {
          type: TransactionType.P2P,
          status: TransactionStatus.COMPLETED,
          amount,
          senderId,
          receiverId: receiver.id,
          description,
          senderBalanceBefore: balanceBefore,
          senderBalanceAfter: balanceAfter,
          processedAt: new Date(),
        },
      });

      this.logger.log(`P2P ${amount} FCFA : ${senderId} → ${receiver.id}`);
      return created;
    });

    // Soldes modifiés (émetteur + destinataire) → invalider leurs caches.
    await this.cache.del(CacheKeys.walletBalance(senderId), CacheKeys.walletBalance(receiver.id));

    // Fidélité : points / 1000 FCFA envoyés selon la config admin (fire-and-forget).
    void this.loyalty.awardP2p(senderId, amount);

    // Événement temps réel pour le dashboard admin (non bloquant).
    this.eventEmitter.emit('transaction.created', { type: 'P2P', amount: Number(amount) / 100 });

    // Notification push au destinataire (hors transaction, non bloquant).
    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      select: { fullName: true },
    });
    void this.notifications.notifyTransactionReceived(receiver.id, {
      type: 'P2P',
      amountCentimes: amount,
      from: sender?.fullName,
      transactionId: transaction.id,
    });

    // Alerte ANIF automatique pour les transactions > 500 000 FCFA (§5.3 CDC)
    if (amount >= 50_000_000n) {
      void this.prisma.auditLog.create({
        data: {
          userId: null,
          action: 'ANIF_HIGH_VALUE_ALERT',
          resource: `Transaction:${transaction.id}`,
          metadata: {
            amount: amount.toString(),
            senderId,
            receiverId: receiver.id,
            threshold: '50000000',
          },
        },
      });
    }

    return transaction;
  }

  // ─── Paiement par QR ──────────────────────────────────────────────────────
  async payByQr(payerId: string, qrPayload: string, amount?: bigint) {
    const qrCode = await this.prisma.qrCode.findFirst({
      where: { payload: qrPayload, isActive: true },
      include: { user: true },
    });
    if (!qrCode) throw new NotFoundException('QR Code invalide ou expiré');

    // QR dynamique — vérifier montant et expiration
    if (qrCode.type === 'DYNAMIC') {
      if (qrCode.expiresAt && qrCode.expiresAt < new Date()) {
        throw new BadRequestException('QR Code expiré');
      }
      if (qrCode.usedAt) throw new BadRequestException('QR Code déjà utilisé');
      amount = qrCode.amount!;
    }

    if (!amount || amount <= 0n) throw new BadRequestException('Montant invalide');

    const transaction = await this.prisma.$transaction(async (tx) => {
      const payerWallet = await tx.wallet.findUnique({ where: { userId: payerId } });
      if (!payerWallet || payerWallet.balance < amount!) {
        throw new BadRequestException('Solde insuffisant');
      }

      // Calculer la commission marchand (0.5%)
      const fee = (amount! * 5n) / 1000n;

      // Instantanés de solde du payeur (avant/après débit).
      const payerBalanceBefore = payerWallet.balance;
      const payerBalanceAfter = payerBalanceBefore - amount!;

      await tx.wallet.update({
        where: { userId: payerId },
        data: { balance: { decrement: amount } },
      });

      await tx.wallet.update({
        where: { userId: qrCode.userId },
        data: { balance: { increment: amount! - fee } },
      });

      // Marquer QR dynamique utilisé
      if (qrCode.type === 'DYNAMIC') {
        await tx.qrCode.update({
          where: { id: qrCode.id },
          data: { usedAt: new Date() },
        });
      }

      const created = await tx.transaction.create({
        data: {
          type: TransactionType.QR_PAYMENT,
          status: TransactionStatus.COMPLETED,
          amount: amount!,
          fee,
          senderId: payerId,
          receiverId: qrCode.userId,
          qrCodeId: qrCode.id,
          senderBalanceBefore: payerBalanceBefore,
          senderBalanceAfter: payerBalanceAfter,
          processedAt: new Date(),
        },
      });

      return { created, net: amount! - fee };
    });

    // Soldes modifiés (payeur + marchand) → invalider leurs caches.
    await this.cache.del(CacheKeys.walletBalance(payerId), CacheKeys.walletBalance(qrCode.userId));

    // Notification push au marchand bénéficiaire (montant net, hors transaction).
    void this.notifications.notifyTransactionReceived(qrCode.userId, {
      type: 'QR_PAYMENT',
      amountCentimes: transaction.net,
      transactionId: transaction.created.id,
    });

    return transaction.created;
  }

  // ─── Contestation de transaction ─────────────────────────────────────────
  async openDispute(requesterId: string, transactionId: string, reason: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction introuvable');
    if (tx.senderId !== requesterId && tx.receiverId !== requesterId) {
      throw new ForbiddenException('Non autorisé à contester cette transaction');
    }
    const dispute = await this.prisma.disputeRequest.create({
      data: { transactionId, requesterId, reason },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: requesterId,
        action: 'DISPUTE_OPEN',
        metadata: { transactionId, reason } as any,
      },
    });

    // Notifie le dashboard admin en temps réel (SSE, non bloquant).
    this.eventEmitter.emit('dispute.opened', {
      disputeId: dispute.id,
      transactionId,
      requesterId,
      reason,
    });

    return dispute;
  }

  // ─── Mes contestations ────────────────────────────────────────────────────
  async getUserDisputes(userId: string) {
    const disputes = await this.prisma.disputeRequest.findMany({
      where: { requesterId: userId },
      orderBy: { createdAt: 'desc' },
    });

    // La contestation ne porte qu'un transactionId (pas de relation Prisma) —
    // on rapatrie les transactions associées en une requête puis on les rattache.
    const txIds = disputes.map((d) => d.transactionId);
    const transactions = await this.prisma.transaction.findMany({
      where: { id: { in: txIds } },
      include: {
        sender: { select: { phone: true, fullName: true } },
        receiver: { select: { phone: true, fullName: true } },
      },
    });
    const byId = new Map(transactions.map((t) => [t.id, t]));

    return disputes.map((d) => ({ ...d, transaction: byId.get(d.transactionId) ?? null }));
  }

  // ─── Historique utilisateur ───────────────────────────────────────────────
  async getHistory(userId: string, page = 1, limit = 20, type?: TransactionType) {
    const skip = (page - 1) * limit;

    const where: any = {
      OR: [{ senderId: userId }, { receiverId: userId }],
    };
    if (type) where.type = type;

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
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
