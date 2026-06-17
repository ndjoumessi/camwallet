-- Remplace les index simples senderId / receiverId par des index composés
-- (colonne, createdAt) pour servir l'historique : WHERE (senderId OR receiverId)
-- ORDER BY createdAt DESC. Les composés couvrent aussi les filtres mono-colonne
-- (préfixe), donc les anciens index deviennent redondants.

-- DropIndex
DROP INDEX "transactions_senderId_idx";

-- DropIndex
DROP INDEX "transactions_receiverId_idx";

-- CreateIndex
CREATE INDEX "transactions_senderId_createdAt_idx" ON "transactions"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_receiverId_createdAt_idx" ON "transactions"("receiverId", "createdAt");
