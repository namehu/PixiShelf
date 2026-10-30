import { Prisma } from '@prisma/client'
import { assertArtworkDedupExecution, type ArtworkDedupExecution, type ArtworkDedupMediaEntry } from './artwork-dedup'
import { activeCreatorMembership, visibleCreatorArtwork } from './creators'
import { assertContentLimit, contentIds, directorySnapshot, lockContentArtworks, lockContentDirectories, lockContentImages } from './media-content-common'
import { contentDirectoriesHaveWriter } from './media-content-directory'
import { MediaContentConflictError, type ArtworkContentSnapshot, type MediaContentDirectorySnapshot, type MediaContentMember, type MediaContentResult } from './media-content-types'

/** Speculative ordinary reads only: the hot commit below owns all publication checks. */
export async function readArtworkDedupStatMembersPage(
  db: Prisma.TransactionClient,
  input: { artworkId: number; afterImageId: number; limit: number }
): Promise<{ members: MediaContentMember[]; nextCursor: number | null }> {
  assertContentLimit(input.limit, 100)
  const rows = await db.image.findMany({
    where: { artworkId: input.artworkId, id: { gt: input.afterImageId } },
    orderBy: { id: 'asc' }, take: input.limit,
    select: { id: true, artworkId: true, path: true, contentSource: { include: { directory: true } }, contentFingerprint: true }
  })
  return {
    members: rows.map(row => ({
      imageId: row.id, artworkId: row.artworkId!, sourcePath: row.path,
      sourceRevision: row.contentSource?.revision ?? 0n, writeToken: row.contentSource?.writeToken ?? null,
      directory: row.contentSource?.directory ? directorySnapshot(row.contentSource.directory) : null,
      fingerprint: row.contentFingerprint
    })),
    nextCursor: rows.length === input.limit ? rows.at(-1)!.id : null
  }
}

/** Must run inside the execution-fenced transaction; no permission survives its commit. */
export async function saveArtworkDedupHotBatch(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; snapshot: ArtworkContentSnapshot; afterImageId: number; algorithmVersion: number; entries: ArtworkDedupMediaEntry[] }
): Promise<MediaContentResult<ArtworkContentSnapshot>> {
  assertContentLimit(input.entries.length, 100)
  const ids = contentIds(input.entries.map(entry => entry.imageId))
  const run = await assertArtworkDedupExecution(tx, input.execution)
  try {
    const directories: MediaContentDirectorySnapshot[] = input.entries.map(entry => ({
      logicalRoot: entry.logicalRoot as MediaContentDirectorySnapshot['logicalRoot'],
      rootIdentity: entry.rootIdentity, relativeDirectory: entry.relativeDirectory,
      directoryId: entry.directoryId, generation: BigInt(entry.directoryGeneration)
    }))
    const locked = await lockContentDirectories(tx, directories)
    for (const directory of directories) {
      const row = locked.get(`${directory.logicalRoot}\0${directory.relativeDirectory}`)!
      if (row.id !== directory.directoryId || row.generation !== directory.generation)
        throw new MediaContentConflictError('STALE')
    }
    if (await contentDirectoriesHaveWriter(tx, [...new Map(directories.map(row => [row.directoryId, row])).values()]))
      throw new MediaContentConflictError('WRITING')
    await lockContentArtworks(tx, [input.snapshot.artworkId])
    const item = await tx.artworkDedupItem.findUniqueOrThrow({
      where: { runId_artworkId: { runId: run.id, artworkId: input.snapshot.artworkId } }
    })
    const artwork = await tx.artwork.findFirst({
      where: {
        id: input.snapshot.artworkId, mediaRevision: item.frozenMediaRevision, ...visibleCreatorArtwork,
        creators: { some: { artistId: run.artistId, ...activeCreatorMembership, artist: { mergedIntoId: null } } }
      },
      select: { contentSource: true }
    })
    if (!artwork || item.status !== 'STATTING' || item.afterImageId !== input.afterImageId ||
      item.snapshotRevision !== input.snapshot.revision || item.mediaEpoch !== input.snapshot.mediaEpoch || item.memberCount !== input.snapshot.memberCount ||
      (artwork.contentSource?.revision ?? 0n) !== input.snapshot.revision ||
      (artwork.contentSource?.mediaEpoch ?? 0n) !== input.snapshot.mediaEpoch)
      throw new MediaContentConflictError('STALE')
    if (artwork.contentSource?.writeToken) throw new MediaContentConflictError('WRITING')
    await lockContentImages(tx, ids)
    const members = await tx.image.findMany({
      where: { id: { in: ids } }, include: { contentSource: true, contentFingerprint: true }
    })
    const byId = new Map(members.map(row => [row.id, row]))
    for (const entry of input.entries) {
      const member = byId.get(entry.imageId)
      const cached = member?.contentFingerprint
      if (!member || member.artworkId !== input.snapshot.artworkId || member.path !== entry.sourcePath ||
        member.contentSource?.revision !== BigInt(entry.sourceRevision) || member.contentSource.directoryStateId !== entry.directoryId)
        throw new MediaContentConflictError('STALE')
      if (member.contentSource.writeToken) throw new MediaContentConflictError('WRITING')
      if (!cached || cached.algorithmVersion !== input.algorithmVersion || cached.sourceRevision !== BigInt(entry.sourceRevision) ||
        cached.artworkMediaEpoch !== input.snapshot.mediaEpoch || cached.sourcePath !== entry.sourcePath ||
        cached.rootIdentity !== entry.rootIdentity || cached.canonicalPath !== entry.canonicalPath || cached.sha256 !== entry.sha256 ||
        cached.size !== BigInt(entry.size) || cached.mtimeNs !== entry.mtimeNs || cached.ctimeNs !== entry.ctimeNs ||
        cached.deviceId !== entry.deviceId || cached.inode !== entry.inode)
        throw new MediaContentConflictError('STALE')
    }
    // The checks above authorize only these writes in this transaction, not shared APIs.
    await tx.artworkDedupMedia.deleteMany({ where: { runId: run.id, artworkId: item.artworkId, imageId: { in: ids } } })
    await tx.artworkDedupMedia.createMany({ data: input.entries.map(entry => ({ ...entry, runId: run.id, artworkId: item.artworkId })) })
    await tx.artworkDedupItem.update({ where: { runId_artworkId: { runId: run.id, artworkId: item.artworkId } }, data: { afterImageId: input.entries.at(-1)!.imageId } })
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { statMedia: { increment: input.entries.length } } })
    return { status: 'READY', value: input.snapshot }
  } catch (error) {
    if (error instanceof MediaContentConflictError) return { status: error.status }
    throw error
  }
}
