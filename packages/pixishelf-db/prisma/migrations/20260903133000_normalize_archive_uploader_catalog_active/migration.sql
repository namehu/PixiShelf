-- ACTIVE belongs to the 30-day scan audit only. Normalize catalog rows written
-- by the initial backfill or a pre-fix Worker into durable recommendations.
WITH "catalogRecommendations" AS (
  SELECT
    catalog."id",
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM "artwork_external_refs" AS exact_ref
        WHERE exact_ref."providerKey" = catalog."providerKey"
          AND exact_ref."externalId" = catalog."externalId"
      ) THEN 'ARCHIVED'::"ArchiveUploaderScanClassification"
      WHEN jsonb_typeof(catalog."relationships"::jsonb) = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(catalog."relationships"::jsonb) AS relationship
          JOIN "artwork_external_refs" AS replaced_ref
            ON replaced_ref."providerKey" = relationship->>'providerKey'
            AND replaced_ref."externalId" = relationship->>'externalId'
          WHERE relationship->>'direction' = 'OUTBOUND'
            AND relationship->>'providerKey' = catalog."providerKey"
        ) THEN 'REPLACEMENT'::"ArchiveUploaderScanClassification"
      ELSE 'NEW'::"ArchiveUploaderScanClassification"
    END AS "classification",
    EXISTS (
      SELECT 1
      FROM "artwork_external_refs" AS exact_ref
      WHERE exact_ref."providerKey" = catalog."providerKey"
        AND exact_ref."externalId" = catalog."externalId"
    ) AS "hasExactReference"
  FROM "archive_uploader_catalog_items" AS catalog
  WHERE catalog."classification" = 'ACTIVE'
)
UPDATE "archive_uploader_catalog_items" AS catalog
SET
  "classification" = recommendation."classification",
  "comparisonKnown" = NOT recommendation."hasExactReference",
  "changeReasons" = '[]'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "catalogRecommendations" AS recommendation
WHERE catalog."id" = recommendation."id";
