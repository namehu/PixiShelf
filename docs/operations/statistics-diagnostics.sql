-- Standalone deployment: run this entire file in a PostgreSQL SQL client.
-- Use the application's database and schema/search_path. No Node.js or pnpm required.
-- Any error/timeout means validation is incomplete: retain exact mode.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- Counter triggers and related indexes, for inspection.
SELECT t.tgname AS name, t.tgenabled::text AS enabled, t.tgtype::int AS type,
       p.proname AS function_name, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = '"Image"'::regclass AND NOT t.tgisinternal;

SELECT tab.relname AS table_name, idx.relname AS index_name,
       i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
JOIN pg_class tab ON tab.oid = i.indrelid
JOIN pg_class idx ON idx.oid = i.indexrelid
WHERE i.indrelid IN (
  '"Image"'::regclass, '"Artwork"'::regclass, '"Tag"'::regclass,
  'artwork_artists'::regclass, 'artwork_artist_evidence'::regclass
);

-- Grand totals alone are insufficient: per-artwork errors can cancel each other.
WITH required_triggers(name, event_type) AS (
  VALUES ('artwork_image_count_trigger', 4),
         ('artwork_image_count_delete_trigger', 8),
         ('artwork_image_count_update_trigger', 16)
), trigger_check AS (
  SELECT bool_and(EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = '"Image"'::regclass
      AND NOT t.tgisinternal
      AND t.tgname = r.name AND t.tgtype = r.event_type
      AND t.tgenabled IN ('O', 'A')
      AND p.proname = 'update_artwork_image_count'
  )) AS ready
  FROM required_triggers r
), totals AS (
  SELECT
    (SELECT COUNT(*) FROM "Image") AS exact_count,
    (COALESCE((SELECT SUM("imageCount") FROM "Artwork"), 0)
      + (SELECT COUNT(*) FROM "Image" WHERE "artworkId" IS NULL))::bigint AS counter_count,
    (SELECT COUNT(*) FROM "Artwork" a LEFT JOIN (
      SELECT "artworkId", COUNT(*) AS actual
      FROM "Image" WHERE "artworkId" IS NOT NULL GROUP BY "artworkId"
    ) actual ON actual."artworkId" = a.id
    WHERE a."imageCount" <> COALESCE(actual.actual, 0)) AS mismatched_artworks
)
SELECT exact_count, counter_count, mismatched_artworks, ready AS triggers_ready,
       (exact_count = counter_count AND mismatched_artworks = 0 AND ready) AS safe_to_enable
FROM totals CROSS JOIN trigger_check;

-- Buffers have been warmed by the consistency check; these are not cold-read timings.
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT COUNT(*) AS count FROM "Image";

EXPLAIN (ANALYZE, BUFFERS, TIMING OFF)
SELECT (
  COALESCE((SELECT SUM("imageCount") FROM "Artwork"), 0)
  + (SELECT COUNT(*) FROM "Image" WHERE "artworkId" IS NULL)
)::bigint AS count;

ROLLBACK;
