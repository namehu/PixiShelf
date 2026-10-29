CREATE TABLE "archive_discovery_deferred_items" (
  "id" TEXT NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "externalId" VARCHAR(120) NOT NULL,
  "sourceId" TEXT,
  "sourceDisplayName" VARCHAR(180) NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "thumbnailUrl" TEXT,
  "uploaderName" VARCHAR(180),
  "postedAt" TIMESTAMP(3),
  "deferredByUserId" TEXT,
  "deferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "archive_discovery_deferred_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "archive_discovery_deferred_provider_external_key"
  ON "archive_discovery_deferred_items"("providerKey", "externalId");
CREATE INDEX "archive_discovery_deferred_date_id_idx"
  ON "archive_discovery_deferred_items"("deferredAt" DESC, "id" DESC);
CREATE INDEX "archive_discovery_deferred_source_idx" ON "archive_discovery_deferred_items"("sourceId");
ALTER TABLE "archive_discovery_deferred_items" ADD CONSTRAINT "archive_discovery_deferred_items_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "archive_uploader_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
