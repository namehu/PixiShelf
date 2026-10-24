import { Prisma } from '@prisma/client'
import { ArtworkDedupOperationError } from './artwork-dedup-operation'
import { lockContentDirectories } from './media-content-common'
import type { MediaContentLogicalRoot } from './media-content-types'

/** Internal state primitive: caller owns operation/version/fence and verified lifecycle/drain evidence.
 * This never releases artwork claims or authorizes file actions. */
export async function reopenArtworkDedupSources(
  tx: Prisma.TransactionClient,
  input: { operationId: string; sources: readonly { sourceId: string; expectedGeneration: bigint }[] }
) {
  if (
    !input.operationId ||
    input.sources.length < 1 ||
    input.sources.length > 20000 ||
    new Set(input.sources.map((source) => source.sourceId)).size !== input.sources.length ||
    input.sources.some((source) => !source.sourceId || source.expectedGeneration < 0n)
  ) {
    throw new TypeError('Invalid source release scope')
  }
  const ids = input.sources.map((source) => source.sourceId)
  const selected = await tx.artworkDedupSourceIdentity.findMany({ where: { id: { in: ids } } })
  if (selected.length !== ids.length) throw new ArtworkDedupOperationError('SOURCE_IDENTITY_CHANGED')
  const roots = selected.flatMap((source) =>
    source.kind === 'PROVIDER'
      ? []
      : [
          {
            logicalRoot: source.logicalRoot as MediaContentLogicalRoot,
            rootIdentity: source.rootIdentity!,
            relativeDirectory: ''
          }
        ]
  )
  await lockContentDirectories(tx, [
    ...new Map(roots.map((root) => [root.logicalRoot + ':' + root.rootIdentity, root])).values()
  ])
  // Segment-boundary comparisons cover PATH -> ancestor DIRECTORY and DIRECTORY -> every descendant.
  const overlap = Prisma.sql`WITH selected AS MATERIALIZED(
    SELECT * FROM "ArtworkDedupSourceIdentity" WHERE id IN (${Prisma.join(ids)})
  ) SELECT s.id FROM "ArtworkDedupSourceIdentity" s WHERE s.id IN (${Prisma.join(ids)}) OR EXISTS(
    SELECT 1 FROM selected p WHERE p.kind IN ('PATH','DIRECTORY') AND s.kind IN ('PATH','DIRECTORY')
      AND s."logicalRoot"=p."logicalRoot" AND s."rootIdentity"=p."rootIdentity" AND (
        s."canonicalPath"=p."canonicalPath"
        OR s.kind='DIRECTORY' AND (s."canonicalPath"='' OR left(p."canonicalPath",length(s."canonicalPath")+1)=s."canonicalPath"||'/')
        OR p.kind='DIRECTORY' AND (p."canonicalPath"='' OR left(s."canonicalPath",length(p."canonicalPath")+1)=p."canonicalPath"||'/')
      ))`
  const affected = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT s.id FROM "ArtworkDedupSourceIdentity" s WHERE s.id IN (${overlap})
    ORDER BY s."identityKey" COLLATE "C" FOR UPDATE OF s`)
  const current = await tx.artworkDedupSourceIdentity.findMany({ where: { id: { in: ids } } })
  const expected = new Map(input.sources.map((source) => [source.sourceId, source.expectedGeneration]))
  if (
    current.some(
      (source) => source.ownerOperationId !== input.operationId || !['HOLD', 'TOMBSTONE'].includes(source.status)
    )
  ) {
    throw new ArtworkDedupOperationError('SOURCE_HELD')
  }
  if (current.some((source) => source.generation !== expected.get(source.id))) {
    throw new ArtworkDedupOperationError('SOURCE_GENERATION_CHANGED')
  }
  await tx.artworkDedupSourceIdentity.updateMany({
    where: { id: { in: affected.map((source) => source.id) } },
    data: { generation: { increment: 1n } }
  })
  await tx.artworkDedupSourceIdentity.updateMany({
    where: { id: { in: ids }, ownerOperationId: input.operationId },
    data: { status: 'OPEN', ownerOperationId: null }
  })
  return { releasedSources: ids.length, invalidatedSources: affected.length }
}
