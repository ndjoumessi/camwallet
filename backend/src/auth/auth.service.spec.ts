import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const makePrismaMock = () => ({
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  systemSettings: {
    upsert: jest.fn().mockResolvedValue({}),
  },
});

const makeJwtMock = () => ({
  sign: jest.fn().mockReturnValue('token'),
  verify: jest.fn(),
});

const makeConfigMock = (overrides: Record<string, string> = {}) => ({
  get: jest.fn((key: string) => {
    const cfg: Record<string, string> = {
      ADMIN_EMAIL: 'admin@camwallet.cm',
      ADMIN_PASSWORD: 'Admin@2025!',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_REFRESH_EXPIRES_IN: '7d',
      ...overrides,
    };
    return cfg[key];
  }),
});

const makeOtpMock = () => ({
  sendOtp: jest.fn().mockResolvedValue(undefined),
  verifyOtp: jest.fn().mockResolvedValue(undefined),
});

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let jwtService: ReturnType<typeof makeJwtMock>;
  let configService: ReturnType<typeof makeConfigMock>;
  let otpService: ReturnType<typeof makeOtpMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    jwtService = makeJwtMock();
    configService = makeConfigMock();
    otpService = makeOtpMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: OtpService, useValue: otpService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ─── register ─────────────────────────────────────────────────────────────

  describe('register', () => {
    it('crée un utilisateur et envoie un OTP', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user-1', phone: '+237677000001' });

      const result = await service.register({ phone: '+237677000001' });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ phone: '+237677000001' }) }),
      );
      expect(otpService.sendOtp).toHaveBeenCalledWith('user-1', 'REGISTRATION');
      expect(result).toHaveProperty('userId', 'user-1');
    });

    it('rejette si le numéro existe déjà', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

      await expect(service.register({ phone: '+237677000001' })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  // ─── login ────────────────────────────────────────────────────────────────

  describe('login', () => {
    const pinHash = bcrypt.hashSync('123456', 1);

    it('retourne des tokens si le PIN est correct', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phone: '+237677000001',
        pinHash,
        pinAttempts: 0,
        lockedUntil: null,
        tokenVersion: 0,
        role: 'USER',
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.login({ phone: '+237677000001', pin: '123456' });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pinAttempts: 0, lockedUntil: null }),
        }),
      );
    });

    it('incrémente les tentatives si le PIN est incorrect', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        pinHash,
        pinAttempts: 0,
        lockedUntil: null,
        role: 'USER',
      });
      prisma.user.update.mockResolvedValue({});

      await expect(service.login({ phone: '+237677000001', pin: '000000' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { pinAttempts: 1 } }),
      );
    });

    it('bloque le compte après 3 tentatives incorrectes', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        pinHash,
        pinAttempts: 2,
        lockedUntil: null,
        role: 'USER',
      });
      prisma.user.update.mockResolvedValue({});

      const err = await service
        .login({ phone: '+237677000001', pin: '000000' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toContain('bloqué');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lockedUntil: expect.any(Date) }),
        }),
      );
    });

    it('rejette si le compte est bloqué', async () => {
      const future = new Date(Date.now() + 30 * 60 * 1000);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        pinHash,
        pinAttempts: 0,
        lockedUntil: future,
        role: 'USER',
      });

      const err = await service
        .login({ phone: '+237677000001', pin: '123456' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toContain('bloqué');
    });

    it('rejette si le numéro est introuvable', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ phone: '+237600000000', pin: '123456' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── loginAdmin ───────────────────────────────────────────────────────────

  describe('loginAdmin', () => {
    it('retourne des tokens admin valides', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'admin-user-id',
        totpEnabled: false,
        totpSecret: null,
      });

      const result = await service.loginAdmin({
        email: 'admin@camwallet.cm',
        password: 'Admin@2025!',
      });

      expect(result).toHaveProperty('accessToken');
    });

    it('rejette des identifiants incorrects', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.loginAdmin({ email: 'admin@camwallet.cm', password: 'mauvais' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuse si ADMIN_EMAIL non configuré', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(
        service.loginAdmin({ email: 'admin@camwallet.cm', password: 'Admin@2025!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('bloque après 5 tentatives incorrectes', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      for (let i = 0; i < 5; i++) {
        await service
          .loginAdmin({ email: 'admin@camwallet.cm', password: 'mauvais' })
          .catch(() => {});
      }

      const err = await service
        .loginAdmin({ email: 'admin@camwallet.cm', password: 'mauvais' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toContain('Réessayez dans');
    });
  });

  // ─── refresh ──────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('rejette un refresh token absent', async () => {
      await expect(service.refresh('')).rejects.toThrow(UnauthorizedException);
    });

    it('rejette un refresh token invalide (verify lève)', async () => {
      jwtService.verify.mockImplementation(() => { throw new Error('expired'); });

      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('renouvelle les tokens d\'un utilisateur avec tokenVersion correcte', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'USER', tv: 2 });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'USER', tokenVersion: 2 });

      const result = await service.refresh('valid-refresh-token');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('rejette si tokenVersion ne correspond plus (déconnexion sur un autre appareil)', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'USER', tv: 1 });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'USER', tokenVersion: 2 });

      await expect(service.refresh('stale-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejette si tv absent du payload (token pré-migration)', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'USER' }); // tv undefined
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'USER', tokenVersion: 0 });

      await expect(service.refresh('old-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejette si l\'utilisateur est introuvable', async () => {
      jwtService.verify.mockReturnValue({ sub: 'ghost', role: 'USER', tv: 0 });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refresh('token')).rejects.toThrow(UnauthorizedException);
    });

    it('renouvelle les tokens d\'un admin si le credHash est valide', async () => {
      // credHash = sha256('admin@camwallet.cm:Admin@2025!')
      const crypto = await import('crypto');
      const credHash = crypto
        .createHash('sha256')
        .update('admin@camwallet.cm:Admin@2025!')
        .digest('hex');

      jwtService.verify.mockReturnValue({ sub: 'admin-id', role: 'ADMIN', adminCredHash: credHash });

      const result = await service.refresh('admin-token');

      expect(result).toHaveProperty('accessToken');
    });

    it('rejette le refresh admin si les identifiants ont changé depuis l\'émission', async () => {
      jwtService.verify.mockReturnValue({ sub: 'admin-id', role: 'ADMIN', adminCredHash: 'ancien-hash' });

      await expect(service.refresh('admin-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejette le refresh admin si adminCredHash absent du payload', async () => {
      jwtService.verify.mockReturnValue({ sub: 'admin-id', role: 'ADMIN' });

      await expect(service.refresh('admin-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── logout ───────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('incrémente tokenVersion et retourne un message', async () => {
      prisma.user.update.mockResolvedValue({});

      const result = await service.logout('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { tokenVersion: { increment: 1 } },
      });
      expect(result).toHaveProperty('message');
    });
  });

  // ─── changePin ────────────────────────────────────────────────────────────

  describe('changePin', () => {
    it('change le PIN si l\'ancien est correct', async () => {
      const pinHash = bcrypt.hashSync('123456', 1);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        pinHash,
        previousPinHashes: [],
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.changePin('user-1', '123456', '654321');

      expect(result).toHaveProperty('message');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pinHash: expect.any(String) }),
        }),
      );
    });

    it('rejette si l\'ancien PIN est incorrect', async () => {
      const pinHash = bcrypt.hashSync('123456', 1);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        pinHash,
        previousPinHashes: [],
      });

      await expect(service.changePin('user-1', '000000', '654321')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejette un PIN déjà utilisé récemment', async () => {
      const pinHash = bcrypt.hashSync('123456', 1);
      const oldHash = bcrypt.hashSync('654321', 1);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        pinHash,
        previousPinHashes: [oldHash],
      });

      await expect(service.changePin('user-1', '123456', '654321')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── Pepper HMAC du PIN ─────────────────────────────────────────────────────

  describe('PIN pepper (HMAC)', () => {
    const PEPPER = 'pepper-de-test-32-octets-aaaaaaaa';
    const peppered = (pin: string) =>
      crypto.createHmac('sha256', PEPPER).update(pin).digest('hex');

    beforeEach(() => {
      // Active le pepper pour ce bloc.
      configService.get.mockImplementation((key: string) =>
        ({
          ADMIN_EMAIL: 'admin@camwallet.cm',
          ADMIN_PASSWORD: 'Admin@2025!',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_REFRESH_EXPIRES_IN: '7d',
          PIN_PEPPER: PEPPER,
        })[key],
      );
    });

    it('setPin hashe le PIN peppered (pas le PIN brut)', async () => {
      let stored: string | undefined;
      prisma.user.update.mockImplementation(({ data }: any) => {
        stored = data.pinHash;
        return Promise.resolve({ id: 'user-1', role: 'USER', tokenVersion: 0 });
      });

      await service.setPin({ userId: 'user-1', pin: '123456' });

      expect(stored).toBeDefined();
      // Le hash correspond au PIN peppered, jamais au PIN brut.
      expect(bcrypt.compareSync(peppered('123456'), stored!)).toBe(true);
      expect(bcrypt.compareSync('123456', stored!)).toBe(false);
    });

    it('connecte avec le PIN peppered', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phone: '+237677000001',
        pinHash: bcrypt.hashSync(peppered('123456'), 1),
        pinAttempts: 0,
        lockedUntil: null,
        tokenVersion: 0,
        role: 'USER',
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.login({ phone: '+237677000001', pin: '123456' });
      expect(result).toHaveProperty('accessToken');
    });

    it('migre de façon transparente un hash legacy (PIN brut) à la connexion', async () => {
      // Hash hérité : PIN brut, sans pepper (créé avant la feature).
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phone: '+237677000001',
        pinHash: bcrypt.hashSync('123456', 1),
        pinAttempts: 0,
        lockedUntil: null,
        tokenVersion: 0,
        role: 'USER',
      });
      const updates: any[] = [];
      prisma.user.update.mockImplementation((arg: any) => {
        updates.push(arg);
        return Promise.resolve({});
      });

      const result = await service.login({ phone: '+237677000001', pin: '123456' });
      expect(result).toHaveProperty('accessToken');

      // Une mise à jour ré-écrit le hash au format peppered (migration).
      const migrated = updates.find((u) => typeof u.data?.pinHash === 'string');
      expect(migrated).toBeDefined();
      expect(bcrypt.compareSync(peppered('123456'), migrated.data.pinHash)).toBe(true);
    });

    it('rejette un PIN incorrect même avec pepper', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phone: '+237677000001',
        pinHash: bcrypt.hashSync(peppered('123456'), 1),
        pinAttempts: 0,
        lockedUntil: null,
        tokenVersion: 0,
        role: 'USER',
      });
      prisma.user.update.mockResolvedValue({});

      await expect(
        service.login({ phone: '+237677000001', pin: '000000' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
