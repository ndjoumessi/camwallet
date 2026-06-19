-- Montant de la transaction source sur les gains de fidélité (nullable, rétrocompat).
ALTER TABLE "loyalty_events" ADD COLUMN IF NOT EXISTS "amountCentimes" BIGINT;
