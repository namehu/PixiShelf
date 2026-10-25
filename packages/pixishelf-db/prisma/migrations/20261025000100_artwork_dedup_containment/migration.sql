-- Additive only: no media access, no existing exact-group or operation rewrites.
ALTER TABLE "ArtworkDedupRun" ADD COLUMN "relationAfterArtworkId" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "relationAfterCandidateId" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "ArtworkDedupRelation" (
 id TEXT PRIMARY KEY, "runId" TEXT NOT NULL REFERENCES "ArtworkDedupRun"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "containedArtworkId" INTEGER NOT NULL, "containerArtworkId" INTEGER NOT NULL,
 "containedFileCount" BIGINT NOT NULL, "containerFileCount" BIGINT NOT NULL,
 CONSTRAINT "ArtworkDedupRelation_direction_check" CHECK ("containedArtworkId"<>"containerArtworkId" AND "containedFileCount">0 AND "containedFileCount"<"containerFileCount")
);
CREATE UNIQUE INDEX "ArtworkDedupRelation_runId_containedArtworkId_containerArtwor_key" ON "ArtworkDedupRelation"("runId","containedArtworkId","containerArtworkId");
CREATE INDEX "ArtworkDedupRelation_runId_id_idx" ON "ArtworkDedupRelation"("runId",id);
CREATE INDEX "ArtworkDedupMedia_runId_size_sha256_artworkId_idx" ON "ArtworkDedupMedia"("runId",size,sha256,"artworkId");
ALTER TABLE "ArtworkDedupOperationGroup" ADD COLUMN "relationKind" TEXT NOT NULL DEFAULT 'EXACT',
 ADD COLUMN "containedArtworkId" INTEGER, ADD COLUMN "containerArtworkId" INTEGER,
 ADD COLUMN "containedFileCount" BIGINT, ADD COLUMN "containerFileCount" BIGINT;
ALTER TABLE "ArtworkDedupOperationGroup" ADD CONSTRAINT "ArtworkDedupOperationGroup_direction_check" CHECK (
 ("relationKind"='EXACT' AND "containedArtworkId" IS NULL AND "containerArtworkId" IS NULL AND "containedFileCount" IS NULL AND "containerFileCount" IS NULL)
 OR ("relationKind"='CONTAINS' AND "containedArtworkId" IS NOT NULL AND "containerArtworkId" IS NOT NULL AND "containedArtworkId"<>"containerArtworkId" AND "containedFileCount">0 AND "containerFileCount">"containedFileCount" AND ("keeperArtworkId" IS NULL OR "keeperArtworkId"="containerArtworkId"))
);
CREATE VIEW "ArtworkDedupResult" AS
 SELECT id,"runId","memberCount","fileCount",'EXACT'::text "relationKind",NULL::int "containedArtworkId",NULL::int "containerArtworkId",NULL::bigint "containedFileCount",NULL::bigint "containerFileCount" FROM "ArtworkDedupGroup"
 UNION ALL SELECT id,"runId",2,"containedFileCount",'CONTAINS',"containedArtworkId","containerArtworkId","containedFileCount","containerFileCount" FROM "ArtworkDedupRelation";
CREATE VIEW "ArtworkDedupResultMember" AS
 SELECT "runId","groupId","artworkId" FROM "ArtworkDedupGroupMember"
 UNION ALL SELECT "runId",id,"containedArtworkId" FROM "ArtworkDedupRelation"
 UNION ALL SELECT "runId",id,"containerArtworkId" FROM "ArtworkDedupRelation";
