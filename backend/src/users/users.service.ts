import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

// Champs renvoyés au client — jamais le pinHash.
const SAFE_USER_SELECT = {
  id: true,
  phone: true,
  phoneCode: true,
  fullName: true,
  email: true,
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: SAFE_USER_SELECT,
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return user;
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
      },
      select: SAFE_USER_SELECT,
    });
  }
}
