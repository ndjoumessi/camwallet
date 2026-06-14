import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

// À utiliser APRÈS AuthGuard('jwt') : @UseGuards(AuthGuard('jwt'), AdminGuard)
// L'utilisateur (avec son rôle) est injecté dans la requête par la JwtStrategy.
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (request.user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Accès réservé aux administrateurs');
    }
    return true;
  }
}
