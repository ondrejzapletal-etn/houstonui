-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('OPENAI', 'ANTHROPIC');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "aiProvider" "AiProvider";
