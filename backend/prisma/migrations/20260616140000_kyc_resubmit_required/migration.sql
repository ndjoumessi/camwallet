-- Ajout du statut KYC "Nouveau document requis"
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'RESUBMIT_REQUIRED'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'KycStatus')
  ) THEN
    ALTER TYPE "KycStatus" ADD VALUE 'RESUBMIT_REQUIRED';
  END IF;
END $$;
