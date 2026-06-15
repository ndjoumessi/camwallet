import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Ces tests requièrent une base PostgreSQL de test.
// Définir DATABASE_TEST_URL dans .env.test ou via CI.
// Exemple : postgresql://camwallet:camwallet@localhost:5432/camwallet_test

const TEST_PHONE = '+237699000099';
const TEST_PIN = '654321';

describe('Flux authentification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Nettoyage avant test
    await prisma.otpCode.deleteMany({ where: { user: { phone: TEST_PHONE } } });
    await prisma.wallet.deleteMany({ where: { user: { phone: TEST_PHONE } } });
    await prisma.user.deleteMany({ where: { phone: TEST_PHONE } });
  });

  afterAll(async () => {
    await prisma.otpCode.deleteMany({ where: { user: { phone: TEST_PHONE } } });
    await prisma.wallet.deleteMany({ where: { user: { phone: TEST_PHONE } } });
    await prisma.user.deleteMany({ where: { phone: TEST_PHONE } });
    await app.close();
  });

  it('Étape 1 — register : crée un utilisateur et envoie un OTP', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ phone: TEST_PHONE, fullName: 'Test E2E' })
      .expect(201);

    expect(res.body).toHaveProperty('userId');
    userId = res.body.userId;
  });

  it('Étape 2 — verifyOtp : vérifie le code OTP depuis la base', async () => {
    // En mode sandbox, le code est dans la table otpCode (hash bcrypt)
    // On récupère le dernier OTP en DB pour ce test
    const otp = await prisma.otpCode.findFirst({
      where: { userId, purpose: 'REGISTRATION', usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(otp).toBeTruthy();

    // En sandbox (AT_USERNAME=sandbox), le code n'est pas envoyé par SMS.
    // On lit le hash et bypass pour tester la route avec un mock OTP.
    // Pour un vrai test e2e, utiliser l'SMS reçu ou une table de codes de test.
    // Ici on teste que la route valide correctement un code via le service.

    // Utilisation d'un patch direct pour les tests : mettre un code connu en DB.
    const bcrypt = await import('bcryptjs');
    const testCode = '123456';
    await prisma.otpCode.update({
      where: { id: otp!.id },
      data: { code: await bcrypt.hash(testCode, 1) },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-otp')
      .send({ userId, code: testCode })
      .expect(200);

    expect(res.body).toHaveProperty('userId');
  });

  it('Étape 3 — setPin : définit le PIN et retourne des tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/set-pin')
      .send({ userId, pin: TEST_PIN })
      .expect(201);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });

  it('login : connexion avec le PIN et retourne des tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone: TEST_PHONE, pin: TEST_PIN })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
    accessToken = res.body.accessToken;
  });

  it('login : rejette un PIN incorrect', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone: TEST_PHONE, pin: '000000' })
      .expect(401);

    expect(res.body.message).toContain('incorrect');
  });

  it('GET /users/me : retourne le profil avec token valide', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('phone', TEST_PHONE);
  });

  it('GET /users/me : rejette sans token', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
  });
});
