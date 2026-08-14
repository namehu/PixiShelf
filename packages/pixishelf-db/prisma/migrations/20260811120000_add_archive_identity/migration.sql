CREATE TYPE "ArtworkCreationMethod" AS ENUM (
  'UNKNOWN',
  'PIXIV_SCAN',
  'URL_ARCHIVE',
  'LOCAL_DIRECTORY',
  'MANUAL_CREATE'
);

CREATE TYPE "ArtworkTagProvenance" AS ENUM ('SOURCE', 'MANUAL', 'DERIVED', 'LEGACY');
CREATE TYPE "ArchiveImportStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "ArchiveImportItemStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'COMPLETED', 'FAILED');
CREATE TYPE "ArchiveQuality" AS ENUM ('ORIGINAL', 'DISPLAY');
CREATE TYPE "ArtworkRelationType" AS ENUM ('REPLACES');
ALTER TYPE "ArtworkSource" ADD VALUE IF NOT EXISTS 'URL_ARCHIVE';

ALTER TABLE "Artwork"
  ADD COLUMN "storageKey" TEXT,
  ADD COLUMN "createdVia" "ArtworkCreationMethod" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "titleOverridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "descriptionOverridden" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Artwork_storageKey_key" ON "Artwork"("storageKey");
CREATE INDEX "Artwork_createdVia_idx" ON "Artwork"("createdVia");
CREATE INDEX "Artwork_deletedAt_idx" ON "Artwork"("deletedAt");

