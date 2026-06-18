import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CacheService } from '../cache/cache.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const makePrismaMock = () => ({
  user: {
    findUnique: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  transaction: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  qrCode: {
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  auditLog: {
    create: jest.fn().mockResolvedValue({}),
  },
  disputeRequest: {
    create: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  $transaction: jest.fn(),
});

describe('TransactionsService', () => {
  let service: TransactionsService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationsService,
          useValue: { notifyTransactionReceived: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: CacheService, useValue: { wrap: (_k: string, _t: number, fn: () => any) => fn(), del: jest.fn() } },
        { provide: LoyaltyService, useValue: { award: jest.fn().mockResolvedValue(undefined), pointsForP2p: () => 0 } },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  // ─── p2p ──────────────────────────────────────────────────────────────────

  describe('p2p', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockImplementation((args: any) => {
        if (args?.where?.phone === '+237677000002') {
          return Promise.resolve({ id: 'receiver-id', phone: '+237677000002' });
        }
        if (args?.where?.id === 'sender-id') {
          return Promise.resolve({ fullName: 'Alice' });
        }
        return Promise.resolve(null);
      });
    });

    it('effectue un virement P2P avec solde suffisant', async () => {
      const createdTx = { id: 'tx-1', type: 'P2P', amount: 100000n };

      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const txClient = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue({ balance: 200000n }),
            update: jest.fn().mockResolvedValue({}),
          },
          transaction: {
            create: jest.fn().mockResolvedValue(createdTx),
          },
        };
        return fn(txClient);
      });

      const result = await service.p2p('sender-id', '+237677000002', 100000n);

      expect(result).toEqual(createdTx);
    });

    it('rejette si le solde est insuffisant', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const txClient = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue({ balance: 5000n }),
          },
        };
        return fn(txClient);
      });

      await expect(service.p2p('sender-id', '+237677000002', 100000n)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette si le destinataire est introuvable', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.p2p('sender-id', '+237600000000', 100000n)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejette un envoi à soi-même', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'sender-id', phone: '+237677000001' });

      await expect(service.p2p('sender-id', '+237677000001', 100000n)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette un montant invalide (0)', async () => {
      await expect(service.p2p('sender-id', '+237677000002', 0n)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── payByQr ──────────────────────────────────────────────────────────────

  describe('payByQr', () => {
    it('effectue un paiement QR statique', async () => {
      const qrCode = {
        id: 'qr-1',
        type: 'STATIC',
        payload: 'camwallet://pay?to=+237699000002',
        isActive: true,
        userId: 'merchant-id',
        amount: null,
        expiresAt: null,
        usedAt: null,
        user: { id: 'merchant-id' },
      };
      prisma.qrCode.findFirst.mockResolvedValue(qrCode);

      const createdTx = { id: 'tx-2', type: 'QR_PAYMENT', amount: 50000n };

      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const txClient = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue({ balance: 200000n }),
            update: jest.fn().mockResolvedValue({}),
          },
          transaction: {
            create: jest.fn().mockResolvedValue(createdTx),
          },
          qrCode: {
            update: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(txClient);
      });

      const result = await service.payByQr('payer-id', qrCode.payload, 50000n);

      expect(result.id).toBe('tx-2');
    });

    it('rejette un QR dynamique expiré', async () => {
      prisma.qrCode.findFirst.mockResolvedValue({
        id: 'qr-2',
        type: 'DYNAMIC',
        isActive: true,
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
        amount: 10000n,
        userId: 'merchant-id',
        user: { id: 'merchant-id' },
      });

      await expect(service.payByQr('payer-id', 'camwallet://dynamic', undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette un QR dynamique déjà utilisé', async () => {
      prisma.qrCode.findFirst.mockResolvedValue({
        id: 'qr-3',
        type: 'DYNAMIC',
        isActive: true,
        expiresAt: new Date(Date.now() + 60000),
        usedAt: new Date(),
        amount: 10000n,
        userId: 'merchant-id',
        user: { id: 'merchant-id' },
      });

      await expect(service.payByQr('payer-id', 'camwallet://dynamic2', undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette si le QR est introuvable', async () => {
      prisma.qrCode.findFirst.mockResolvedValue(null);

      await expect(service.payByQr('payer-id', 'invalid-payload', 10000n)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('calcule la commission marchand à 0,5%', async () => {
      const qrCode = {
        id: 'qr-4',
        type: 'DYNAMIC',
        isActive: true,
        expiresAt: new Date(Date.now() + 60000),
        usedAt: null,
        amount: 100000n,
        userId: 'merchant-id',
        user: { id: 'merchant-id' },
      };
      prisma.qrCode.findFirst.mockResolvedValue(qrCode);

      let capturedCreate: any;
      prisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => {
        const txClient = {
          wallet: {
            findUnique: jest.fn().mockResolvedValue({ balance: 500000n }),
            update: jest.fn().mockResolvedValue({}),
          },
          transaction: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedCreate = args.data;
              return Promise.resolve({ id: 'tx-fee', ...args.data });
            }),
          },
          qrCode: { update: jest.fn().mockResolvedValue({}) },
        };
        return fn(txClient);
      });

      await service.payByQr('payer-id', 'payload', undefined);

      // commission = (100000 * 5) / 1000 = 500 centimes (5 FCFA)
      expect(capturedCreate.fee).toBe(500n);
    });
  });

  // ─── getHistory ───────────────────────────────────────────────────────────

  describe('getHistory', () => {
    const fakeTx = (id: string) => ({
      id,
      type: 'P2P',
      amount: 50000n,
      senderId: 'user-1',
      receiverId: 'user-2',
      createdAt: new Date(),
      sender: { phone: '+237677000001', fullName: 'Alice' },
      receiver: { phone: '+237677000002', fullName: 'Bob' },
    });

    it('retourne la première page avec métadonnées', async () => {
      prisma.transaction.findMany.mockResolvedValue([fakeTx('tx-1'), fakeTx('tx-2')]);
      prisma.transaction.count.mockResolvedValue(15);

      const result = await service.getHistory('user-1');

      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({ total: 15, page: 1, limit: 20, totalPages: 1 });
    });

    it('calcule totalPages correctement', async () => {
      prisma.transaction.findMany.mockResolvedValue([fakeTx('tx-1')]);
      prisma.transaction.count.mockResolvedValue(45);

      const result = await service.getHistory('user-1', 2, 20);

      expect(result.meta.totalPages).toBe(3); // ceil(45/20)
      expect(result.meta.page).toBe(2);
    });

    it('applique le skip de pagination correctement', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(0);

      await service.getHistory('user-1', 3, 10);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('filtre par type si fourni', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(0);

      await service.getHistory('user-1', 1, 20, 'P2P' as any);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'P2P' }),
        }),
      );
    });

    it('n\'applique pas de filtre type si absent', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(0);

      await service.getHistory('user-1');

      const call = prisma.transaction.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('type');
    });

    it('inclut les transactions où l\'utilisateur est expéditeur ou destinataire', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(0);

      await service.getHistory('user-1');

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ senderId: 'user-1' }, { receiverId: 'user-1' }],
          }),
        }),
      );
    });

    it('retourne une liste vide si aucune transaction', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(0);

      const result = await service.getHistory('user-inconnu');

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });
});
