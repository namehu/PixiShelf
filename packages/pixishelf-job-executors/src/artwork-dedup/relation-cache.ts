import { createHash } from 'node:crypto'
import { Prisma, ARTWORK_DEDUP_RELATION_CACHE_VERSION, artworkDedupRepresentativeSql, lockArtworkDedupRelationCache } from '@pixishelf/db'
import { VISUAL_PARAMETER_PRESETS } from './visual-experiment.ts'
import { VISUAL_ALGORITHM_VERSION, VISUAL_NORMALIZATION_VERSION, VISUAL_LIMITS, type VisualPage, type VisualPairEvidence, type VisualRelationReuse } from './visual-matching.ts'

export function visualRelationSignature(pages: readonly VisualPage[]) {
  return createHash('sha256').update(JSON.stringify([
    ARTWORK_DEDUP_RELATION_CACHE_VERSION, VISUAL_ALGORITHM_VERSION, VISUAL_NORMALIZATION_VERSION, VISUAL_PARAMETER_PRESETS[1],
    [...pages].sort((a, b) => a.imageId - b.imageId).map(p => [p.imageId, p.size.toString(), p.sha256, p.views])
  ])).digest('hex')
}

/** Materialize bounded evidence while the historical parent is share-locked.
 * Nothing outside this transaction depends on historical rows remaining alive.
 */
export async function readVisualRelationReuse(tx: Prisma.TransactionClient, run: Prisma.ArtworkDedupRunGetPayload<Record<string, never>>, pages: VisualPage[], signatures: Map<number, string>): Promise<VisualRelationReuse | undefined> {
  const baseId = await lockArtworkDedupRelationCache(tx, run, true)
  if (!baseId || !pages.length) return undefined
  const old = await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: baseId }, select: { visualCandidatePairs: true } })
  if (old.visualCandidatePairs.length > VISUAL_LIMITS.artworkPairs || old.visualCandidatePairs.some(key => !/^[1-9]\d*:[1-9]\d*$/.test(key))) return undefined
  const items = await tx.$queryRaw<{ artworkId: number; visualSignature: string | null; compatibleRepresentative: boolean }[]>(Prisma.sql`
    SELECT i."artworkId",i."visualSignature",
      (${artworkDedupRepresentativeSql(baseId, Prisma.sql`i."artworkId"`)} = ${artworkDedupRepresentativeSql(run.id, Prisma.sql`i."artworkId"`)}) "compatibleRepresentative"
    FROM "ArtworkDedupItem" i WHERE i."runId"=${baseId} AND i."artworkId" IN (${Prisma.join([...signatures.keys()])})`)
  const artworks = new Set(items.filter(i => i.compatibleRepresentative && i.visualSignature === signatures.get(i.artworkId)).map(i => i.artworkId))
  const candidatePairs = old.visualCandidatePairs.filter(key => key.split(':').every(id => artworks.has(Number(id))))
  const stored = artworks.size ? await tx.artworkDedupVisualPair.findMany({ where: { runId: baseId, relationKind: 'VISUAL', leftArtworkId: { in: [...artworks] }, rightArtworkId: { in: [...artworks] } },
    take: VISUAL_LIMITS.artworkPairs + 1, include: { pages: { orderBy: { ordinal: 'asc' }, take: VISUAL_LIMITS.artworkFiles * 2 + 1 } } }) : []
  if (stored.length > VISUAL_LIMITS.artworkPairs) return undefined
  const byId = new Map(pages.map(p => [p.imageId, p]))
  const counts = new Map<number, number>()
  for (const page of pages) counts.set(page.artworkId, (counts.get(page.artworkId) ?? 0) + 1)
  const pairs: VisualPairEvidence[] = []
  for (const pair of stored) {
    if (!candidatePairs.includes(`${pair.leftArtworkId}:${pair.rightArtworkId}`) || pair.pages.length > VISUAL_LIMITS.artworkFiles * 2) return undefined
    const evidence: VisualPairEvidence['pages'] = [], leftIds = new Set<number>(), rightIds = new Set<number>()
    for (const p of pair.pages) {
      const left = p.leftImageId === null ? null : byId.get(p.leftImageId), right = p.rightImageId === null ? null : byId.get(p.rightImageId)
      if (left === undefined || right === undefined || !left && !right ||
        left && (left.artworkId !== pair.leftArtworkId || leftIds.has(left.imageId)) ||
        right && (right.artworkId !== pair.rightArtworkId || rightIds.has(right.imageId)) ||
        !['EXACT', 'SIMILAR', 'UNMATCHED'].includes(p.kind) ||
        (p.kind === 'UNMATCHED' ? !!left === !!right : !left || !right) ||
        p.kind === 'EXACT' && (left!.size !== right!.size || left!.sha256 !== right!.sha256)) return undefined
      if (left) leftIds.add(left.imageId)
      if (right) rightIds.add(right.imageId)
      evidence.push({ kind: p.kind as 'EXACT' | 'SIMILAR' | 'UNMATCHED', left, right })
    }
    if (leftIds.size !== counts.get(pair.leftArtworkId) || rightIds.size !== counts.get(pair.rightArtworkId)) return undefined
    pairs.push({ leftArtworkId: pair.leftArtworkId, rightArtworkId: pair.rightArtworkId, pages: evidence })
  }
  return { artworks, candidatePairs, pairs }
}
