import { KycService } from './kyc.service';
import { KycAggregateResult } from './kyc-ai.service';

const makeService = (opts: { setting?: { value: string } | null; threshold?: string } = {}) => {
  const prisma = {
    systemSettings: { findUnique: jest.fn().mockResolvedValue('setting' in opts ? opts.setting : { value: 'on' }) },
    user: { update: jest.fn().mockReturnValue('user-op') },
    kycDocument: { update: jest.fn().mockReturnValue('doc-op') },
    auditLog: { create: jest.fn().mockReturnValue('audit-op') },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const notifications = { sendToUser: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue(opts.threshold ?? '90') };
  const eventEmitter = { emit: jest.fn() };
  const svc = new KycService(
    prisma as any,
    {} as any,
    {} as any,
    notifications as any,
    config as any,
    eventEmitter as any,
  );
  return { svc, prisma, notifications, eventEmitter };
};

// maybeAutoApprove est privée — on l'appelle directement pour tester le gating.
const autoApprove = (svc: KycService, res: KycAggregateResult) =>
  (svc as any).maybeAutoApprove('u1', res);

const result = (over: Partial<KycAggregateResult>): KycAggregateResult => ({
  score: 95,
  suggestion: 'APPROVE',
  issues: [],
  ...over,
});

describe('KycService.maybeAutoApprove', () => {
  it('auto-approuve si APPROVE + score ≥ seuil + toggle activé', async () => {
    const { svc, prisma, notifications, eventEmitter } = makeService({ setting: { value: 'on' }, threshold: '90' });

    await autoApprove(svc, result({ score: 95 }));

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
    const { svc, prisma, notifications } = makeService({ setting: { value: 'off' } });
    await autoApprove(svc, result({ score: 99 }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('n\'auto-approuve pas si le toggle n\'existe pas (défaut désactivé)', async () => {
    const { svc, prisma } = makeService({ setting: null });
    await autoApprove(svc, result({ score: 99 }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('n\'auto-approuve pas si le score est sous le seuil', async () => {
    const { svc, prisma } = makeService({ setting: { value: 'on' }, threshold: '90' });
    await autoApprove(svc, result({ score: 89 }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // court-circuit avant même la lecture du toggle
    expect(prisma.systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it('n\'auto-approuve pas si la suggestion n\'est pas APPROVE', async () => {
    const { svc, prisma } = makeService({ setting: { value: 'on' } });
    await autoApprove(svc, result({ score: 99, suggestion: 'MANUAL_REVIEW' }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('respecte un seuil personnalisé via KYC_AUTO_APPROVE_THRESHOLD', async () => {
    const { svc, prisma } = makeService({ setting: { value: 'on' }, threshold: '95' });
    await autoApprove(svc, result({ score: 92 })); // 92 < 95 → refusé
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
