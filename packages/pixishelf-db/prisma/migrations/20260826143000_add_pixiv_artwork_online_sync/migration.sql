CREATE TYPE "ArtworkExternalRefStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'NO_DATA', 'FAILED');

ALTER TABLE "artwork_external_refs"
  ADD COLUMN "status" "ArtworkExternalRefStatus",
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastSuccessAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorCode" VARCHAR(80),
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "lastSystemJobId" TEXT,
  ADD COLUMN "onlineSnapshotHash" VARCHAR(64),
  ADD COLUMN "onlineSnapshotPath" TEXT;

ALTER TABLE "artwork_external_refs"
  ADD CONSTRAINT "artwork_external_refs_online_snapshot_hash_check"
  CHECK (
    "onlineSnapshotHash" IS NULL
    OR "onlineSnapshotHash" ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT "artwork_external_refs_online_snapshot_pair_check"
  CHECK (
    ("onlineSnapshotHash" IS NULL) = ("onlineSnapshotPath" IS NULL)
  );

CREATE INDEX "artwork_external_refs_providerKey_status_lastAttemptAt_idx"
  ON "artwork_external_refs"("providerKey", "status", "lastAttemptAt");
CREATE INDEX "artwork_external_refs_lastSystemJobId_idx"
  ON "artwork_external_refs"("lastSystemJobId");

-- The editor historically submitted title and description even when only another
-- field changed. Clear those false-positive override flags only where one unique
-- Pixiv reference and its latest persisted source snapshot prove exact equality.
WITH unique_pixiv_refs AS MATERIALIZED (
  SELECT "artworkId", min("id") AS "externalRefId"
  FROM "artwork_external_refs"
  WHERE "providerKey" = 'pixiv'
  GROUP BY "artworkId"
  HAVING count(*) = 1
),
latest_snapshots AS MATERIALIZED (
  SELECT DISTINCT ON (ref."artworkId")
    ref."artworkId",
    snapshot."normalizedMetadata"
  FROM unique_pixiv_refs ref
  JOIN "artwork_source_snapshots" snapshot
    ON snapshot."externalRefId" = ref."externalRefId"
  ORDER BY
    ref."artworkId",
    snapshot."fetchedAt" DESC,
    snapshot."createdAt" DESC,
    snapshot."id" DESC
)
UPDATE "Artwork" artwork
SET "titleOverridden" = false
FROM latest_snapshots snapshot
WHERE artwork."id" = snapshot."artworkId"
  AND artwork."titleOverridden" = true
  AND snapshot."normalizedMetadata" ? 'title'
  AND artwork."title" IS NOT DISTINCT FROM snapshot."normalizedMetadata" ->> 'title';

WITH unique_pixiv_refs AS MATERIALIZED (
  SELECT "artworkId", min("id") AS "externalRefId"
  FROM "artwork_external_refs"
  WHERE "providerKey" = 'pixiv'
  GROUP BY "artworkId"
  HAVING count(*) = 1
),
latest_snapshots AS MATERIALIZED (
  SELECT DISTINCT ON (ref."artworkId")
    ref."artworkId",
    snapshot."normalizedMetadata"
  FROM unique_pixiv_refs ref
  JOIN "artwork_source_snapshots" snapshot
    ON snapshot."externalRefId" = ref."externalRefId"
  ORDER BY
    ref."artworkId",
    snapshot."fetchedAt" DESC,
    snapshot."createdAt" DESC,
    snapshot."id" DESC
)
UPDATE "Artwork" artwork
SET "descriptionOverridden" = false
FROM latest_snapshots snapshot
WHERE artwork."id" = snapshot."artworkId"
  AND artwork."descriptionOverridden" = true
  AND snapshot."normalizedMetadata" ? 'description'
  AND artwork."description" IS NOT DISTINCT FROM snapshot."normalizedMetadata" ->> 'description';
