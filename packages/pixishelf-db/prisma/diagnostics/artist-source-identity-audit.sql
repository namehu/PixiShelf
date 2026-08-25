-- Read-only production audit for the Artist external identity cutover.
-- Run before and after migration; every statement is SELECT-only.

SELECT
  count(*) FILTER (WHERE "userId" ~ '^[1-9][0-9]*$') AS numeric_legacy_ids,
  count(*) FILTER (WHERE "userId" LIKE 'p\_%' ESCAPE '\') AS synthetic_local_ids,
  count(*) FILTER (WHERE "userId" IS NULL) AS null_legacy_ids
FROM "Artist";

WITH strong_candidates AS MATERIALIZED (
  SELECT DISTINCT artist.id AS artist_id, artist."userId" AS external_id
  FROM "Artist" artist
  JOIN "Artwork" artwork ON artwork."artistId" = artist.id
  JOIN "artwork_external_refs" artwork_ref
    ON artwork_ref."artworkId" = artwork.id
   AND artwork_ref."providerKey" = 'pixiv'
  WHERE artist."userId" ~ '^[1-9][0-9]*$'
)
SELECT
  count(DISTINCT artist_id) AS strong_pixiv_artists,
  count(DISTINCT external_id) AS strong_pixiv_ids
FROM strong_candidates;

WITH unique_legacy_ids AS MATERIALIZED (
  SELECT "userId"
  FROM "Artist"
  WHERE "userId" ~ '^[1-9][0-9]*$'
  GROUP BY "userId"
  HAVING count(*) = 1
),
automatic_claims AS MATERIALIZED (
  SELECT DISTINCT artist.id
  FROM "Artist" artist
  JOIN unique_legacy_ids unique_id ON unique_id."userId" = artist."userId"
  JOIN "Artwork" artwork ON artwork."artistId" = artist.id
  JOIN "artwork_external_refs" artwork_ref
    ON artwork_ref."artworkId" = artwork.id
   AND artwork_ref."providerKey" = 'pixiv'
)
SELECT count(*) AS automatic_claim_count FROM automatic_claims;

SELECT "userId" AS duplicate_numeric_user_id, count(*) AS artist_count, array_agg(id ORDER BY id) AS artist_ids
FROM "Artist"
WHERE "userId" ~ '^[1-9][0-9]*$'
GROUP BY "userId"
HAVING count(*) > 1
ORDER BY count(*) DESC, "userId";

SELECT artist.id, artist.name, artist."userId"
FROM "Artist" artist
WHERE artist."userId" ~ '^[1-9][0-9]*$'
  AND NOT EXISTS (
    SELECT 1
    FROM "Artwork" artwork
    JOIN "artwork_external_refs" artwork_ref
      ON artwork_ref."artworkId" = artwork.id
     AND artwork_ref."providerKey" = 'pixiv'
    WHERE artwork."artistId" = artist.id
  )
ORDER BY artist.id
LIMIT 200;

SELECT artist.id, artist.name, artist."userId"
FROM "Artist" artist
WHERE artist."userId" LIKE 'p\_%' ESCAPE '\'
ORDER BY artist.id
LIMIT 200;
