-- CreateTable
CREATE TABLE "knowledge_entities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_external_links" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "knowledge_external_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_relations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_observations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scanRunId" TEXT,
    "entityId" TEXT,
    "sourceSystem" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "content" TEXT,
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_facts" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_derived_states" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT,
    "insights" JSONB,
    "urgencyScore" DOUBLE PRECISION,
    "riskScore" DOUBLE PRECISION,
    "relatedIds" TEXT[],
    "modelVersion" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "knowledge_derived_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_entities_userId_type_idx" ON "knowledge_entities"("userId", "type");

-- CreateIndex
CREATE INDEX "knowledge_external_links_entityId_idx" ON "knowledge_external_links"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_external_links_sourceSystem_sourceType_sourceRef_key" ON "knowledge_external_links"("sourceSystem", "sourceType", "sourceRef");

-- CreateIndex
CREATE INDEX "knowledge_relations_fromEntityId_idx" ON "knowledge_relations"("fromEntityId");

-- CreateIndex
CREATE INDEX "knowledge_relations_toEntityId_idx" ON "knowledge_relations"("toEntityId");

-- CreateIndex
CREATE INDEX "knowledge_relations_userId_idx" ON "knowledge_relations"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_relations_fromEntityId_toEntityId_relationType_key" ON "knowledge_relations"("fromEntityId", "toEntityId", "relationType");

-- CreateIndex
CREATE INDEX "knowledge_observations_userId_processed_idx" ON "knowledge_observations"("userId", "processed");

-- CreateIndex
CREATE INDEX "knowledge_observations_sourceSystem_sourceRef_idx" ON "knowledge_observations"("sourceSystem", "sourceRef");

-- CreateIndex
CREATE INDEX "knowledge_observations_scanRunId_idx" ON "knowledge_observations"("scanRunId");

-- CreateIndex
CREATE INDEX "knowledge_facts_entityId_idx" ON "knowledge_facts"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_facts_entityId_key_key" ON "knowledge_facts"("entityId", "key");

-- CreateIndex
CREATE INDEX "knowledge_events_entityId_idx" ON "knowledge_events"("entityId");

-- CreateIndex
CREATE INDEX "knowledge_events_userId_createdAt_idx" ON "knowledge_events"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_derived_states_entityId_key" ON "knowledge_derived_states"("entityId");

-- AddForeignKey
ALTER TABLE "knowledge_entities" ADD CONSTRAINT "knowledge_entities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_external_links" ADD CONSTRAINT "knowledge_external_links_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "knowledge_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_relations" ADD CONSTRAINT "knowledge_relations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_relations" ADD CONSTRAINT "knowledge_relations_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "knowledge_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_relations" ADD CONSTRAINT "knowledge_relations_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "knowledge_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_observations" ADD CONSTRAINT "knowledge_observations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_observations" ADD CONSTRAINT "knowledge_observations_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "scan_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_observations" ADD CONSTRAINT "knowledge_observations_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "knowledge_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_facts" ADD CONSTRAINT "knowledge_facts_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "knowledge_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_events" ADD CONSTRAINT "knowledge_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_events" ADD CONSTRAINT "knowledge_events_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "knowledge_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_derived_states" ADD CONSTRAINT "knowledge_derived_states_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "knowledge_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
