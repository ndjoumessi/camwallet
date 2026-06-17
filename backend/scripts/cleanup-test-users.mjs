// Supprime les comptes de test (artefacts RBAC / Render / op-*) de la base.
// DRY-RUN par défaut : affiche la liste. Passer `--delete` pour supprimer.
//
//   node --env-file=.env scripts/cleanup-test-users.mjs            # aperçu
//   node --env-file=.env scripts/cleanup-test-users.mjs --delete   # suppression
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DELETE = process.argv.includes('--delete');

// Comptes réels à NE JAMAIS supprimer.
const PROTECTED_NAMES = ['Jean Dupont', 'Boutique Mboa'];
const PROTECTED_EMAIL_PREFIX = ['admin@', 'finance@', 'kyc@', 'support@'];

const where = {
  AND: [
    {
      OR: [
        { fullName: { startsWith: 'RBAC' } },
        { fullName: { startsWith: 'Render' } },
        { email: { contains: 'rbac.' } },
        { email: { contains: 'render.' } },
        { email: { contains: 'op-' } },
        { email: { contains: '.status@' } },
        { email: { contains: 'op-8f' } },
      ],
    },
    { fullName: { notIn: PROTECTED_NAMES } },
    ...PROTECTED_EMAIL_PREFIX.map((p) => ({ NOT: { email: { startsWith: p } } })),
  ],
};

async function main() {
  const users = await prisma.user.findMany({
    where,
    select: { id: true, fullName: true, email: true, phone: true, role: true, adminRole: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n${users.length} compte(s) de test correspondant aux critères :\n`);
  for (const u of users) {
    console.log(`  - ${u.fullName ?? '(sans nom)'}  |  ${u.email ?? u.phone ?? '?'}  |  role=${u.role}/${u.adminRole ?? '-'}  |  ${u.id}`);
  }
  console.log('');
  console.log('Comptes protégés (jamais supprimés) :', PROTECTED_NAMES.join(', '), '+ emails', PROTECTED_EMAIL_PREFIX.join(', '));

  if (!DELETE) {
    console.log('\n[DRY-RUN] Aucune suppression. Relancer avec --delete pour supprimer.\n');
    return;
  }
  if (users.length === 0) {
    console.log('\nRien à supprimer.\n');
    return;
  }

  const ids = users.map((u) => u.id);
  console.log(`\n[SUPPRESSION] de ${ids.length} compte(s) + dépendances…\n`);

  // Pas de onDelete:Cascade côté schéma → on purge les dépendances d'abord.
  const result = await prisma.$transaction([
    prisma.supportMessage.deleteMany({ where: { authorId: { in: ids } } }),
    prisma.supportTicket.deleteMany({ where: { OR: [{ userId: { in: ids } }, { assignedTo: { in: ids } }] } }),
    prisma.disputeRequest.deleteMany({ where: { requesterId: { in: ids } } }),
    prisma.adminNote.deleteMany({ where: { OR: [{ targetId: { in: ids } }, { authorId: { in: ids } }] } }),
    prisma.transaction.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } }),
    prisma.auditLog.deleteMany({ where: { userId: { in: ids } } }),
    prisma.otpCode.deleteMany({ where: { userId: { in: ids } } }),
    prisma.qrCode.deleteMany({ where: { userId: { in: ids } } }),
    prisma.loyaltyPoints.deleteMany({ where: { userId: { in: ids } } }),
    prisma.kycDocument.deleteMany({ where: { userId: { in: ids } } }),
    prisma.wallet.deleteMany({ where: { userId: { in: ids } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);

  const labels = ['supportMessage', 'supportTicket', 'disputeRequest', 'adminNote', 'transaction', 'auditLog', 'otpCode', 'qrCode', 'loyaltyPoints', 'kycDocument', 'wallet', 'user'];
  result.forEach((r, i) => console.log(`  ${labels[i]}: ${r.count} supprimé(s)`));
  console.log('\n✅ Suppression terminée.\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
