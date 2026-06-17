import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { SupportedLang } from '../common/i18n/i18n.util';
import { OtpPurpose } from '@prisma/client';

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 3;

// Message OTP localisé (FR par défaut, EN si la langue de l'utilisateur l'exige).
function otpMessage(code: string, lang: SupportedLang): string {
  return lang === 'en'
    ? `Your CamWallet code: ${code}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`
    : `Votre code CamWallet : ${code}. Valable ${OTP_EXPIRY_MINUTES} minutes.`;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private prisma: PrismaService,
    private sms: SmsService,
  ) {}

  async sendOtp(
    userId: string,
    purpose: OtpPurpose,
    lang: SupportedLang = 'fr',
  ): Promise<void> {
    // Générer code 6 chiffres
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Invalider les anciens OTPs du même purpose
    await this.prisma.otpCode.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Sauvegarder le nouveau
    await this.prisma.otpCode.create({
      data: { userId, code: codeHash, purpose, expiresAt },
    });

    // Récupérer le numéro de téléphone
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });

    // Envoyer SMS (AfricasTalking via SmsService)
    await this.sms.sendSms(user!.phone, otpMessage(code, lang));
    this.logger.log(`OTP envoyé pour userId=${userId} purpose=${purpose}`);
  }

  async verifyOtp(userId: string, code: string, purpose: OtpPurpose): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        userId,
        purpose,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new BadRequestException('Code OTP invalide ou expiré');
    }

    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      throw new BadRequestException('Trop de tentatives. Demandez un nouveau code.');
    }

    const valid = await bcrypt.compare(code, otp.code);

    if (!valid) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: otp.attempts + 1 },
      });
      throw new BadRequestException('Code OTP incorrect');
    }

    // Marquer comme utilisé
    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });
  }
}
