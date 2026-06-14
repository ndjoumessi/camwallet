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
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { LoginDto } from './dto/login.dto';
import { LoginAdminDto } from './dto/login-admin.dto';
import { OtpPurpose } from '@prisma/client';

const MAX_PIN_ATTEMPTS = 3;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const ADMIN_MAX_ATTEMPTS = 5;
const ADMIN_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // L'admin n'a pas de compte en base : le suivi des tentatives (anti
  // brute-force) est tenu en mémoire, par email. NB : sur plusieurs instances
  // il faudrait un store partagé (Redis).
  private adminAttempts = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private otpService: OtpService,
  ) {}

  // Comparaison à temps constant, indépendante de la longueur (digests SHA-256).
  private safeEqual(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  // Empreinte des identifiants admin courants. Si ADMIN_EMAIL/ADMIN_PASSWORD
  // changent, l'empreinte change et les tokens admin déjà émis sont invalidés.
  private adminCredHash(): string {
    const email = this.config.get<string>('ADMIN_EMAIL') ?? '';
    const password = this.config.get<string>('ADMIN_PASSWORD') ?? '';
    return crypto.createHash('sha256').update(`${email}:${password}`).digest('hex');
  }

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

  // ─── Connexion administrateur (email + mot de passe) ──────────────────────
  // L'admin n'est pas un compte User en base : ses identifiants vivent dans la
  // config (ADMIN_EMAIL / ADMIN_PASSWORD). La JwtStrategy étant sans état, il
  // suffit d'émettre un token portant le rôle ADMIN pour passer l'AdminGuard.
  async loginAdmin(dto: LoginAdminDto) {
    const adminEmail = this.config.get<string>('ADMIN_EMAIL');
    const adminPassword = this.config.get<string>('ADMIN_PASSWORD');

    // Refus si les identifiants ne sont pas configurés (pas de secret vide).
    if (!adminEmail || !adminPassword) {
      this.logger.error('ADMIN_EMAIL / ADMIN_PASSWORD non configurés');
      throw new UnauthorizedException('Connexion administrateur indisponible');
    }

    const key = dto.email.toLowerCase();

    // Blocage temporaire après trop d'échecs (anti brute-force, par email).
    const entry = this.adminAttempts.get(key);
    if (entry && entry.lockedUntil > Date.now()) {
      const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
      throw new UnauthorizedException(
        `Trop de tentatives. Réessayez dans ${minutes} minute(s).`,
      );
    }

    // Comparaisons à temps constant (les deux sont toujours évaluées).
    const emailMatch = this.safeEqual(key, adminEmail.toLowerCase());
    const passwordMatch = this.safeEqual(dto.password, adminPassword);

    if (!emailMatch || !passwordMatch) {
      const count = (entry?.count ?? 0) + 1;
      const lockedUntil =
        count >= ADMIN_MAX_ATTEMPTS ? Date.now() + ADMIN_LOCK_DURATION_MS : 0;
      this.adminAttempts.set(key, { count, lockedUntil });
      this.logger.warn(`Échec connexion admin (tentative ${count}) : ${dto.email}`);
      throw new UnauthorizedException('Identifiants administrateur invalides');
    }

    // Succès : réinitialiser le compteur et lier le token aux identifiants courants.
    this.adminAttempts.delete(key);
    this.logger.log(`Connexion admin : ${dto.email}`);

    // On rattache le token au compte admin réel (s'il existe en base) afin que
    // les actions admin soient traçables dans l'AuditLog. Sinon, sentinelle 'admin'.
    const adminUser = await this.prisma.user.findFirst({
      where: { email: { equals: adminEmail, mode: 'insensitive' }, role: 'ADMIN' },
      select: { id: true },
    });
    const sub = adminUser?.id ?? 'admin';
    return this.generateTokens(sub, 'ADMIN', { adminCredHash: this.adminCredHash() });
  }

  // ─── Refresh token ────────────────────────────────────────────────────────
  async refreshTokens(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.generateTokens(user.id, user.role);
  }

  // Échange un refresh token valide contre une nouvelle paire de tokens.
  async refresh(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException('Refresh token manquant');
    let payload: { sub: string; role?: string; adminCredHash?: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }
    // L'admin n'existe pas en base : on régénère directement ses tokens, mais
    // seulement si les identifiants admin n'ont pas changé depuis l'émission
    // (la rotation de ADMIN_PASSWORD invalide ainsi les sessions en cours).
    if (payload.role === 'ADMIN') {
      if (!payload.adminCredHash || payload.adminCredHash !== this.adminCredHash()) {
        throw new UnauthorizedException('Session administrateur expirée');
      }
      return this.generateTokens(payload.sub, 'ADMIN', { adminCredHash: this.adminCredHash() });
    }
    return this.refreshTokens(payload.sub);
  }

  // ─── Reset PIN via OTP ────────────────────────────────────────────────────
  async requestPinReset(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new BadRequestException('Numéro introuvable');
    await this.otpService.sendOtp(user.id, OtpPurpose.PIN_RESET);
    return { message: 'Code OTP envoyé', userId: user.id };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private generateTokens(userId: string, role = 'USER', extra: Record<string, any> = {}) {
    const payload = { sub: userId, role, ...extra };
    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      }),
    };
  }
}
