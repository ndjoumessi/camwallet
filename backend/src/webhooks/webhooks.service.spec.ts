import { WebhooksService } from './webhooks.service';
import { TransactionType } from '@prisma/client';

// Vérifie l'attribution de points fidélité à la confirmation d'une RECHARGE
// (la confirmation passe normalement par un webhook signé — non forgeable hors prod ;
// on teste ici directement la logique de confirmTransaction).
const makeService = () => {
  const prisma = {
    wallet: { update: jest.fn().mockReturnValue('wallet-op') },
    transaction: { update: jest.fn().mockReturnValue('tx-op') },
    webhookEvent: { update: jest.fn().mockReturnValue('evt-op') },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const config = { get: jest.fn() };
  const notifications = { notifyTransactionReceived: jest.fn().mockResolvedValue(undefined) };
  const campay = {};
  const cache = { del: jest.fn().mockResolvedValue(undefined) };
  const loyalty = { awardRecharge: jest.fn().mockResolvedValue(undefined) };
  const svc = new WebhooksService(
    prisma as any,
    config as any,
    notifications as any,
    campay as any,
    cache as any,
    loyalty as any,
  );
  return { svc, loyalty, cache, prisma };
};

const confirm = (svc: WebhooksService, tx: any) => (svc as any).confirmTransaction(tx, 'evt-1');

describe('WebhooksService — fidélité à la confirmation', () => {
  it('attribue les points recharge au bénéficiaire (RECHARGE confirmée)', async () => {
    const { svc, loyalty, cache } = makeService();
    await confirm(svc, {
      id: 'tx1', type: TransactionType.RECHARGE, receiverId: 'u1', amount: 100000n, fee: 0n, operatorRef: 'r1',
    });
    expect(loyalty.awardRecharge).toHaveBeenCalledWith('u1');
    expect(cache.del).toHaveBeenCalled(); // invalidation du solde
  });

  it("n'attribue PAS de points recharge pour une WITHDRAWAL confirmée", async () => {
    const { svc, loyalty } = makeService();
    await confirm(svc, {
      id: 'tx2', type: TransactionType.WITHDRAWAL, senderId: 'u2', amount: 50000n, fee: 5000n, operatorRef: 'w1',
    });
    expect(loyalty.awardRecharge).not.toHaveBeenCalled();
  });
});
