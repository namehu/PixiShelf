BEGIN;

LOCK TABLE "Artist", "Artwork", "Series", "SeriesArtwork", "artist_external_refs", "series_external_refs",
  "migration_job_items", "migration_file_entries"
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  artist_blocker_count bigint;
  direct_series_blocker_count bigint;
  series_identity_blocker_count bigint;
  migration_closure_blocker_count bigint;
BEGIN
  SELECT count(*) INTO artist_blocker_count
  FROM "Artist"
  WHERE "userId" IS NOT NULL;

  SELECT count(*) INTO direct_series_blocker_count
  FROM "Artwork"
  WHERE "seriesId" IS NOT NULL;

  SELECT count(*) INTO series_identity_blocker_count
  FROM "Series" legacy_series
  WHERE NOT (
    upper(btrim(legacy_series."source")) = 'LOCAL'
    AND legacy_series."externalId" IS NULL
  )
  AND NOT (
    upper(btrim(legacy_series."source")) = 'PIXIV'
    AND legacy_series."externalId" ~ '^[1-9][0-9]*$'
    AND EXISTS (
      SELECT 1
      FROM "series_external_refs" external_ref
      WHERE external_ref."seriesId" = legacy_series.id
        AND external_ref."providerKey" = 'pixiv'
        AND external_ref."externalId" = legacy_series."externalId"
    )
  );

  SELECT count(*) INTO migration_closure_blocker_count
  FROM "migration_job_items" item
  WHERE NOT (
    (
      item.status IN ('COMPLETED', 'SKIPPED')
      AND NOT EXISTS (
        SELECT 1 FROM "migration_file_entries" file
        WHERE file."itemId" = item.id AND file.status <> 'COMPLETED'
      )
    )
    OR (
      item.status IN ('FAILED', 'CANCELLED')
      AND item.phase = 'DISCOVERING'
      AND NOT EXISTS (SELECT 1 FROM "migration_file_entries" file WHERE file."itemId" = item.id)
    )
  );

  IF artist_blocker_count > 0
     OR direct_series_blocker_count > 0
     OR series_identity_blocker_count > 0
     OR migration_closure_blocker_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'legacy identity retirement blocked: Artist.userId=%s, Artwork.seriesId=%s, unresolved Series identity=%s, unfinished migration items=%s; run retire-legacy-fields audit and prepare first',
        artist_blocker_count,
        direct_series_blocker_count,
        series_identity_blocker_count,
        migration_closure_blocker_count
      );
  END IF;
END
$$;

DROP INDEX IF EXISTS "unique_username_userid";
ALTER TABLE "Artist" DROP COLUMN "userId";

COMMIT;
