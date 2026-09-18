CREATE TABLE "slack_read_cursors" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_read_cursors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "slack_read_cursors_userId_channelId_key"
    ON "slack_read_cursors"("userId", "channelId");

CREATE INDEX "slack_read_cursors_userId_idx"
    ON "slack_read_cursors"("userId");

ALTER TABLE "slack_read_cursors"
    ADD CONSTRAINT "slack_read_cursors_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;