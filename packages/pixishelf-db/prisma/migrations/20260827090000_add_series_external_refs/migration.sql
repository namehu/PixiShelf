CREATE TYPE "SeriesExternalRefStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'NO_DATA', 'FAILED');
CREATE TYPE "SeriesArtworkProvenance" AS ENUM ('SOURCE', 'MANUAL', 'LEGACY');

ALTER TABLE "Series"
  ADD COLUMN "titleOverridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "descriptionOverridden" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "artwork_external_refs"
  ADD COLUMN "seriesSyncStatus" "SeriesExternalRefStatus",
  ADD COLUMN "seriesLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "seriesLastSuccessAt" TIMESTAMP(3),
  ADD COLUMN "seriesLastErrorCode" VARCHAR(80),
  ADD COLUMN "seriesLastError" TEXT,
  ADD COLUMN "seriesLastSystemJobId" TEXT;

CREATE INDEX "artwork_external_refs_providerKey_seriesSyncStatus_seriesLastAttemptAt_idx"
  ON "artwork_external_refs"("providerKey", "seriesSyncStatus", "seriesLastAttemptAt");
CREATE INDEX "artwork_external_refs_seriesLastSystemJobId_idx"
  ON "artwork_external_refs"("seriesLastSystemJobId");

CREATE TABLE "series_external_refs" (
  "id" TEXT NOT NULL,
  "seriesId" INTEGER NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "externalId" TEXT NOT NULL,
  "canonicalUrl" TEXT,
  "sourceTitle" TEXT,
  "status" "SeriesExternalRefStatus",
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "lastError" TEXT,
  "lastSystemJobId" TEXT,
  "observedMemberCount" INTEGER,
  "localMemberCount" INTEGER,
  "missingMemberCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "series_external_refs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "series_external_refs_provider_key_check" CHECK (length(btrim("providerKey")) > 0),
  CONSTRAINT "series_external_refs_external_id_check" CHECK (length(btrim("externalId")) > 0),
  CONSTRAINT "series_external_refs_member_counts_check" CHECK (
    ("observedMemberCount" IS NULL OR "observedMemberCount" >= 0)
    AND ("localMemberCount" IS NULL OR "localMemberCount" >= 0)
    AND ("missingMemberCount" IS NULL OR "missingMemberCount" >= 0)
  )
);

CREATE UNIQUE INDEX "series_external_refs_providerKey_externalId_key"
  ON "series_external_refs"("providerKey", "externalId");
CREATE UNIQUE INDEX "series_external_refs_seriesId_providerKey_key"
  ON "series_external_refs"("seriesId", "providerKey");
CREATE INDEX "series_external_refs_providerKey_status_lastAttemptAt_idx"
  ON "series_external_refs"("providerKey", "status", "lastAttemptAt");
CREATE INDEX "series_external_refs_lastSystemJobId_idx"
  ON "series_external_refs"("lastSystemJobId");

ALTER TABLE "series_external_refs"
  ADD CONSTRAINT "series_external_refs_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "Series"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeriesArtwork"
  ADD COLUMN "sourceOrder" INTEGER,
  ADD COLUMN "orderOverridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "excludedAt" TIMESTAMP(3),
  ADD COLUMN "provenance" "SeriesArtworkProvenance" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "sourceRefId" TEXT;

-- The only supported writer before this migration is the authenticated manual
-- series management service. Keep unexpected non-LOCAL rows conservative.
UPDATE "SeriesArtwork" membership
SET "provenance" = 'MANUAL'
FROM "Series" series
WHERE series.id = membership."seriesId"
  AND upper(btrim(series."source")) = 'LOCAL';

