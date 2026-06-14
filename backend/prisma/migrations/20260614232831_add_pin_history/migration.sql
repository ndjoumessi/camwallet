-- AlterTable
ALTER TABLE "users" ADD COLUMN     "previousPinHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];
