import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

interface CamPayToken {
  token: string;
  expiresAt: Date;
}

interface CamPayCollectResponse {
  reference: string;
  ussd_code?: string;
  operator?: string;
  status: string;
}

interface CamPayWithdrawResponse {
  reference: string;
  status: string;
  operator?: string;
}

interface CamPayTransactionStatus {
  reference: string;
  status: string;
  amount: string;
  currency: string;
  operator?: string;
  external_reference?: string;
  code?: string;
  reason?: string;
}

@Injectable()
export class CamPayService {
  private readonly logger = new Logger(CamPayService.name);
  private readonly http: AxiosInstance;
  private cachedToken: CamPayToken | null = null;

  constructor(private config: ConfigService) {
    const baseURL = this.config.get<string>('CAMPAY_BASE_URL') || 'https://demo.campay.net/api';
    this.http = axios.create({ baseURL, timeout: 30_000 });
  }

  // ─── Authentification ──────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    // Réutiliser le token en cache s'il expire dans plus de 60 secondes
    if (this.cachedToken && this.cachedToken.expiresAt > new Date(Date.now() + 60_000)) {
      return this.cachedToken.token;
    }

    const username = this.config.get<string>('CAMPAY_USERNAME');
    const password = this.config.get<string>('CAMPAY_PASSWORD');

    if (!username || !password) {
      throw new InternalServerErrorException('CAMPAY_USERNAME / CAMPAY_PASSWORD non configurés');
    }

    try {
      const { data } = await this.http.post('/token/', { username, password });
      const expiresIn: number = data.expires_in ?? 3600;

      this.cachedToken = {
        token: data.token,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      };

      this.logger.log('Token CamPay obtenu (expire dans ' + expiresIn + 's)');
      return this.cachedToken.token;
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'Erreur inconnue';
      this.logger.error('Échec obtention token CamPay : ' + msg);
      throw new InternalServerErrorException('Authentification CamPay échouée : ' + msg);
    }
  }

  private async authHeaders() {
    const token = await this.getToken();
    return { Authorization: `Token ${token}` };
  }

  // ─── Collect (recharge — débit mobile money de l'utilisateur) ─────────────

  async collect(
    amountCentimes: bigint,
    phone: string,
    externalRef: string,
    description: string,
  ): Promise<CamPayCollectResponse> {
    // CamPay attend le montant en FCFA entiers et le numéro sans le '+'
    const amount = String(amountCentimes / 100n);
    const from = phone.replace(/^\+/, '');

    try {
      const headers = await this.authHeaders();
      const { data } = await this.http.post<CamPayCollectResponse>(
        '/collect/',
        { amount, currency: 'XAF', from, description, external_reference: externalRef },
        { headers },
      );

      this.logger.log(`CamPay collect initié : ${amount} XAF (ref=${data.reference}, extRef=${externalRef})`);
      return data;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.detail || err?.message || 'Erreur inconnue';
      this.logger.error(`Erreur CamPay collect : ${msg}`);
      throw new BadRequestException('Initiation du paiement CamPay échouée : ' + msg);
    }
  }

  // ─── Withdraw (retrait — crédit vers mobile money de l'utilisateur) ────────

  async withdraw(
    amountCentimes: bigint,
    phone: string,
    externalRef: string,
    description: string,
  ): Promise<CamPayWithdrawResponse> {
    const amount = String(amountCentimes / 100n);
    const to = phone.replace(/^\+/, '');

    try {
      const headers = await this.authHeaders();
      const { data } = await this.http.post<CamPayWithdrawResponse>(
        '/withdraw/',
        { amount, currency: 'XAF', to, description, external_reference: externalRef },
        { headers },
      );

      this.logger.log(`CamPay withdraw initié : ${amount} XAF (ref=${data.reference}, extRef=${externalRef})`);
      return data;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.detail || err?.message || 'Erreur inconnue';
      this.logger.error(`Erreur CamPay withdraw : ${msg}`);
      throw new BadRequestException('Initiation du retrait CamPay échouée : ' + msg);
    }
  }

  // ─── Statut d'une transaction ─────────────────────────────────────────────

  async getTransaction(reference: string): Promise<CamPayTransactionStatus> {
    try {
      const headers = await this.authHeaders();
      const { data } = await this.http.get<CamPayTransactionStatus>(
        `/transaction/${reference}/`,
        { headers },
      );
      return data;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Erreur inconnue';
      this.logger.error(`Erreur CamPay getTransaction(${reference}) : ${msg}`);
      throw new InternalServerErrorException('Vérification statut CamPay échouée : ' + msg);
    }
  }

  // ─── Vérification de signature webhook ────────────────────────────────────
  // CamPay signe ses callbacks avec un JWT HS256 dont le secret est CAMPAY_WEBHOOK_KEY.
  // Format : {"alg":"HS256","app":"camwallet","typ":"JWT"} / {"source":"CamPay","exp":...}
  verifyWebhookSignature(payload: { signature?: string }): boolean {
    const webhookKey = this.config.get<string>('CAMPAY_WEBHOOK_KEY');

    if (!webhookKey) {
      throw new InternalServerErrorException('CAMPAY_WEBHOOK_KEY non configuré');
    }

    if (!payload.signature) {
      return false;
    }

    const parts = payload.signature.split('.');
    if (parts.length !== 3) {
      return false;
    }

    const [headerB64, payloadB64, sigB64] = parts;

    try {
      // Vérifier la signature HS256 à temps constant
      const expected = crypto
        .createHmac('sha256', webhookKey)
        .update(`${headerB64}.${payloadB64}`)
        .digest();

      const b64urlDecode = (s: string) =>
        Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

      const actual = b64urlDecode(sigB64);
      if (expected.length !== actual.length) return false;
      if (!crypto.timingSafeEqual(expected, actual)) return false;

      // Vérifier les claims (expiration + source)
      const claims = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
      const nowSec = Math.floor(Date.now() / 1000);
      if (claims.exp && claims.exp < nowSec) {
        this.logger.warn('JWT webhook CamPay expiré');
        return false;
      }
      if (claims.source !== 'CamPay') {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}
