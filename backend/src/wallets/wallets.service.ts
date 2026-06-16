import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CamPayService } from '../campay/campay.service';
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

  constructor(
    private prisma: PrismaService,
    private campay: CamPayService,
    private config: ConfigService,
  ) {}

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

  // ─── Recharge via CamPay ─────────────────────────────────────────────────
  // 1. Appelle CamPay /collect pour déclencher le paiement mobile money.
  // 2. Enregistre la transaction PENDING avec la référence CamPay.
  // 3. Le crédit effectif est appliqué par le webhook CamPay (WebhooksService).
  async recharge(
    userId: string,
    amount: bigint,
    operator: MobileOperator,
    phone?: string,
  ) {
    if (amount <= 0n) throw new BadRequestException('Montant invalide');
    if (!phone) throw new BadRequestException('Numéro mobile money requis pour la recharge');

    const isSandbox = this.config.get<string>('NODE_ENV') !== 'production';
    if (isSandbox && amount > 2500n) {
      throw new BadRequestException(
        'Mode sandbox CamPay — montant max 25 FCFA (2 500 centimes). Réduisez le montant pour les tests.',
      );
    }

    const operatorRef = `RCHG-${randomUUID()}`;
    const description = `Recharge CamWallet depuis ${phone}`;

    const campayResponse = await this.campay.collect(amount, phone, operatorRef, description);

    const transaction = await this.prisma.transaction.create({
      data: {
        type: TransactionType.RECHARGE,
        status: TransactionStatus.PENDING,
        amount,
        receiverId: userId,
        operator: MobileOperator.CAMPAY,
        operatorRef,
        description,
      },
    });

    this.logger.log(
      `Recharge CamPay initiée : ${amount} centimes (${operator}) ref=${operatorRef} campayRef=${campayResponse.reference}`,
    );

    return {
      reference: transaction.reference,
      operatorRef,
      campayReference: campayResponse.reference,
      ussdCode: campayResponse.ussd_code,
      type: transaction.type,
      status: transaction.status,
      amount: transaction.amount,
      fee: 0n,
      message:
        'Recharge initiée via CamPay. Validez le paiement sur votre téléphone ' +
        `(${campayResponse.ussd_code ?? 'code USSD envoyé par SMS'}) ; ` +
        'le solde sera crédité après confirmation.',
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

      // Instantanés de solde (avant/après réservation des fonds).
      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore - total;

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
          operator: MobileOperator.CAMPAY,
          operatorRef,
          senderBalanceBefore: balanceBefore,
          senderBalanceAfter: balanceAfter,
          description: phone ? `Retrait CamWallet vers ${phone}` : 'Retrait CamWallet',
        },
      });
    });

    // Déclencher le décaissement CamPay de façon asynchrone (le solde est déjà
    // réservé). Si CamPay échoue, le retrait reste PENDING et sera expiré + remboursé
    // par WithdrawalsExpiryService selon WITHDRAWAL_TIMEOUT_MINUTES.
    const description = phone ? `Retrait CamWallet vers ${phone}` : 'Retrait CamWallet';
    void this.campay.withdraw(amount, phone ?? '', operatorRef, description).catch((err) => {
      this.logger.error(
        `Erreur déclenchement retrait CamPay (ref=${operatorRef}) : ${err?.message ?? err}`,
      );
    });

    this.logger.log(
      `Retrait initié : ${amount} centimes (frais ${fee}) ref=${operatorRef}`,
    );

    return {
      reference: transaction.reference,
      operatorRef,
      type: transaction.type,
      status: transaction.status,
      amount: transaction.amount,
      fee: transaction.fee,
      message:
        'Retrait en cours de traitement via CamPay. Le solde a été réservé ; ' +
        'il sera confirmé après validation (ou recrédité en cas d\'échec).',
    };
  }
}
