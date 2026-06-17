import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CamPayService } from '../src/campay/campay.service';

// BigInt → Number pour la sérialisation JSON (normalement dans main.ts)
(BigInt.prototype as any).toJSON = function () { return Number(this); };

const USER_PHONE = '+237622000001';
const PIN = '445566';
// Montant ≤ 2 500 centimes (25 FCFA) : limite du mode sandbox CamPay (NODE_ENV
// ≠ production en CI). Le webhook crédite ensuite ce même montant.
const RECHARGE_AMOUNT = 2500;

// Faux client CamPay : évite l'appel réseau réel (aucune credential en CI) et
// renvoie une réponse /collect valide pour que la recharge soit enregistrée
// PENDING. Le crédit effectif reste piloté par le webhook (cf. test suivant).
const campayMock = {
  collect: jest.fn(async () => ({
    reference: 'FAKE-CAMPAY-REF',
    ussd_code: '#150*00#',
    status: 'PENDING',
  })),
};

describe('Flux recharge + webhook (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userToken: string;
  let userId: string;
  let operatorRef: string;
  let webhookSecret: string;

  const cleanup = async () => {
    await prisma.transaction.deleteMany({ where: { receiver: { phone: USER_PHONE } } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { user: { phone: USER_PHONE } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { phone: USER_PHONE } }).catch(() => {});
  };

  beforeAll(async () => {
    // Vider le secret webhook pour désactiver la validation de signature en test
    webhookSecret = process.env.OM_WEBHOOK_SECRET ?? '';
    process.env.OM_WEBHOOK_SECRET = '';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CamPayService)
      .useValue(campayMock)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
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
    // Restaurer le secret
    process.env.OM_WEBHOOK_SECRET = webhookSecret;
    await cleanup();
    await app.close();
  });

  it('initie une recharge PENDING', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/wallets/recharge')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amount: RECHARGE_AMOUNT, operator: 'ORANGE_MONEY', phone: USER_PHONE })
      .expect(201);

    expect(res.body).toHaveProperty('status', 'PENDING');
    expect(res.body).toHaveProperty('operatorRef');
    expect(campayMock.collect).toHaveBeenCalled();
    operatorRef = res.body.operatorRef;
  });

  it('webhook Orange Money crédite le solde après confirmation', async () => {
    // Le service attend payload.externalId pour matcher la transaction par operatorRef
    const payload = {
      status: 'SUCCESSFUL',
      externalId: operatorRef,
      type: 'PAYMENT_NOTIFICATION',
    };

    const res = await request(app.getHttpServer())
      .post('/api/v1/webhooks/orange-money')
      .send(payload)
      .expect(200);

    expect(res.body).toHaveProperty('status', 'ok');

    // Vérifier que le solde a été crédité
    // Convertir en Number pour éviter les BigInt dans les erreurs Jest (structured clone)
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    expect(Number(wallet?.balance)).toBe(RECHARGE_AMOUNT);
  });

  it('GET /wallets/balance retourne le solde mis à jour', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/wallets/balance')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.balance).toBe(RECHARGE_AMOUNT);
  });
});
