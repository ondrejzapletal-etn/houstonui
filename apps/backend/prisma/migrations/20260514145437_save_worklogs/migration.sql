-- AlterTable
ALTER TABLE "users" ADD COLUMN     "worklogsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "worklogsSeconds" INTEGER NOT NULL DEFAULT 0;
