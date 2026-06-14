import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TransactionType, TransactionStatus, MobileOperator } from '@prisma/client';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ─── Paiement P2P (CamWallet → CamWallet) ────────────────────────────────
  async p2p(senderId: string, receiverPhone: string, amount: bigint, description?: string) {
    if (amount <= 0n) throw new BadRequestException('Montant invalide');

    const receiver = await this.prisma.user.findUnique({
      where: { phone: receiverPhone },
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
          processedAt: new Date(),
        },
      });

      this.logger.log(`P2P ${amount} FCFA : ${senderId} → ${receiver.id}`);
      return created;
    });

    // Notification push au destinataire (hors transaction, non bloquant).
    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      select: { fullName: true },
    });
    void this.notifications.notifyTransactionReceived(receiver.id, {
      type: 'P2P',
      amountCentimes: amount,
      from: sender?.fullName,
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
          processedAt: new Date(),
        },
      });

      return { created, net: amount! - fee };
    });

    // Notification push au marchand bénéficiaire (montant net, hors transaction).
    void this.notifications.notifyTransactionReceived(qrCode.userId, {
      type: 'QR_PAYMENT',
      amountCentimes: transaction.net,
    });

    return transaction.created;
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
