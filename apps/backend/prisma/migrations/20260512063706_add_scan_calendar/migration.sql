-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "ConnectorType" ADD VALUE 'CALENDAR';

-- CreateTable
CREATE TABLE "scan_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "scan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "draft" TEXT,
    "url" TEXT,
    "externalId" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "risk" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scan_runs_userId_idx" ON "scan_runs"("userId");

-- CreateIndex
CREATE INDEX "scan_runs_status_idx" ON "scan_runs"("status");

-- CreateIndex
CREATE INDEX "proposals_userId_idx" ON "proposals"("userId");

-- CreateIndex
CREATE INDEX "proposals_scanRunId_idx" ON "proposals"("scanRunId");

-- CreateIndex
CREATE INDEX "proposals_status_idx" ON "proposals"("status");

-- AddForeignKey
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
