import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { QrCodeType } from '@prisma/client';

const DEFAULT_DYNAMIC_EXPIRY_MIN = 15;

@Injectable()
export class QrService {
  constructor(private prisma: PrismaService) {}

  // ─── QR statique (réutilisable, lié au compte) ──────────────────────────────
  async getStatic(userId: string) {
    let qr = await this.prisma.qrCode.findFirst({
      where: { userId, type: QrCodeType.STATIC, isActive: true },
    });

    if (!qr) {
      qr = await this.prisma.qrCode.create({
        data: {
          userId,
          type: QrCodeType.STATIC,
          payload: `CW:STATIC:${userId}`,
        },
      });
    }

    return {
      id: qr.id,
      type: qr.type,
      payload: qr.payload,
      image: await this.toImage(qr.payload),
    };
  }

  // ─── QR dynamique (montant fixe, usage unique) ──────────────────────────────
  async createDynamic(userId: string, amount: bigint, expiresInMinutes?: number) {
    if (amount <= 0n) throw new BadRequestException('Montant invalide');

    const minutes = expiresInMinutes ?? DEFAULT_DYNAMIC_EXPIRY_MIN;
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
    const payload = `CW:DYN:${randomUUID()}`;

    const qr = await this.prisma.qrCode.create({
      data: {
        userId,
        type: QrCodeType.DYNAMIC,
        payload,
        amount,
        expiresAt,
      },
    });

    return {
      id: qr.id,
      type: qr.type,
      payload: qr.payload,
      amount: qr.amount,
      expiresAt: qr.expiresAt,
      image: await this.toImage(qr.payload),
    };
  }

  // ─── Décodage d'un QR scanné ────────────────────────────────────────────────
  async decode(payload: string) {
    const qr = await this.prisma.qrCode.findFirst({
      where: { payload, isActive: true },
      include: {
        user: { select: { id: true, fullName: true, phone: true, role: true } },
      },
    });
    if (!qr) throw new NotFoundException('QR Code invalide ou expiré');

    const expired = !!qr.expiresAt && qr.expiresAt < new Date();
    const used = !!qr.usedAt;

    return {
      type: qr.type,
      amount: qr.amount, // null pour un QR statique
      expiresAt: qr.expiresAt,
      payable: qr.type === QrCodeType.STATIC || (!expired && !used),
      merchant: {
        id: qr.user.id,
        fullName: qr.user.fullName,
        phone: qr.user.phone,
        role: qr.user.role,
      },
    };
  }

  private toImage(payload: string): Promise<string> {
    return QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1 });
  }
}
