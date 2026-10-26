import { Prisma } from '@prisma/client'
import { assertArtworkDedupExecution, type ArtworkDedupExecution } from './artwork-dedup'
import { ArtworkDedupOperationError } from './artwork-dedup-operation'

export const ARTWORK_DEDUP_PARTIAL_EVIDENCE_VERSION = 'sha256-multiset-overlap-v1'
export function assertArtworkDedupPartialSummary(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ArtworkDedupOperationError('PARTIAL_EVIDENCE_REQUIRED')
  const v = value as Record<string, Prisma.JsonValue>
  const counts = ['leftFileCount', 'rightFileCount', 'pairedCount', 'exactCount', 'similarCount', 'leftUnmatchedCount', 'rightUnmatchedCount', 'leftUncheckedCount', 'rightUncheckedCount']
  if (v.evidenceVersion !== ARTWORK_DEDUP_PARTIAL_EVIDENCE_VERSION ||
    !Number.isSafeInteger(v.leftArtworkId) || !Number.isSafeInteger(v.rightArtworkId) ||
    Number(v.leftArtworkId) <= 0 || Number(v.leftArtworkId) >= Number(v.rightArtworkId) ||
    counts.some(key => typeof v[key] !== 'string' || !/^\d{1,10}$/.test(v[key] as string)))
    throw new ArtworkDedupOperationError('PARTIAL_EVIDENCE_REQUIRED')
  const n = (key: string) => BigInt(v[key] as string)
  const left = n('leftFileCount'), right = n('rightFileCount'), paired = n('pairedCount')
  if (!left || !right || n('similarCount') || n('leftUncheckedCount') || n('rightUncheckedCount') ||
    paired !== n('exactCount') || !n('leftUnmatchedCount') || !n('rightUnmatchedCount') ||
    paired + n('leftUnmatchedCount') !== left || paired + n('rightUnmatchedCount') !== right ||
    paired * 5n < (left < right ? left : right) * 4n)
    throw new ArtworkDedupOperationError('PARTIAL_EVIDENCE_REQUIRED')
  return { leftArtworkId: Number(v.leftArtworkId), rightArtworkId: Number(v.rightArtworkId),
    leftFileCount: left, rightFileCount: right, pairedCount: paired }
}

/** Recompute from each side's frozen original files, including repeated occurrences.
 * File SHA/identity and full-scope freshness remain independently mandatory.
 */
export async function assertArtworkDedupPartialFileEvidence(tx: Prisma.TransactionClient, operationId: string, value: Prisma.JsonValue | null) {
  const summary = assertArtworkDedupPartialSummary(value)
  const [row] = await tx.$queryRaw<{ leftCount: bigint; rightCount: bigint; paired: bigint; invalid: boolean }[]>(Prisma.sql`
    WITH counts AS MATERIALIZED (
      SELECT "artworkId",size,sha256,count(*) n FROM "ArtworkDedupOperationFile"
      WHERE "operationId"=${operationId} AND role='MEDIA' GROUP BY "artworkId",size,sha256
    ) SELECT
      coalesce((SELECT sum(n) FROM counts WHERE "artworkId"=${summary.leftArtworkId}),0)::bigint "leftCount",
      coalesce((SELECT sum(n) FROM counts WHERE "artworkId"=${summary.rightArtworkId}),0)::bigint "rightCount",
      coalesce((SELECT sum(least(l.n,r.n)) FROM counts l JOIN counts r ON l.size=r.size AND l.sha256=r.sha256
        WHERE l."artworkId"=${summary.leftArtworkId} AND r."artworkId"=${summary.rightArtworkId}),0)::bigint paired,
      EXISTS(SELECT 1 FROM counts WHERE size IS NULL OR size<=0 OR sha256 IS NULL
        OR "artworkId" NOT IN (${summary.leftArtworkId},${summary.rightArtworkId})) invalid`)
  if (!row || row.invalid || row.leftCount !== summary.leftFileCount || row.rightCount !== summary.rightFileCount || row.paired !== summary.pairedCount)
    throw new ArtworkDedupOperationError('PARTIAL_EVIDENCE_REQUIRED')
  return summary
}

/** A threshold-safe rare-key prefix must share a posting with every qualifying
 * candidate: at most floor(N/5) short-side occurrences may be absent. One pair
 * per checkpoint keeps application memory bounded; PostgreSQL owns spillable
 * tuple aggregation and page generation. The cursor never truncates a hot key.
 */
