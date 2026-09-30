-- Read-only verification after 20260930120000_retire_artist_legacy_identity.
-- This file intentionally uses only the current schema.

SELECT
  ref."providerKey",
  count(*) AS identity_count,
  count(DISTINCT ref."artistId") AS artist_count,
  count(*) FILTER (WHERE ref.status IS NULL) AS unchecked_count
FROM artist_external_refs ref
GROUP BY ref."providerKey"
ORDER BY ref."providerKey";

SELECT count(*) AS duplicate_provider_identity_count
FROM (
  SELECT "artistId", "providerKey"
  FROM artist_external_refs
  GROUP BY "artistId", "providerKey"
  HAVING count(*) > 1
) duplicate_rows;

SELECT count(*) AS duplicate_external_identity_count
FROM (
  SELECT "providerKey", "externalId"
  FROM artist_external_refs
  GROUP BY "providerKey", "externalId"
  HAVING count(*) > 1
) duplicate_rows;

SELECT count(*) AS merged_artist_identity_count
FROM artist_external_refs ref
JOIN "Artist" artist ON artist.id = ref."artistId"
WHERE artist."mergedIntoId" IS NOT NULL;

SELECT count(*) AS artwork_without_durable_storage_path_count
FROM "Artwork"
WHERE "artistId" IS NOT NULL
  AND "storagePath" IS NULL;
