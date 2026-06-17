import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SmsPingResult {
  reachable: boolean;
  latency: number | null;
}

/**
 * Envoi de SMS via AfricasTalking (passerelle SMS pour le Cameroun).
 *
 * - En production avec `AT_API_KEY` configuré → envoi réel via l'API AT.
 * - Sinon (développement / sandbox) → le SMS est seulement loggué (aucun
 *   appel réseau), ce qui permet de tester les flux OTP sans crédits SMS.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private client: any | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Vrai quand AfricasTalking est configuré (clé API présente). */
  isConfigured(): boolean {
    return !!this.config.get<string>('AT_API_KEY');
  }

  private isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  /** Client AfricasTalking mémoïsé (instancié à la demande). */
  private getClient(): any {
    if (this.client) return this.client;
    const apiKey = this.config.get<string>('AT_API_KEY');
    const username = this.config.get<string>('AT_USERNAME', 'sandbox');
    // require dynamique : on ne charge le SDK que si on en a réellement besoin.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AfricasTalking = require('africastalking');
    this.client = AfricasTalking({ apiKey, username });
    return this.client;
  }

  /**
   * Envoie un SMS.
   * - Dev / sandbox (pas de clé API ou NODE_ENV ≠ production) → log console.
   * - Prod → API AfricasTalking, avec 1 nouvel essai en cas d'échec.
   */
  async sendSms(phone: string, message: string): Promise<void> {
    if (!this.isProduction() || !this.isConfigured()) {
      this.logger.warn(`[SMS SANDBOX] → ${phone} : ${message}`);
      return;
    }

    const senderId = this.config.get<string>('AT_SENDER_ID');
    const options: any = { to: [phone], message };
    if (senderId) options.from = senderId; // sender ID optionnel (alphanumérique)

    // Un essai initial + un retry (la consigne : « retry 1 fois si échec »).
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.getClient().SMS.send(options);
        this.logger.log(`SMS envoyé → ${phone}`);
        return;
      } catch (err) {
        const last = attempt === 2;
        this.logger.error(
          `Échec envoi SMS → ${phone} (tentative ${attempt}/2)${last ? '' : ', nouvel essai…'}`,
          err instanceof Error ? err.stack : String(err),
        );
        if (last) throw err;
      }
    }
  }

  /**
   * Ping l'API AfricasTalking (récupère les données du compte).
   * Utilisé par le tableau de bord « Santé des intégrations ».
   */
  async ping(): Promise<SmsPingResult> {
    if (!this.isConfigured()) return { reachable: false, latency: null };
    const start = Date.now();
    try {
      await this.getClient().APPLICATION.fetchApplicationData();
      return { reachable: true, latency: Date.now() - start };
    } catch (err) {
      this.logger.error(
        'Ping AfricasTalking échoué',
        err instanceof Error ? err.stack : String(err),
      );
      return { reachable: false, latency: null };
    }
  }
}
