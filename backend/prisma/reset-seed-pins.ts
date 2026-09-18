// Script de récupération ponctuel — réécrit le PIN des comptes seed au format
// pepper COURANT et lève tout verrou. À lancer via `railway run` pour bénéficier
// du PIN_PEPPER + DATABASE_URL de prod. Idempotent et re-lançable.
//
//   railway run npx ts-node prisma/reset-seed-pins.ts
//
// Contexte : une rotation involontaire de PIN_PEPPER a rendu invérifiables les
// hash existants (le seed.ts upsert avec `update: {}` ne les réécrit pas).
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

const PHONES = ['+237677000001', '+237699000002', '+237699999999'];
const COST = parseInt(process.env.PIN_BCRYPT_COST ?? '10', 10);

// Identique à AuthService.pepperPin : HMAC-SHA256(pin, PIN_PEPPER) avant bcrypt.
function pepperPin(pin: string): string {
  const secret = process.env.PIN_PEPPER;
  if (!secret) return pin; // dev/local : PIN brut (le fallback login migrera)
  return crypto.createHmac('sha256', secret).update(pin).digest('hex');
}

async function main() {
  const hasPepper = !!process.env.PIN_PEPPER;
  console.log(`🔧 Reset PIN seed — PIN_PEPPER ${hasPepper ? 'présent ✅' : 'ABSENT ⚠️ (hash raw)'} | bcrypt cost ${COST}`);
  const pinHash = await bcrypt.hash(pepperPin('123456'), COST);

  for (const phone of PHONES) {
    const res = await prisma.user.updateMany({
      where: { phone },
      data: { pinHash, pinAttempts: 0, lockedUntil: null },
    });
    console.log(`  ${phone} → ${res.count} compte(s) mis à jour`);
  }
  console.log('✅ Terminé — PIN = 123456, verrou levé sur les comptes seed');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
