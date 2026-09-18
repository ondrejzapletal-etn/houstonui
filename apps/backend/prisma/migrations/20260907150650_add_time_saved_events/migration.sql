-- CreateTable
CREATE TABLE "time_saved_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_saved_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_saved_events_userId_createdAt_idx" ON "time_saved_events"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "time_saved_events" ADD CONSTRAINT "time_saved_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
