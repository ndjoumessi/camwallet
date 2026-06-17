// ─────────────────────────────────────────────────────────────────────────────
// RBAC backend par sous-rôle admin (claim `adminRole` du JWT).
//
// L'AdminGuard garantit déjà role === ADMIN. Ce module cloisonne ensuite les
// routes selon le sous-rôle, en miroir du RBAC frontend (ROLE_PAGES + gating
// d'actions). SUPER_ADMIN (et un token legacy sans adminRole) a un accès total.
//
// Principe : chaque route sensible porte un @RequirePermission('resource:action').
// Les lectures de listes/stats partagées entre pages restent ouvertes à tout
// admin (pas de permission requise) ; le cloisonnement strict porte sur les
// écritures et les ressources sensibles (KYC, audit, settings, équipe, support).
// ─────────────────────────────────────────────────────────────────────────────

export type AdminRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'COMPLIANCE_OFFICER'
  | 'SUPPORT_OPERATOR'
  | 'FINANCE_OFFICER'
  | 'KYC_OFFICER';

// Permissions accordées à chaque sous-rôle. '*' = accès total.
export const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: [
    'metrics:read',
    'dashboard:read',
    'users:read',
    'users:write',
    'transactions:read',
    'transactions:write',
    'operations:read',
    'operations:write',
    'kyc:read',
    'kyc:write',
    'anif:read',
    'anif:write',
    'audit:read',
    'settings:read',
    'settings:write', // limité aux clés anif_* hors SUPER_ADMIN (cf. AdminService.updateSettings)
    'support:read',
    'support:write',
    // PAS : team:manage, support:delete (réservés au SUPER_ADMIN)
  ],
  COMPLIANCE_OFFICER: [
    'anif:read',
    'anif:write',
    'audit:read',
    'settings:read',
    'settings:write', // clés anif_* uniquement (cf. service)
  ],
  SUPPORT_OPERATOR: [
    'metrics:read',
    'users:read',
    'transactions:read',
    'support:read',
    'support:write',
    // PAS : users:write, transactions:write, support:delete
  ],
  FINANCE_OFFICER: [
    'metrics:read',
    'operations:read',
    'operations:write',
  ],
  KYC_OFFICER: [
    'kyc:read',
    'kyc:write',
  ],
};

// Un token sans adminRole = ancien token de l'admin configuré (toujours
// SUPER_ADMIN) → accès total, pour éviter tout verrouillage à la transition.
export function isFullAccess(adminRole?: string | null): boolean {
  return adminRole == null || adminRole === 'SUPER_ADMIN';
}

export function roleHasPermission(adminRole: string | null | undefined, permission: string): boolean {
  if (isFullAccess(adminRole)) return true;
  const perms = ROLE_PERMISSIONS[adminRole as AdminRole];
  if (!perms) return false; // rôle inconnu → refus (plus strict que le frontend)
  return perms.includes('*') || perms.includes(permission);
}
