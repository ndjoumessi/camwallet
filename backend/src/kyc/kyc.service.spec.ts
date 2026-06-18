import { KycService } from './kyc.service';
import { KycAggregateResult } from './kyc-ai.service';

// opts.toggle : valeur de kyc_auto_approve en base ('on'/'off'/absent).
// opts.dbThreshold : valeur de kyc_auto_approve_threshold en base (absent = non défini).
// opts.envThreshold : variable d'env KYC_AUTO_APPROVE_THRESHOLD (absent = undefined).
const makeService = (opts: { toggle?: string; dbThreshold?: string; envThreshold?: string } = {}) => {
  const rows: { key: string; value: string }[] = [];
  if (opts.toggle !== undefined) rows.push({ key: 'kyc_auto_approve', value: opts.toggle });
  if (opts.dbThreshold !== undefined) rows.push({ key: 'kyc_auto_approve_threshold', value: opts.dbThreshold });

  const prisma = {
    systemSettings: { findMany: jest.fn().mockResolvedValue(rows) },
    user: { update: jest.fn().mockReturnValue('user-op') },
    kycDocument: { update: jest.fn().mockReturnValue('doc-op') },
    auditLog: { create: jest.fn().mockReturnValue('audit-op') },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue(opts.envThreshold) };
  const eventEmitter = { emit: jest.fn() };
  const loyalty = { award: jest.fn().mockResolvedValue(undefined) };
  const svc = new KycService(
    prisma as any,
    {} as any,
    {} as any,
    notifications as any,
    config as any,
    eventEmitter as any,
    loyalty as any,
  );
  return { svc, prisma, notifications, eventEmitter, loyalty };
};

// maybeAutoApprove est privée — on l'appelle directement pour tester le gating.
const autoApprove = (svc: KycService, res: KycAggregateResult) =>
  (svc as any).maybeAutoApprove('u1', res);

const result = (over: Partial<KycAggregateResult>): KycAggregateResult => ({
  score: 96,
  suggestion: 'APPROVE',
  issues: [],
  ...over,
});

describe('KycService.maybeAutoApprove', () => {
  it('auto-approuve si APPROVE + score ≥ seuil + toggle activé', async () => {
    const { svc, prisma, notifications, eventEmitter } = makeService({ toggle: 'on', dbThreshold: '95' });

    await autoApprove(svc, result({ score: 96 }));

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { kycStatus: 'APPROVED' } }),
    );
    expect(prisma.kycDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', reviewedBy: 'AI' }) }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'KYC_AUTO_APPROVED' }) }),
    );
    expect(notifications.sendToUser).toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith('kyc.auto_approved', expect.objectContaining({ userId: 'u1' }));
  });

  it('n\'auto-approuve pas si le toggle est désactivé', async () => {
    const { svc, prisma, notifications } = makeService({ toggle: 'off', dbThreshold: '95' });
    await autoApprove(svc, result({ score: 99 }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('n\'auto-approuve pas si le toggle n\'existe pas (défaut désactivé)', async () => {
    const { svc, prisma } = makeService({ dbThreshold: '95' }); // pas de ligne toggle
    await autoApprove(svc, result({ score: 99 }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('n\'auto-approuve pas si le score est sous le seuil (base)', async () => {
    const { svc, prisma } = makeService({ toggle: 'on', dbThreshold: '95' });
    await autoApprove(svc, result({ score: 94 })); // 94 < 95
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('n\'auto-approuve pas si la suggestion n\'est pas APPROVE (court-circuit avant lecture base)', async () => {
    const { svc, prisma } = makeService({ toggle: 'on', dbThreshold: '95' });
    await autoApprove(svc, result({ score: 99, suggestion: 'MANUAL_REVIEW' }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.systemSettings.findMany).not.toHaveBeenCalled();
  });

  it('priorité : le seuil en base l\'emporte sur la variable d\'env', async () => {
    // base = 98, env = 90 → un score de 95 doit être refusé (98 prioritaire).
    const refus = makeService({ toggle: 'on', dbThreshold: '98', envThreshold: '90' });
    await autoApprove(refus.svc, result({ score: 95 }));
    expect(refus.prisma.$transaction).not.toHaveBeenCalled();

    const ok = makeService({ toggle: 'on', dbThreshold: '98', envThreshold: '90' });
    await autoApprove(ok.svc, result({ score: 98 }));
    expect(ok.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('repli sur l\'env quand aucun seuil en base', async () => {
    const { svc, prisma } = makeService({ toggle: 'on', envThreshold: '90' }); // pas de dbThreshold
    await autoApprove(svc, result({ score: 92 })); // 92 ≥ 90 (env) → approuvé
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('repli sur le défaut 95 quand ni base ni env', async () => {
    const under = makeService({ toggle: 'on' }); // ni dbThreshold ni env
    await autoApprove(under.svc, result({ score: 94 }));
    expect(under.prisma.$transaction).not.toHaveBeenCalled(); // 94 < 95

    const ok = makeService({ toggle: 'on' });
    await autoApprove(ok.svc, result({ score: 95 }));
    expect(ok.prisma.$transaction).toHaveBeenCalledTimes(1); // 95 ≥ 95
  });
});
