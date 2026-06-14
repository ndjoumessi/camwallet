import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

// À utiliser APRÈS AuthGuard('jwt').
// Autorise les MERCHANT et ADMIN (un admin peut consulter les stats commerçant).
@Injectable()
export class MerchantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const role = request.user?.role;
    if (role !== UserRole.MERCHANT && role !== UserRole.ADMIN) {
      throw new ForbiddenException('Accès réservé aux commerçants');
    }
    return true;
  }
}
