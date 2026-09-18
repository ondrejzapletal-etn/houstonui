/*
  Warnings:

  - You are about to drop the column `scans_count` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "scans_count",
ADD COLUMN     "scansCount" INTEGER NOT NULL DEFAULT 0;
