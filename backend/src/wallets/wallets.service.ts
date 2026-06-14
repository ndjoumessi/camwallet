import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  TransactionType,
  TransactionStatus,
  MobileOperator,
} from '@prisma/client';

// Frais de retrait : 1 % avec un minimum de 50 FCFA (5 000 centimes).
const WITHDRAWAL_FEE_RATE_NUM = 1n;
const WITHDRAWAL_FEE_RATE_DEN = 100n;
const WITHDRAWAL_FEE_MIN = 5000n;

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Solde ────────────────────────────────────────────────────────────────
  async getBalance(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: {
        balance: true,
        currency: true,
        dailyLimit: true,
        monthlyLimit: true,
        isActive: true,
      },
    });
    if (!wallet) throw new NotFoundException('Portefeuille introuvable');
    return wallet;
  }

  // ─── Recharge depuis OM/MoMo ────────────────────────────────────────────────
  // Crée une transaction PENDING ; le crédit effectif est appliqué par le
  // webhook opérateur (voir WebhooksService) à réception de la confirmation.
  async recharge(
    userId: string,
    amount: bigint,
    operator: MobileOperator,
    phone?: string,
  ) {
    if (amount <= 0n) throw new BadRequestException('Montant invalide');

    const operatorRef = `RCHG-${randomUUID()}`;

    const transaction = await this.prisma.transaction.create({
      data: {
        type: TransactionType.RECHARGE,
        status: TransactionStatus.PENDING,
        amount,
        receiverId: userId,
        operator,
        operatorRef,
        description: phone ? `Recharge depuis ${phone}` : 'Recharge mobile money',
      },
    });

    this.logger.log(
      `Recharge initiée : ${amount} XAF (${operator}) ref=${operatorRef}`,
    );

    return {
      reference: transaction.reference,
      operatorRef,
      type: transaction.type,
      status: transaction.status,
      amount: transaction.amount,
      fee: 0n,
      message:
        'Recharge initiée. Validez le paiement sur votre téléphone ; ' +
        'le solde sera crédité après confirmation de l\'opérateur.',
    };
  }

  // ─── Retrait vers OM/MoMo (flux asynchrone) ─────────────────────────────────
  // Réserve immédiatement les fonds (débit solde + frais) et crée une
  // transaction PENDING. Le décaissement est confirmé par le webhook opérateur :
  //   • succès → transaction COMPLETED (les fonds ont déjà quitté le portefeuille)
  //   • échec  → transaction FAILED + recrédit du portefeuille (montant + frais)
  async withdraw(
    userId: string,
    amount: bigint,
    operator: MobileOperator,
    phone?: string,
  ) {
    if (amount <= 0n) throw new BadRequestException('Montant invalide');

    const computedFee = (amount * WITHDRAWAL_FEE_RATE_NUM) / WITHDRAWAL_FEE_RATE_DEN;
    const fee = computedFee > WITHDRAWAL_FEE_MIN ? computedFee : WITHDRAWAL_FEE_MIN;
    const total = amount + fee;
    const operatorRef = `WDRW-${randomUUID()}`;

    const transaction = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Portefeuille introuvable');
      if (!wallet.isActive) throw new BadRequestException('Portefeuille désactivé');
      if (wallet.balance < total) {
        throw new BadRequestException(
          'Solde insuffisant (montant + frais de retrait)',
        );
      }

      // Réservation des fonds dès la demande (évite tout double-débit pendant
      // le traitement). Recrédités par le webhook si le décaissement échoue.
      await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: total } },
      });

      return tx.transaction.create({
        data: {
          type: TransactionType.WITHDRAWAL,
          status: TransactionStatus.PENDING,
          amount,
          fee,
          senderId: userId,
          operator,
          operatorRef,
          description: phone ? `Retrait vers ${phone}` : 'Retrait mobile money',
        },
      });
    });

    // TODO: déclencher ici l'API de décaissement de l'opérateur (OM/MoMo).
    this.logger.log(
      `Retrait initié : ${amount} XAF (frais ${fee}) ref=${operatorRef}`,
    );

    return {
      reference: transaction.reference,
      operatorRef,
      type: transaction.type,
      status: transaction.status,
      amount: transaction.amount,
      fee: transaction.fee,
      message:
        'Retrait en cours de traitement. Le solde a été réservé ; il sera ' +
        'confirmé après validation de l\'opérateur (ou recrédité en cas d\'échec).',
    };
  }
}