CREATE TABLE "artwork_external_refs" (
  "id" TEXT NOT NULL,
  "artworkId" INTEGER NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "externalId" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "locator" JSONB NOT NULL,
  "metadataHash" TEXT,
  "fetchedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "artwork_external_refs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "artwork_source_snapshots" (
  "id" TEXT NOT NULL,
  "externalRefId" TEXT NOT NULL,
  "providerSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "normalizedMetadata" JSONB NOT NULL,
  "rawMetadata" JSONB NOT NULL,
  "metadataHash" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "artwork_source_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "artwork_external_refs_providerKey_externalId_key"
  ON "artwork_external_refs"("providerKey", "externalId");
CREATE INDEX "artwork_external_refs_artworkId_idx" ON "artwork_external_refs"("artworkId");
CREATE INDEX "artwork_external_refs_providerKey_fetchedAt_idx"
  ON "artwork_external_refs"("providerKey", "fetchedAt");
CREATE UNIQUE INDEX "artwork_source_snapshots_externalRefId_metadataHash_key"
  ON "artwork_source_snapshots"("externalRefId", "metadataHash");
CREATE INDEX "artwork_source_snapshots_externalRefId_fetchedAt_idx"
  ON "artwork_source_snapshots"("externalRefId", "fetchedAt" DESC);

ALTER TABLE "artwork_external_refs"
  ADD CONSTRAINT "artwork_external_refs_artworkId_fkey"
  FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artwork_source_snapshots"
  ADD CONSTRAINT "artwork_source_snapshots_externalRefId_fkey"
  FOREIGN KEY ("externalRefId") REFERENCES "artwork_external_refs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Tag" ADD COLUMN "namespace" VARCHAR(50) NOT NULL DEFAULT 'general';
DROP INDEX IF EXISTS "Tag_name_key";
CREATE UNIQUE INDEX "Tag_namespace_name_key" ON "Tag"("namespace", "name");

ALTER TABLE "ArtworkTag"
  ADD COLUMN "provenance" "ArtworkTagProvenance" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "sourceRefId" TEXT;
CREATE INDEX "ArtworkTag_sourceRefId_idx" ON "ArtworkTag"("sourceRefId");
CREATE INDEX "ArtworkTag_provenance_idx" ON "ArtworkTag"("provenance");
ALTER TABLE "ArtworkTag"
  ADD CONSTRAINT "ArtworkTag_sourceRefId_fkey"
  FOREIGN KEY ("sourceRefId") REFERENCES "artwork_external_refs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "archive_imports" (
  "id" TEXT NOT NULL,
  "systemJobId" TEXT NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "externalId" TEXT NOT NULL,
  "externalRefId" TEXT,
  "submittedUrl" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "locator" JSONB NOT NULL,
  "status" "ArchiveImportStatus" NOT NULL DEFAULT 'PENDING',
  "requestedQuality" "ArchiveQuality" NOT NULL DEFAULT 'ORIGINAL',
  "selectedQuality" "ArchiveQuality" NOT NULL DEFAULT 'ORIGINAL',
  "decisionCode" VARCHAR(80),
  "normalizedMetadata" JSONB NOT NULL,
  "rawMetadata" JSONB NOT NULL,
  "metadataHash" TEXT NOT NULL,
  "creatorBucket" VARCHAR(180) NOT NULL,
  "stagingPath" TEXT NOT NULL,
  "totalItems" INTEGER NOT NULL DEFAULT 0,
  "completedItems" INTEGER NOT NULL DEFAULT 0,
  "failedItems" INTEGER NOT NULL DEFAULT 0,
  "warning" TEXT,
  "errorCode" VARCHAR(80),
  "errorMessage" TEXT,
  "publishedArtworkId" INTEGER,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "retainUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "archive_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "archive_import_items" (
  "id" TEXT NOT NULL,
  "archiveImportId" TEXT NOT NULL,
  "pageIndex" INTEGER NOT NULL,
  "sourcePageUrl" TEXT NOT NULL,
  "locator" JSONB NOT NULL,
  "expectedFilename" TEXT NOT NULL,
  "status" "ArchiveImportItemStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "stagedPath" TEXT,
  "byteCount" BIGINT,
  "mimeType" VARCHAR(120),
  "quality" "ArchiveQuality",
  "width" INTEGER,
  "height" INTEGER,
  "sha256" VARCHAR(64),
  "errorCode" VARCHAR(80),
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "archive_import_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "archive_preview_sessions" (
  "id" TEXT NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "externalId" TEXT NOT NULL,
  "resolved" JSONB NOT NULL,
  "metadataHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "archive_preview_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "archive_revisions" (
  "id" TEXT NOT NULL,
  "artworkId" INTEGER NOT NULL,
  "externalRefId" TEXT NOT NULL,
  "archiveImportId" TEXT,
  "archivePath" TEXT NOT NULL,
  "manifestPath" TEXT NOT NULL,
  "mediaSnapshot" JSONB NOT NULL,
  "metadataHash" TEXT NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "trashPath" TEXT,
  "trashedAt" TIMESTAMP(3),
  "purgeAfter" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "archive_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "artwork_relations" (
  "id" TEXT NOT NULL,
  "fromArtworkId" INTEGER NOT NULL,
  "toArtworkId" INTEGER NOT NULL,
  "type" "ArtworkRelationType" NOT NULL,
  "providerKey" VARCHAR(50),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "artwork_relations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "archive_imports_systemJobId_key" ON "archive_imports"("systemJobId");
CREATE UNIQUE INDEX "archive_imports_stagingPath_key" ON "archive_imports"("stagingPath");
CREATE INDEX "archive_imports_providerKey_externalId_idx" ON "archive_imports"("providerKey", "externalId");
CREATE INDEX "archive_imports_status_createdAt_idx" ON "archive_imports"("status", "createdAt");
CREATE INDEX "archive_imports_publishedArtworkId_idx" ON "archive_imports"("publishedArtworkId");
CREATE INDEX "archive_imports_externalRefId_idx" ON "archive_imports"("externalRefId");
CREATE INDEX "archive_preview_sessions_expiresAt_idx" ON "archive_preview_sessions"("expiresAt");
CREATE INDEX "archive_preview_sessions_providerKey_externalId_idx"
  ON "archive_preview_sessions"("providerKey", "externalId");
CREATE UNIQUE INDEX "archive_imports_active_provider_identity_key"
  ON "archive_imports"("providerKey", "externalId")
  WHERE "status" IN ('PENDING', 'RUNNING', 'PAUSED', 'CANCELLING');
CREATE UNIQUE INDEX "archive_import_items_archiveImportId_pageIndex_key"
  ON "archive_import_items"("archiveImportId", "pageIndex");
CREATE INDEX "archive_import_items_archiveImportId_status_idx"
  ON "archive_import_items"("archiveImportId", "status");
CREATE UNIQUE INDEX "archive_revisions_archiveImportId_key" ON "archive_revisions"("archiveImportId");
CREATE UNIQUE INDEX "archive_revisions_current_artwork_key" ON "archive_revisions"("artworkId") WHERE "isCurrent" = true;
CREATE INDEX "archive_revisions_artworkId_publishedAt_idx" ON "archive_revisions"("artworkId", "publishedAt" DESC);
CREATE INDEX "archive_revisions_externalRefId_idx" ON "archive_revisions"("externalRefId");
CREATE INDEX "archive_revisions_purgeAfter_idx" ON "archive_revisions"("purgeAfter");
CREATE UNIQUE INDEX "artwork_relations_fromArtworkId_toArtworkId_type_key"
  ON "artwork_relations"("fromArtworkId", "toArtworkId", "type");
CREATE INDEX "artwork_relations_toArtworkId_type_idx" ON "artwork_relations"("toArtworkId", "type");

ALTER TABLE "archive_imports" ADD CONSTRAINT "archive_imports_systemJobId_fkey"
  FOREIGN KEY ("systemJobId") REFERENCES "system_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "archive_imports" ADD CONSTRAINT "archive_imports_externalRefId_fkey"
  FOREIGN KEY ("externalRefId") REFERENCES "artwork_external_refs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "archive_imports" ADD CONSTRAINT "archive_imports_publishedArtworkId_fkey"
  FOREIGN KEY ("publishedArtworkId") REFERENCES "Artwork"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "archive_import_items" ADD CONSTRAINT "archive_import_items_archiveImportId_fkey"
  FOREIGN KEY ("archiveImportId") REFERENCES "archive_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "archive_revisions" ADD CONSTRAINT "archive_revisions_artworkId_fkey"
  FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "archive_revisions" ADD CONSTRAINT "archive_revisions_externalRefId_fkey"
  FOREIGN KEY ("externalRefId") REFERENCES "artwork_external_refs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "archive_revisions" ADD CONSTRAINT "archive_revisions_archiveImportId_fkey"
  FOREIGN KEY ("archiveImportId") REFERENCES "archive_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "artwork_relations" ADD CONSTRAINT "artwork_relations_fromArtworkId_fkey"
  FOREIGN KEY ("fromArtworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artwork_relations" ADD CONSTRAINT "artwork_relations_toArtworkId_fkey"
  FOREIGN KEY ("toArtworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Local e_* identifiers are PixiShelf storage identity, never a Source Reference.
UPDATE "Artwork"
SET "storageKey" = "externalId"
WHERE "externalId" ~ '^e_[0-9]+_[0-9]{7}$';

UPDATE "Artwork"
SET "createdVia" = CASE
  WHEN "source" = 'LOCAL_CREATED' THEN 'MANUAL_CREATE'::"ArtworkCreationMethod"
  WHEN "source" = 'LOCAL_IMPORT' THEN 'LOCAL_DIRECTORY'::"ArtworkCreationMethod"
  WHEN "externalId" ~ '^[0-9]+$'
    AND (
      "metaSource" IS NOT NULL
      OR "metadataFormat" IN ('txt', 'json')
      OR COALESCE("sourceUrl", '') ~* '(^|//)(www\.)?pixiv\.net/'
      OR COALESCE("originalUrl", '') ~* '(^|//)(i\.)?pximg\.net/'
    ) THEN 'PIXIV_SCAN'::"ArtworkCreationMethod"
  ELSE 'UNKNOWN'::"ArtworkCreationMethod"
END;

INSERT INTO "artwork_external_refs" (
  "id", "artworkId", "providerKey", "externalId", "canonicalUrl", "locator", "fetchedAt", "createdAt", "updatedAt"
)
SELECT
  'legacy_pixiv_' || "id"::text,
  "id",
  'pixiv',
  "externalId",
  COALESCE(NULLIF("sourceUrl", ''), 'https://www.pixiv.net/artworks/' || "externalId"),
  jsonb_build_object('artworkId', "externalId"),
  "updatedAt",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Artwork"
WHERE "createdVia" = 'PIXIV_SCAN'
  AND "externalId" ~ '^[0-9]+$'
ON CONFLICT ("providerKey", "externalId") DO NOTHING;
