import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SmsService } from './sms.service';

// Mock du SDK AfricasTalking : on intercepte SMS.send pour vérifier l'appel.
const mockSend = jest.fn();
const mockFetchApp = jest.fn();
jest.mock('africastalking', () =>
  jest.fn(() => ({
    SMS: { send: mockSend },
    APPLICATION: { fetchApplicationData: mockFetchApp },
  })),
);

const makeConfig = (values: Record<string, any>) => ({
  get: jest.fn((key: string, def?: any) => (key in values ? values[key] : def)),
});

const build = async (values: Record<string, any>) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SmsService,
      { provide: ConfigService, useValue: makeConfig(values) },
    ],
  }).compile();
  return module.get<SmsService>(SmsService);
};

describe('SmsService', () => {
  beforeEach(() => {
    mockSend.mockReset().mockResolvedValue({});
    mockFetchApp.mockReset().mockResolvedValue({});
  });

  describe('sans configuration (dev local)', () => {
    it('logge le SMS sans appeler AfricasTalking (pas de clé API)', async () => {
      const service = await build({ NODE_ENV: 'development' });
      const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation();

      await service.sendSms('+237677000001', 'Bonjour');

      expect(mockSend).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[SMS DEV]'),
      );
    });

    it('ne déclenche pas l\'envoi réel si AT_API_KEY est absent', async () => {
      const service = await build({ NODE_ENV: 'production' });

      await service.sendSms('+237677000001', 'Bonjour');

      expect(mockSend).not.toHaveBeenCalled();
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('mode sandbox (AT_USERNAME=sandbox)', () => {
    const sandboxConfig = {
      AT_API_KEY: 'sandbox-key',
      AT_USERNAME: 'sandbox',
      AT_SENDER_ID: 'camwallet',
    };

    it('envoie via AfricasTalking sans sender ID (omis en sandbox)', async () => {
      const service = await build(sandboxConfig);

      await service.sendSms('+237677000001', 'Votre code CamWallet : 123456.');

      expect(service.isSandbox()).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith({
        to: ['+237677000001'],
        message: 'Votre code CamWallet : 123456.',
      });
      // pas de clé `from` en sandbox
      expect(mockSend.mock.calls[0][0]).not.toHaveProperty('from');
    });

    it('ping renvoie sandbox=true', async () => {
      const service = await build(sandboxConfig);

      const res = await service.ping();

      expect(res).toEqual({ reachable: true, latency: expect.any(Number), sandbox: true });
    });
  });

  describe('mode live', () => {
    const prodConfig = {
      NODE_ENV: 'production',
      AT_API_KEY: 'test-key',
      AT_USERNAME: 'camwallet',
      AT_SENDER_ID: 'CamWallet',
    };

    it('envoie le SMS via AfricasTalking avec le bon message et le sender ID', async () => {
      const service = await build(prodConfig);

      await service.sendSms('+237677000001', 'Votre code CamWallet : 123456.');

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith({
        to: ['+237677000001'],
        message: 'Votre code CamWallet : 123456.',
        from: 'CamWallet',
      });
    });

    it('réessaie une fois en cas d\'échec puis réussit', async () => {
      const service = await build(prodConfig);
      jest.spyOn((service as any).logger, 'error').mockImplementation();
      mockSend.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({});

      await service.sendSms('+237677000001', 'Bonjour');

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('propage l\'erreur après 2 tentatives échouées', async () => {
      const service = await build(prodConfig);
      jest.spyOn((service as any).logger, 'error').mockImplementation();
      mockSend.mockRejectedValue(new Error('down'));

      await expect(service.sendSms('+237677000001', 'Bonjour')).rejects.toThrow('down');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('ping', () => {
    it('renvoie reachable=false quand non configuré', async () => {
      const service = await build({ NODE_ENV: 'production' });
      expect(await service.ping()).toEqual({ reachable: false, latency: null, sandbox: false });
      expect(mockFetchApp).not.toHaveBeenCalled();
    });

    it('renvoie reachable=true quand l\'API répond', async () => {
      const service = await build({ NODE_ENV: 'production', AT_API_KEY: 'k', AT_USERNAME: 'u' });

      const res = await service.ping();

      expect(mockFetchApp).toHaveBeenCalled();
      expect(res.reachable).toBe(true);
      expect(typeof res.latency).toBe('number');
      expect(res.sandbox).toBe(false);
    });
  });
});
