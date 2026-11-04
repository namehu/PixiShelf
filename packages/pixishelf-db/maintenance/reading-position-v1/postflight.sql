-- Read only. Run immediately after db:deploy and before allowing writers to resume.
BEGIN READ ONLY;
SELECT current_database() AS database, current_timestamp AS checked_at;
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
WHERE migration_name = '20261104010000_reading_position_progress';
SELECT (SELECT count(*) FROM artwork_reading_progress) AS new_rows,
 (SELECT count(*) FROM reading_legacy_v1.artwork_reading_summaries) AS sealed_summaries,
 (SELECT count(*) FROM reading_legacy_v1.artwork_read_media) AS sealed_read_members,
 (SELECT count(*) FROM artwork_reading_progress WHERE completed) AS completed_rows;
DO $$
DECLARE progress_mismatches bigint; layout_mismatches bigint;
BEGIN
 IF to_regclass('public.artwork_reading_summaries') IS NOT NULL OR to_regclass('public.artwork_read_media') IS NOT NULL THEN
  RAISE EXCEPTION 'Legacy tables remain in the application schema'; END IF;
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND conrelid IN (
  'reading_legacy_v1.artwork_reading_summaries'::regclass, 'reading_legacy_v1.artwork_read_media'::regclass)) THEN
  RAISE EXCEPTION 'Sealed legacy tables still have outgoing foreign keys'; END IF;
 IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','reading_legacy_v1') AND p.prosrc ~ 'artwork_reading_summaries|artwork_read_media') THEN
  RAISE EXCEPTION 'A business function still reads legacy tables'; END IF;
 IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema','reading_legacy_v1') AND definition ~ 'artwork_reading_summaries|artwork_read_media')
 OR EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname NOT IN ('pg_catalog','information_schema','reading_legacy_v1') AND definition ~ 'artwork_reading_summaries|artwork_read_media') THEN
  RAISE EXCEPTION 'A business view still reads legacy tables'; END IF;
 IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON d.classid='pg_rewrite'::regclass AND r.oid=d.objid
  JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','reading_legacy_v1') AND d.refobjid IN ('reading_legacy_v1.artwork_reading_summaries'::regclass, 'reading_legacy_v1.artwork_read_media'::regclass)) THEN
  RAISE EXCEPTION 'A business view depends on sealed legacy tables'; END IF;
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
FROM owners o JOIN positions p ON p.id=o.owner_id AND p."artworkId"=o."artworkId"
), layout_counts AS (
SELECT a.id, count(DISTINCT m.owner_id)::integer AS logical_count FROM "Artwork" a
LEFT JOIN media_map m ON m."artworkId"=a.id GROUP BY a.id
), keys AS (
  SELECT "userId", "artworkId" FROM reading_legacy_v1.artwork_reading_summaries
  UNION SELECT "userId", "artworkId" FROM reading_legacy_v1.artwork_read_media
), reads AS (
  SELECT r."userId", r."artworkId", max(m.logical_index) AS furthest_index,
    min(r."firstSeenAt") AS first_seen, max(r."firstSeenAt") AS latest_seen
  FROM reading_legacy_v1.artwork_read_media r LEFT JOIN media_map m ON m.member_id = r."mediaId" AND m."artworkId" = r."artworkId"
  GROUP BY r."userId", r."artworkId"
), expected (
  "userId", "artworkId", "furthestMediaId", "furthestMediaIndex", "lastMediaId", "lastMediaIndex", completed,
  "viewCount", "lastViewedAt", "lastActiveAt", "stateVersion", "createdAt", "updatedAt"
) AS (
SELECT k."userId", k."artworkId", furthest.owner_id, furthest.logical_index, last_media.owner_id, last_media.logical_index,
  -- Keep the old displayed completion even when its count snapshot predates media changes.
  coalesce(s."totalCount" > 0 AND s."seenCount"::bigint * 100 >= s."totalCount"::bigint * 90, false)
    OR coalesce(a.logical_count > 0 AND r.furthest_index = a.logical_count - 1, false),
  coalesce(s."viewCount", 0), s."lastViewedAt", s."lastActiveAt", coalesce(s."stateVersion", 0) + 1,
  coalesce(s."createdAt", r.first_seen), coalesce(s."updatedAt", r.latest_seen)
FROM keys k JOIN layout_counts a ON a.id = k."artworkId"
LEFT JOIN reading_legacy_v1.artwork_reading_summaries s ON s."userId" = k."userId" AND s."artworkId" = k."artworkId"
LEFT JOIN reads r ON r."userId" = k."userId" AND r."artworkId" = k."artworkId"
LEFT JOIN media_map furthest ON furthest."artworkId" = k."artworkId" AND furthest.logical_index = r.furthest_index AND furthest.member_id = furthest.owner_id
LEFT JOIN media_map last_media ON last_media."artworkId" = k."artworkId" AND last_media.member_id = s."lastMediaId"
), differences AS (
  (TABLE expected EXCEPT TABLE artwork_reading_progress)
  UNION ALL (TABLE artwork_reading_progress EXCEPT TABLE expected)
)
SELECT (SELECT count(*) FROM differences),
  (SELECT count(*) FROM layout_counts l JOIN "Artwork" a ON a.id=l.id WHERE a."logicalMediaCount"<>l.logical_count)
INTO progress_mismatches, layout_mismatches;
IF progress_mismatches > 0 OR layout_mismatches > 0 THEN
 RAISE EXCEPTION 'Reading postflight failed: % differing source-derived progress rows; % incorrect cached logical counts', progress_mismatches, layout_mismatches;
END IF;
END $$;
COMMIT;
