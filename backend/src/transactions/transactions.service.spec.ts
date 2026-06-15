import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
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

      prisma.$transaction.mockImplementation(async (fn: Function) => {
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
      prisma.$transaction.mockImplementation(async (fn: Function) => {
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

      prisma.$transaction.mockImplementation(async (fn: Function) => {
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
      prisma.$transaction.mockImplementation(async (fn: Function) => {
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
});