export async function buildArtworkDedupPartialPage(tx: Prisma.TransactionClient, input: { execution: ArtworkDedupExecution }) {
  const run = await assertArtworkDedupExecution(tx, input.execution)
  const [item] = await tx.$queryRaw<{ artworkId: number; memberCount: bigint }[]>(Prisma.sql`
    SELECT i."artworkId",i."memberCount" FROM "ArtworkDedupItem" i
    WHERE i."runId"=${run.id} AND i.status='COMPLETE' AND i."artworkId">=${run.partialAfterArtworkId}
      AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupGroupMember" m JOIN "ArtworkDedupGroupMember" earlier ON earlier."groupId"=m."groupId" AND earlier."artworkId"<m."artworkId"
        WHERE m."runId"=i."runId" AND m."artworkId"=i."artworkId") ORDER BY i."artworkId" LIMIT 1`)
  if (!item) return true
  const after = item.artworkId === run.partialAfterArtworkId ? run.partialAfterCandidateId : 0
  const [candidate] = await tx.$queryRaw<{ artworkId: number; memberCount: bigint; paired: bigint }[]>(Prisma.sql`
    WITH required AS MATERIALIZED (
      SELECT size,sha256,count(*) n FROM "ArtworkDedupMedia" WHERE "runId"=${run.id} AND "artworkId"=${item.artworkId} GROUP BY size,sha256
    ), frequencies AS (
      SELECT q.*,(SELECT count(DISTINCT p."artworkId") FROM "ArtworkDedupMedia" p
        WHERE p."runId"=${run.id} AND p.size=q.size AND p.sha256=q.sha256) frequency FROM required q
    ), prefix AS MATERIALIZED (
      SELECT * FROM (SELECT *,coalesce(sum(n) OVER(ORDER BY frequency,size,sha256 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) before FROM frequencies) ranked
      WHERE before<=${item.memberCount / 5n}
    ), candidate AS MATERIALIZED (
      SELECT i."artworkId",i."memberCount" FROM prefix q
      JOIN "ArtworkDedupMedia" p ON p."runId"=${run.id} AND p.size=q.size AND p.sha256=q.sha256
      JOIN "ArtworkDedupItem" i ON i."runId"=p."runId" AND i."artworkId"=p."artworkId"
      WHERE i.status='COMPLETE' AND i."artworkId">${after}
        AND (i."memberCount">${item.memberCount} OR i."memberCount"=${item.memberCount} AND i."artworkId">${item.artworkId})
        AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupGroupMember" m JOIN "ArtworkDedupGroupMember" earlier ON earlier."groupId"=m."groupId" AND earlier."artworkId"<m."artworkId"
          WHERE m."runId"=i."runId" AND m."artworkId"=i."artworkId")
      GROUP BY i."artworkId",i."memberCount" ORDER BY i."artworkId" LIMIT 1
    ) SELECT c.*,coalesce((SELECT sum(least(q.n,p.n)) FROM required q JOIN (
      SELECT size,sha256,count(*) n FROM "ArtworkDedupMedia" WHERE "runId"=${run.id} AND "artworkId"=c."artworkId" GROUP BY size,sha256
    ) p ON q.size=p.size AND q.sha256=p.sha256),0)::bigint paired FROM candidate c`)
  if (candidate && candidate.paired * 5n >= item.memberCount * 4n && candidate.paired < item.memberCount && candidate.paired < candidate.memberCount) {
    const left = Math.min(item.artworkId, candidate.artworkId), right = Math.max(item.artworkId, candidate.artworkId)
    const leftCount = left === item.artworkId ? item.memberCount : candidate.memberCount
    const rightCount = right === item.artworkId ? item.memberCount : candidate.memberCount
    const pairId = `partial:${run.id}:${left}:${right}`
    const summary = { evidenceVersion: ARTWORK_DEDUP_PARTIAL_EVIDENCE_VERSION, leftArtworkId: left, rightArtworkId: right,
      leftFileCount: String(leftCount), rightFileCount: String(rightCount), pairedCount: String(candidate.paired), exactCount: String(candidate.paired), similarCount: '0',
      leftUnmatchedCount: String(leftCount - candidate.paired), rightUnmatchedCount: String(rightCount - candidate.paired), leftUncheckedCount: '0', rightUncheckedCount: '0' }
    assertArtworkDedupPartialSummary(summary)
    await tx.artworkDedupVisualPair.create({ data: { id: pairId, runId: run.id, relationKind: 'PARTIAL', leftArtworkId: left, rightArtworkId: right, summary } })
    await tx.$executeRaw(Prisma.sql`
      WITH pages AS MATERIALIZED (
        SELECT m."artworkId",m."imageId",m.size,m.sha256,
          (row_number() OVER(PARTITION BY m."artworkId" ORDER BY i."sortOrder",m."imageId")-1)::int idx,
          row_number() OVER(PARTITION BY m."artworkId",m.size,m.sha256 ORDER BY i."sortOrder",m."imageId") occurrence
        FROM "ArtworkDedupMedia" m JOIN "Image" i ON i.id=m."imageId" AND i."artworkId"=m."artworkId"
        WHERE m."runId"=${run.id} AND m."artworkId" IN (${left},${right})
      ), paired AS (
        SELECT l."imageId" lid,r."imageId" rid,l.idx li,r.idx ri FROM (SELECT * FROM pages WHERE "artworkId"=${left}) l
        FULL JOIN (SELECT * FROM pages WHERE "artworkId"=${right}) r ON l.size=r.size AND l.sha256=r.sha256 AND l.occurrence=r.occurrence
      ) INSERT INTO "ArtworkDedupVisualPage" ("pairId",ordinal,kind,"leftImageId","rightImageId","leftIndex","rightIndex")
      SELECT ${pairId},row_number() OVER(ORDER BY li NULLS LAST,ri)::int,CASE WHEN lid IS NOT NULL AND rid IS NOT NULL THEN 'EXACT' ELSE 'UNMATCHED' END,lid,rid,li,ri FROM paired`)
    // A concurrent inventory change must never publish a truncated comparison.
    const [counts] = await tx.$queryRaw<{ leftCount: bigint; rightCount: bigint; exact: bigint }[]>(Prisma.sql`
      SELECT count("leftImageId") "leftCount",count("rightImageId") "rightCount",count(*) FILTER(WHERE kind='EXACT') exact
      FROM "ArtworkDedupVisualPage" WHERE "pairId"=${pairId}`)
    if (counts?.leftCount !== leftCount || counts.rightCount !== rightCount || counts.exact !== candidate.paired)
      throw new ArtworkDedupOperationError('PARTIAL_EVIDENCE_REQUIRED')
  }
  await tx.artworkDedupRun.update({ where: { id: run.id }, data: candidate
    ? { partialAfterArtworkId: item.artworkId, partialAfterCandidateId: candidate.artworkId }
    : { partialAfterArtworkId: item.artworkId + 1, partialAfterCandidateId: 0 } })
  return false
}
