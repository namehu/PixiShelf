-- The catalog backfill initially preferred any published artwork over later
-- intake/import failures. Re-rank every durable summary by the latest workflow
-- event so cleanup of the short-lived workflow rows cannot reveal a stale state.
WITH "catalogOutcomeCandidates" AS (
  SELECT
    catalog."id" AS "catalogId",
    latest_event."outcome",
    latest_event."eventAt",
    latest_event."errorCode",
    latest_event."errorMessage"
  FROM "archive_uploader_catalog_items" AS catalog
  LEFT JOIN LATERAL (
    SELECT candidate.*
    FROM (
      SELECT
        CASE intake_item."status"
          WHEN 'FAILED' THEN 'FAILED'::"ArchiveUploaderCatalogOutcome"
          WHEN 'CANCELLED' THEN 'CANCELLED'::"ArchiveUploaderCatalogOutcome"
          WHEN 'DUPLICATE' THEN 'DUPLICATE'::"ArchiveUploaderCatalogOutcome"
          ELSE 'SUBMITTED'::"ArchiveUploaderCatalogOutcome"
        END AS "outcome",
        COALESCE(intake_item."finishedAt", intake_item."updatedAt", intake_item."createdAt") AS "eventAt",
        intake_item."errorCode" AS "errorCode",
        intake_item."errorMessage" AS "errorMessage",
        20 AS "eventPriority",
        'intake:' || intake_item."id" AS "eventId"
      FROM "archive_intake_items" AS intake_item
      WHERE (
          intake_item."providerKey" = catalog."providerKey"
          AND intake_item."externalId" = catalog."externalId"
        )
        OR intake_item."submittedUrl" = catalog."canonicalUrl"
        OR intake_item."canonicalUrl" = catalog."canonicalUrl"

      UNION ALL

      SELECT
        CASE archive_import."status"
          WHEN 'COMPLETED' THEN 'ARCHIVED'::"ArchiveUploaderCatalogOutcome"
          WHEN 'FAILED' THEN 'FAILED'::"ArchiveUploaderCatalogOutcome"
          WHEN 'CANCELLED' THEN 'CANCELLED'::"ArchiveUploaderCatalogOutcome"
          ELSE 'SUBMITTED'::"ArchiveUploaderCatalogOutcome"
        END AS "outcome",
        COALESCE(archive_import."finishedAt", archive_import."updatedAt", archive_import."createdAt") AS "eventAt",
        archive_import."errorCode" AS "errorCode",
        archive_import."errorMessage" AS "errorMessage",
        30 AS "eventPriority",
        'import:' || archive_import."id" AS "eventId"
      FROM "archive_imports" AS archive_import
      WHERE archive_import."providerKey" = catalog."providerKey"
        AND archive_import."externalId" = catalog."externalId"

      UNION ALL

      SELECT
        'ARCHIVED'::"ArchiveUploaderCatalogOutcome" AS "outcome",
        COALESCE(external_ref."lastSuccessAt", external_ref."updatedAt", external_ref."createdAt") AS "eventAt",
        NULL::VARCHAR(80) AS "errorCode",
        NULL::TEXT AS "errorMessage",
        10 AS "eventPriority",
        'reference:' || external_ref."id" AS "eventId"
      FROM "artwork_external_refs" AS external_ref
      WHERE external_ref."providerKey" = catalog."providerKey"
        AND external_ref."externalId" = catalog."externalId"

      UNION ALL

      SELECT
        catalog."lastOutcome" AS "outcome",
        catalog."lastOutcomeAt" AS "eventAt",
        catalog."lastErrorCode" AS "errorCode",
        catalog."lastErrorMessage" AS "errorMessage",
        5 AS "eventPriority",
        'catalog:' || catalog."id" AS "eventId"
      WHERE catalog."lastOutcome" IS NOT NULL
        AND catalog."lastOutcomeAt" IS NOT NULL
    ) AS candidate
    ORDER BY candidate."eventAt" DESC, candidate."eventPriority" DESC, candidate."eventId" DESC
    LIMIT 1
  ) AS latest_event ON TRUE
)
UPDATE "archive_uploader_catalog_items" AS catalog
SET
  "lastOutcome" = candidate."outcome",
  "lastOutcomeAt" = candidate."eventAt",
  "lastErrorCode" = CASE
    WHEN candidate."outcome" IN ('FAILED', 'CANCELLED', 'DUPLICATE')
      THEN candidate."errorCode"
    ELSE NULL
  END,
  "lastErrorMessage" = CASE
    WHEN candidate."outcome" IN ('FAILED', 'CANCELLED', 'DUPLICATE')
      THEN candidate."errorMessage"
    ELSE NULL
  END
FROM "catalogOutcomeCandidates" AS candidate
WHERE catalog."id" = candidate."catalogId"
  AND candidate."outcome" IS NOT NULL;
