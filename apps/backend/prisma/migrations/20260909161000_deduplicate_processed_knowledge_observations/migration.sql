-- A primary observation is the canonical connector record. It remains primary
-- after entity resolution; additional evidence linked to entities is not primary.
ALTER TABLE "knowledge_observations"
ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- Mark historical root observations, including ones already linked to their
-- canonical external entity, as primary.
UPDATE "knowledge_observations" AS observation
SET "isPrimary" = true
WHERE observation."entityId" IS NULL
   OR EXISTS (
       SELECT 1
       FROM "knowledge_external_links" AS link
       WHERE link."entityId" = observation."entityId"
         AND link."sourceSystem" = observation."sourceSystem"
         AND link."sourceType" = observation."sourceType"
         AND link."sourceRef" = observation."sourceRef"
   );

-- Retain one canonical record for each connector item before enforcing the key.
WITH ranked_observations AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "userId", "sourceSystem", "sourceType", "sourceRef"
            ORDER BY "processed" DESC, "createdAt" DESC, "id" DESC
        ) AS row_number
    FROM "knowledge_observations"
    WHERE "isPrimary" = true
)
DELETE FROM "knowledge_observations"
WHERE "id" IN (
    SELECT "id"
    FROM ranked_observations
    WHERE row_number > 1
);

DROP INDEX IF EXISTS "knowledge_observations_root_source_unique";

CREATE UNIQUE INDEX "knowledge_observations_primary_source_unique"
ON "knowledge_observations"("userId", "sourceSystem", "sourceType", "sourceRef")
WHERE "isPrimary" = true;