-- Read only. Run on the stopped source database before phase 1; retain the output with the checkpoint.
BEGIN READ ONLY;
SELECT current_database() AS database, current_timestamp AS checked_at,
  (SELECT count(*) FROM "Artwork") AS artworks,
  (SELECT count(*) FROM "Image" WHERE "artworkId" IS NOT NULL) AS physical_media,
  (SELECT count(*) FROM artwork_reading_summaries) AS old_summaries,
  (SELECT count(*) FROM artwork_read_media) AS old_read_members;
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 3;
WITH names AS (
  SELECT id, "artworkId", "sortOrder", path, "mediaType",
    regexp_replace(regexp_replace(replace(path, chr(92), '/'), '/+$', ''), '^.*/', '') AS name
  FROM "Image" WHERE "artworkId" IS NOT NULL
), sources AS (
  SELECT *, CASE WHEN name <> '..' AND length(name) - strpos(reverse(name), '.') > 0 AND strpos(reverse(name), '.') > 0
    THEN left(name, length(name) - strpos(reverse(name), '.')) ELSE name END AS stem,
    ("mediaType" = 'VIDEO' OR regexp_replace(path, '\?.*$', '') ~* '\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v)$') AS is_video
  FROM names
), videos AS (
  SELECT DISTINCT ON ("artworkId", stem) "artworkId", stem, id
  FROM sources WHERE is_video ORDER BY "artworkId", stem, "sortOrder", id
), owners AS (
  SELECT s.id, s."artworkId", s."sortOrder",
    CASE WHEN s.path ~* '\.apng$' AND v.id IS NOT NULL AND v.id <> s.id THEN v.id ELSE s.id END AS owner_id
  FROM sources s LEFT JOIN videos v ON v."artworkId" = s."artworkId" AND v.stem = s.stem
), positions AS (
  SELECT id, "artworkId", (row_number() OVER (PARTITION BY "artworkId" ORDER BY "sortOrder", id) - 1)::integer AS logical_index
  FROM owners WHERE id = owner_id
), media_map AS (
SELECT o.id AS member_id, o."artworkId", o.owner_id, p.logical_index
FROM owners o JOIN positions p ON p.id = o.owner_id AND p."artworkId" = o."artworkId"
), counts AS (
SELECT a.id, count(DISTINCT m.owner_id)::integer AS logical_count FROM "Artwork" a
LEFT JOIN media_map m ON m."artworkId" = a.id GROUP BY a.id
), audits AS (
SELECT s."userId", s."artworkId", s."seenCount", s."totalCount", c.logical_count,
  (s."totalCount" > 0 AND s."seenCount"::bigint * 100 >= s."totalCount"::bigint * 90) AS keep_old_completed,
  s."lastMediaId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM media_map m WHERE m.member_id = s."lastMediaId" AND m."artworkId" = s."artworkId") AS invalid_last,
  (SELECT count(DISTINCT m.owner_id) FROM artwork_read_media r JOIN media_map m ON m.member_id = r."mediaId" AND m."artworkId" = r."artworkId" WHERE r."userId" = s."userId" AND r."artworkId" = s."artworkId") AS current_read_logical_count
FROM artwork_reading_summaries s JOIN counts c ON c.id = s."artworkId"
)
SELECT count(*) AS summaries,
  count(*) FILTER (WHERE "totalCount" <> logical_count) AS stale_total_snapshots,
  count(*) FILTER (WHERE "seenCount" <> current_read_logical_count) AS differing_read_snapshots,
  count(*) FILTER (WHERE keep_old_completed) AS preserved_completed,
  count(*) FILTER (WHERE keep_old_completed AND "totalCount" <> logical_count) AS completed_with_stale_total,
  count(*) FILTER (WHERE invalid_last) AS invalid_last_anchors
FROM audits;
SELECT count(*) AS read_only_account_artworks FROM (
SELECT "userId", "artworkId" FROM artwork_read_media EXCEPT SELECT "userId", "artworkId" FROM artwork_reading_summaries
) k;
-- This function must be replaced in phase 1; investigate any additional dependent function.
SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosrc ~ 'artwork_reading_summaries|artwork_read_media';
SELECT schemaname, viewname, definition FROM pg_views
WHERE definition ~ 'artwork_reading_summaries|artwork_read_media';
SELECT schemaname, matviewname, definition FROM pg_matviews
WHERE definition ~ 'artwork_reading_summaries|artwork_read_media';
SELECT pg_describe_object(d.classid,d.objid,d.objsubid) AS dependent_object,
  d.refobjid::regclass AS legacy_table, d.deptype
FROM pg_depend d WHERE d.refobjid IN ('artwork_reading_summaries'::regclass, 'artwork_read_media'::regclass)
ORDER BY dependent_object;
SELECT c.conrelid::regclass AS legacy_table, c.conname, c.confrelid::regclass AS referenced_table
FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid IN ('artwork_reading_summaries'::regclass, 'artwork_read_media'::regclass);
COMMIT;
