BEGIN;

-- All App, Worker, scanner and maintenance writers must be stopped before deployment.
LOCK TABLE "Artwork", "Image", artwork_reading_summaries, artwork_read_media IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "Artwork"
  ADD COLUMN "logicalMediaCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "readingLayoutVersion" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "Artwork_logicalMediaCount_check" CHECK ("logicalMediaCount" >= 0),
  ADD CONSTRAINT "Artwork_readingLayoutVersion_check" CHECK ("readingLayoutVersion" >= 1);

CREATE TABLE artwork_reading_progress (
  "userId" TEXT NOT NULL,
  "artworkId" INTEGER NOT NULL,
  "furthestMediaId" INTEGER,
  "furthestMediaIndex" INTEGER,
  "lastMediaId" INTEGER,
  "lastMediaIndex" INTEGER,
  completed BOOLEAN NOT NULL DEFAULT false,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "lastViewedAt" TIMESTAMP(3),
  "lastActiveAt" TIMESTAMP(3),
  "stateVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT artwork_reading_progress_pkey PRIMARY KEY ("userId", "artworkId"),
  CONSTRAINT artwork_reading_progress_counts_check CHECK ("viewCount" >= 0 AND "stateVersion" >= 0),
  CONSTRAINT artwork_reading_progress_furthest_check CHECK (
    ("furthestMediaId" IS NULL AND "furthestMediaIndex" IS NULL) OR
    ("furthestMediaId" IS NOT NULL AND "furthestMediaIndex" IS NOT NULL AND "furthestMediaIndex" >= 0)),
  CONSTRAINT artwork_reading_progress_last_check CHECK (
    ("lastMediaId" IS NULL AND "lastMediaIndex" IS NULL) OR
    ("lastMediaId" IS NOT NULL AND "lastMediaIndex" IS NOT NULL AND "lastMediaIndex" >= 0)),
  CONSTRAINT "artwork_reading_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserBA"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "artwork_reading_progress_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "Artwork"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX artwork_reading_progress_user_recent_idx ON artwork_reading_progress ("userId", "lastViewedAt" DESC, "artworkId" DESC);
CREATE INDEX "artwork_reading_progress_artworkId_idx" ON artwork_reading_progress ("artworkId");

-- Exact groupLogicalMedia parity: ordered by sortOrder/id; case-sensitive basename stem;
-- only a trailing .apng is paired, with the first video of that stem (directory ignored).
-- Video extensions ignore query strings; stem and APNG detection deliberately do not.
CREATE TEMP TABLE reading_position_media_map ON COMMIT DROP AS
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
)
SELECT o.id AS member_id, o."artworkId", o.owner_id, p.logical_index
FROM owners o JOIN positions p ON p.id = o.owner_id AND p."artworkId" = o."artworkId";
CREATE UNIQUE INDEX ON reading_position_media_map (member_id);
CREATE INDEX ON reading_position_media_map ("artworkId", logical_index);

UPDATE "Artwork" a SET "logicalMediaCount" = (
  SELECT count(DISTINCT m.owner_id)::integer FROM reading_position_media_map m WHERE m."artworkId" = a.id
);

CREATE TEMP TABLE reading_position_expected_progress (
  "userId", "artworkId", "furthestMediaId", "furthestMediaIndex", "lastMediaId", "lastMediaIndex", completed,
  "viewCount", "lastViewedAt", "lastActiveAt", "stateVersion", "createdAt", "updatedAt"
) ON COMMIT DROP AS
WITH keys AS (
  SELECT "userId", "artworkId" FROM artwork_reading_summaries
  UNION SELECT "userId", "artworkId" FROM artwork_read_media
), reads AS (
  SELECT r."userId", r."artworkId", max(m.logical_index) AS furthest_index,
    min(r."firstSeenAt") AS first_seen, max(r."firstSeenAt") AS latest_seen
  FROM artwork_read_media r LEFT JOIN reading_position_media_map m ON m.member_id = r."mediaId" AND m."artworkId" = r."artworkId"
  GROUP BY r."userId", r."artworkId"
)
SELECT k."userId", k."artworkId", furthest.owner_id, furthest.logical_index, last_media.owner_id, last_media.logical_index,
  -- Keep the old displayed completion even when its count snapshot predates media changes.
  coalesce(s."totalCount" > 0 AND s."seenCount"::bigint * 100 >= s."totalCount"::bigint * 90, false)
    OR coalesce(a."logicalMediaCount" > 0 AND r.furthest_index = a."logicalMediaCount" - 1, false),
  coalesce(s."viewCount", 0), s."lastViewedAt", s."lastActiveAt", coalesce(s."stateVersion", 0) + 1,
  coalesce(s."createdAt", r.first_seen), coalesce(s."updatedAt", r.latest_seen)
