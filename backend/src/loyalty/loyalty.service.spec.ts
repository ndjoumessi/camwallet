import { LoyaltyService } from './loyalty.service';

const makeService = (points: number | null) => {
  const prisma = {
    systemSettings: { findMany: jest.fn().mockResolvedValue([]) }, // → seuils/points par défaut
    loyaltyPoints: {
      findUnique: jest.fn().mockResolvedValue(points === null ? null : { points }),
      upsert: jest.fn().mockReturnValue('pts-op'),
    },
    loyaltyEvent: { create: jest.fn().mockReturnValue('evt-op') },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const svc = new LoyaltyService(prisma as any);
  return { svc, prisma };
};

describe('LoyaltyService', () => {
  describe('pointsForP2p', () => {
    it('attribue 1 point par tranche de 1000 FCFA (centimes)', () => {
      const { svc } = makeService(0);
      expect(svc.pointsForP2p(100_000n)).toBe(1); // 1000 FCFA
      expect(svc.pointsForP2p(550_000n)).toBe(5); // 5500 FCFA → 5
      expect(svc.pointsForP2p(50_000n)).toBe(0); // 500 FCFA → 0
    });
  });

  describe('getBalance — niveaux et progression', () => {
    it('Bronze à 0 point, progression vers Argent', async () => {
      const { svc } = makeService(0);
      const r = await svc.getBalance('u1');
      expect(r.level.key).toBe('BRONZE');
      expect(r.nextLevel?.key).toBe('SILVER');
      expect(r.pointsToNext).toBe(100);
      expect(r.progress).toBe(0);
    });

    it('Argent à 300 points (progression vers Or)', async () => {
      const { svc } = makeService(300);
      const r = await svc.getBalance('u1');
      expect(r.level.key).toBe('SILVER');
      expect(r.nextLevel?.key).toBe('GOLD');
      expect(r.pointsToNext).toBe(200); // 500 - 300
    });

    it('Platine au sommet (pas de niveau suivant, progress 100)', async () => {
      const { svc } = makeService(1500);
      const r = await svc.getBalance('u1');
      expect(r.level.key).toBe('PLATINUM');
      expect(r.nextLevel).toBeNull();
      expect(r.progress).toBe(100);
    });
  });

  describe('award', () => {
    it('upsert le solde + crée une ligne d’historique de façon atomique', async () => {
      const { svc, prisma } = makeService(0);
      await svc.award('u1', 10, 'KYC approuvé');
      expect(prisma.loyaltyPoints.upsert).toHaveBeenCalled();
      expect(prisma.loyaltyEvent.create).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledWith(['pts-op', 'evt-op']);
    });

    it('ignore une attribution de 0 point ou moins', async () => {
      const { svc, prisma } = makeService(0);
      await svc.award('u1', 0, 'x');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
