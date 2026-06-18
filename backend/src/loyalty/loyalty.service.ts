import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Programme de fidélité CamWallet.
// Les seuils de niveaux et les règles de gain sont CONFIGURABLES depuis le dashboard
// admin (system_settings). Valeurs par défaut ci-dessous si non configurées.
//   • +N points par tranche de 1000 FCFA envoyée (P2P)     [loyalty_points_per_1000_fcfa]
//   • +N points par recharge confirmée                      [loyalty_points_recharge]
//   • +N points à l'approbation KYC                         [loyalty_points_kyc]
// Niveaux : Bronze (0) · Argent · Or · Platine
//   [loyalty_silver_threshold / loyalty_gold_threshold / loyalty_platinum_threshold]
const LEVEL_META = [
  { key: 'BRONZE', label: 'Bronze', emoji: '🥉' },
  { key: 'SILVER', label: 'Argent', emoji: '🥈' },
  { key: 'GOLD', label: 'Or', emoji: '🥇' },
  { key: 'PLATINUM', label: 'Platine', emoji: '💎' },
] as const;

// Valeurs par défaut (utilisées si la clé system_settings est absente/invalide).
export const LOYALTY_DEFAULTS = {
  silver: 100,
  gold: 500,
  platinum: 1000,
  perThousand: 1,
  recharge: 5,
  kyc: 10,
};

// Niveaux par défaut exposés pour compat (ex. tests). Préférer getConfig() à l'exécution.
export const LOYALTY_LEVELS = LEVEL_META.map((m, i) => ({
  ...m,
  min: [0, LOYALTY_DEFAULTS.silver, LOYALTY_DEFAULTS.gold, LOYALTY_DEFAULTS.platinum][i],
}));

// Raisons normalisées (libellés FR — l'app est francophone par défaut).
export const LoyaltyReason = {
  P2P_SEND: "Envoi d'argent",
  RECHARGE: 'Recharge',
  KYC_APPROVED: 'KYC approuvé',
};

interface LoyaltyConfig {
  silver: number;
  gold: number;
  platinum: number;
  perThousand: number;
  recharge: number;
  kyc: number;
}

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(private prisma: PrismaService) {}

  // Lit les seuils + règles depuis system_settings (repli sur les défauts).
  async getConfig(): Promise<LoyaltyConfig> {
    const keys = [
      'loyalty_silver_threshold', 'loyalty_gold_threshold', 'loyalty_platinum_threshold',
      'loyalty_points_per_1000_fcfa', 'loyalty_points_recharge', 'loyalty_points_kyc',
    ];
    const rows = await this.prisma.systemSettings.findMany({ where: { key: { in: keys } } });
    const num = (k: string, d: number) => {
      const v = rows.find((r) => r.key === k)?.value;
      const n = Number(v);
      return v != null && v !== '' && Number.isFinite(n) ? n : d;
    };
    return {
      silver: num('loyalty_silver_threshold', LOYALTY_DEFAULTS.silver),
      gold: num('loyalty_gold_threshold', LOYALTY_DEFAULTS.gold),
      platinum: num('loyalty_platinum_threshold', LOYALTY_DEFAULTS.platinum),
      perThousand: num('loyalty_points_per_1000_fcfa', LOYALTY_DEFAULTS.perThousand),
      recharge: num('loyalty_points_recharge', LOYALTY_DEFAULTS.recharge),
      kyc: num('loyalty_points_kyc', LOYALTY_DEFAULTS.kyc),
    };
  }

  private buildLevels(cfg: LoyaltyConfig) {
    const mins = [0, cfg.silver, cfg.gold, cfg.platinum];
    return LEVEL_META.map((m, i) => ({ ...m, min: mins[i] }));
  }

  // Attribue des points (atomique : solde + ligne d'historique). Appelé en
  // fire-and-forget après un mouvement déjà persisté.
  async award(userId: string, points: number, reason: string): Promise<void> {
    if (!userId || points <= 0) return;
    try {
      await this.prisma.$transaction([
        this.prisma.loyaltyPoints.upsert({
          where: { userId },
          create: { userId, points },
          update: { points: { increment: points } },
        }),
        this.prisma.loyaltyEvent.create({ data: { userId, points, reason } }),
      ]);
    } catch (err) {
      this.logger.error(
        `Attribution fidélité échouée (user=${userId}, +${points}) : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Points P2P : (montant en centimes / 1000 FCFA) × points configurés.
  pointsForP2p(amountCentimes: bigint, perThousand = LOYALTY_DEFAULTS.perThousand): number {
    return Math.floor(Number(amountCentimes) / 100_000) * perThousand; // 1000 FCFA = 100 000 centimes
  }

  // Attributions de haut niveau (lisent la config) — utilisées par les flux métier.
  async awardP2p(userId: string, amountCentimes: bigint): Promise<void> {
    const cfg = await this.getConfig();
    await this.award(userId, this.pointsForP2p(amountCentimes, cfg.perThousand), LoyaltyReason.P2P_SEND);
  }
  async awardRecharge(userId: string): Promise<void> {
    const cfg = await this.getConfig();
    await this.award(userId, cfg.recharge, LoyaltyReason.RECHARGE);
  }
  async awardKyc(userId: string): Promise<void> {
    const cfg = await this.getConfig();
    await this.award(userId, cfg.kyc, LoyaltyReason.KYC_APPROVED);
  }

  private levelFor(points: number, levels: ReturnType<LoyaltyService['buildLevels']>) {
    let current = levels[0];
    for (const l of levels) if (points >= l.min) current = l;
    const idx = levels.findIndex((l) => l.key === current.key);
    const next = levels[idx + 1] ?? null;
    const progress = next
      ? Math.min(100, Math.max(0, Math.round(((points - current.min) / (next.min - current.min)) * 100)))
      : 100;
    return { current, next, progress };
  }

  async getBalance(userId: string) {
    const [cfg, row] = await Promise.all([
      this.getConfig(),
      this.prisma.loyaltyPoints.findUnique({ where: { userId } }),
    ]);
    const levels = this.buildLevels(cfg);
    const points = row?.points ?? 0;
    const { current, next, progress } = this.levelFor(points, levels);
    return {
      points,
      level: { key: current.key, label: current.label, emoji: current.emoji },
      nextLevel: next ? { key: next.key, label: next.label, emoji: next.emoji, at: next.min } : null,
      pointsToNext: next ? Math.max(0, next.min - points) : 0,
      progress,
      // Seuils configurés (pour l'affichage dynamique côté mobile).
      levels: levels.map((l) => ({ key: l.key, label: l.label, emoji: l.emoji, min: l.min })),
    };
  }

  async getHistory(userId: string, take = 50) {
    return this.prisma.loyaltyEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, points: true, reason: true, createdAt: true },
    });
  }

  // Stats agrégées pour le dashboard admin : total distribué + répartition par niveau.
  async getDistribution() {
    const [cfg, rows] = await Promise.all([
      this.getConfig(),
      this.prisma.loyaltyPoints.findMany({ select: { points: true } }),
    ]);
    const levels = this.buildLevels(cfg);
    const totalDistributed = rows.reduce((s, r) => s + r.points, 0);
    const byLevel = levels.map((l, i) => {
      const next = levels[i + 1];
      const count = rows.filter((r) => r.points >= l.min && (!next || r.points < next.min)).length;
      return { key: l.key, label: l.label, emoji: l.emoji, count };
    });
    return { totalDistributed, members: rows.length, byLevel };
  }
}
