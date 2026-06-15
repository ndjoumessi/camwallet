import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const SENDER_PHONE = '+237611000001';
const RECEIVER_PHONE = '+237611000002';
const PIN = '112233';

describe('Flux paiement P2P (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let senderToken: string;
  let senderId: string;
  let receiverId: string;

  const cleanup = async () => {
    const phones = [SENDER_PHONE, RECEIVER_PHONE];
    for (const phone of phones) {
      await prisma.otpCode.deleteMany({ where: { user: { phone } } }).catch(() => {});
      await prisma.transaction.deleteMany({ where: { sender: { phone } } }).catch(() => {});
      await prisma.transaction.deleteMany({ where: { receiver: { phone } } }).catch(() => {});
      await prisma.wallet.deleteMany({ where: { user: { phone } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { phone } }).catch(() => {});
    }
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await cleanup();

    const pinHash = await bcrypt.hash(PIN, 1);

    // Créer expéditeur avec 10 000 FCFA (1 000 000 centimes)
    const sender = await prisma.user.create({
      data: {
        phone: SENDER_PHONE,
        pinHash,
        wallet: { create: { balance: 1_000_000n } },
      },
    });
    senderId = sender.id;

    // Créer destinataire avec 0
    const receiver = await prisma.user.create({
      data: {
        phone: RECEIVER_PHONE,
        pinHash,
        wallet: { create: { balance: 0n } },
      },
    });
    receiverId = receiver.id;

    // Login expéditeur
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone: SENDER_PHONE, pin: PIN });

    senderToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('effectue un virement P2P et met à jour les deux soldes', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions/p2p')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ phone: RECEIVER_PHONE, amount: 50000, description: 'Test e2e' })
      .expect(201);

    expect(res.body).toHaveProperty('type', 'P2P');
    expect(res.body).toHaveProperty('status', 'COMPLETED');

    // Vérification des soldes en base
    const senderWallet = await prisma.wallet.findUnique({ where: { userId: senderId } });
    const receiverWallet = await prisma.wallet.findUnique({ where: { userId: receiverId } });

    // 1 000 000 - 50 000 = 950 000 centimes
    expect(senderWallet?.balance).toBe(950_000n);
    // 0 + 50 000 = 50 000 centimes
    expect(receiverWallet?.balance).toBe(50_000n);
  });

  it('rejette si le solde est insuffisant', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions/p2p')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ phone: RECEIVER_PHONE, amount: 99_999_999 })
      .expect(400);

    expect(res.body.message).toContain('Solde insuffisant');
  });

  it('rejette un envoi à soi-même', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions/p2p')
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ phone: SENDER_PHONE, amount: 1000 })
      .expect(400);

    expect(res.body.message).toContain('vous-même');
  });
});
