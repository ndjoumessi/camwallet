import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './require-permission.decorator';
import { roleHasPermission } from './permissions';

// À utiliser APRÈS AuthGuard('jwt') et AdminGuard. Lit la permission requise
// (métadonnée @RequirePermission) et la confronte au sous-rôle du token
// (req.user.adminRole). Route sans permission requise → autorisée (tout admin).
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const adminRole: string | undefined = request.user?.adminRole;
    if (!roleHasPermission(adminRole, required)) {
      throw new ForbiddenException(`Permission insuffisante (${required}) pour ce sous-rôle`);
    }
    return true;
  }
}
