-- Keep the newest processed connector observation for each source item.
-- Entity-linked observations are intentionally retained: one message or event
-- may provide evidence for multiple knowledge entities.
WITH ranked_observations AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "userId", "sourceSystem", "sourceType", "sourceRef"
            ORDER BY "processed" DESC, "createdAt" DESC, "id" DESC
        ) AS row_number
    FROM "knowledge_observations"
    WHERE "entityId" IS NULL
)
DELETE FROM "knowledge_observations"
WHERE "id" IN (
    SELECT "id"
    FROM ranked_observations
    WHERE row_number > 1
);

-- PostgreSQL partial unique index: root observations are idempotent across scans.
CREATE UNIQUE INDEX "knowledge_observations_root_source_unique"
ON "knowledge_observations"("userId", "sourceSystem", "sourceType", "sourceRef")
WHERE "entityId" IS NULL;