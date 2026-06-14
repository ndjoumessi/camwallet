import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  MobileOperator,
  TransactionStatus,
  TransactionType,
  Transaction,
} from '@prisma/client';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async handleOrangeMoney(payload: any, signature: string) {
    // TODO: Vérifier signature HMAC avec OM_WEBHOOK_SECRET
    this.logger.log(`Webhook OM reçu : ${JSON.stringify(payload)}`);
    await this.processOperatorWebhook(MobileOperator.ORANGE_MONEY, payload);
    return { status: 'ok' };
  }

  async handleMtnMomo(payload: any, token: string) {
    // TODO: Vérifier token MTN avec MTN_WEBHOOK_SECRET
    this.logger.log(`Webhook MTN MoMo reçu : ${JSON.stringify(payload)}`);
    await this.processOperatorWebhook(MobileOperator.MTN_MOMO, payload);
    return { status: 'ok' };
  }

  // Finalise une transaction PENDING (recharge ou retrait) à partir de la
  // notification opérateur. Idempotent : on ne traite qu'une transaction encore
  // PENDING, identifiée par operatorRef = payload.externalId.
  private async processOperatorWebhook(operator: MobileOperator, payload: any) {
    // Sauvegarder l'événement brut pour audit
    const event = await this.prisma.webhookEvent.create({
      data: {
        operator,
        eventType: payload.type || 'PAYMENT_NOTIFICATION',
        payload,
      },
    });

    try {
      if (!payload.externalId) {
        await this.markEventProcessed(event.id);
        return;
      }

      const tx = await this.prisma.transaction.findFirst({
        where: {
          operatorRef: payload.externalId,
          status: TransactionStatus.PENDING,
        },
      });

      // Transaction inconnue ou déjà finalisée → on acquitte sans rien changer
      if (!tx) {
        await this.markEventProcessed(event.id);
        return;
      }

      if (payload.status === 'SUCCESSFUL') {
        await this.confirmTransaction(tx, event.id);
      } else if (payload.status === 'FAILED') {
        await this.failTransaction(tx, payload.reason, event.id);
      } else {
        // Statut intermédiaire (ex: PENDING côté opérateur) : on acquitte juste
        await this.markEventProcessed(event.id);
      }
    } catch (err) {
      this.logger.error('Erreur traitement webhook', err);
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { error: String(err) },
      });
    }
  }

  // ─── Succès opérateur ───────────────────────────────────────────────────────
  private async confirmTransaction(tx: Transaction, eventId: string) {
    const ops: any[] = [];

    // RECHARGE : les fonds arrivent → on crédite le bénéficiaire.
    // WITHDRAWAL : les fonds ont déjà été réservés à la demande → aucun
    //   mouvement de solde, on confirme simplement.
    if (tx.type === TransactionType.RECHARGE && tx.receiverId) {
      ops.push(
        this.prisma.wallet.update({
          where: { userId: tx.receiverId },
          data: { balance: { increment: tx.amount } },
        }),
      );
    }

    ops.push(
      this.prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: TransactionStatus.COMPLETED,
          operatorStatus: 'SUCCESSFUL',
          processedAt: new Date(),
        },
      }),
      this.eventProcessedOp(eventId),
    );

    await this.prisma.$transaction(ops);
    this.logger.log(
      `✅ ${tx.type} confirmée : ${tx.amount} XAF (ref=${tx.operatorRef})`,
    );
  }

  // ─── Échec opérateur ────────────────────────────────────────────────────────
  private async failTransaction(
    tx: Transaction,
    reason: string | undefined,
    eventId: string,
  ) {
    const ops: any[] = [];

    // WITHDRAWAL : les fonds avaient été réservés → on recrédite (montant + frais).
    // RECHARGE : rien n'avait été crédité → aucun remboursement nécessaire.
    if (tx.type === TransactionType.WITHDRAWAL && tx.senderId) {
      const refund = tx.amount + tx.fee;
      ops.push(
        this.prisma.wallet.update({
          where: { userId: tx.senderId },
          data: { balance: { increment: refund } },
        }),
      );
    }

    ops.push(
      this.prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: TransactionStatus.FAILED,
          operatorStatus: 'FAILED',
          failureReason: reason || 'Échec opérateur',
          processedAt: new Date(),
        },
      }),
      this.eventProcessedOp(eventId),
    );

    await this.prisma.$transaction(ops);
    this.logger.warn(
      `❌ ${tx.type} échouée : ${tx.amount} XAF (ref=${tx.operatorRef})` +
        (tx.type === TransactionType.WITHDRAWAL ? ' — portefeuille recrédité' : ''),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  private eventProcessedOp(eventId: string) {
    return this.prisma.webhookEvent.update({
      where: { id: eventId },
      data: { processed: true, processedAt: new Date() },
    });
  }

  private async markEventProcessed(eventId: string) {
    await this.eventProcessedOp(eventId);
  }
}
