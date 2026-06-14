import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionStatus, UserStatus } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';

// Champs renvoyés au client — jamais le pinHash.
const SAFE_USER_SELECT = {
  id: true,
  phone: true,
  phoneCode: true,
  fullName: true,
  email: true,
  avatarUrl: true,
  dateOfBirth: true,
  city: true,
  role: true,
  status: true,
  kycStatus: true,
  lastLoginAt: true,
  createdAt: true,
  wallet: {
    select: { balance: true, currency: true, isActive: true },
  },
} as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getMe(userId: string) {
    const [user, sent, received] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: SAFE_USER_SELECT }),
      this.prisma.transaction.aggregate({
        _count: { _all: true },
        _sum: { amount: true },
        where: { senderId: userId, status: TransactionStatus.COMPLETED },
      }),
      this.prisma.transaction.aggregate({
        _count: { _all: true },
        _sum: { amount: true },
        where: { receiverId: userId, status: TransactionStatus.COMPLETED },
      }),
    ]);
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    return {
      ...user,
      stats: {
        transactionsCount: sent._count._all + received._count._all,
        totalSent: sent._sum.amount ?? 0n,
        totalReceived: received._sum.amount ?? 0n,
      },
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // Vérifier l'unicité de l'email s'il est fourni
    if (dto.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Cet email est déjà utilisé');
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.dateOfBirth !== undefined && { dateOfBirth: new Date(dto.dateOfBirth) }),
        ...(dto.city !== undefined && { city: dto.city }),
      },
      select: SAFE_USER_SELECT,
    });
  }

  // Met à jour la photo de profil (URL Cloudinary ou data URI).
  async setAvatar(userId: string, avatarUrl: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
    return { avatarUrl };
  }

  // Enregistre le jeton push Expo de l'utilisateur (appelé après le login mobile).
  async setPushToken(userId: string, pushToken: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pushToken },
    });
    return { ok: true };
  }

  // Soft delete : passe le statut à DELETED. Les données sont conservées pour la traçabilité ANIF.
  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.DELETED, pushToken: null },
    });
    return { ok: true };
  }
}
