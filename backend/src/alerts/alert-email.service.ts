import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// Surveillance automatique (cron 5 min) + envoi d'alertes email aux opérateurs.
// Dégradation gracieuse à la SmsService : sans RESEND_API_KEY, on logue
// « [ALERT EMAIL DEV] » au lieu d'envoyer (la prod reste saine si la clé manque).
type Kind = 'high_value' | 'failure_rate' | 'signups' | 'kyc_score' | 'admin_failed';

// Fenêtre anti-spam par type d'alerte (minutes) : on ne renvoie pas la même
// alerte tant que la fenêtre n'est pas écoulée.
const COOLDOWN_MIN: Record<Kind, number> = {
  high_value: 10,
  failure_rate: 60,
  signups: 60,
  kyc_score: 60,
  admin_failed: 15,
};

@Injectable()
export class AlertEmailService {
  private readonly logger = new Logger(AlertEmailService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  isConfigured(): boolean {
    const key = this.config.get<string>('RESEND_API_KEY');
    return !!key && key.length > 10 && !key.includes('placeholder') && !key.includes('xxx');
  }

  // ─── Scan périodique ────────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'alert-email-scan' })
  async scan() {
    try {
      const rows = await this.prisma.systemSettings.findMany();
      const s = new Map(rows.map((r) => [r.key, r.value]));
      if (s.get('email_alerts_enabled') !== 'on') return;

      // Historique récent (60 min) pour le cooldown par type.
      const since = new Date(Date.now() - 60 * 60000);
      const recent = await this.prisma.auditLog.findMany({
        where: { action: 'EMAIL_ALERT_SENT', createdAt: { gte: since } },
        select: { metadata: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      const lastByKind = new Map<string, Date>();
      for (const r of recent) {
        const k = (r.metadata as any)?.kind as string | undefined;
        if (k && !lastByKind.has(k)) lastByKind.set(k, r.createdAt);
      }
      const onCooldown = (kind: Kind) => {
        const last = lastByKind.get(kind);
        if (!last) return false;
        return Date.now() - last.getTime() < COOLDOWN_MIN[kind] * 60000;
      };

      if (s.get('email_alert_high_value') === 'on' && !onCooldown('high_value')) {
        await this.checkHighValue(s);
      }
      if (s.get('email_alert_failure_rate') === 'on' && !onCooldown('failure_rate')) {
        await this.checkFailureRate();
      }
      if (s.get('email_alert_signups') === 'on' && !onCooldown('signups')) {
        await this.checkSignups();
      }
      if (s.get('email_alert_kyc_score') === 'on' && !onCooldown('kyc_score')) {
        await this.checkKycScore();
      }
      if (s.get('email_alert_admin_failed') === 'on' && !onCooldown('admin_failed')) {
        await this.checkAdminFailed();
      }
    } catch (err: any) {
      this.logger.warn(`Scan alertes email échoué : ${err?.message ?? err}`);
    }
  }

  // ─── Règles ─────────────────────────────────────────────────────────────────
  private async checkHighValue(s: Map<string, string>) {
    const thresholdFcfa = Number(s.get('anif_threshold_fcfa') || '500000');
    const thresholdCentimes = BigInt(Math.round(thresholdFcfa * 100));
    const since = new Date(Date.now() - 10 * 60000);
    const tx = await this.prisma.transaction.findFirst({
      where: { amount: { gte: thresholdCentimes }, createdAt: { gte: since }, status: { in: ['COMPLETED', 'PENDING'] } },
      orderBy: { amount: 'desc' },
      select: { reference: true, amount: true, type: true, createdAt: true },
    });
    if (!tx) return;
    const fcfa = (Number(tx.amount) / 100).toLocaleString('fr-FR');
    await this.trigger('high_value', `Transaction ${tx.reference} (${tx.type})`, `${fcfa} FCFA`, {
      title: 'Transaction à montant élevé',
      rows: [
        { label: 'Référence', value: tx.reference },
        { label: 'Type', value: tx.type },
        { label: 'Montant', value: `${fcfa} FCFA` },
        { label: 'Seuil ANIF', value: `${thresholdFcfa.toLocaleString('fr-FR')} FCFA` },
      ],
    });
  }

  private async checkFailureRate() {
    const since = new Date(Date.now() - 60 * 60000);
    const [total, failed] = await Promise.all([
      this.prisma.transaction.count({ where: { type: { in: ['RECHARGE', 'WITHDRAWAL'] }, createdAt: { gte: since } } }),
      this.prisma.transaction.count({ where: { type: { in: ['RECHARGE', 'WITHDRAWAL'] }, createdAt: { gte: since }, status: { in: ['FAILED', 'CANCELLED'] } } }),
    ]);
    if (total < 5) return;
    const rate = failed / total;
    if (rate <= 0.1) return;
    const pct = Math.round(rate * 100);
    await this.trigger('failure_rate', `Taux d'échec recharge/retrait`, `${pct}%`, {
      title: "Taux d'échec opérateur élevé",
      rows: [
        { label: 'Taux d\'échec (1h)', value: `${pct} %` },
        { label: 'Échecs', value: String(failed) },
        { label: 'Total', value: String(total) },
      ],
    });
  }

  private async checkSignups() {
    const since = new Date(Date.now() - 60 * 60000);
    const count = await this.prisma.user.count({ where: { createdAt: { gte: since } } });
    if (count <= 50) return;
    await this.trigger('signups', 'Pic d\'inscriptions', `${count}/h`, {
      title: 'Inscriptions anormalement élevées',
      rows: [
        { label: 'Inscriptions (1h)', value: String(count) },
        { label: 'Seuil', value: '50 / h' },
      ],
    });
  }

  private async checkKycScore() {
    const since = new Date(Date.now() - 24 * 3600000);
    const agg = await this.prisma.kycDocument.aggregate({
      _avg: { aiScore: true },
      _count: { aiScore: true },
      where: { aiAnalyzedAt: { gte: since }, aiScore: { not: null } },
    });
    const n = agg._count.aiScore ?? 0;
    const avg = agg._avg.aiScore ?? null;
    if (n < 3 || avg == null || avg >= 60) return;
    const avgR = Math.round(avg);
    await this.trigger('kyc_score', 'Score IA KYC moyen faible', `${avgR}/100`, {
      title: 'Qualité KYC en baisse',
      rows: [
        { label: 'Score IA moyen (24h)', value: `${avgR} / 100` },
        { label: 'Documents analysés', value: String(n) },
        { label: 'Seuil', value: '60 / 100' },
      ],
    });
  }

  private async checkAdminFailed() {
    const since = new Date(Date.now() - 15 * 60000);
    const count = await this.prisma.auditLog.count({
      where: {
        createdAt: { gte: since },
        OR: [
          { action: { contains: 'LOGIN_FAIL', mode: 'insensitive' } },
          { action: { contains: 'ADMIN_LOGIN_FAILED', mode: 'insensitive' } },
        ],
      },
    });
    if (count <= 5) return;
    await this.trigger('admin_failed', 'Connexions admin échouées', `${count} en 15 min`, {
      title: 'Tentatives de connexion admin suspectes',
      rows: [
        { label: 'Échecs (15 min)', value: String(count) },
        { label: 'Seuil', value: '5' },
      ],
    });
  }

  // ─── Envoi + historique ─────────────────────────────────────────────────────
  private async trigger(kind: Kind, detail: string, value: string, email: { title: string; rows: { label: string; value: string }[] }) {
    await this.sendEmail(`⚠️ CamWallet — ${email.title}`, this.renderEmail(email.title, email.rows));
    await this.prisma.auditLog.create({
      data: { action: 'EMAIL_ALERT_SENT', resource: 'AlertEmail', metadata: { kind, detail, value } },
    });
    this.logger.log(`Alerte « ${kind} » déclenchée : ${detail} (${value})`);
  }

  private async resolveRecipient(): Promise<string | null> {
    const row = await this.prisma.systemSettings.findUnique({ where: { key: 'alert_email' } });
    const fromDb = row?.value?.trim();
    return fromDb || this.config.get<string>('ALERT_EMAIL') || null;
  }

  private async sendEmail(subject: string, html: string) {
    const recipient = await this.resolveRecipient();
    if (!this.isConfigured() || !recipient) {
      this.logger.log(`[ALERT EMAIL DEV] ${subject}${recipient ? ` → ${recipient}` : ' (aucun destinataire)'}`);
      return;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.get<string>('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.get<string>('ALERT_EMAIL_FROM') || 'CamWallet Alertes <alertes@camwallet.cm>',
          to: [recipient],
          subject,
          html,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Resend a renvoyé ${res.status} pour « ${subject} »`);
      }
    } catch (err: any) {
      this.logger.warn(`Envoi email échoué : ${err?.message ?? err}`);
    }
  }

  // Gabarit HTML professionnel aux couleurs CamWallet.
  private renderEmail(title: string, rows: { label: string; value: string }[]): string {
    const cells = rows
      .map(
        (r) =>
          `<tr><td style="padding:8px 0;color:#64748B;font-size:13px">${r.label}</td><td style="padding:8px 0;color:#0A0F1E;font-size:13px;font-weight:600;text-align:right">${r.value}</td></tr>`,
      )
      .join('');
    return `<!DOCTYPE html><html lang="fr"><body style="margin:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E2E8F0">
    <div style="background:#0A0F1E;padding:18px 24px">
      <span style="font-size:20px;font-weight:800;color:#00C896">Cam</span><span style="font-size:20px;font-weight:800;color:#fff">Wallet</span>
      <span style="color:#94A3B8;font-size:12px"> · Alertes</span>
    </div>
    <div style="padding:24px">
      <h1 style="margin:0 0 16px;font-size:17px;color:#0A0F1E">${title}</h1>
      <table style="width:100%;border-collapse:collapse">${cells}</table>
    </div>
    <div style="padding:14px 24px;background:#F8FAFC;color:#94A3B8;font-size:11px;text-align:center;border-top:1px solid #E2E8F0">
      Alerte automatique · CamWallet · ${new Date().toLocaleString('fr-FR')}
    </div>
  </div>
</body></html>`;
  }

  // Historique des dernières alertes envoyées (pour le dashboard admin).
  async getEmailAlertHistory(limit = 10) {
    const rows = await this.prisma.auditLog.findMany({
      where: { action: 'EMAIL_ALERT_SENT' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(50, Math.max(1, limit)),
      select: { id: true, metadata: true, createdAt: true },
    });
    return rows.map((r) => {
      const m = (r.metadata as any) ?? {};
      return { id: r.id, kind: m.kind ?? '—', detail: m.detail ?? '', value: m.value ?? '', createdAt: r.createdAt };
    });
  }
}
