-- Additive F01: original SHA overlap reuses comparison evidence without changing historical visual rows.
ALTER TABLE "ArtworkDedupRun" ADD COLUMN "partialAfterArtworkId" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "partialAfterCandidateId" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ArtworkDedupRun" ADD CONSTRAINT "ArtworkDedupRun_partial_cursor" CHECK (
 "partialAfterArtworkId">=0 AND "partialAfterCandidateId">=0);
ALTER TABLE "ArtworkDedupVisualPair" ADD COLUMN "relationKind" TEXT NOT NULL DEFAULT 'VISUAL';
ALTER TABLE "ArtworkDedupVisualPair" ADD CONSTRAINT "ArtworkDedupVisualPair_relation_kind" CHECK ("relationKind" IN ('VISUAL','PARTIAL'));
ALTER TABLE "ArtworkDedupOperationGroup" DROP CONSTRAINT "ArtworkDedupOperationGroup_direction_check";
ALTER TABLE "ArtworkDedupOperationGroup" ADD CONSTRAINT "ArtworkDedupOperationGroup_direction_check" CHECK (
 ("relationKind"='EXACT' AND "containedArtworkId" IS NULL AND "containerArtworkId" IS NULL AND "containedFileCount" IS NULL AND "containerFileCount" IS NULL AND visual IS NULL)
 OR ("relationKind"='CONTAINS' AND "containedArtworkId" IS NOT NULL AND "containerArtworkId" IS NOT NULL AND "containedArtworkId"<>"containerArtworkId" AND "containedFileCount">0 AND "containerFileCount">"containedFileCount" AND ("keeperArtworkId" IS NULL OR "keeperArtworkId"="containerArtworkId") AND visual IS NULL)
 OR ("relationKind" IN ('VISUAL','PARTIAL') AND visual IS NOT NULL AND "containedArtworkId" IS NULL AND "containerArtworkId" IS NULL AND "containedFileCount" IS NULL AND "containerFileCount" IS NULL)
);
DROP FUNCTION artwork_dedup_group_choices(text,text);
DROP VIEW "ArtworkDedupResult";
DROP VIEW "ArtworkDedupResultMember";
CREATE VIEW "ArtworkDedupResult" AS
 SELECT id,"runId","memberCount","fileCount",'EXACT'::text "relationKind",NULL::int "containedArtworkId",NULL::int "containerArtworkId",NULL::bigint "containedFileCount",NULL::bigint "containerFileCount",NULL::jsonb visual FROM "ArtworkDedupGroup"
 UNION ALL SELECT id,"runId",2,"containedFileCount",'CONTAINS',"containedArtworkId","containerArtworkId","containedFileCount","containerFileCount",NULL::jsonb FROM "ArtworkDedupRelation"
 UNION ALL SELECT id,"runId",2,(summary->>'leftFileCount')::bigint,"relationKind",NULL::int,NULL::int,NULL::bigint,NULL::bigint,summary FROM "ArtworkDedupVisualPair";
CREATE VIEW "ArtworkDedupResultMember" AS
 SELECT "runId","groupId","artworkId" FROM "ArtworkDedupGroupMember"
 UNION ALL SELECT "runId",id,"containedArtworkId" FROM "ArtworkDedupRelation"
 UNION ALL SELECT "runId",id,"containerArtworkId" FROM "ArtworkDedupRelation"
 UNION ALL SELECT "runId",id,"leftArtworkId" FROM "ArtworkDedupVisualPair"
 UNION ALL SELECT "runId",id,"rightArtworkId" FROM "ArtworkDedupVisualPair";
CREATE FUNCTION artwork_dedup_group_choices(run_id text, actor_id text)
RETURNS TABLE("groupId" text,"memberCount" integer,"fileCount" bigint,"keeperArtworkId" integer,"reviewVersion" integer,"saved" boolean,"protectedCount" integer,"eligible" boolean,"reason" text,"relationKind" text,"containedArtworkId" integer,"containerArtworkId" integer,"containedFileCount" bigint,"containerFileCount" bigint,"visual" jsonb)
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
  CASE WHEN v."keeperArtworkId" IS NOT NULL THEN v."keeperArtworkId" WHEN g."relationKind" IN ('VISUAL','PARTIAL') THEN NULL WHEN g."relationKind"='CONTAINS' THEN CASE WHEN NOT EXISTS(SELECT 1 FROM members cm WHERE cm."groupId"=g.id AND cm."artworkId"=g."containedArtworkId" AND cm.organized) THEN g."containerArtworkId" END WHEN x.protected_count<2 THEN x.recommended END,
  coalesce(v."reviewVersion",0),v."keeperArtworkId" IS NOT NULL,x.protected_count,x.current,
  CASE WHEN NOT x.current THEN 'UNAVAILABLE' WHEN v."keeperArtworkId" IS NOT NULL THEN 'SAVED' WHEN g."relationKind" IN ('VISUAL','PARTIAL') THEN 'NEEDS_CHOICE' WHEN g."relationKind"='CONTAINS' AND EXISTS(SELECT 1 FROM members cm WHERE cm."groupId"=g.id AND cm."artworkId"=g."containedArtworkId" AND cm.organized) THEN 'NEEDS_CHOICE' WHEN x.protected_count>1 AND g."relationKind"='EXACT' THEN 'NEEDS_CHOICE' WHEN x.protected_count=1 THEN 'ORGANIZATION' WHEN x.viewed THEN 'LAST_VIEWED' ELSE 'CREATED' END,
 g."relationKind",g."containedArtworkId",g."containerArtworkId",g."containedFileCount",g."containerFileCount",g.visual
 FROM "ArtworkDedupResult" g JOIN grouped x ON x."groupId"=g.id
 LEFT JOIN "ArtworkDedupReview" v ON v."runId"=run_id AND v."userId"=actor_id AND v."groupId"=g.id
 WHERE g."runId"=run_id;
