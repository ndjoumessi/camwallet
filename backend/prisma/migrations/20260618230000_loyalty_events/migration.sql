-- CreateTable : journal des gains de points (programme de fidélité)
CREATE TABLE IF NOT EXISTS "loyalty_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "loyalty_events_userId_createdAt_idx" ON "loyalty_events"("userId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "loyalty_events" ADD CONSTRAINT "loyalty_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
