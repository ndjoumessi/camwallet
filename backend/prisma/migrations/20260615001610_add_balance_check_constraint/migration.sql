-- Contrainte CHECK : le solde du portefeuille ne peut pas être négatif
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_non_negative" CHECK (balance >= 0);
