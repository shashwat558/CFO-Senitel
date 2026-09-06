-- AlterTable
ALTER TABLE "FinancialIncident" ADD COLUMN "assignedToId" TEXT;

-- AlterTable
ALTER TABLE "IncidentAction" ADD COLUMN "verificationResult" JSONB;

-- CreateIndex
CREATE INDEX "FinancialIncident_assignedToId_idx" ON "FinancialIncident"("assignedToId");

-- AddForeignKey
ALTER TABLE "FinancialIncident" ADD CONSTRAINT "FinancialIncident_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;