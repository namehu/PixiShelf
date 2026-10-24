import { Prisma } from '@prisma/client'
import { ArtworkDedupOperationError } from './artwork-dedup-operation'

export function artworkDedupBoundRoots(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ArtworkDedupOperationError('ROOT_CHANGED')
  const v = value as { version?: unknown; source?: unknown; archive?: unknown; archiveRelativePrefix?: unknown }
  const root = (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new ArtworkDedupOperationError('ROOT_CHANGED')
    const r = input as { logicalRoot?: unknown; rootIdentity?: unknown }
    if (
      !['source-media:v1', 'archive-media:v1'].includes(String(r.logicalRoot)) ||
      typeof r.rootIdentity !== 'string' ||
      !r.rootIdentity
    )
      throw new ArtworkDedupOperationError('ROOT_CHANGED')
    return { logicalRoot: r.logicalRoot as string, rootIdentity: r.rootIdentity }
  }
  if (
    v.version !== 1 ||
    typeof v.archiveRelativePrefix !== 'string' ||
    /\\|^\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(v.archiveRelativePrefix)
  )
    throw new ArtworkDedupOperationError('ROOT_CHANGED')
  return { source: root(v.source), archive: root(v.archive), archiveRelativePrefix: v.archiveRelativePrefix }
}
/** SQL keeps cross-artwork/role reference checks bounded by indexed canonical paths, never a JS catalog. */
export async function refreshArtworkDedupFileOwnership(
  tx: Prisma.TransactionClient,
  input: { operationId: string; rootBindings: Prisma.JsonValue | null; referenceKeys?: string[] }
) {
  const roots = artworkDedupBoundRoots(input.rootBindings)
  if (input.referenceKeys?.length === 0) return { changedFiles: 0n, updatedFiles: 0n, totalFiles: 0n }
  if (input.referenceKeys && input.referenceKeys.length > 100) throw new RangeError('At most 100 ownership references')
  const selected = input.referenceKeys
    ? Prisma.sql`AND f."referenceKey" IN(${Prisma.join(input.referenceKeys)})`
    : Prisma.empty
  const [result] = await tx.$queryRaw<{ changedFiles: bigint; updatedFiles: bigint; totalFiles: bigint }[]>(Prisma.sql`
    WITH files AS MATERIALIZED(SELECT f.* FROM "ArtworkDedupOperationFile" f WHERE f."operationId"=${input.operationId} ${selected}),
    addresses AS MATERIALIZED(SELECT DISTINCT "logicalRoot","rootIdentity","canonicalPath" FROM files),
    targets AS MATERIALIZED(
      SELECT a.*,'SOURCE' kind,a."canonicalPath" path FROM addresses a WHERE a."rootIdentity"=${roots.source.rootIdentity} AND a."logicalRoot"=${roots.source.logicalRoot}
      UNION ALL SELECT a.*,'ARCHIVE',CASE WHEN ${roots.archiveRelativePrefix}='' THEN a."canonicalPath" ELSE substring(a."canonicalPath" FROM length(${roots.archiveRelativePrefix})+2) END FROM addresses a WHERE a."rootIdentity"=${roots.archive.rootIdentity} AND a."logicalRoot"=${roots.archive.logicalRoot} AND(${roots.archiveRelativePrefix}='' OR left(a."canonicalPath",length(${roots.archiveRelativePrefix})+1)=${roots.archiveRelativePrefix}||'/')
    ), refs AS (
      SELECT t."logicalRoot",t."rootIdentity",t."canonicalPath",i."artworkId",'MEDIA' role,i.id "imageId",NULL::text "revisionId",'media:'||i.id::text "referenceKey" FROM targets t JOIN "Image" i ON ltrim(replace(i.path,chr(92),'/'),'/')=t.path LEFT JOIN "Artwork" a ON a.id=i."artworkId" WHERE a.id IS NULL OR (a."createdVia"='URL_ARCHIVE')=(t.kind='ARCHIVE')
      UNION ALL SELECT t."logicalRoot",t."rootIdentity",t."canonicalPath",i."artworkId",'CHAPTER',i.id,NULL,'chapter:'||i.id::text FROM targets t JOIN "Image" i ON ltrim(replace(i."chaptersPath",chr(92),'/'),'/')=t.path LEFT JOIN "Artwork" a ON a.id=i."artworkId" WHERE a.id IS NULL OR (a."createdVia"='URL_ARCHIVE')=(t.kind='ARCHIVE')
      UNION ALL SELECT t."logicalRoot",t."rootIdentity",t."canonicalPath",a.id,'SOURCE_FILE',NULL,NULL,'meta:'||a.id::text FROM targets t JOIN "Artwork" a ON ltrim(replace(a."metaSource",chr(92),'/'),'/')=t.path WHERE(a."createdVia"='URL_ARCHIVE')=(t.kind='ARCHIVE')
      UNION ALL SELECT t."logicalRoot",t."rootIdentity",t."canonicalPath",r."artworkId",'SOURCE_FILE',NULL,r.id,'revision:'||r.id||':manifest' FROM targets t JOIN archive_revisions r ON ltrim(replace(r."manifestPath",chr(92),'/'),'/')=t.path WHERE t.kind='ARCHIVE'
    ), ref_counts AS(
      SELECT "logicalRoot","rootIdentity","canonicalPath",count(*) n,min("artworkId") "artworkId",min(role) role,min("imageId") "imageId",min("revisionId") "revisionId",min("referenceKey") "referenceKey" FROM refs GROUP BY "logicalRoot","rootIdentity","canonicalPath"
    ), duplicate_paths AS(
      SELECT x."rootIdentity",x."canonicalPath",count(*) n FROM (SELECT DISTINCT "rootIdentity","canonicalPath" FROM addresses) a JOIN "ArtworkDedupOperationFile" x ON x."operationId"=${input.operationId} AND x."rootIdentity"=a."rootIdentity" AND x."canonicalPath"=a."canonicalPath" GROUP BY x."rootIdentity",x."canonicalPath"
    ), decisions AS(
      SELECT f."fileId",f."ownershipStatus",f.status,f."blockReason",CASE
        WHEN f.role IN('ATTACHMENT','UNKNOWN') OR f."requiresReview" THEN 'UNREVIEWED_ATTACHMENT'
        WHEN r.n>1 OR d.n>1 THEN 'SHARED_PATH'
        WHEN NOT coalesce(r.n=1 AND r."artworkId"=f."artworkId" AND r.role=f.role AND(r.role IN('MEDIA','CHAPTER') AND r."imageId"=f."imageId" OR r.role='SOURCE_FILE' AND r."referenceKey"=f."referenceKey" AND r."revisionId" IS NOT DISTINCT FROM f."revisionId"),false) THEN 'UNVERIFIED_SOURCE_IDENTITY'
        ELSE NULL END reason FROM files f LEFT JOIN ref_counts r ON r."logicalRoot"=f."logicalRoot" AND r."rootIdentity"=f."rootIdentity" AND r."canonicalPath"=f."canonicalPath" LEFT JOIN duplicate_paths d ON d."rootIdentity"=f."rootIdentity" AND d."canonicalPath"=f."canonicalPath"
    ), changes AS MATERIALIZED(
      SELECT "fileId",CASE WHEN reason='SHARED_PATH' THEN 'SHARED' WHEN reason IS NULL THEN 'VERIFIED' ELSE 'UNCONFIRMED' END "ownershipStatus",
        CASE WHEN reason IS NOT NULL THEN 'BLOCKED' ELSE status END status,coalesce(reason,"blockReason") "blockReason"
      FROM decisions WHERE ROW("ownershipStatus",status,"blockReason") IS DISTINCT FROM ROW(
        CASE WHEN reason='SHARED_PATH' THEN 'SHARED' WHEN reason IS NULL THEN 'VERIFIED' ELSE 'UNCONFIRMED' END,
        CASE WHEN reason IS NOT NULL THEN 'BLOCKED' ELSE status END,coalesce(reason,"blockReason"))
    ), updated AS(
      UPDATE "ArtworkDedupOperationFile" f SET "ownershipStatus"=d."ownershipStatus",status=d.status,"blockReason"=d."blockReason","updatedAt"=CURRENT_TIMESTAMP
      FROM (SELECT * FROM changes ORDER BY "fileId" LIMIT 100) d WHERE f."fileId"=d."fileId" RETURNING f."fileId"
    ) SELECT (SELECT count(*) FROM changes) "changedFiles",(SELECT count(*) FROM updated) "updatedFiles",(SELECT count(*) FROM files) "totalFiles"
  `)
  return result!
}
