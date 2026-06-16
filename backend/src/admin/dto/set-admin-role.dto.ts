import { IsIn } from 'class-validator';

// Rôles RBAC du dashboard admin (sous-rôles du rôle technique ADMIN).
//   SUPER_ADMIN        — accès total (toutes les pages, gestion d'équipe)
//   ADMIN              — accès total sauf Équipe Admin et Paramètres système
//   COMPLIANCE_OFFICER — Conformité ANIF + Journal Audit uniquement
//   SUPPORT_OPERATOR   — Utilisateurs + Transactions uniquement (lecture seule)
//   FINANCE_OFFICER    — Finances + Recharges & Retraits uniquement
export const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'COMPLIANCE_OFFICER',
  'SUPPORT_OPERATOR',
  'FINANCE_OFFICER',
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export class SetAdminRoleDto {
  // null = retirer le sous-rôle (l'utilisateur reste ADMIN technique).
  @IsIn([...ADMIN_ROLES, null])
  adminRole: AdminRole | null;
}
