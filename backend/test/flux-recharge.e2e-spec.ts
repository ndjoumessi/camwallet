import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const USER_PHONE = '+237622000001';
const PIN = '445566';

describe('Flux recharge + webhook (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userToken: string;
  let userId: string;
  let operatorRef: string;

  const cleanup = async () => {
    await prisma.webhookEvent.deleteMany({ where: { operatorRef: { startsWith: 'RCHG-' } } }).catch(() => {});
    await prisma.transaction.deleteMany({ where: { receiver: { phone: USER_PHONE } } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { user: { phone: USER_PHONE } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { phone: USER_PHONE } }).catch(() => {});
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
    const user = await prisma.user.create({
      data: { phone: USER_PHONE, pinHash, wallet: { create: { balance: 0n } } },
    });
    userId = user.id;

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone: USER_PHONE, pin: PIN });
    userToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('initie une recharge PENDING', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/wallets/recharge')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 500000, operator: 'ORANGE_MONEY' })
      .expect(201);

    expect(res.body).toHaveProperty('status', 'PENDING');
    expect(res.body).toHaveProperty('operatorRef');
    operatorRef = res.body.operatorRef;
  });

  it('webhook Orange Money crédite le solde après confirmation', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/webhooks/orange-money')
      .send({
        status: 'SUCCESSFUL',
        transId: operatorRef,
        amount: 500000,
        msisdn: USER_PHONE,
      })
      .expect(200);

    expect(res.body).toHaveProperty('message');

    // Vérifier que le solde a été crédité
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(wallet?.balance).toBe(500_000n);
  });

  it('GET /wallets/balance retourne le solde mis à jour', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/wallets/balance')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.balance).toBe(500000);
  });
});
