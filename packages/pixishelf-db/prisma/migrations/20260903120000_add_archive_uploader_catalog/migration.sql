CREATE TYPE "ArchiveUploaderCatalogOutcome" AS ENUM (
  'SUBMITTED',
  'FAILED',
  'CANCELLED',
  'DUPLICATE',
  'ARCHIVED'
);

CREATE TYPE "ArchiveUploaderScanStopReason" AS ENUM (
  'LIMIT_REACHED',
  'WATERMARK_REACHED',
  'REMOTE_END'
);

ALTER TABLE "archive_uploader_scan_runs"
  ADD COLUMN "stopReason" "ArchiveUploaderScanStopReason";

CREATE TABLE "archive_uploader_catalog_items" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "externalId" VARCHAR(120) NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "thumbnailUrl" TEXT,
  "uploaderName" VARCHAR(180),
  "postedAt" TIMESTAMP(3),
  "relationships" JSONB NOT NULL,
  "classification" "ArchiveUploaderScanClassification" NOT NULL,
  "changeReasons" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "comparisonSnapshot" JSONB,
  "comparisonFingerprint" VARCHAR(64),
  "comparisonKnown" BOOLEAN NOT NULL DEFAULT false,
  "firstSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "lastScanRunId" TEXT,
  "lastIntakeItemId" TEXT,
  "lastArchiveImportId" TEXT,
  "lastOutcome" "ArchiveUploaderCatalogOutcome",
  "lastOutcomeAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "lastErrorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "archive_uploader_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "archive_uploader_catalog_items_source_provider_external_key"
  ON "archive_uploader_catalog_items"("sourceId", "providerKey", "externalId");
CREATE INDEX "archive_uploader_catalog_items_source_seen_id_idx"
  ON "archive_uploader_catalog_items"("sourceId", "lastSeenAt" DESC, "id" DESC);
CREATE INDEX "archive_uploader_catalog_items_source_classification_seen_idx"
  ON "archive_uploader_catalog_items"("sourceId", "classification", "lastSeenAt" DESC);
CREATE INDEX "archive_uploader_catalog_items_source_outcome_seen_idx"
  ON "archive_uploader_catalog_items"("sourceId", "lastOutcome", "lastSeenAt" DESC);
CREATE INDEX "archive_uploader_catalog_items_provider_external_idx"
  ON "archive_uploader_catalog_items"("providerKey", "externalId");
CREATE INDEX "archive_uploader_catalog_items_last_scan_run_idx"
  ON "archive_uploader_catalog_items"("lastScanRunId");
CREATE INDEX "archive_uploader_catalog_items_last_intake_item_idx"
  ON "archive_uploader_catalog_items"("lastIntakeItemId");
CREATE INDEX "archive_uploader_catalog_items_last_archive_import_idx"
  ON "archive_uploader_catalog_items"("lastArchiveImportId");

