-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_orgId_idempotencyKey_key" ON "AgentRun"("orgId", "idempotencyKey");