DROP FUNCTION artwork_dedup_group_choices(text,text);
CREATE FUNCTION artwork_dedup_group_choices(run_id text, actor_id text)
RETURNS TABLE("groupId" text,"memberCount" integer,"fileCount" bigint,"keeperArtworkId" integer,"reviewVersion" integer,"saved" boolean,"protectedCount" integer,"eligible" boolean,"reason" text,"relationKind" text,"containedArtworkId" integer,"containerArtworkId" integer,"containedFileCount" bigint,"containerFileCount" bigint)
LANGUAGE sql STABLE AS $$
 WITH members AS (
  SELECT gm."groupId",gm."artworkId",a."createdAt",rs."lastViewedAt",
   EXISTS(SELECT 1 FROM "ArtworkLike" l WHERE l."artworkId"=a.id) OR EXISTS(SELECT 1 FROM "MediaMark" mm WHERE mm."artworkId"=a.id AND (mm."bookmarkedAt" IS NOT NULL OR mm."likedAt" IS NOT NULL)) organized,
   coalesce(a.id IS NOT NULL AND a."deletedAt" IS NULL AND a."archiveLifecycleState"='ACTIVE' AND a."mediaRevision"=i."frozenMediaRevision" AND s."writeToken" IS NULL AND s.revision=i."snapshotRevision" AND s."mediaEpoch"=i."mediaEpoch" AND f."sourceRevision"=s.revision AND f."mediaEpoch"=s."mediaEpoch" AND f."membersSignature"=i."membersSignature" AND f."contentSha256"=i."contentSha256"
   AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupClaim" c WHERE c."artworkId"=a.id)
   AND EXISTS(SELECT 1 FROM artwork_artists m JOIN artwork_artist_evidence e ON e."membershipId"=m.id JOIN "Artist" ar ON ar.id=m."artistId" WHERE m."artworkId"=a.id AND m."artistId"=r."artistId" AND ar."mergedIntoId" IS NULL AND e.present AND e."excludedAt" IS NULL),false) current
  FROM "ArtworkDedupResultMember" gm JOIN "ArtworkDedupRun" r ON r.id=gm."runId"
  JOIN "ArtworkDedupItem" i ON i."runId"=gm."runId" AND i."artworkId"=gm."artworkId"
  LEFT JOIN "Artwork" a ON a.id=gm."artworkId" LEFT JOIN "ArtworkContentSource" s ON s."artworkId"=a.id LEFT JOIN "ArtworkContentFingerprint" f ON f."artworkId"=a.id
  LEFT JOIN artwork_reading_summaries rs ON rs."artworkId"=a.id AND rs."userId"=actor_id
  WHERE gm."runId"=run_id
 ), ranked AS (
  SELECT *,row_number() OVER(PARTITION BY "groupId" ORDER BY organized DESC,"lastViewedAt" DESC NULLS LAST,"createdAt","artworkId") rank FROM members
 ), grouped AS (
  SELECT "groupId",count(*) FILTER(WHERE organized)::int protected_count,bool_and(current) current,
   min("artworkId") FILTER(WHERE rank=1) recommended,bool_or("lastViewedAt" IS NOT NULL) viewed FROM ranked GROUP BY "groupId"
 ) SELECT g.id,g."memberCount",g."fileCount",
  CASE WHEN v."keeperArtworkId" IS NOT NULL THEN v."keeperArtworkId" WHEN g."relationKind"='CONTAINS' THEN CASE WHEN NOT EXISTS(SELECT 1 FROM members cm WHERE cm."groupId"=g.id AND cm."artworkId"=g."containedArtworkId" AND cm.organized) THEN g."containerArtworkId" END WHEN x.protected_count<2 THEN x.recommended END,
  coalesce(v."reviewVersion",0),v."keeperArtworkId" IS NOT NULL,x.protected_count,x.current,
  CASE WHEN NOT x.current THEN 'UNAVAILABLE' WHEN v."keeperArtworkId" IS NOT NULL THEN 'SAVED' WHEN g."relationKind"='CONTAINS' AND EXISTS(SELECT 1 FROM members cm WHERE cm."groupId"=g.id AND cm."artworkId"=g."containedArtworkId" AND cm.organized) THEN 'NEEDS_CHOICE' WHEN x.protected_count>1 AND g."relationKind"='EXACT' THEN 'NEEDS_CHOICE' WHEN x.protected_count=1 THEN 'ORGANIZATION' WHEN x.viewed THEN 'LAST_VIEWED' ELSE 'CREATED' END,
 g."relationKind",g."containedArtworkId",g."containerArtworkId",g."containedFileCount",g."containerFileCount"
 FROM "ArtworkDedupResult" g JOIN grouped x ON x."groupId"=g.id
 LEFT JOIN "ArtworkDedupReview" v ON v."runId"=run_id AND v."userId"=actor_id AND v."groupId"=g.id
 WHERE g."runId"=run_id;
$$;
