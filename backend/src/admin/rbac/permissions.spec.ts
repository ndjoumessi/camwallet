import { roleHasPermission, isFullAccess } from './permissions';

describe('RBAC permissions par sous-rôle', () => {
  it('SUPER_ADMIN et token legacy (null) ont un accès total', () => {
    expect(isFullAccess('SUPER_ADMIN')).toBe(true);
    expect(isFullAccess(null)).toBe(true);
    expect(isFullAccess(undefined)).toBe(true);
    for (const p of ['team:manage', 'support:delete', 'settings:write', 'kyc:write']) {
      expect(roleHasPermission('SUPER_ADMIN', p)).toBe(true);
      expect(roleHasPermission(null, p)).toBe(true);
    }
  });

  it('SUPPORT_OPERATOR : lecture users/transactions, écriture support, mais ni écriture users/transactions ni suppression', () => {
    expect(roleHasPermission('SUPPORT_OPERATOR', 'support:read')).toBe(true);
    expect(roleHasPermission('SUPPORT_OPERATOR', 'support:write')).toBe(true);
    expect(roleHasPermission('SUPPORT_OPERATOR', 'users:read')).toBe(true);
    expect(roleHasPermission('SUPPORT_OPERATOR', 'transactions:read')).toBe(true);
    expect(roleHasPermission('SUPPORT_OPERATOR', 'metrics:read')).toBe(true);
    // refus
    expect(roleHasPermission('SUPPORT_OPERATOR', 'support:delete')).toBe(false);
    expect(roleHasPermission('SUPPORT_OPERATOR', 'users:write')).toBe(false);
    expect(roleHasPermission('SUPPORT_OPERATOR', 'transactions:write')).toBe(false);
    expect(roleHasPermission('SUPPORT_OPERATOR', 'kyc:read')).toBe(false);
    expect(roleHasPermission('SUPPORT_OPERATOR', 'audit:read')).toBe(false);
    expect(roleHasPermission('SUPPORT_OPERATOR', 'settings:write')).toBe(false);
    expect(roleHasPermission('SUPPORT_OPERATOR', 'team:manage')).toBe(false);
  });

  it('KYC_OFFICER : seulement KYC', () => {
    expect(roleHasPermission('KYC_OFFICER', 'kyc:read')).toBe(true);
    expect(roleHasPermission('KYC_OFFICER', 'kyc:write')).toBe(true);
    expect(roleHasPermission('KYC_OFFICER', 'users:read')).toBe(false);
    expect(roleHasPermission('KYC_OFFICER', 'transactions:read')).toBe(false);
    expect(roleHasPermission('KYC_OFFICER', 'support:read')).toBe(false);
  });

  it('FINANCE_OFFICER : métriques + opérations, pas de KYC ni users ni support', () => {
    expect(roleHasPermission('FINANCE_OFFICER', 'metrics:read')).toBe(true);
    expect(roleHasPermission('FINANCE_OFFICER', 'operations:read')).toBe(true);
    expect(roleHasPermission('FINANCE_OFFICER', 'operations:write')).toBe(true);
    expect(roleHasPermission('FINANCE_OFFICER', 'kyc:read')).toBe(false);
    expect(roleHasPermission('FINANCE_OFFICER', 'users:read')).toBe(false);
    expect(roleHasPermission('FINANCE_OFFICER', 'support:read')).toBe(false);
    expect(roleHasPermission('FINANCE_OFFICER', 'team:manage')).toBe(false);
  });

  it('COMPLIANCE_OFFICER : ANIF + audit + settings, pas de users/kyc/support', () => {
    expect(roleHasPermission('COMPLIANCE_OFFICER', 'anif:read')).toBe(true);
    expect(roleHasPermission('COMPLIANCE_OFFICER', 'anif:write')).toBe(true);
    expect(roleHasPermission('COMPLIANCE_OFFICER', 'audit:read')).toBe(true);
    expect(roleHasPermission('COMPLIANCE_OFFICER', 'settings:write')).toBe(true);
    expect(roleHasPermission('COMPLIANCE_OFFICER', 'users:read')).toBe(false);
    expect(roleHasPermission('COMPLIANCE_OFFICER', 'kyc:read')).toBe(false);
    expect(roleHasPermission('COMPLIANCE_OFFICER', 'support:read')).toBe(false);
  });

  it('ADMIN : tout sauf gestion équipe et suppression de ticket', () => {
    for (const p of ['users:write', 'kyc:write', 'transactions:write', 'operations:write', 'anif:write', 'audit:read', 'support:write']) {
      expect(roleHasPermission('ADMIN', p)).toBe(true);
    }
    expect(roleHasPermission('ADMIN', 'team:manage')).toBe(false);
    expect(roleHasPermission('ADMIN', 'support:delete')).toBe(false);
  });

  it('rôle inconnu → aucun accès (plus strict que le frontend)', () => {
    expect(roleHasPermission('HACKER', 'users:read')).toBe(false);
    expect(roleHasPermission('HACKER', 'support:read')).toBe(false);
  });
});