$$;
ALTER TABLE "ArtworkDedupOperation" DROP CONSTRAINT "ArtworkDedupOperation_direct_delete_contract";
ALTER TABLE "ArtworkDedupOperation" ADD CONSTRAINT "ArtworkDedupOperation_direct_delete_contract" CHECK (
 ("preparePurpose" <> 'DIRECT_DELETE' AND "protocolVersion" IS NULL AND "scopeDigest" IS NULL AND "directDeleteConfirmedAt" IS NULL AND "freshVerifiedExecutionVersion" IS NULL AND "deleteStartedAt" IS NULL AND mode <> 'DIRECT_DELETE')
 OR ("preparePurpose"='DIRECT_DELETE' AND "protocolVersion" IN (1,2,3,4)
   AND ("scopeDigest" IS NULL OR "scopeDigest" ~ '^[a-f0-9]{64}$')
   AND (mode <> 'DIRECT_DELETE' OR ("scopeDigest" IS NOT NULL AND "directDeleteConfirmedAt" IS NOT NULL AND "externalWritesStoppedAt" IS NOT NULL AND "authorizationDigest" IS NOT NULL))
   AND ("freshVerifiedExecutionVersion" IS NULL OR "freshVerifiedExecutionVersion">0)
   AND ("deleteStartedAt" IS NULL OR (mode='DIRECT_DELETE' AND "freshVerifiedExecutionVersion" IS NOT NULL)))
);
-- New scans cannot be claimed by exact-only v1 Workers. Legacy v1 scans remain readable.
ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_dedup_policy";
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_dedup_policy" CHECK (
  type NOT IN ('ARTWORK_DEDUP_SCAN','ARTWORK_DEDUP_MAINTENANCE') OR (
    "executionLane"='BACKGROUND_WRITER' AND "triggerSource"='SYSTEM'
    AND "queuePriority"=900 AND "effectivePriority"=900 AND "scheduledTaskId" IS NULL
    AND "parentJobId" IS NULL AND "deadlineAt" IS NULL
    AND (
      "definitionVersion"=1
      OR (type='ARTWORK_DEDUP_SCAN' AND "definitionVersion" IN(2,3,4))
      OR (type='ARTWORK_DEDUP_MAINTENANCE' AND "definitionVersion" IN(2,3,4,5) AND coalesce((
        jsonb_typeof(payload)='object'
        AND payload ?& ARRAY['operationId','executionVersion','mode']
        AND jsonb_typeof(payload->'operationId')='string'
        AND length(btrim(payload->>'operationId')) BETWEEN 1 AND 128
        AND jsonb_typeof(payload->'executionVersion')='number'
        AND CASE WHEN (payload->>'executionVersion') ~ '^[1-9][0-9]*$'
          THEN (payload->>'executionVersion')::numeric <= 9007199254740991 ELSE false END
        AND (
          (payload->'mode'='"DIRECT_DELETE"'::jsonb
            AND payload - ARRAY['operationId','executionVersion','mode']='{}'::jsonb)
          OR (payload->'mode'='"PREPARE"'::jsonb
            AND payload->'purpose'='"DIRECT_DELETE"'::jsonb
            AND (payload->'protocolVersion'='1'::jsonb OR "definitionVersion">=3 AND payload->'protocolVersion'='2'::jsonb OR "definitionVersion">=4 AND payload->'protocolVersion'='3'::jsonb OR "definitionVersion"=5 AND payload->'protocolVersion'='4'::jsonb)
            AND payload - ARRAY['operationId','executionVersion','mode','purpose','protocolVersion']='{}'::jsonb)
        )
      ),false))
    )
  )
);
