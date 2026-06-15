import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../auth/otp.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Types de notifications considérées comme critiques (SMS de backup activé).
type CriticalType = 'P2P' | 'QR_PAYMENT' | 'RECHARGE';
type ReceivedType = CriticalType;

// Délai avant envoi SMS de backup (ms).
const SMS_BACKUP_DELAY_MS = 30_000;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private otpService: OtpService,
  ) {}

  // Notification « argent reçu » après crédit d'un portefeuille.
  // Non bloquant : un échec d'envoi ne doit jamais faire échouer la transaction.
  async notifyTransactionReceived(
    userId: string,
    opts: { type: ReceivedType; amountCentimes: bigint; from?: string | null },
  ): Promise<void> {
    const montant = (Number(opts.amountCentimes) / 100).toLocaleString('fr-FR');
    const titles: Record<ReceivedType, string> = {
      P2P: '💸 Argent reçu',
      QR_PAYMENT: '🧾 Paiement reçu',
      RECHARGE: '⚡ Recharge confirmée',
    };
    const from = opts.from ? ` de ${opts.from}` : '';
    const body =
      opts.type === 'RECHARGE'
        ? `Votre compte a été crédité de ${montant} FCFA.`
        : `Vous avez reçu ${montant} FCFA${from}.`;

    await this.sendToUser(userId, titles[opts.type], body, {
      type: opts.type,
      amount: Number(opts.amountCentimes) / 100,
    });
  }

  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true, phone: true },
    });
    if (!user?.pushToken) return;

    await this.sendExpoPush(user.pushToken, title, body, data);

    // SMS de backup 30 s après, uniquement pour les types critiques.
    const type = data?.type as string | undefined;
    const isCritical: boolean =
      type === 'P2P' || type === 'QR_PAYMENT' || type === 'RECHARGE';

    if (isCritical && user.phone) {
      const phone = user.phone;
      const smsText = `CamWallet : ${title}. ${body}`;
      setTimeout(() => {
        void this.otpService
          .sendSms(phone, smsText)
          .catch((err: any) =>
            this.logger.warn(`Échec SMS backup pour ${phone} : ${err?.message ?? err}`),
          );
      }, SMS_BACKUP_DELAY_MS);
    }
  }

  private async sendExpoPush(
    to: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ to, title, body, sound: 'default', priority: 'high', badge: 1, data }),
      });
      if (!res.ok) {
        this.logger.warn(`Échec envoi push Expo (HTTP ${res.status})`);
      }
    } catch (err: any) {
      this.logger.warn(`Erreur envoi push: ${err?.message ?? err}`);
    }
  }
}
