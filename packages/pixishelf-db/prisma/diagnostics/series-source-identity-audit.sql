-- Read-only production audit for the Series external identity cutover.
-- Run every statement before migration. The file never changes data.

-- 1. Current Series source and external-id distribution.
SELECT
  upper(btrim(coalesce(source, ''))) AS source,
  count(*) AS series_count,
  count(*) FILTER (WHERE "externalId" ~ '^[1-9][0-9]*$') AS numeric_external_id_count,
  count(*) FILTER (WHERE "externalId" IS NULL) AS null_external_id_count
FROM "Series"
GROUP BY upper(btrim(coalesce(source, '')))
ORDER BY series_count DESC, source;

-- 2. Duplicate Pixiv ids after case-normalizing the legacy source string.
SELECT
  "externalId" AS pixiv_series_id,
  count(*) AS series_count,
  array_agg(id ORDER BY id) AS series_ids
FROM "Series"
WHERE upper(btrim(source)) = 'PIXIV'
  AND "externalId" ~ '^[1-9][0-9]*$'
GROUP BY "externalId"
HAVING count(*) > 1
ORDER BY series_count DESC, "externalId";

-- 3. Existing membership shape, including true multi-series Artwork rows.
WITH membership_counts AS MATERIALIZED (
  SELECT "artworkId", count(*) AS membership_count
  FROM "SeriesArtwork"
  GROUP BY "artworkId"
)
SELECT
  (SELECT count(*) FROM "SeriesArtwork") AS membership_count,
  count(*) AS artwork_with_membership_count,
  count(*) FILTER (WHERE membership_count > 1) AS multi_series_artwork_count,
  coalesce(max(membership_count), 0) AS max_memberships_per_artwork
FROM membership_counts;

-- 4. Drift between the legacy direct pointer and the join table.
WITH join_summary AS MATERIALIZED (
  SELECT
    artwork.id AS artwork_id,
    artwork."seriesId" AS direct_series_id,
    count(membership."seriesId") AS join_count,
    bool_or(membership."seriesId" = artwork."seriesId") AS has_matching_join,
    array_agg(membership."seriesId" ORDER BY membership."seriesId")
      FILTER (WHERE membership."seriesId" IS NOT NULL) AS join_series_ids
  FROM "Artwork" artwork
  LEFT JOIN "SeriesArtwork" membership ON membership."artworkId" = artwork.id
  GROUP BY artwork.id, artwork."seriesId"
)
SELECT
  count(*) FILTER (WHERE direct_series_id IS NOT NULL AND join_count = 0) AS direct_only_count,
  count(*) FILTER (WHERE direct_series_id IS NULL AND join_count > 0) AS join_only_count,
  count(*) FILTER (
    WHERE direct_series_id IS NOT NULL
      AND join_count > 0
      AND coalesce(has_matching_join, false) = false
  ) AS conflicting_count
FROM join_summary;

-- 5. At most 200 concrete drift rows for manual inspection.
WITH join_summary AS MATERIALIZED (
  SELECT
    artwork.id AS artwork_id,
    artwork.title,
    artwork."seriesId" AS direct_series_id,
    count(membership."seriesId") AS join_count,
    bool_or(membership."seriesId" = artwork."seriesId") AS has_matching_join,
    array_agg(membership."seriesId" ORDER BY membership."seriesId")
      FILTER (WHERE membership."seriesId" IS NOT NULL) AS join_series_ids
  FROM "Artwork" artwork
  LEFT JOIN "SeriesArtwork" membership ON membership."artworkId" = artwork.id
  GROUP BY artwork.id, artwork.title, artwork."seriesId"
)
SELECT *
FROM join_summary
WHERE (direct_series_id IS NOT NULL AND join_count = 0)
   OR (direct_series_id IS NULL AND join_count > 0)
   OR (
     direct_series_id IS NOT NULL
     AND join_count > 0
     AND coalesce(has_matching_join, false) = false
   )
ORDER BY artwork_id
LIMIT 200;

-- 6. Strong automatic Pixiv identity candidates available to the migration.
WITH unique_pixiv_refs AS MATERIALIZED (
  SELECT "artworkId", min(id) AS id
  FROM "artwork_external_refs"
  WHERE "providerKey" = 'pixiv'
  GROUP BY "artworkId"
  HAVING count(*) = 1
),
strong_candidates AS MATERIALIZED (
  SELECT DISTINCT
    series.id AS series_id,
    series.title,
    series."externalId" AS pixiv_series_id
  FROM "Series" series
  JOIN "SeriesArtwork" membership ON membership."seriesId" = series.id
  JOIN unique_pixiv_refs pixiv_ref ON pixiv_ref."artworkId" = membership."artworkId"
  JOIN "ArtworkRawMetadata" raw_metadata ON raw_metadata."artworkId" = membership."artworkId"
  WHERE upper(btrim(series.source)) = 'PIXIV'
    AND series."externalId" ~ '^[1-9][0-9]*$'
    AND raw_metadata."rawMetadataJson" ->> 'seriesId' = series."externalId"
)
SELECT
  count(*) AS strong_series_count,
  count(DISTINCT pixiv_series_id) AS strong_unique_external_id_count
FROM strong_candidates;

-- 7. Legacy PIXIV rows that cannot be claimed automatically by database evidence.
WITH unique_pixiv_refs AS MATERIALIZED (
  SELECT "artworkId", min(id) AS id
  FROM "artwork_external_refs"
  WHERE "providerKey" = 'pixiv'
  GROUP BY "artworkId"
  HAVING count(*) = 1
),
strong_series AS MATERIALIZED (
  SELECT DISTINCT series.id
  FROM "Series" series
  JOIN "SeriesArtwork" membership ON membership."seriesId" = series.id
  JOIN unique_pixiv_refs pixiv_ref ON pixiv_ref."artworkId" = membership."artworkId"
  JOIN "ArtworkRawMetadata" raw_metadata ON raw_metadata."artworkId" = membership."artworkId"
  WHERE upper(btrim(series.source)) = 'PIXIV'
    AND series."externalId" ~ '^[1-9][0-9]*$'
    AND raw_metadata."rawMetadataJson" ->> 'seriesId' = series."externalId"
)
SELECT series.id, series.title, series.source, series."externalId"
FROM "Series" series
WHERE upper(btrim(series.source)) = 'PIXIV'
  AND NOT EXISTS (SELECT 1 FROM strong_series strong WHERE strong.id = series.id)
ORDER BY series.id
LIMIT 200;
