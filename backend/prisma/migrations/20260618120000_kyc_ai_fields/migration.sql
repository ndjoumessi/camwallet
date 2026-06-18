-- Pré-validation KYC par Claude Vision : champs d'analyse IA sur kyc_documents.
-- Additif et non destructif (colonnes nullables + tableau avec défaut vide).
ALTER TABLE "kyc_documents" ADD COLUMN     "aiScore" INTEGER;
ALTER TABLE "kyc_documents" ADD COLUMN     "aiSuggestion" TEXT;
ALTER TABLE "kyc_documents" ADD COLUMN     "aiIssues" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "kyc_documents" ADD COLUMN     "aiAnalyzedAt" TIMESTAMP(3);