ALTER TABLE "archive_uploader_catalog_items"
  ADD CONSTRAINT "archive_uploader_catalog_items_source_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "archive_uploader_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "archive_uploader_catalog_items"
  ADD CONSTRAINT "archive_uploader_catalog_items_last_scan_run_fkey"
  FOREIGN KEY ("lastScanRunId") REFERENCES "archive_uploader_scan_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "archive_uploader_catalog_items"
  ADD CONSTRAINT "archive_uploader_catalog_items_last_intake_item_fkey"
  FOREIGN KEY ("lastIntakeItemId") REFERENCES "archive_intake_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "archive_uploader_catalog_items"
  ADD CONSTRAINT "archive_uploader_catalog_items_last_archive_import_fkey"
  FOREIGN KEY ("lastArchiveImportId") REFERENCES "archive_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH completed_items AS (
  SELECT
    scan_item.*,
    scan_run."sourceId",
    MIN(scan_item."createdAt") OVER (
      PARTITION BY scan_run."sourceId", scan_item."providerKey", scan_item."externalId"
    ) AS "firstSeenAt",
    MAX(scan_item."createdAt") OVER (
      PARTITION BY scan_run."sourceId", scan_item."providerKey", scan_item."externalId"
    ) AS "lastSeenAt",
    ROW_NUMBER() OVER (
      PARTITION BY scan_run."sourceId", scan_item."providerKey", scan_item."externalId"
      ORDER BY COALESCE(scan_run."finishedAt", scan_run."createdAt") DESC,
        scan_item."createdAt" DESC,
        scan_item."id" DESC
    ) AS item_rank
  FROM "archive_uploader_scan_items" AS scan_item
  INNER JOIN "archive_uploader_scan_runs" AS scan_run
    ON scan_run."id" = scan_item."runId"
  WHERE scan_run."status" = 'COMPLETED'
), latest_items AS (
  SELECT *
  FROM completed_items
  WHERE item_rank = 1
), catalog_seed AS (
  SELECT
    latest_item.*,
    artwork_ref."id" AS "artworkExternalRefId",
    artwork_ref."lastSuccessAt" AS "artworkLastSuccessAt",
    artwork_ref."updatedAt" AS "artworkUpdatedAt",
    intake_item."id" AS "resolvedIntakeItemId",
    intake_item."status" AS "intakeStatus",
    intake_item."finishedAt" AS "intakeFinishedAt",
    intake_item."updatedAt" AS "intakeUpdatedAt",
    intake_item."errorCode" AS "intakeErrorCode",
    intake_item."errorMessage" AS "intakeErrorMessage",
    archive_import."id" AS "resolvedArchiveImportId",
    archive_import."status" AS "archiveImportStatus",
    archive_import."finishedAt" AS "archiveImportFinishedAt",
    archive_import."updatedAt" AS "archiveImportUpdatedAt",
    archive_import."errorCode" AS "archiveImportErrorCode",
    archive_import."errorMessage" AS "archiveImportErrorMessage"
  FROM latest_items AS latest_item
  LEFT JOIN "artwork_external_refs" AS artwork_ref
    ON artwork_ref."providerKey" = latest_item."providerKey"
    AND artwork_ref."externalId" = latest_item."externalId"
  LEFT JOIN LATERAL (
    SELECT candidate.*
    FROM "archive_intake_items" AS candidate
    WHERE candidate."id" = latest_item."intakeItemId"
      OR (
        candidate."providerKey" = latest_item."providerKey"
        AND candidate."externalId" = latest_item."externalId"
      )
    ORDER BY candidate."updatedAt" DESC, candidate."createdAt" DESC, candidate."id" DESC
    LIMIT 1
  ) AS intake_item ON true
  LEFT JOIN LATERAL (
    SELECT candidate.*
    FROM "archive_imports" AS candidate
    WHERE candidate."providerKey" = latest_item."providerKey"
      AND candidate."externalId" = latest_item."externalId"
    ORDER BY candidate."updatedAt" DESC, candidate."createdAt" DESC, candidate."id" DESC
    LIMIT 1
  ) AS archive_import ON true
)
INSERT INTO "archive_uploader_catalog_items" (
  "id",
  "sourceId",
  "providerKey",
  "externalId",
  "canonicalUrl",
  "title",
  "thumbnailUrl",
  "uploaderName",
  "postedAt",
  "relationships",
  "classification",
  "changeReasons",
  "comparisonSnapshot",
  "comparisonFingerprint",
  "comparisonKnown",
  "firstSeenAt",
  "lastSeenAt",
  "lastScanRunId",
  "lastIntakeItemId",
  "lastArchiveImportId",
  "lastOutcome",
  "lastOutcomeAt",
  "lastErrorCode",
  "lastErrorMessage",
  "createdAt",
  "updatedAt"
)
SELECT
  'auc_' || md5(
    catalog_seed."sourceId" || E'\x1f' || catalog_seed."providerKey" || E'\x1f' || catalog_seed."externalId"
  ),
  catalog_seed."sourceId",
  catalog_seed."providerKey",
  catalog_seed."externalId",
  catalog_seed."canonicalUrl",
  catalog_seed."title",
  catalog_seed."thumbnailUrl",
  catalog_seed."uploaderName",
  catalog_seed."postedAt",
  catalog_seed."relationships",
  CASE
    WHEN catalog_seed."artworkExternalRefId" IS NOT NULL THEN 'ARCHIVED'::"ArchiveUploaderScanClassification"
    ELSE catalog_seed."classification"
  END,
  '[]'::JSONB,
  NULL,
  NULL,
  false,
  catalog_seed."firstSeenAt",
  catalog_seed."lastSeenAt",
  catalog_seed."runId",
  catalog_seed."resolvedIntakeItemId",
  catalog_seed."resolvedArchiveImportId",
  CASE
    WHEN catalog_seed."artworkExternalRefId" IS NOT NULL
      OR catalog_seed."archiveImportStatus" = 'COMPLETED'
      THEN 'ARCHIVED'::"ArchiveUploaderCatalogOutcome"
    WHEN catalog_seed."intakeStatus" = 'DUPLICATE'
      THEN 'DUPLICATE'::"ArchiveUploaderCatalogOutcome"
    WHEN catalog_seed."archiveImportStatus" = 'FAILED'
      OR catalog_seed."intakeStatus" = 'FAILED'
      THEN 'FAILED'::"ArchiveUploaderCatalogOutcome"
    WHEN catalog_seed."archiveImportStatus" = 'CANCELLED'
      OR catalog_seed."intakeStatus" = 'CANCELLED'
      THEN 'CANCELLED'::"ArchiveUploaderCatalogOutcome"
    WHEN catalog_seed."resolvedIntakeItemId" IS NOT NULL
      OR catalog_seed."resolvedArchiveImportId" IS NOT NULL
      THEN 'SUBMITTED'::"ArchiveUploaderCatalogOutcome"
    ELSE NULL
  END,
  CASE
    WHEN catalog_seed."artworkExternalRefId" IS NOT NULL
      OR catalog_seed."archiveImportStatus" = 'COMPLETED'
      THEN COALESCE(
        catalog_seed."archiveImportFinishedAt",
        catalog_seed."artworkLastSuccessAt",
        catalog_seed."archiveImportUpdatedAt",
        catalog_seed."artworkUpdatedAt"
      )
    ELSE COALESCE(
      catalog_seed."archiveImportFinishedAt",
      catalog_seed."intakeFinishedAt",
      catalog_seed."archiveImportUpdatedAt",
      catalog_seed."intakeUpdatedAt"
    )
  END,
  CASE
    WHEN catalog_seed."artworkExternalRefId" IS NOT NULL
      OR catalog_seed."archiveImportStatus" = 'COMPLETED'
      THEN NULL
    ELSE COALESCE(catalog_seed."archiveImportErrorCode", catalog_seed."intakeErrorCode")
  END,
  CASE
    WHEN catalog_seed."artworkExternalRefId" IS NOT NULL
      OR catalog_seed."archiveImportStatus" = 'COMPLETED'
      THEN NULL
    ELSE COALESCE(catalog_seed."archiveImportErrorMessage", catalog_seed."intakeErrorMessage")
  END,
  catalog_seed."firstSeenAt",
  catalog_seed."lastSeenAt"
FROM catalog_seed;
