import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Programme de fidélité CamWallet.
// Règles d'attribution :
//   • +1 point par tranche de 1000 FCFA envoyée (P2P)
//   • +5 points par recharge confirmée
//   • +10 points à l'approbation KYC
// Niveaux : Bronze (0-99) · Argent (100-499) · Or (500-999) · Platine (1000+).
export const LOYALTY_LEVELS = [
  { key: 'BRONZE', label: 'Bronze', emoji: '🥉', min: 0 },
  { key: 'SILVER', label: 'Argent', emoji: '🥈', min: 100 },
  { key: 'GOLD', label: 'Or', emoji: '🥇', min: 500 },
  { key: 'PLATINUM', label: 'Platine', emoji: '💎', min: 1000 },
] as const;

// Raisons normalisées (libellés FR — l'app est francophone par défaut).
export const LoyaltyReason = {
  P2P_SEND: "Envoi d'argent",
  RECHARGE: 'Recharge',
  KYC_APPROVED: 'KYC approuvé',
};

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(private prisma: PrismaService) {}

  // Attribue des points (atomique : solde + ligne d'historique). Idempotence non
  // requise — appelé en fire-and-forget après un mouvement déjà persisté.
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
      // Ne jamais casser le flux métier pour un échec de fidélité.
      this.logger.error(
        `Attribution fidélité échouée (user=${userId}, +${points}) : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Points gagnés sur un envoi P2P : 1 point / 1000 FCFA (montant en centimes).
  pointsForP2p(amountCentimes: bigint): number {
    return Math.floor(Number(amountCentimes) / 100_000); // 1000 FCFA = 100 000 centimes
  }

  private levelFor(points: number) {
    let current: (typeof LOYALTY_LEVELS)[number] = LOYALTY_LEVELS[0];
    for (const l of LOYALTY_LEVELS) if (points >= l.min) current = l;
    const idx = LOYALTY_LEVELS.findIndex((l) => l.key === current.key);
    const next = LOYALTY_LEVELS[idx + 1] ?? null;
    // Progression (%) entre le palier courant et le suivant (100 % si Platine).
    const progress = next
      ? Math.min(100, Math.round(((points - current.min) / (next.min - current.min)) * 100))
      : 100;
    return { current, next, progress };
  }

  async getBalance(userId: string) {
    const row = await this.prisma.loyaltyPoints.findUnique({ where: { userId } });
    const points = row?.points ?? 0;
    const { current, next, progress } = this.levelFor(points);
    return {
      points,
      level: { key: current.key, label: current.label, emoji: current.emoji },
      nextLevel: next ? { key: next.key, label: next.label, emoji: next.emoji, at: next.min } : null,
      pointsToNext: next ? Math.max(0, next.min - points) : 0,
      progress,
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
    const rows = await this.prisma.loyaltyPoints.findMany({ select: { points: true } });
    const totalDistributed = rows.reduce((s, r) => s + r.points, 0);
    const byLevel = LOYALTY_LEVELS.map((l, i) => {
      const next = LOYALTY_LEVELS[i + 1];
      const count = rows.filter((r) => r.points >= l.min && (!next || r.points < next.min)).length;
      return { key: l.key, label: l.label, emoji: l.emoji, count };
    });
    return { totalDistributed, members: rows.length, byLevel };
  }
}
