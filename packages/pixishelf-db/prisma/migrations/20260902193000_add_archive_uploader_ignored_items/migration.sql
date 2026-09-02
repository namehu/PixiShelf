CREATE TABLE "archive_uploader_ignored_items" (
  "id" TEXT NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "externalId" VARCHAR(120) NOT NULL,
  "sourceId" TEXT,
  "sourceDisplayName" VARCHAR(180) NOT NULL,
  "title" TEXT NOT NULL,
  "thumbnailUrl" TEXT,
  "uploaderName" VARCHAR(180),
  "postedAt" TIMESTAMP(3),
  "ignoredByUserId" TEXT,
  "ignoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "archive_uploader_ignored_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "archive_uploader_ignored_items_provider_external_key"
  ON "archive_uploader_ignored_items"("providerKey", "externalId");
CREATE INDEX "archive_uploader_ignored_items_ignored_id_idx"
  ON "archive_uploader_ignored_items"("ignoredAt" DESC, "id" DESC);
CREATE INDEX "archive_uploader_ignored_items_source_ignored_idx"
  ON "archive_uploader_ignored_items"("sourceId", "ignoredAt" DESC);

ALTER TABLE "archive_uploader_ignored_items"
  ADD CONSTRAINT "archive_uploader_ignored_items_source_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "archive_uploader_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