FROM keys k JOIN "Artwork" a ON a.id = k."artworkId"
LEFT JOIN artwork_reading_summaries s ON s."userId" = k."userId" AND s."artworkId" = k."artworkId"
LEFT JOIN reads r ON r."userId" = k."userId" AND r."artworkId" = k."artworkId"
LEFT JOIN reading_position_media_map furthest ON furthest."artworkId" = k."artworkId" AND furthest.logical_index = r.furthest_index AND furthest.member_id = furthest.owner_id
LEFT JOIN reading_position_media_map last_media ON last_media."artworkId" = k."artworkId" AND last_media.member_id = s."lastMediaId";

INSERT INTO artwork_reading_progress SELECT * FROM reading_position_expected_progress;

DO $$
BEGIN
  IF (SELECT count(*) FROM reading_position_media_map) <> (SELECT count(*) FROM "Image" WHERE "artworkId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Reading migration: incomplete logical media mapping';
  END IF;
  IF EXISTS (SELECT 1 FROM "Artwork" a WHERE a."logicalMediaCount" <> (
    SELECT count(DISTINCT m.owner_id)::integer FROM reading_position_media_map m WHERE m."artworkId"=a.id
  )) THEN RAISE EXCEPTION 'Reading migration: logical count mismatch'; END IF;
  IF EXISTS (TABLE reading_position_expected_progress EXCEPT TABLE artwork_reading_progress)
    OR EXISTS (TABLE artwork_reading_progress EXCEPT TABLE reading_position_expected_progress) THEN
    RAISE EXCEPTION 'Reading migration: account/artwork, anchors, completion or history differ from expected progress';
  END IF;
END $$;

-- Frozen evidence must survive subsequent business-table deletions. Remove every legacy FK.
DO $$
DECLARE legacy_fk record;
BEGIN
  FOR legacy_fk IN SELECT conrelid::regclass AS table_name, conname FROM pg_constraint
    WHERE contype = 'f' AND conrelid IN ('artwork_reading_summaries'::regclass, 'artwork_read_media'::regclass)
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', legacy_fk.table_name, legacy_fk.conname); END LOOP;
END $$;
CREATE SCHEMA reading_legacy_v1;
ALTER TABLE artwork_reading_summaries SET SCHEMA reading_legacy_v1;
ALTER TABLE artwork_read_media SET SCHEMA reading_legacy_v1;

-- The dedup recommendation uses real visit time from the new progress table.
CREATE OR REPLACE FUNCTION artwork_dedup_group_choices(run_id text, actor_id text)
RETURNS TABLE("groupId" text,"memberCount" integer,"fileCount" bigint,"keeperArtworkId" integer,"reviewVersion" integer,"saved" boolean,"protectedCount" integer,"eligible" boolean,"reason" text,"relationKind" text,"containedArtworkId" integer,"containerArtworkId" integer,"containedFileCount" bigint,"containerFileCount" bigint,"visual" jsonb)
LANGUAGE sql STABLE AS $$
 WITH members AS (
  SELECT gm."groupId",gm."artworkId",a."createdAt",rs."lastViewedAt",
   EXISTS(SELECT 1 FROM "ArtworkLike" l WHERE l."artworkId"=a.id) OR EXISTS(SELECT 1 FROM "MediaMark" mm WHERE mm."artworkId"=a.id AND (mm."bookmarkedAt" IS NOT NULL OR mm."likedAt" IS NOT NULL)) organized,
   coalesce(a.id IS NOT NULL AND a."deletedAt" IS NULL AND a."archiveLifecycleState"='ACTIVE' AND a."mediaRevision"=i."frozenMediaRevision" AND s."writeToken" IS NULL AND COALESCE(s.revision,0)=i."snapshotRevision" AND COALESCE(s."mediaEpoch",0)=i."mediaEpoch" AND f."sourceRevision"=COALESCE(s.revision,0) AND f."mediaEpoch"=COALESCE(s."mediaEpoch",0) AND f."membersSignature"=i."membersSignature" AND f."contentSha256"=i."contentSha256"
   AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupClaim" c WHERE c."artworkId"=a.id)
   AND EXISTS(SELECT 1 FROM artwork_artists m JOIN artwork_artist_evidence e ON e."membershipId"=m.id JOIN "Artist" ar ON ar.id=m."artistId" WHERE m."artworkId"=a.id AND m."artistId"=r."artistId" AND ar."mergedIntoId" IS NULL AND e.present AND e."excludedAt" IS NULL),false) current
  FROM "ArtworkDedupPendingMember" gm JOIN "ArtworkDedupRun" r ON r.id=gm."runId"
  JOIN "ArtworkDedupItem" i ON i."runId"=gm."runId" AND i."artworkId"=gm."artworkId"
  LEFT JOIN "Artwork" a ON a.id=gm."artworkId" LEFT JOIN "ArtworkContentSource" s ON s."artworkId"=a.id LEFT JOIN "ArtworkContentFingerprint" f ON f."artworkId"=a.id
  LEFT JOIN artwork_reading_progress rs ON rs."artworkId"=a.id AND rs."userId"=actor_id
  WHERE gm."runId"=run_id
 ), ranked AS (
  SELECT *,row_number() OVER(PARTITION BY "groupId" ORDER BY organized DESC,"lastViewedAt" DESC NULLS LAST,"createdAt","artworkId") rank FROM members
 ), grouped AS (
  SELECT "groupId",count(*)::int remaining_count,count(*) FILTER(WHERE organized)::int protected_count,bool_and(current) current,
   min("artworkId") FILTER(WHERE rank=1) recommended,bool_or("lastViewedAt" IS NOT NULL) viewed FROM ranked GROUP BY "groupId" HAVING count(*) >= 2
 ) SELECT g.id,x.remaining_count,g."fileCount",
  CASE WHEN chosen."artworkId" IS NOT NULL THEN v."keeperArtworkId" WHEN g."relationKind" IN ('VISUAL','PARTIAL') THEN NULL WHEN g."relationKind"='CONTAINS' THEN CASE WHEN NOT EXISTS(SELECT 1 FROM members cm WHERE cm."groupId"=g.id AND cm."artworkId"=g."containedArtworkId" AND cm.organized) THEN g."containerArtworkId" END WHEN x.protected_count<2 THEN x.recommended END,
  coalesce(v."reviewVersion",0),chosen."artworkId" IS NOT NULL,x.protected_count,x.current,
  CASE WHEN NOT x.current THEN 'UNAVAILABLE' WHEN chosen."artworkId" IS NOT NULL THEN 'SAVED' WHEN g."relationKind" IN ('VISUAL','PARTIAL') THEN 'NEEDS_CHOICE' WHEN g."relationKind"='CONTAINS' AND EXISTS(SELECT 1 FROM members cm WHERE cm."groupId"=g.id AND cm."artworkId"=g."containedArtworkId" AND cm.organized) THEN 'NEEDS_CHOICE' WHEN x.protected_count>1 AND g."relationKind"='EXACT' THEN 'NEEDS_CHOICE' WHEN x.protected_count=1 THEN 'ORGANIZATION' WHEN x.viewed THEN 'LAST_VIEWED' ELSE 'CREATED' END,
 g."relationKind",g."containedArtworkId",g."containerArtworkId",g."containedFileCount",g."containerFileCount",g.visual
 FROM "ArtworkDedupResult" g JOIN grouped x ON x."groupId"=g.id
 LEFT JOIN "ArtworkDedupReview" v ON v."runId"=run_id AND v."userId"=actor_id AND v."groupId"=g.id
 LEFT JOIN members chosen ON chosen."groupId"=g.id AND chosen."artworkId"=v."keeperArtworkId"
 WHERE g."runId"=run_id;
$$;

COMMIT;
