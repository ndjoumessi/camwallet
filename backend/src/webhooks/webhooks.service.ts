import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MobileOperator, TransactionStatus } from '@prisma/client';

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
      // Paiement confirmé par l'opérateur
      if (payload.status === 'SUCCESSFUL' && payload.externalId) {
        const tx = await this.prisma.transaction.findFirst({
          where: {
            operatorRef: payload.externalId,
            status: TransactionStatus.PENDING,
          },
        });

        if (tx && tx.receiverId) {
          await this.prisma.$transaction([
            // Créditer le portefeuille
            this.prisma.wallet.update({
              where: { userId: tx.receiverId },
              data: { balance: { increment: tx.amount } },
            }),
            // Marquer transaction complète
            this.prisma.transaction.update({
              where: { id: tx.id },
              data: {
                status: TransactionStatus.COMPLETED,
                operatorStatus: 'SUCCESSFUL',
                processedAt: new Date(),
              },
            }),
            // Marquer webhook traité
            this.prisma.webhookEvent.update({
              where: { id: event.id },
              data: { processed: true, processedAt: new Date() },
            }),
          ]);

          this.logger.log(
            `✅ Recharge confirmée : ${tx.amount} XAF → userId=${tx.receiverId}`,
          );
        }
      } else if (payload.status === 'FAILED') {
        if (payload.externalId) {
          await this.prisma.transaction.updateMany({
            where: { operatorRef: payload.externalId },
            data: {
              status: TransactionStatus.FAILED,
              failureReason: payload.reason || 'Échec opérateur',
            },
          });
        }

        await this.prisma.webhookEvent.update({
          where: { id: event.id },
          data: { processed: true, processedAt: new Date() },
        });
      }
    } catch (err) {
      this.logger.error('Erreur traitement webhook', err);
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { error: String(err) },
      });
    }
  }
}
