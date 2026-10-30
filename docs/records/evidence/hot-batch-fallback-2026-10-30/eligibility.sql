-- Historical diagnostic for the pre-fix v9 gate. ARTWORK_SOURCE_MISSING is a
-- legal default-zero state; this label explains why the OLD fast path rejected it.
-- Query result is a post-completion snapshot, not a reconstructed historical event.
WITH scoped AS (
SELECT r.id AS run_id,r."algorithmVersion",r."rootBindings",r."finishedAt",
 i."artworkId",i."frozenMediaRevision",i."snapshotRevision",i."mediaEpoch" AS frozen_epoch,i."memberCount",
 a."mediaRevision",a.source,s.revision,s."mediaEpoch",s."writeToken" IS NOT NULL AS artwork_writing,s."updatedAt" AS source_updated,
 f."algorithmVersion" AS fingerprint_version,f."sourceRevision",f."mediaEpoch" AS fingerprint_epoch,f."fileCount",f."completedAt",
 CASE WHEN a.source='URL_ARCHIVE' THEN r."rootBindings"->'archive' ELSE r."rootBindings"->'source' END AS root
 FROM "ArtworkDedupRun" r JOIN "ArtworkDedupItem" i ON i."runId"=r.id
 JOIN "Artwork" a ON a.id=i."artworkId"
 LEFT JOIN "ArtworkContentSource" s ON s."artworkId"=a.id
 LEFT JOIN "ArtworkContentFingerprint" f ON f."artworkId"=a.id
 WHERE r.id='face2cc2-35b7-4d68-9859-394ea453acbe'
), members AS (
 SELECT s."artworkId",m.id,m."updatedAt" AS image_updated,
 CASE
 WHEN ms."imageId" IS NULL THEN 'MEDIA_SOURCE_MISSING'
 WHEN d.id IS NULL THEN 'DIRECTORY_MISSING'
 WHEN ms."writeToken" IS NOT NULL THEN 'MEDIA_WRITING'
 WHEN mf."imageId" IS NULL THEN 'MEDIA_FINGERPRINT_MISSING'
 WHEN d."logicalRoot" IS DISTINCT FROM s.root->>'logicalRoot' THEN 'DIRECTORY_LOGICAL_ROOT'
 WHEN d."rootIdentity" IS DISTINCT FROM s.root->>'rootIdentity' THEN 'DIRECTORY_ROOT_IDENTITY'
 WHEN d."relativeDirectory" IS DISTINCT FROM
   CASE WHEN strpos(regexp_replace(m.path,'^/+',''),'/')=0 THEN ''
   ELSE regexp_replace(CASE WHEN s.source='URL_ARCHIVE' AND coalesce(s."rootBindings"->>'archiveRelativePrefix','')<>'' THEN
     (s."rootBindings"->>'archiveRelativePrefix') || '/' || regexp_replace(m.path,'^/+','')
   ELSE regexp_replace(m.path,'^/+','') END,'/[^/]*$','') END THEN 'DIRECTORY_RELATIVE_PATH'
 WHEN mf."algorithmVersion" IS DISTINCT FROM s."algorithmVersion" THEN 'MEDIA_ALGORITHM'
 WHEN mf."sourceRevision" IS DISTINCT FROM ms.revision THEN 'MEDIA_SOURCE_REVISION'
 WHEN mf."artworkMediaEpoch" IS DISTINCT FROM s.fingerprint_epoch THEN 'MEDIA_EPOCH'
 WHEN mf."sourcePath" IS DISTINCT FROM m.path THEN 'MEDIA_PATH'
 WHEN mf."rootIdentity" IS DISTINCT FROM s.root->>'rootIdentity' THEN 'MEDIA_ROOT_IDENTITY'
 ELSE 'ELIGIBLE_DB' END AS media_condition,
 mf."hashedAt",ms."updatedAt" AS media_source_updated
 FROM scoped s JOIN "Image" m ON m."artworkId"=s."artworkId"
 LEFT JOIN "MediaContentSource" ms ON ms."imageId"=m.id
 LEFT JOIN "MediaContentFingerprint" mf ON mf."imageId"=m.id
 LEFT JOIN "MediaContentDirectoryState" d ON d.id=ms."directoryStateId"
), aggregated AS (
 SELECT "artworkId",count(*) AS member_count,
 count(*) FILTER(WHERE media_condition <> 'ELIGIBLE_DB') AS ineligible_media,
 min(id) FILTER(WHERE media_condition <> 'ELIGIBLE_DB') AS first_ineligible_image,
 string_agg(DISTINCT media_condition, ',') AS media_conditions,
 max(image_updated) AS last_image_updated,max(media_source_updated) AS last_media_source_updated,max("hashedAt") AS last_hashed_at
 FROM members GROUP BY "artworkId"
)
SELECT now() AS captured_at,s."artworkId",s.source,s."memberCount" AS frozen_count,s."fileCount" AS cached_count,a.member_count,
 CASE WHEN s.revision IS NULL THEN 'ARTWORK_SOURCE_MISSING'
 WHEN s.fingerprint_version IS NULL THEN 'ARTWORK_FINGERPRINT_MISSING'
 WHEN s.artwork_writing THEN 'ARTWORK_WRITING'
 WHEN s.fingerprint_version<>s."algorithmVersion" THEN 'ARTWORK_ALGORITHM'
 WHEN s."sourceRevision" IS DISTINCT FROM s.revision THEN 'ARTWORK_REVISION'
 WHEN s.fingerprint_epoch IS DISTINCT FROM s."mediaEpoch" THEN 'ARTWORK_EPOCH'
 WHEN s."fileCount" <= 0 OR s."fileCount" IS DISTINCT FROM a.member_count THEN 'ARTWORK_COUNT'
 ELSE 'ELIGIBLE_DB' END AS artwork_condition,
 a.ineligible_media,a.first_ineligible_image,a.media_conditions,
 s."mediaRevision"=s."frozenMediaRevision" AS media_revision_unchanged,
 s.source_updated,s."completedAt",a.last_image_updated,a.last_media_source_updated,a.last_hashed_at
FROM scoped s LEFT JOIN aggregated a USING("artworkId") ORDER BY s."artworkId" LIMIT 60;