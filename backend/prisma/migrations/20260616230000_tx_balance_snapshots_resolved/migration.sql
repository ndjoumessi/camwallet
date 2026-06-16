-- Instantanés de solde émetteur + marquage de résolution sur les transactions.
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "senderBalanceBefore" BIGINT;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "senderBalanceAfter" BIGINT;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "resolved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "resolvedBy" TEXT;
