import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private configured = false;

  constructor(private config: ConfigService) {
    const cloud = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const key = this.config.get<string>('CLOUDINARY_API_KEY');
    const secret = this.config.get<string>('CLOUDINARY_API_SECRET');
    // Valeurs de dev / gabarits → considérées comme « non configurées ».
    const placeholder = (v?: string) =>
      !v || /^(your_|dev_|test_|example|placeholder|changeme|xxx|\*+$)/i.test(v);

    if (!placeholder(cloud) && !placeholder(key) && !placeholder(secret)) {
      cloudinary.config({ cloud_name: cloud, api_key: key, api_secret: secret });
      this.configured = true;
      this.logger.log('Cloudinary configuré');
    } else {
      this.logger.warn('Cloudinary non configuré — repli sur data URI (dev)');
    }
  }

  get isConfigured(): boolean {
    return this.configured;
  }

  // Détecte le type réel d'après les octets de signature (ne fait pas confiance
  // au mimetype déclaré par le client). Exclut SVG et tout non-image.
  private detectImageType(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
    if (buf.length < 12) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
  }

  // Upload un buffer image vers Cloudinary et renvoie l'URL sécurisée HTTPS.
  // En dev (Cloudinary non configuré) OU en cas d'échec Cloudinary (réseau/API),
  // renvoie un data URI base64 (repli) afin que la fonctionnalité reste utilisable
  // et que le flux KYC ne soit jamais bloqué. Le type est validé par signature
  // binaire (jamais le mimetype client) pour éviter une injection.
  // `quality: auto` + `fetch_format: auto` → optimisation automatique à l'upload.
  async uploadImage(buffer: Buffer, folder = 'camwallet/avatars', publicId?: string): Promise<string> {
    const type = this.detectImageType(buffer);
    if (!type) {
      throw new BadRequestException('Format non supporté (PNG, JPEG ou WEBP attendu)');
    }
    const dataUri = () => `data:${type};base64,${buffer.toString('base64')}`;
    if (!this.configured) {
      return dataUri();
    }
    try {
      return await new Promise<string>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder,
            ...(publicId ? { public_id: publicId } : {}),
            resource_type: 'image',
            transformation: [{ quality: 'auto', fetch_format: 'auto' }],
          },
          (err, result) => {
            if (err || !result) return reject(err ?? new Error('Upload Cloudinary échoué'));
            resolve(result.secure_url);
          },
        );
        stream.end(buffer);
      });
    } catch (err) {
      // Échec Cloudinary → repli base64 + log d'erreur (ne bloque pas la soumission).
      this.logger.error(
        `Upload Cloudinary échoué (repli base64) : ${err instanceof Error ? err.message : String(err)}`,
      );
      return dataUri();
    }
  }

  // Supprime une image par son public_id (no-op si Cloudinary non configuré).
  async deleteImage(publicId: string): Promise<void> {
    if (!this.configured) return;
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    } catch (err) {
      this.logger.error(
        `Suppression Cloudinary échouée (${publicId}) : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Ping de santé pour GET /admin/health/integrations.
  async ping(): Promise<{ reachable: boolean; latency: number | null }> {
    if (!this.configured) return { reachable: false, latency: null };
    const start = Date.now();
    try {
      await cloudinary.api.ping();
      return { reachable: true, latency: Date.now() - start };
    } catch (err) {
      this.logger.error('Ping Cloudinary échoué', err instanceof Error ? err.stack : String(err));
      return { reachable: false, latency: null };
    }
  }
}
