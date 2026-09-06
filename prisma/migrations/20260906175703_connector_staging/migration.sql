-- CreateEnum
CREATE TYPE "StagedRecordStatus" AS ENUM ('STAGED', 'PROMOTED', 'REJECTED');

-- CreateTable
CREATE TABLE "StagedRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'dodo',
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" DECIMAL(14,2) NOT NULL,
    "customerExternalId" TEXT,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "status" "StagedRecordStatus" NOT NULL DEFAULT 'STAGED',
    "raw" JSONB NOT NULL DEFAULT '{}',
    "promotedId" TEXT,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StagedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StagedRecord_orgId_idx" ON "StagedRecord"("orgId");

-- CreateIndex
CREATE INDEX "StagedRecord_orgId_provider_status_idx" ON "StagedRecord"("orgId", "provider", "status");

-- CreateIndex
CREATE INDEX "StagedRecord_orgId_provider_occurredAt_idx" ON "StagedRecord"("orgId", "provider", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "StagedRecord_orgId_provider_kind_externalId_key" ON "StagedRecord"("orgId", "provider", "kind", "externalId");

-- AddForeignKey
ALTER TABLE "StagedRecord" ADD CONSTRAINT "StagedRecord_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
