import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { LoginDto } from './dto/login.dto';
import { OtpPurpose } from '@prisma/client';

const MAX_PIN_ATTEMPTS = 3;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private otpService: OtpService,
  ) {}

  // ─── Étape 1 : Inscription — envoi OTP ────────────────────────────────────
  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });

    if (existing) {
      throw new ConflictException('Ce numéro est déjà enregistré');
    }

    const user = await this.prisma.user.create({
      data: {
        phone: dto.phone,
        fullName: dto.fullName,
        pinHash: '', // Sera défini à l'étape 3
        wallet: { create: {} },
      },
    });

    await this.otpService.sendOtp(user.id, OtpPurpose.REGISTRATION);
    this.logger.log(`Nouveau compte créé : ${user.phone}`);

    return { message: 'Code OTP envoyé par SMS', userId: user.id };
  }

  // ─── Étape 2 : Vérification OTP ───────────────────────────────────────────
  async verifyOtp(dto: VerifyOtpDto) {
    await this.otpService.verifyOtp(dto.userId, dto.code, OtpPurpose.REGISTRATION);
    return { message: 'Numéro vérifié', userId: dto.userId };
  }

  // ─── Étape 3 : Création PIN ────────────────────────────────────────────────
  async setPin(dto: SetPinDto) {
    const pinHash = await bcrypt.hash(dto.pin, 12);
    await this.prisma.user.update({
      where: { id: dto.userId },
      data: { pinHash },
    });
    return this.generateTokens(dto.userId);
  }

  // ─── Connexion avec PIN ────────────────────────────────────────────────────
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });

    if (!user) throw new UnauthorizedException('Numéro introuvable');

    // Vérification blocage
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(
        `Compte bloqué. Réessayez dans ${minutes} minutes.`,
      );
    }

    const pinValid = await bcrypt.compare(dto.pin, user.pinHash);

    if (!pinValid) {
      const attempts = user.pinAttempts + 1;

      if (attempts >= MAX_PIN_ATTEMPTS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            pinAttempts: 0,
            lockedUntil: new Date(Date.now() + LOCK_DURATION_MS),
          },
        });
        throw new UnauthorizedException(
          'Trop de tentatives. Compte bloqué 30 minutes.',
        );
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: { pinAttempts: attempts },
      });

      throw new UnauthorizedException(
        `PIN incorrect. ${MAX_PIN_ATTEMPTS - attempts} tentative(s) restante(s).`,
      );
    }

    // Succès : réinitialiser les tentatives
    await this.prisma.user.update({
      where: { id: user.id },
      data: { pinAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return this.generateTokens(user.id, user.role);
  }

  // ─── Refresh token ────────────────────────────────────────────────────────
  async refreshTokens(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.generateTokens(user.id, user.role);
  }

  // ─── Reset PIN via OTP ────────────────────────────────────────────────────
  async requestPinReset(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new BadRequestException('Numéro introuvable');
    await this.otpService.sendOtp(user.id, OtpPurpose.PIN_RESET);
    return { message: 'Code OTP envoyé', userId: user.id };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private generateTokens(userId: string, role = 'USER') {
    const payload = { sub: userId, role };
    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      }),
    };
  }
}
