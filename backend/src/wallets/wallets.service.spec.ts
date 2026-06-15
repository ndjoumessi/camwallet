import { Test, TestingModule } from '@nestjs/testing';
import { WalletsService } from './wallets.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const makePrismaMock = () => ({
  wallet: {
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  transaction: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('WalletsService', () => {
  let service: WalletsService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
  });

  // ─── getBalance ───────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('retourne le solde du portefeuille', async () => {
      prisma.wallet.findUnique.mockResolvedValue({
        balance: 150000n,
        currency: 'XAF',
        dailyLimit: 5000000n,
        monthlyLimit: 50000000n,
        isActive: true,
      });

      const result = await service.getBalance('user-1');

      expect(result.balance).toBe(150000n);
      expect(result.currency).toBe('XAF');
    });

    it('lève NotFoundException si le portefeuille est introuvable', async () => {
      prisma.wallet.findUnique.mockResolvedValue(null);

      await expect(service.getBalance('user-inexistant')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── recharge ─────────────────────────────────────────────────────────────

  describe('recharge', () => {
    it('crée une transaction PENDING', async () => {
      prisma.transaction.create.mockResolvedValue({
        id: 'tx-1',
        type: 'RECHARGE',
        status: 'PENDING',
        amount: 500000n,
        reference: 'REF-001',
        fee: 0n,
      });

      const result = await service.recharge('user-1', 500000n, 'ORANGE_MONEY');

      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'RECHARGE', status: 'PENDING', amount: 500000n }),
        }),
      );
      expect(result.status).toBe('PENDING');
      expect(result.fee).toBe(0n);
    });

    it('rejette un montant invalide (0)', async () => {
      await expect(service.recharge('user-1', 0n, 'MTN_MOMO')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette un montant négatif', async () => {
      await expect(service.recharge('user-1', -1000n, 'ORANGE_MONEY')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── withdraw ─────────────────────────────────────────────────────────────

  describe('withdraw', () => {
    it('débite solde + frais et crée une transaction PENDING', async () => {
      const createdTx = {
        id: 'tx-w1',
        type: 'WITHDRAWAL',
        status: 'PENDING',
        amount: 100000n,
        fee: 5000n, // frais min = 5000 centimes (50 FCFA)
        reference: 'WDRW-001',
      };

      prisma.$transaction.mockImplementation(async (fn: Function) => {
        const txClient = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue({
              balance: 200000n,
              isActive: true,
            }),
            update: jest.fn().mockResolvedValue({}),
          },
          transaction: {
            create: jest.fn().mockResolvedValue(createdTx),
          },
        };
        return fn(txClient);
      });

      const result = await service.withdraw('user-1', 100000n, 'ORANGE_MONEY');

      expect(result.status).toBe('PENDING');
      expect(result.fee).toBe(5000n);
    });

    it('applique les frais min de 50 FCFA (5000 centimes) sur petits montants', async () => {
      let capturedData: any;
      prisma.$transaction.mockImplementation(async (fn: Function) => {
        const txClient = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue({ balance: 200000n, isActive: true }),
            update: jest.fn().mockResolvedValue({}),
          },
          transaction: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedData = args.data;
              return Promise.resolve({ ...args.data, id: 'tx-min-fee', reference: 'X', status: 'PENDING' });
            }),
          },
        };
        return fn(txClient);
      });

      // Retrait 1000 centimes (10 FCFA) → frais 1% = 10 centimes < 5000 → frais = 5000
      await service.withdraw('user-1', 1000n, 'MTN_MOMO');

      expect(capturedData.fee).toBe(5000n);
    });

    it('applique frais 1% pour les gros montants', async () => {
      let capturedData: any;
      prisma.$transaction.mockImplementation(async (fn: Function) => {
        const txClient = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue({ balance: 200000000n, isActive: true }),
            update: jest.fn().mockResolvedValue({}),
          },
          transaction: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedData = args.data;
              return Promise.resolve({ ...args.data, id: 'tx-big', reference: 'X', status: 'PENDING' });
            }),
          },
        };
        return fn(txClient);
      });

      // Retrait 100 000 000 centimes (1 000 000 FCFA) → frais 1% = 1 000 000 centimes
      await service.withdraw('user-1', 100_000_000n, 'ORANGE_MONEY');

      expect(capturedData.fee).toBe(1_000_000n);
    });

    it('rejette si le solde est insuffisant (montant + frais)', async () => {
      prisma.$transaction.mockImplementation(async (fn: Function) => {
        const txClient = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue({ balance: 5000n, isActive: true }),
          },
        };
        return fn(txClient);
      });

      await expect(service.withdraw('user-1', 100000n, 'ORANGE_MONEY')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette si le portefeuille est désactivé', async () => {
      prisma.$transaction.mockImplementation(async (fn: Function) => {
        const txClient = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue({ balance: 500000n, isActive: false }),
          },
        };
        return fn(txClient);
      });

      await expect(service.withdraw('user-1', 50000n, 'MTN_MOMO')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette un montant invalide (0)', async () => {
      await expect(service.withdraw('user-1', 0n, 'ORANGE_MONEY')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
