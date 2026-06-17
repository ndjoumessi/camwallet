import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SmsPingResult {
  reachable: boolean;
  latency: number | null;
  sandbox: boolean;
}

/**
 * Envoi de SMS via AfricasTalking (passerelle SMS pour le Cameroun).
 *
 * Modes (déterminés par les variables d'environnement) :
 * - **Pas de `AT_API_KEY`** → aucun appel réseau, le SMS est seulement loggué.
 *   C'est le défaut en local/dev (la clé n'est posée que sur Railway).
 * - **`AT_USERNAME=sandbox`** → le SDK route automatiquement vers
 *   `api.sandbox.africastalking.com`. ⚠️ Le sandbox **ne livre pas** de vrais
 *   SMS : les messages sont seulement visibles dans le simulateur AfricasTalking.
 *   Utile pour valider l'intégration de bout en bout sans crédits ni go-live.
 * - **`AT_USERNAME` = compte live** → envoi réel via l'API de production AT.
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

  /** Vrai en mode sandbox (username `sandbox` → endpoint AT sandbox). */
  isSandbox(): boolean {
    return (this.config.get<string>('AT_USERNAME') ?? '').toLowerCase() === 'sandbox';
  }

  /** Client AfricasTalking mémoïsé (instancié à la demande). */
  private getClient(): any {
    if (this.client) return this.client;
    const apiKey = this.config.get<string>('AT_API_KEY');
    const username = this.config.get<string>('AT_USERNAME', 'sandbox');
    // require dynamique : on ne charge le SDK que si on en a réellement besoin.
    // Le SDK détecte username==='sandbox' et bascule sur l'endpoint sandbox.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AfricasTalking = require('africastalking');
    this.client = AfricasTalking({ apiKey, username });
    return this.client;
  }

  /**
   * Envoie un SMS.
   * - Pas de clé API configurée → log console seulement (dev local).
   * - Clé configurée → API AfricasTalking (sandbox ou live selon le username),
   *   avec 1 nouvel essai en cas d'échec.
   */
  async sendSms(phone: string, message: string): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.warn(`[SMS DEV] → ${phone} : ${message}`);
      return;
    }

    const options: any = { to: [phone], message };
    // Sender ID alphanumérique : uniquement en live. En sandbox, un sender ID
    // non enregistré fait échouer l'envoi (InvalidSenderId) → on l'omet.
    const senderId = this.config.get<string>('AT_SENDER_ID');
    if (senderId && !this.isSandbox()) options.from = senderId;

    // Un essai initial + un retry (la consigne : « retry 1 fois si échec »).
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.getClient().SMS.send(options);
        this.logger.log(`SMS envoyé → ${phone}${this.isSandbox() ? ' (sandbox)' : ''}`);
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
    const sandbox = this.isSandbox();
    if (!this.isConfigured()) return { reachable: false, latency: null, sandbox };
    const start = Date.now();
    try {
      await this.getClient().APPLICATION.fetchApplicationData();
      return { reachable: true, latency: Date.now() - start, sandbox };
    } catch (err) {
      this.logger.error(
        'Ping AfricasTalking échoué',
        err instanceof Error ? err.stack : String(err),
      );
      return { reachable: false, latency: null, sandbox };
    }
  }
}
