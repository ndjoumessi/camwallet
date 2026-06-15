import { Injectable, Logger, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    private notifications: NotificationsService,
  ) {}

  async handleOrangeMoney(payload: any, rawBody: Buffer, signature: string) {
    this.verifyOmSignature(rawBody, signature);
    this.logger.log(`Webhook OM reçu : ${JSON.stringify(payload)}`);
    await this.processOperatorWebhook(MobileOperator.ORANGE_MONEY, payload);
    return { status: 'ok' };
  }

  async handleMtnMomo(payload: any, token: string) {
    this.verifyMtnToken(token);
    this.logger.log(`Webhook MTN MoMo reçu : ${JSON.stringify(payload)}`);
    await this.processOperatorWebhook(MobileOperator.MTN_MOMO, payload);
    return { status: 'ok' };
  }

  // ─── Validation signatures ───────────────────────────────────────────────
  private verifyOmSignature(rawBody: Buffer, signature: string): void {
    const secret = this.config.get<string>('OM_WEBHOOK_SECRET');
    if (!secret) {
      // Fail-closed en production — jamais de webhook non authentifié en prod
      if (this.config.get('NODE_ENV') === 'production') {
        throw new InternalServerErrorException('OM_WEBHOOK_SECRET requis en production');
      }
      this.logger.warn('[SÉCU] OM_WEBHOOK_SECRET non configuré — validation HMAC désactivée (dev uniquement)');
      return;
    }
    if (!signature) {
      throw new UnauthorizedException('Signature webhook Orange Money manquante');
    }
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    // Comparaison à temps constant — les deux digests sont des hex SHA-256 (64 chars)
    let valid = true;
    try {
      const eBuf = Buffer.from(expected, 'hex');
      const sBuf = Buffer.from(signature.slice(0, 64).padEnd(64, '0'), 'hex');
      valid = signature.length === 64 && crypto.timingSafeEqual(eBuf, sBuf);
    } catch {
      valid = false;
    }
    if (!valid) {
      // Ne pas logger le HMAC attendu (oracle de signature)
      this.logger.warn(`Signature OM invalide : reçu=${signature.slice(0, 8)}…`);
      throw new UnauthorizedException('Signature webhook Orange Money invalide');
    }
  }

  private verifyMtnToken(token: string): void {
    const secret = this.config.get<string>('MTN_WEBHOOK_SECRET');
    if (!secret) {
      if (this.config.get('NODE_ENV') === 'production') {
        throw new InternalServerErrorException('MTN_WEBHOOK_SECRET requis en production');
      }
      this.logger.warn('[SÉCU] MTN_WEBHOOK_SECRET non configuré — validation token désactivée (dev uniquement)');
      return;
    }
    if (!token) {
      throw new UnauthorizedException('Token webhook MTN MoMo manquant');
    }
    // Hash les deux valeurs pour obtenir des buffers de longueur identique (timingSafeEqual l'exige)
    const ha = crypto.createHash('sha256').update(token).digest();
    const hb = crypto.createHash('sha256').update(secret).digest();
    if (!crypto.timingSafeEqual(ha, hb)) {
      this.logger.warn('Token MTN MoMo invalide');
      throw new UnauthorizedException('Token webhook MTN MoMo invalide');
    }
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

    // Notification push après crédit d'une recharge (hors transaction, non bloquant).
    if (tx.type === TransactionType.RECHARGE && tx.receiverId) {
      void this.notifications.notifyTransactionReceived(tx.receiverId, {
        type: 'RECHARGE',
        amountCentimes: tx.amount,
        transactionId: tx.id,
      });
    }
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
