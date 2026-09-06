-- AlterTable
ALTER TABLE "IncidentEvidence" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "relevance" DOUBLE PRECISION,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- CreateIndex
CREATE INDEX "IncidentEvidence_incidentId_occurredAt_idx" ON "IncidentEvidence"("incidentId", "occurredAt");
