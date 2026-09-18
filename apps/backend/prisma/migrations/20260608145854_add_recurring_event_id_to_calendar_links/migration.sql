-- AlterTable
ALTER TABLE "calendar_event_issue_links" ADD COLUMN     "recurringEventId" TEXT;

-- CreateIndex
CREATE INDEX "calendar_event_issue_links_userId_recurringEventId_idx" ON "calendar_event_issue_links"("userId", "recurringEventId");
