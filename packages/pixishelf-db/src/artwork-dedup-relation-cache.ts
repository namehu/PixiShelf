import { Prisma } from '@prisma/client'
import { assertArtworkDedupVisualDirectories } from './artwork-dedup-visual'
import { lockCreatorCatalog } from './creators'
import { lockContentDirectories } from './media-content-common'

// Bump for candidate, threshold, precedence or assignment semantics changes.
// Feature/normalization/parameter changes additionally change each visual signature.
export const ARTWORK_DEDUP_RELATION_CACHE_VERSION = 'original-multiset-v1:partial80-v1:visual-local1-v1'
type Run = Prisma.ArtworkDedupRunGetPayload<Record<string, never>>

/** Excluded media do not invalidate fully compared artwork signatures. Budget/error gaps do. */
export function artworkDedupVisualReusableRunSql() {
  return Prisma.sql`(r."visualStatus"='COMPLETE'
    OR (r."visualStatus"='INCOMPLETE' AND r."visualIncompleteReasons"=ARRAY['UNSUPPORTED_MEDIA']::text[]
      AND r."visualCheckpoint"->>'phase'='PUBLISH'))`
}

/** No cross-checkpoint reference: hold the historical run while copying this
 * checkpoint's evidence, then the current cursor/results are self-contained.
 */
export async function lockArtworkDedupRelationCache(tx: Prisma.TransactionClient, run: Run, visual = false) {
  if (run.mode === 'FULL') return null
  const [base] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT r.id FROM "ArtworkDedupRun" r
    WHERE r."artistId"=${run.artistId} AND r.id<>${run.id} AND r.status='COMPLETED' AND r.stage='DONE'
      AND r."algorithmVersion"=${run.algorithmVersion} AND r."relationCacheVersion"=${ARTWORK_DEDUP_RELATION_CACHE_VERSION}
      AND (${!visual} OR ${artworkDedupVisualReusableRunSql()})
      AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupItem" i WHERE i."runId"=r.id AND i.status<>'COMPLETE')
    ORDER BY r."frozenAt" DESC,r.id DESC LIMIT 1 FOR SHARE OF r`)
  return base?.id ?? null
}

export function artworkDedupRepresentativeSql(runId: string, artworkId: Prisma.Sql) {
  return Prisma.sql`NOT EXISTS(SELECT 1 FROM "ArtworkDedupGroupMember" m
    JOIN "ArtworkDedupGroupMember" earlier ON earlier."groupId"=m."groupId" AND earlier."artworkId"<m."artworkId"
    WHERE m."runId"=${runId} AND m."artworkId"=${artworkId})`
}

/** Current candidates are already representatives. A newly promoted/demoted
 * representative must not inherit an old absence caused by representative filtering.
 */
export function artworkDedupOriginalReusableSql(baseId: string | null, runId: string, left: Prisma.Sql, right: Prisma.Sql) {
  if (!baseId) return Prisma.sql`false`
  return Prisma.sql`(SELECT count(*)=2 FROM "ArtworkDedupItem" old
    JOIN "ArtworkDedupItem" current ON current."runId"=${runId} AND current."artworkId"=old."artworkId"
    WHERE old."runId"=${baseId} AND old."artworkId" IN (${left},${right}) AND old.status='COMPLETE'
      AND old."contentSha256" IS NOT NULL AND old."contentSha256"=current."contentSha256"
      AND old."memberCount"=current."memberCount"
      AND ${artworkDedupRepresentativeSql(baseId, Prisma.sql`old."artworkId"`)})`
}

/** Match source release's catalog -> all roots -> directories -> Artwork order.
 * Lock both roots before paging: directory-ID order is not logical-root order.
 * Negative evidence needs the same guards as published positive relationships.
 */
export async function assertArtworkDedupCacheDirectories(tx: Prisma.TransactionClient, runId: string, artworkIds?: readonly number[]) {
  if (artworkIds && (artworkIds.length === 0 || artworkIds.length > 51)) throw new RangeError('Visual guard batch')
  const scope = artworkIds ? Prisma.sql`AND m."artworkId" IN (${Prisma.join(artworkIds)})` : Prisma.empty
  await lockCreatorCatalog(tx)
  const roots = await tx.$queryRaw<{ logicalRoot: 'source-media:v1' | 'archive-media:v1'; rootIdentity: string }[]>(Prisma.sql`
    SELECT DISTINCT m."logicalRoot",m."rootIdentity" FROM "ArtworkDedupMedia" m
    JOIN "ArtworkDedupItem" i ON i."runId"=m."runId" AND i."artworkId"=m."artworkId"
    WHERE m."runId"=${runId} AND i.status='COMPLETE' ${scope} LIMIT 3`)
  if (roots.length > 2 || new Set(roots.map(r => r.logicalRoot)).size !== roots.length ||
    roots.some(r => !['source-media:v1', 'archive-media:v1'].includes(r.logicalRoot))) return false
  await lockContentDirectories(tx, roots.map(root => ({ ...root, relativeDirectory: '' })))
  let after = ''
  for (;;) {
    const rows = await tx.$queryRaw<{ logicalRoot: 'source-media:v1' | 'archive-media:v1'; rootIdentity: string; relativeDirectory: string; directoryId: string; generation: bigint }[]>(Prisma.sql`
      SELECT DISTINCT m."logicalRoot",m."rootIdentity",m."relativeDirectory",m."directoryId",m."directoryGeneration" generation
      FROM "ArtworkDedupMedia" m JOIN "ArtworkDedupItem" i ON i."runId"=m."runId" AND i."artworkId"=m."artworkId"
      WHERE m."runId"=${runId} AND i.status='COMPLETE' ${scope} AND m."directoryId">${after}
      ORDER BY m."directoryId" LIMIT 100`)
    if (!rows.length) return true
    if (!(await assertArtworkDedupVisualDirectories(tx, rows))) return false
    after = rows.at(-1)!.directoryId
  }
}
