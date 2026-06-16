import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding CamWallet database...');

  const pinHash = await bcrypt.hash('123456', 12);

  // Utilisateur test 1 (particulier)
  const user1 = await prisma.user.upsert({
    where: { phone: '+237677000001' },
    update: {},
    create: {
      phone: '+237677000001',
      fullName: 'Jean Dupont',
      pinHash,
      role: UserRole.USER,
      kycStatus: 'APPROVED',
      wallet: { create: { balance: 5000000n } }, // 50 000 FCFA
    },
  });

  // Utilisateur test 2 (marchand)
  const merchant = await prisma.user.upsert({
    where: { phone: '+237699000002' },
    update: {},
    create: {
      phone: '+237699000002',
      fullName: 'Boutique Mboa',
      pinHash,
      role: UserRole.MERCHANT,
      kycStatus: 'APPROVED',
      wallet: { create: { balance: 25000000n } }, // 250 000 FCFA
    },
  });

  // Admin
  const admin = await prisma.user.upsert({
    where: { phone: '+237699999999' },
    update: { adminRole: 'SUPER_ADMIN' },
    create: {
      phone: '+237699999999',
      fullName: 'Admin CamWallet',
      email: 'admin@camwallet.cm',
      pinHash,
      role: UserRole.ADMIN,
      adminRole: 'SUPER_ADMIN',
      kycStatus: 'APPROVED',
      wallet: { create: { balance: 0n } },
    },
  });

  // QR Code statique pour le marchand
  await prisma.qrCode.upsert({
    where: { id: 'static-merchant-qr-001' },
    update: {},
    create: {
      id: 'static-merchant-qr-001',
      userId: merchant.id,
      type: 'STATIC',
      payload: JSON.stringify({ type: 'CAMWALLET_QR', userId: merchant.id, version: 1 }),
    },
  });

  // Quelques transactions de démo
  await prisma.transaction.createMany({
    data: [
      {
        type: 'P2P',
        status: 'COMPLETED',
        amount: 500000n, // 5 000 FCFA
        senderId: user1.id,
        receiverId: merchant.id,
        description: 'Remboursement repas',
        processedAt: new Date(),
      },
      {
        type: 'RECHARGE',
        status: 'COMPLETED',
        amount: 2000000n, // 20 000 FCFA
        receiverId: user1.id,
        operator: 'ORANGE_MONEY',
        operatorRef: 'OM-TEST-001',
        processedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Seed terminé');
  console.log(`  👤 User test : ${user1.phone} | PIN: 123456`);
  console.log(`  🏪 Marchand test : ${merchant.phone} | PIN: 123456`);
  console.log(`  🔐 Admin : ${admin.phone} | PIN: 123456`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
