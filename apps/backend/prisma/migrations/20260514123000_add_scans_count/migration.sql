-- Add scans_count to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS scans_count integer NOT NULL DEFAULT 0;