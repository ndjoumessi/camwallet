import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermission';

// Annote une route avec la permission nécessaire (ex. 'users:write').
// Sans ce décorateur, la route reste accessible à tout admin (cf. PermissionsGuard).
export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);
