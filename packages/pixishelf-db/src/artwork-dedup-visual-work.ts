import { Prisma } from '@prisma/client'
import { assertArtworkDedupExecution, type ArtworkDedupExecution } from './artwork-dedup'
import { activeCreatorMembership, visibleCreatorArtwork } from './creators'
import { lockContentArtworks } from './media-content-common'

/** Caller owns the run's control/execution fence; persistent feature caches survive retry. */
export async function resetArtworkDedupVisualWork(tx: Prisma.TransactionClient, runId: string) {
  await tx.artworkDedupVisualPosting.deleteMany({ where: { runId } })
  await tx.artworkDedupVisualCandidate.deleteMany({ where: { runId } })
  await tx.artworkDedupItem.updateMany({ where: { runId }, data: { visualReuseSignature: null } })
  await tx.artworkDedupRun.update({ where: { id: runId }, data: { visualCheckpoint: Prisma.DbNull } })
}

/** Directory/root guards must already be held. Batch the same per-item/current
 * snapshot checks without releasing the Artwork locks before checkpoint commit. */
export async function assertArtworkDedupVisualItems(tx: Prisma.TransactionClient, execution: ArtworkDedupExecution, artworkIds: readonly number[]) {
  if (!artworkIds.length || artworkIds.length > 51 || artworkIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new RangeError('Visual item guard batch')
  const ids = [...new Set(artworkIds)].sort((a, b) => a - b)
  const run = await assertArtworkDedupExecution(tx, execution)
  await lockContentArtworks(tx, ids)
  const items = await tx.artworkDedupItem.findMany({ where: { runId: run.id, artworkId: { in: ids } },
    select: { artworkId: true, status: true, frozenMediaRevision: true, snapshotRevision: true, mediaEpoch: true, memberCount: true } })
  const artworks = await tx.artwork.findMany({ where: { id: { in: ids }, ...visibleCreatorArtwork,
    creators: { some: { artistId: run.artistId, ...activeCreatorMembership, artist: { mergedIntoId: null } } } },
    select: { id: true, mediaRevision: true, contentSource: { select: { revision: true, mediaEpoch: true, writeToken: true } } } })
  if (items.length !== ids.length || artworks.length !== ids.length) return false
  const byId = new Map(artworks.map(artwork => [artwork.id, artwork]))
  return items.every(item => {
    const artwork = byId.get(item.artworkId)
    return artwork && item.status === 'COMPLETE' && item.snapshotRevision !== null && item.mediaEpoch !== null && item.memberCount !== null &&
      artwork.mediaRevision === item.frozenMediaRevision && !artwork.contentSource?.writeToken &&
      (artwork.contentSource?.revision ?? 0n) === item.snapshotRevision && (artwork.contentSource?.mediaEpoch ?? 0n) === item.mediaEpoch
  })
}
