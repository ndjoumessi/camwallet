import { Test, TestingModule } from '@nestjs/testing';
import { OtpService } from './otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

const makePrismaMock = () => ({
  otpCode: {
    findFirst: jest.fn(),
    create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  user: {
    findUnique: jest.fn(),
  },
});

describe('OtpService', () => {
  let service: OtpService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let sms: { sendSms: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    sms = { sendSms: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: SmsService, useValue: sms },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  describe('sendOtp', () => {
    it('invalide les anciens OTPs et crée un nouveau', async () => {
      prisma.user.findUnique.mockResolvedValue({ phone: '+237677000001' });

      await service.sendOtp('user-1', 'REGISTRATION');

      expect(prisma.otpCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1', usedAt: null }) }),
      );
      expect(prisma.otpCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            purpose: 'REGISTRATION',
          }),
        }),
      );
    });

    it('envoie le SMS OTP en français par défaut', async () => {
      prisma.user.findUnique.mockResolvedValue({ phone: '+237677000001' });

      await service.sendOtp('user-1', 'REGISTRATION');

      expect(sms.sendSms).toHaveBeenCalledWith(
        '+237677000001',
        expect.stringContaining('Votre code CamWallet'),
      );
      expect(sms.sendSms.mock.calls[0][1]).toContain('Valable 10 minutes');
    });

    it('envoie le SMS OTP en anglais quand lang=en', async () => {
      prisma.user.findUnique.mockResolvedValue({ phone: '+237677000001' });

      await service.sendOtp('user-1', 'REGISTRATION', 'en');

      expect(sms.sendSms).toHaveBeenCalledWith(
        '+237677000001',
        expect.stringContaining('Your CamWallet code'),
      );
      expect(sms.sendSms.mock.calls[0][1]).toContain('Valid for 10 minutes');
    });
  });

  describe('verifyOtp', () => {
    it('valide un code correct et le marque utilisé', async () => {
      const code = '123456';
      const codeHash = await bcrypt.hash(code, 1);

      prisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        code: codeHash,
        attempts: 0,
      });

      await expect(service.verifyOtp('user-1', code, 'REGISTRATION')).resolves.toBeUndefined();

      expect(prisma.otpCode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedAt: expect.any(Date) } }),
      );
    });

    it('incrémente les tentatives si le code est incorrect', async () => {
      const codeHash = await bcrypt.hash('123456', 1);

      prisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        code: codeHash,
        attempts: 0,
      });

      await expect(service.verifyOtp('user-1', '000000', 'REGISTRATION')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.otpCode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attempts: 1 } }),
      );
    });

    it('rejette si le nombre max de tentatives est atteint', async () => {
      const codeHash = await bcrypt.hash('123456', 1);

      prisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        code: codeHash,
        attempts: 3,
      });

      await expect(service.verifyOtp('user-1', '000000', 'REGISTRATION')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette si aucun OTP valide n\'existe', async () => {
      prisma.otpCode.findFirst.mockResolvedValue(null);

      await expect(service.verifyOtp('user-1', '123456', 'REGISTRATION')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
