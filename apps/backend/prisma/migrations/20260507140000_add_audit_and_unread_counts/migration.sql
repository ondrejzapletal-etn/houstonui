-- AlterTable: add unread count cache fields to connector_credentials
ALTER TABLE "connector_credentials"
  ADD COLUMN "unreadCount"          INTEGER,
  ADD COLUMN "unreadCountFetchedAt" TIMESTAMP(3);

-- CreateTable: audit_logs
CREATE TABLE "audit_logs" (
    "id"            TEXT         NOT NULL,
    "userId"        TEXT,
    "action"        TEXT         NOT NULL,
    "connectorType" TEXT,
    "metadata"      JSONB,
    "ipAddress"     TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx"    ON "audit_logs"("userId");
CREATE INDEX "audit_logs_action_idx"    ON "audit_logs"("action");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
