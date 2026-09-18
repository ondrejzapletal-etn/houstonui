ALTER TABLE "users"
ADD COLUMN "jiraWorklogsCount" INTEGER,
ADD COLUMN "jiraWorklogsSeconds" INTEGER,
ADD COLUMN "jiraWorklogsStatsUpdatedAt" TIMESTAMP(3);