import type { Prisma } from '@pixishelf/db'
import { hashResolvedMetadata } from './providers/e-hentai.ts'
import type { ResolvedArchive } from './types.ts'

export async function isPublishedArchiveUnchanged(
  transaction: Prisma.TransactionClient,
  reference: { id: string; archiveRevisions: Array<{ metadataHash: string }> },
  resolved: Pick<ResolvedArchive, 'providerKey' | 'normalizedMetadata'>,
  metadataHash: string
): Promise<boolean> {
  const currentHash = reference.archiveRevisions[0]?.metadataHash
  if (!currentHash) return false
  if (currentHash === metadataHash) return true
  if (resolved.providerKey !== 'e-hentai') return false

  // Compare against the published revision, even when newer source snapshots exist.
  // Keep full snapshot hashes unchanged so historical archives need no backfill.
  const snapshot = await transaction.artworkSourceSnapshot.findUnique({
    where: { externalRefId_metadataHash: { externalRefId: reference.id, metadataHash: currentHash } },
    select: { normalizedMetadata: true }
  })
  const previous = snapshot?.normalizedMetadata
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return false
  return hashUpdateMetadata(previous) === hashUpdateMetadata(resolved.normalizedMetadata)
}

function hashUpdateMetadata(metadata: Record<string, unknown>): string {
  return hashResolvedMetadata(
    Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== 'tags' && key !== 'rating'))
  )
}
