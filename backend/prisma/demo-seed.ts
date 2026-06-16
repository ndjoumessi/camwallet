/**
 * Seed de DÉMO CamWallet — données réalistes pour présentation / preview.
 *
 *   cd backend && npx ts-node prisma/demo-seed.ts
 *
 * Idempotent : tout est upserté sur des clés stables (phone, reference DEMO-*),
 * donc relançable sans créer de doublons. Conçu pour tourner sur Supabase.
 *
 * Contenu :
 *   - 1 utilisateur démo (Jean Dupont)        — solde 150 000 FCFA, KYC APPROVED
 *   - 1 marchand démo (Boutique Mboa)         — solde 500 000 FCFA, KYC APPROVED
 *   - 5 contacts récents (noms camerounais)
 *   - 30 transactions réparties sur 30 jours  (recharges OM/MTN, P2P, QR, retraits)
 *
 * Montants en centimes FCFA (BigInt) : 1 FCFA = 100.
 */
import { PrismaClient, UserRole, MobileOperator, TransactionType, TransactionStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// FCFA (entier) → centimes BigInt.
const fcfa = (n: number): bigint => BigInt(Math.round(n)) * 100n;
// Commission marchand QR : 0,5 %.
const qrFee = (amount: bigint): bigint => (amount * 5n) / 1000n;

// Date à J-`daysAgo`, à l'heure indiquée (déterministe → idempotent).
const REF_NOW = new Date('2026-06-16T12:00:00.000Z').getTime();
const daysAgo = (days: number, hour = 10, min = 0): Date =>
  new Date(REF_NOW - days * 86_400_000 + (hour * 60 + min) * 60_000 - 12 * 3_600_000);

async function main() {
  console.log('🌱 Seed DÉMO CamWallet…');
  const pinHash = await bcrypt.hash('123456', 12);

  // ── Utilisateur démo ─────────────────────────────────────────
  const jean = await prisma.user.upsert({
    where: { phone: '+237677000001' },
    update: {
      fullName: 'Jean Dupont',
      kycStatus: 'APPROVED',
      role: UserRole.USER,
      city: 'Douala',
      wallet: { upsert: { create: { balance: fcfa(150_000) }, update: { balance: fcfa(150_000) } } },
    },
    create: {
      phone: '+237677000001',
      fullName: 'Jean Dupont',
      pinHash,
      role: UserRole.USER,
      kycStatus: 'APPROVED',
      city: 'Douala',
      wallet: { create: { balance: fcfa(150_000) } },
    },
  });

  // ── Marchand démo ────────────────────────────────────────────
  const mboa = await prisma.user.upsert({
    where: { phone: '+237699000002' },
    update: {
      fullName: 'Boutique Mboa',
      kycStatus: 'APPROVED',
      role: UserRole.MERCHANT,
      city: 'Yaoundé',
      wallet: { upsert: { create: { balance: fcfa(500_000) }, update: { balance: fcfa(500_000) } } },
    },
    create: {
      phone: '+237699000002',
      fullName: 'Boutique Mboa',
      pinHash,
      role: UserRole.MERCHANT,
      kycStatus: 'APPROVED',
      city: 'Yaoundé',
      wallet: { create: { balance: fcfa(500_000) } },
    },
  });

  // ── 5 contacts récents (noms camerounais réalistes) ──────────
  const contactsData = [
    { phone: '+237670000010', fullName: 'Aïcha Nana', city: 'Douala' },
    { phone: '+237680000011', fullName: 'Emmanuel Fotso', city: 'Bafoussam' },
    { phone: '+237690000012', fullName: 'Brigitte Ngono', city: 'Yaoundé' },
    { phone: '+237671000013', fullName: 'Serge Kamga', city: 'Douala' },
    { phone: '+237682000014', fullName: 'Marlène Abena', city: 'Yaoundé' },
  ];
  const contacts = [];
  for (const c of contactsData) {
    const u = await prisma.user.upsert({
      where: { phone: c.phone },
      update: { fullName: c.fullName, city: c.city, kycStatus: 'APPROVED' },
      create: {
        phone: c.phone,
        fullName: c.fullName,
        city: c.city,
        pinHash,
        role: UserRole.USER,
        kycStatus: 'APPROVED',
        wallet: { create: { balance: fcfa(40_000) } },
      },
    });
    contacts.push(u);
  }

  // ── 30 transactions réalistes sur 30 jours ───────────────────
  // Chaque entrée a une `reference` stable (DEMO-XX) → upsert idempotent.
  type Tx = {
    ref: string;
    type: TransactionType;
    amountFcfa: number;
    senderId?: string;
    receiverId?: string;
    operator?: MobileOperator;
    operatorRef?: string;
    description?: string;
    day: number;
    hour?: number;
  };

  const C = contacts;
  const txs: Tx[] = [
    // Recharges Orange Money / MTN
    { ref: 'DEMO-01', type: 'RECHARGE', amountFcfa: 50_000, receiverId: jean.id, operator: 'ORANGE_MONEY', operatorRef: 'OM-DEMO-01', description: 'Recharge Orange Money', day: 29, hour: 8 },
    { ref: 'DEMO-02', type: 'RECHARGE', amountFcfa: 25_000, receiverId: jean.id, operator: 'MTN_MOMO', operatorRef: 'MTN-DEMO-02', description: 'Recharge MTN MoMo', day: 27, hour: 19 },
    { ref: 'DEMO-03', type: 'RECHARGE', amountFcfa: 100_000, receiverId: jean.id, operator: 'ORANGE_MONEY', operatorRef: 'OM-DEMO-03', description: 'Recharge Orange Money', day: 22, hour: 12 },
    { ref: 'DEMO-04', type: 'RECHARGE', amountFcfa: 15_000, receiverId: jean.id, operator: 'MTN_MOMO', operatorRef: 'MTN-DEMO-04', description: 'Recharge MTN MoMo', day: 16, hour: 9 },
    { ref: 'DEMO-05', type: 'RECHARGE', amountFcfa: 60_000, receiverId: jean.id, operator: 'ORANGE_MONEY', operatorRef: 'OM-DEMO-05', description: 'Recharge Orange Money', day: 9, hour: 18 },
    { ref: 'DEMO-06', type: 'RECHARGE', amountFcfa: 30_000, receiverId: jean.id, operator: 'MTN_MOMO', operatorRef: 'MTN-DEMO-06', description: 'Recharge MTN MoMo', day: 3, hour: 7 },

    // Paiements QR chez le marchand
    { ref: 'DEMO-07', type: 'QR_PAYMENT', amountFcfa: 3_500, senderId: jean.id, receiverId: mboa.id, description: 'Boutique Mboa — courses', day: 28, hour: 13 },
    { ref: 'DEMO-08', type: 'QR_PAYMENT', amountFcfa: 1_200, senderId: jean.id, receiverId: mboa.id, description: 'Boutique Mboa — boissons', day: 26, hour: 17 },
    { ref: 'DEMO-09', type: 'QR_PAYMENT', amountFcfa: 7_800, senderId: jean.id, receiverId: mboa.id, description: 'Boutique Mboa — provisions', day: 21, hour: 11 },
    { ref: 'DEMO-10', type: 'QR_PAYMENT', amountFcfa: 2_000, senderId: jean.id, receiverId: mboa.id, description: 'Boutique Mboa — pain & lait', day: 18, hour: 8 },
    { ref: 'DEMO-11', type: 'QR_PAYMENT', amountFcfa: 4_500, senderId: jean.id, receiverId: mboa.id, description: 'Boutique Mboa — déjeuner', day: 14, hour: 13 },
    { ref: 'DEMO-12', type: 'QR_PAYMENT', amountFcfa: 9_000, senderId: jean.id, receiverId: mboa.id, description: 'Boutique Mboa — électroménager', day: 10, hour: 16 },
    { ref: 'DEMO-13', type: 'QR_PAYMENT', amountFcfa: 1_500, senderId: jean.id, receiverId: mboa.id, description: 'Boutique Mboa — recharge crédit', day: 6, hour: 10 },
    { ref: 'DEMO-14', type: 'QR_PAYMENT', amountFcfa: 5_200, senderId: jean.id, receiverId: mboa.id, description: 'Boutique Mboa — divers', day: 2, hour: 15 },

    // Envois P2P (Jean → contacts)
    { ref: 'DEMO-15', type: 'P2P', amountFcfa: 10_000, senderId: jean.id, receiverId: C[0].id, description: 'Pour Aïcha — transport', day: 25, hour: 14 },
    { ref: 'DEMO-16', type: 'P2P', amountFcfa: 5_000, senderId: jean.id, receiverId: C[1].id, description: 'Remboursement Emmanuel', day: 23, hour: 20 },
    { ref: 'DEMO-17', type: 'P2P', amountFcfa: 15_000, senderId: jean.id, receiverId: C[2].id, description: 'Cotisation tontine', day: 20, hour: 9 },
    { ref: 'DEMO-18', type: 'P2P', amountFcfa: 7_500, senderId: jean.id, receiverId: C[3].id, description: 'Pour Serge', day: 15, hour: 18 },
    { ref: 'DEMO-19', type: 'P2P', amountFcfa: 12_000, senderId: jean.id, receiverId: C[4].id, description: 'Anniversaire Marlène', day: 8, hour: 12 },
    { ref: 'DEMO-20', type: 'P2P', amountFcfa: 3_000, senderId: jean.id, receiverId: C[0].id, description: 'Dépannage Aïcha', day: 4, hour: 21 },

    // Réceptions P2P (contacts → Jean)
    { ref: 'DEMO-21', type: 'P2P', amountFcfa: 20_000, senderId: C[1].id, receiverId: jean.id, description: 'Emmanuel — part loyer', day: 24, hour: 10 },
    { ref: 'DEMO-22', type: 'P2P', amountFcfa: 8_000, senderId: C[2].id, receiverId: jean.id, description: 'Brigitte — remboursement', day: 19, hour: 16 },
    { ref: 'DEMO-23', type: 'P2P', amountFcfa: 6_500, senderId: C[3].id, receiverId: jean.id, description: 'Serge — covoiturage', day: 13, hour: 8 },
    { ref: 'DEMO-24', type: 'P2P', amountFcfa: 25_000, senderId: C[4].id, receiverId: jean.id, description: 'Marlène — vente téléphone', day: 7, hour: 19 },
    { ref: 'DEMO-25', type: 'P2P', amountFcfa: 4_000, senderId: C[0].id, receiverId: jean.id, description: 'Aïcha — retour', day: 1, hour: 11 },

    // Retraits vers OM / MoMo
    { ref: 'DEMO-26', type: 'WITHDRAWAL', amountFcfa: 30_000, senderId: jean.id, operator: 'ORANGE_MONEY', operatorRef: 'OM-WD-26', description: 'Retrait Orange Money', day: 17, hour: 15 },
    { ref: 'DEMO-27', type: 'WITHDRAWAL', amountFcfa: 12_000, senderId: jean.id, operator: 'MTN_MOMO', operatorRef: 'MTN-WD-27', description: 'Retrait MTN MoMo', day: 12, hour: 9 },
    { ref: 'DEMO-28', type: 'WITHDRAWAL', amountFcfa: 20_000, senderId: jean.id, operator: 'ORANGE_MONEY', operatorRef: 'OM-WD-28', description: 'Retrait Orange Money', day: 5, hour: 17 },

    // Recharges complémentaires (variété de dates)
    { ref: 'DEMO-29', type: 'RECHARGE', amountFcfa: 40_000, receiverId: jean.id, operator: 'MTN_MOMO', operatorRef: 'MTN-DEMO-29', description: 'Recharge MTN MoMo', day: 11, hour: 20 },
    { ref: 'DEMO-30', type: 'QR_PAYMENT', amountFcfa: 6_300, senderId: jean.id, receiverId: mboa.id, description: 'Boutique Mboa — épicerie', day: 0, hour: 9 },
  ];

  let created = 0;
  for (const t of txs) {
    const amount = fcfa(t.amountFcfa);
    const fee = t.type === 'QR_PAYMENT' ? qrFee(amount) : 0n;
    const when = daysAgo(t.day, t.hour ?? 10);
    await prisma.transaction.upsert({
      where: { reference: t.ref },
      update: {},
      create: {
        reference: t.ref,
        type: t.type,
        status: 'COMPLETED' as TransactionStatus,
        amount,
        fee,
        senderId: t.senderId,
        receiverId: t.receiverId,
        operator: t.operator,
        operatorRef: t.operatorRef,
        description: t.description,
        processedAt: when,
        createdAt: when,
      },
    });
    created++;
  }

  console.log('✅ Seed démo terminé');
  console.log(`  👤 ${jean.fullName} — ${jean.phone} — solde 150 000 FCFA — PIN 123456`);
  console.log(`  🏪 ${mboa.fullName} — ${mboa.phone} — solde 500 000 FCFA — PIN 123456`);
  console.log(`  📇 ${contacts.length} contacts récents`);
  console.log(`  💳 ${created} transactions sur 30 jours`);
}

main()
  .catch((e) => {
    console.error('❌ Seed démo échoué :', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
