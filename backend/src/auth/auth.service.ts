import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { SupportedLang } from '../common/i18n/i18n.util';
import { normalizeCameroonPhone } from '../common/phone.util';
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
// Coût bcrypt du PIN (2^coût itérations). 10 = défaut bcrypt (~60-75 ms) au lieu
// de 12 (~250-300 ms) pour réduire la latence de connexion. Acceptable car le
// brute-force est déjà borné par le verrouillage (MAX_PIN_ATTEMPTS → 30 min).
// NB : ne change que les NOUVEAUX hash ; les PIN existants gardent leur coût
// jusqu'à un changement de PIN (cf. re-hash à la connexion si besoin).
const PIN_BCRYPT_COST = 10;

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
    private readonly eventEmitter: EventEmitter2,
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

  // ─── Pepper du PIN (défense en profondeur) ────────────────────────────────
  // Applique HMAC-SHA256(pin, PIN_PEPPER) AVANT bcrypt. Le pepper vit uniquement
  // dans l'environnement (jamais en base) : un vol de la seule base (hashes
  // bcrypt) ne permet donc pas de bruteforcer les PIN sans connaître le pepper.
  // Si PIN_PEPPER n'est pas configuré (dev/local), on retombe sur le PIN brut —
  // comportement legacy, sans rupture.
  private pepperPin(pin: string): string {
    const secret = this.config.get<string>('PIN_PEPPER');
    if (!secret) return pin;
    return crypto.createHmac('sha256', secret).update(pin).digest('hex');
  }

  // Compare un PIN au hash stocké. Chemin nominal : PIN peppered. Repli legacy :
  // ancien hash du PIN brut (créé avant le pepper) — si la correspondance passe
  // et qu'un userId est fourni, on re-hash au nouveau format (pepper + coût
  // courant) pour migrer l'utilisateur de façon transparente à la connexion.
  // Sans userId (ex. vérification d'historique), aucune migration.
  private async comparePin(pin: string, hash: string, userId?: string): Promise<boolean> {
    if (!hash) return false;
    if (await bcrypt.compare(this.pepperPin(pin), hash)) return true;
    // Repli utile seulement si un pepper est actif (sinon pepperPin = identité).
    const peppered = !!this.config.get<string>('PIN_PEPPER');
    if (peppered && (await bcrypt.compare(pin, hash))) {
      if (userId) {
        const migrated = await bcrypt.hash(this.pepperPin(pin), PIN_BCRYPT_COST);
        await this.prisma.user.update({ where: { id: userId }, data: { pinHash: migrated } });
        this.logger.log(`PIN migré vers le format peppered (user ${userId})`);
      }
      return true;
    }
    return false;
  }

  // ─── Étape 1 : Inscription — envoi OTP ────────────────────────────────────
  async register(dto: RegisterDto, lang: SupportedLang = 'fr') {
    // Normaliser en E.164 (+237XXXXXXXXX) — requis pour la livraison SMS live.
    const phone = normalizeCameroonPhone(dto.phone);
    if (!phone) {
      throw new BadRequestException(
        'Numéro de téléphone invalide (format attendu : +237 suivi de 9 chiffres).',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { phone },
    });

    if (existing) {
      throw new ConflictException('Ce numéro est déjà enregistré');
    }

    const user = await this.prisma.user.create({
      data: {
        phone,
        fullName: dto.fullName,
        pinHash: '', // Sera défini à l'étape 3
        wallet: { create: {} },
      },
    });

    // Événement temps réel pour le dashboard admin (non bloquant).
    this.eventEmitter.emit('user.registered', { phone });

    await this.otpService.sendOtp(user.id, OtpPurpose.REGISTRATION, lang);
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
    const pinHash = await bcrypt.hash(this.pepperPin(dto.pin), PIN_BCRYPT_COST);
    const user = await this.prisma.user.update({
      where: { id: dto.userId },
      data: { pinHash },
    });
    return this.generateTokens(user.id, user.role, { tv: user.tokenVersion });
  }

  // ─── Connexion avec PIN ────────────────────────────────────────────────────
  async login(dto: LoginDto) {
    // Normaliser pour retrouver le compte quelle que soit la saisie (espaces, 237…).
    const phone = normalizeCameroonPhone(dto.phone) ?? dto.phone;
    const user = await this.prisma.user.findUnique({
      where: { phone },
    });

    if (!user) throw new UnauthorizedException('Numéro introuvable');

    // Vérification blocage
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(
        `Compte bloqué. Réessayez dans ${minutes} minutes.`,
      );
    }

    const pinValid = await this.comparePin(dto.pin, user.pinHash, user.id);

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

    // Succès. Deux cas :
    //  - compteur déjà à zéro (cas courant) : seul lastLoginAt change (cosmétique)
    //    → écriture fire-and-forget, hors chemin critique (~150 ms de moins au p95).
    //  - tentatives échouées / verrou actif (rare) : la remise à zéro est
    //    sensible (anti brute-force) → on l'attend pour la garantir durable.
    const needsReset = user.pinAttempts !== 0 || user.lockedUntil !== null;
    if (needsReset) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { pinAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
    } else {
      void this.prisma.user
        .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
        .catch((err) =>
          this.logger.warn(
            `MAJ lastLoginAt échouée (user ${user.id}) : ${err?.message ?? err}`,
          ),
        );
    }

    return this.generateTokens(user.id, user.role, { tv: user.tokenVersion });
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
      // Repli : connexion par-utilisateur d'un admin en base (email + mot de
      // passe propre). Le super-admin configuré garde sa connexion via la config.
      const perUser = await this.loginAdminUser(dto);
      if (perUser) return perUser;

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
      select: { id: true, totpEnabled: true, totpSecret: true, adminRole: true },
    });
    const sub = adminUser?.id ?? 'admin';
    // Le compte admin configuré (ADMIN_EMAIL/PASSWORD) est SUPER_ADMIN par défaut.
    // Le claim adminRole est lu côté frontend pour le RBAC du dashboard.
    const adminRole = adminUser?.adminRole ?? 'SUPER_ADMIN';

    // ── Vérification 2FA TOTP (si activée sur le compte admin) ───────────────
    if (adminUser?.totpEnabled) {
      if (!dto.totpCode) {
        // Informer le frontend qu'une étape TOTP est requise (HTTP 200).
        return { requiresTOTP: true };
      }
      const totpValid = authenticator.verify({
        token: dto.totpCode,
        secret: adminUser.totpSecret!,
      });
      if (!totpValid) {
        throw new UnauthorizedException('Code TOTP invalide ou expiré');
      }
    }

    // Tracer la dernière connexion de l'admin configuré (affichée dans Équipe).
    if (adminUser) {
      void this.prisma.user.update({ where: { id: adminUser.id }, data: { lastLoginAt: new Date() } });
    }

    // Enregistrer la date de premier login admin si non définie (rotation 90j).
    void this.prisma.systemSettings.upsert({
      where: { key: 'admin_password_changed_at' },
      create: {
        key: 'admin_password_changed_at',
        value: new Date().toISOString(),
        updatedBy: sub,
      },
      update: {},
    });

    return this.generateTokens(sub, 'ADMIN', { adminCredHash: this.adminCredHash(), adminRole });
  }

  // Connexion par-utilisateur d'un admin disposant d'un mot de passe propre
  // (User.passwordHash). Renvoie null si aucun compte admin correspondant n'a de
  // mot de passe défini — le caller traite alors « identifiants invalides ».
  // Le token émis porte `adminRole` + `tv` (pas d'adminCredHash) : le refresh
  // est donc validé via tokenVersion en base, comme pour un utilisateur normal.
  private async loginAdminUser(dto: LoginAdminDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email, mode: 'insensitive' },
        role: 'ADMIN',
        deletedAt: null,
        passwordHash: { not: null },
      },
    });
    if (!user) return null;

    // Compte admin désactivé par un SUPER_ADMIN → connexion refusée.
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Compte administrateur désactivé');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(`Compte bloqué. Réessayez dans ${minutes} minute(s).`);
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash!);
    if (!valid) {
      const attempts = user.pinAttempts + 1;
      if (attempts >= MAX_PIN_ATTEMPTS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { pinAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_DURATION_MS) },
        });
        throw new UnauthorizedException('Trop de tentatives. Compte bloqué 30 minutes.');
      }
      await this.prisma.user.update({ where: { id: user.id }, data: { pinAttempts: attempts } });
      throw new UnauthorizedException('Identifiants administrateur invalides');
    }

    // 2FA TOTP (si activée sur ce compte admin).
    if (user.totpEnabled) {
      if (!dto.totpCode) return { requiresTOTP: true };
      const ok = authenticator.verify({ token: dto.totpCode, secret: user.totpSecret! });
      if (!ok) throw new UnauthorizedException('Code TOTP invalide ou expiré');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { pinAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    this.logger.log(`Connexion admin par-utilisateur : ${user.email}`);
    return this.generateTokens(user.id, 'ADMIN', { adminRole: user.adminRole, tv: user.tokenVersion });
  }

  // Échange un refresh token valide contre une nouvelle paire de tokens.
  async refresh(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException('Refresh token manquant');
    let payload: { sub: string; role?: string; adminCredHash?: string; adminRole?: string; tv?: number };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }

    // L'admin n'existe pas en base : on régénère directement ses tokens, mais
    // seulement si les identifiants admin n'ont pas changé depuis l'émission.
    // Admin configuré (token portant adminCredHash) : revalider l'empreinte des
    // identifiants de config. Les admins par-utilisateur n'ont pas d'adminCredHash
    // et tombent dans la branche base ci-dessous (validation par tokenVersion).
    if (payload.role === 'ADMIN' && payload.adminCredHash) {
      if (payload.adminCredHash !== this.adminCredHash()) {
        throw new UnauthorizedException('Session administrateur expirée');
      }
      return this.generateTokens(payload.sub, 'ADMIN', { adminCredHash: this.adminCredHash(), adminRole: payload.adminRole ?? 'SUPER_ADMIN' });
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException();

    // Fail-closed : absence de tv (token pré-migration) === rejet systématique
    if (payload.tv !== user.tokenVersion) {
      throw new UnauthorizedException('Session expirée — reconnectez-vous');
    }

    // Préserver le sous-rôle admin pour les admins par-utilisateur.
    const extra: Record<string, any> = { tv: user.tokenVersion };
    if (user.role === 'ADMIN') extra.adminRole = user.adminRole ?? null;
    return this.generateTokens(user.id, user.role, extra);
  }

  // ─── Déconnexion (invalide les refresh tokens en cours) ───────────────────
  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    return { message: 'Déconnexion réussie' };
  }

  // ─── Changement de PIN (avec vérification de l'ancien) ────────────────────
  async changePin(userId: string, currentPin: string, newPin: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const pinValid = await this.comparePin(currentPin, user.pinHash, user.id);
    if (!pinValid) throw new UnauthorizedException('PIN actuel incorrect');

    // Vérifier que le nouveau PIN n'est pas parmi les 3 derniers utilisés.
    // comparePin (sans userId → sans migration) gère les hash peppered ET legacy.
    const hashesToCheck = [user.pinHash, ...user.previousPinHashes];
    for (const oldHash of hashesToCheck) {
      if (await this.comparePin(newPin, oldHash)) {
        throw new BadRequestException('Ce PIN a déjà été utilisé récemment. Choisissez un PIN différent.');
      }
    }

    const newPinHash = await bcrypt.hash(this.pepperPin(newPin), PIN_BCRYPT_COST);
    // Conserver les 2 anciens hashes + l'actuel = 3 entrées dans l'historique
    const previousPinHashes = [user.pinHash, ...user.previousPinHashes].slice(0, 3);

    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: newPinHash, tokenVersion: { increment: 1 }, previousPinHashes },
    });

    return { message: 'PIN modifié avec succès — reconnectez-vous' };
  }

  // ─── Vérification du PIN courant (sans reconnexion) ───────────────────────
  // Utilisé par le flux « changer le PIN » côté mobile : on confirme l'ancien
  // PIN avant de présenter la saisie du nouveau. Ne compte pas dans le verrou
  // anti brute-force (rate-limit via le Throttler côté contrôleur).
  async verifyPin(userId: string, pin: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const valid = await this.comparePin(pin ?? '', user.pinHash, user.id);
    if (!valid) throw new UnauthorizedException('PIN incorrect');
    return { valid: true };
  }

  // ─── Reset PIN via OTP ────────────────────────────────────────────────────
  async requestPinReset(phone: string, lang: SupportedLang = 'fr') {
    const normalized = normalizeCameroonPhone(phone) ?? phone;
    const user = await this.prisma.user.findUnique({ where: { phone: normalized } });
    if (!user) throw new BadRequestException('Numéro introuvable');
    await this.otpService.sendOtp(user.id, OtpPurpose.PIN_RESET, lang);
    return { message: 'Code OTP envoyé', userId: user.id };
  }

  // ─── 2FA TOTP ─────────────────────────────────────────────────────────────

  async setup2FA(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // Si la 2FA est déjà active, exiger une désactivation explicite avant de régénérer un secret.
    if (user?.totpEnabled) {
      throw new BadRequestException('Désactivez la 2FA existante avant d\'en configurer une nouvelle');
    }
    const secret = authenticator.generateSecret();
    // Stocke le secret en "attente" — il ne sera promu dans totpSecret qu'après vérification.
    await this.prisma.user.update({ where: { id: userId }, data: { pendingTotpSecret: secret } });
    const otpauthUrl = authenticator.keyuri('admin', 'CamWallet', secret);
    return { otpauthUrl, secret };
  }

  async verify2FA(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // Vérifie le secret en attente (pas encore le secret actif).
    if (!user?.pendingTotpSecret) throw new UnauthorizedException('Aucune configuration 2FA en cours');
    const valid = authenticator.verify({ token: code, secret: user.pendingTotpSecret });
    if (!valid) throw new UnauthorizedException('Code TOTP invalide');
    // Promotion : le secret est validé, on l'active et on efface le pending.
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: user.pendingTotpSecret, totpEnabled: true, pendingTotpSecret: null },
    });
    return { ok: true };
  }

  async disable2FA(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret || !user.totpEnabled) throw new UnauthorizedException('2FA non activée');
    const valid = authenticator.verify({ token: code, secret: user.totpSecret });
    if (!valid) throw new UnauthorizedException('Code TOTP invalide');
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecret: null } });
    return { ok: true };
  }

  async get2FAStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabled: true },
    });
    return { totpEnabled: !!user?.totpEnabled };
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
