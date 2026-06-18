import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';

// Mock du SDK Cloudinary : on contrôle config / upload_stream / api.ping.
jest.mock('cloudinary', () => {
  const uploadStream = jest.fn((_opts: any, cb: any) => ({
    end: () => cb(null, { secure_url: 'https://res.cloudinary.com/demo/image/upload/x.jpg' }),
  }));
  return {
    v2: {
      config: jest.fn(),
      uploader: { upload_stream: uploadStream, destroy: jest.fn().mockResolvedValue({ result: 'ok' }) },
      api: { ping: jest.fn().mockResolvedValue({ status: 'ok' }) },
    },
  };
});

// Buffer image PNG valide (signature + longueur ≥ 12 octets).
const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

const makeConfig = (values: Record<string, string | undefined>): ConfigService =>
  ({ get: (k: string) => values[k] } as unknown as ConfigService);

describe('CloudinaryService', () => {
  describe('mode dev (non configuré)', () => {
    const service = new CloudinaryService(makeConfig({}));

    it('n’est pas configuré', () => {
      expect(service.isConfigured).toBe(false);
    });

    it('uploadImage renvoie un data URI base64 (repli)', async () => {
      const url = await service.uploadImage(pngBuffer, 'camwallet/kyc/selfie');
      expect(url).toMatch(/^data:image\/png;base64,/);
    });

    it('ping renvoie reachable=false sans appeler le SDK', async () => {
      expect(await service.ping()).toEqual({ reachable: false, latency: null });
    });

    it('rejette un buffer non-image', async () => {
      await expect(service.uploadImage(Buffer.from('not-an-image-xxxxx'))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('mode configuré (Cloudinary mocké)', () => {
    const service = new CloudinaryService(
      makeConfig({
        CLOUDINARY_CLOUD_NAME: 'mycloud',
        CLOUDINARY_API_KEY: '123456789',
        CLOUDINARY_API_SECRET: 'sUperSecretValue',
      }),
    );

    it('est configuré', () => {
      expect(service.isConfigured).toBe(true);
    });

    it('uploadImage renvoie une URL HTTPS Cloudinary', async () => {
      const url = await service.uploadImage(pngBuffer, 'camwallet/kyc/cni_recto');
      expect(url).toMatch(/^https:\/\//);
    });

    it('ping renvoie reachable=true', async () => {
      const res = await service.ping();
      expect(res.reachable).toBe(true);
      expect(typeof res.latency).toBe('number');
    });

    it('deleteImage ne lève pas', async () => {
      await expect(service.deleteImage('camwallet/kyc/selfie/abc')).resolves.toBeUndefined();
    });
  });
});
