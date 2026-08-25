-- Read-only verification after 20260825103000_add_artist_external_refs.

SELECT
  ref."providerKey",
  count(*) AS identity_count,
  count(DISTINCT ref."artistId") AS artist_count,
  count(*) FILTER (WHERE ref.status IS NULL) AS unchecked_count
FROM "artist_external_refs" ref
GROUP BY ref."providerKey"
ORDER BY ref."providerKey";

WITH unique_legacy_ids AS MATERIALIZED (
  SELECT "userId"
  FROM "Artist"
  WHERE "userId" ~ '^[1-9][0-9]*$'
  GROUP BY "userId"
  HAVING count(*) = 1
),
expected_claims AS MATERIALIZED (
  SELECT DISTINCT artist.id AS artist_id, artist."userId" AS external_id
  FROM "Artist" artist
  JOIN unique_legacy_ids unique_id ON unique_id."userId" = artist."userId"
  JOIN "Artwork" artwork ON artwork."artistId" = artist.id
  JOIN "artwork_external_refs" artwork_ref
    ON artwork_ref."artworkId" = artwork.id
   AND artwork_ref."providerKey" = 'pixiv'
)
SELECT count(*) AS missing_expected_claims
FROM expected_claims expected
LEFT JOIN "artist_external_refs" ref
  ON ref."artistId" = expected.artist_id
 AND ref."providerKey" = 'pixiv'
 AND ref."externalId" = expected.external_id
WHERE ref.id IS NULL;

SELECT count(*) AS duplicate_provider_identities
FROM (
  SELECT "artistId", "providerKey"
  FROM "artist_external_refs"
  GROUP BY "artistId", "providerKey"
  HAVING count(*) > 1
) duplicate_rows;