-- Claim an old PIXIV Series only when the external id is unique and at least
-- one member has both a unique Pixiv ArtworkExternalRef and matching retained
-- downloader metadata. Disk-only online snapshots are handled by the Worker.
WITH eligible_series AS MATERIALIZED (
  SELECT series.id AS "seriesId", series."externalId"
  FROM "Series" series
  WHERE upper(btrim(series."source")) = 'PIXIV'
    AND series."externalId" ~ '^[1-9][0-9]*$'
    AND EXISTS (
      SELECT 1
      FROM "SeriesArtwork" membership
      JOIN "artwork_external_refs" artwork_ref
        ON artwork_ref."artworkId" = membership."artworkId"
       AND artwork_ref."providerKey" = 'pixiv'
      JOIN "ArtworkRawMetadata" raw_metadata
        ON raw_metadata."artworkId" = membership."artworkId"
      WHERE membership."seriesId" = series.id
        AND raw_metadata."rawMetadataJson" ->> 'seriesId' = series."externalId"
        AND (
          SELECT count(*)
          FROM "artwork_external_refs" sibling_ref
          WHERE sibling_ref."artworkId" = membership."artworkId"
            AND sibling_ref."providerKey" = 'pixiv'
        ) = 1
    )
),
unique_external_ids AS MATERIALIZED (
  SELECT "externalId"
  FROM eligible_series
  GROUP BY "externalId"
  HAVING count(*) = 1
)
INSERT INTO "series_external_refs" (
  "id",
  "seriesId",
  "providerKey",
  "externalId",
  "createdAt",
  "updatedAt"
)
SELECT
  'series_ref_' || md5('pixiv:' || eligible."externalId"),
  eligible."seriesId",
  'pixiv',
  eligible."externalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM eligible_series eligible
JOIN unique_external_ids unique_id
  ON unique_id."externalId" = eligible."externalId";

WITH unique_pixiv_refs AS MATERIALIZED (
  SELECT "artworkId", min(id) AS id
  FROM "artwork_external_refs"
  WHERE "providerKey" = 'pixiv'
  GROUP BY "artworkId"
  HAVING count(*) = 1
),
source_memberships AS MATERIALIZED (
  SELECT
    membership."seriesId",
    membership."artworkId",
    artwork_ref.id AS "sourceRefId",
    CASE
      WHEN raw_metadata."rawMetadataJson" ->> 'seriesOrder' ~ '^[0-9]+$'
        THEN (raw_metadata."rawMetadataJson" ->> 'seriesOrder')::INTEGER
      ELSE NULL
    END AS "sourceOrder"
  FROM "SeriesArtwork" membership
  JOIN "series_external_refs" series_ref
    ON series_ref."seriesId" = membership."seriesId"
   AND series_ref."providerKey" = 'pixiv'
  JOIN unique_pixiv_refs unique_ref
    ON unique_ref."artworkId" = membership."artworkId"
  JOIN "artwork_external_refs" artwork_ref
    ON artwork_ref.id = unique_ref.id
  JOIN "ArtworkRawMetadata" raw_metadata
    ON raw_metadata."artworkId" = membership."artworkId"
  WHERE raw_metadata."rawMetadataJson" ->> 'seriesId' = series_ref."externalId"
)
UPDATE "SeriesArtwork" membership
SET
  "provenance" = 'SOURCE',
  "sourceRefId" = source_membership."sourceRefId",
  "sourceOrder" = source_membership."sourceOrder",
  "sortOrder" = coalesce(source_membership."sourceOrder", membership."sortOrder")
FROM source_memberships source_membership
WHERE membership."seriesId" = source_membership."seriesId"
  AND membership."artworkId" = source_membership."artworkId";

CREATE UNIQUE INDEX "SeriesArtwork_sourceRefId_key"
  ON "SeriesArtwork"("sourceRefId");
CREATE INDEX "SeriesArtwork_provenance_idx"
  ON "SeriesArtwork"("provenance");
CREATE INDEX "SeriesArtwork_seriesId_excludedAt_sortOrder_idx"
  ON "SeriesArtwork"("seriesId", "excludedAt", "sortOrder");

ALTER TABLE "SeriesArtwork"
  ADD CONSTRAINT "SeriesArtwork_sourceRefId_fkey"
  FOREIGN KEY ("sourceRefId") REFERENCES "artwork_external_refs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeriesArtwork"
  ADD CONSTRAINT "SeriesArtwork_source_provenance_check" CHECK (
    ("provenance" = 'SOURCE' AND "sourceRefId" IS NOT NULL)
    OR ("provenance" <> 'SOURCE' AND "sourceRefId" IS NULL)
  );
