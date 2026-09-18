-- AlterTable
ALTER TABLE "proposals" ADD COLUMN "topicKey" TEXT;

-- CreateIndex
CREATE INDEX "proposals_userId_topicKey_idx" ON "proposals"("userId", "topicKey");

-- Prevent concurrent scans from creating multiple pending proposals for one topic.
-- Existing rows keep a NULL topicKey and are intentionally not deduplicated.
CREATE UNIQUE INDEX "proposals_userId_pending_topicKey_key"
ON "proposals"("userId", "topicKey")
WHERE "status" = 'PENDING' AND "topicKey" IS NOT NULL;
