import { archiveCompletionSnapshotSchema, type ArchiveCompletionSnapshot } from '@pixishelf/job-contracts'
import { lockArtworkForReading } from '@pixishelf/db'
import { ArchiveExecutorError } from './errors.ts'
import type { ArchiveTransaction } from './types.ts'

export async function assertArchiveCompletionBase(
  tx: ArchiveTransaction,
  input: { completionBaseRevisionId: string | null; completionSnapshot: unknown }
): Promise<ArchiveCompletionSnapshot | null> {
  if (!input.completionBaseRevisionId) return null
  const snapshot = archiveCompletionSnapshotSchema.parse(input.completionSnapshot)
  await lockArtworkForReading(tx, snapshot.artworkId)
  const [revision, artwork, images] = await Promise.all([
    tx.archiveRevision.findUnique({ where: { id: snapshot.revisionId } }),
    tx.artwork.findUnique({ where: { id: snapshot.artworkId } }),
    tx.image.findMany({ where: { artworkId: snapshot.artworkId }, include: { contentSource: true } })
  ])
  if (
    !revision?.isCurrent ||
    revision.retiredAt ||
    revision.id !== input.completionBaseRevisionId ||
    revision.artworkId !== snapshot.artworkId ||
    revision.archivePath !== snapshot.archivePath ||
    !artwork ||
    artwork.deletedAt ||
    artwork.archiveLifecycleState !== 'ACTIVE' ||
    artwork.mediaRevision !== snapshot.mediaRevision ||
    artwork.storagePath !== snapshot.archivePath ||
    images.length !== snapshot.media.length ||
    snapshot.media.some((entry) => {
      const image = images.find((image) => image.id === entry.imageId)
      return (
        !image ||
        image.path !== entry.imagePath ||
        image.sortOrder !== entry.index ||
        image.size?.toString() !== entry.size ||
        image.chaptersPath !== null ||
        (image.contentSource?.revision ?? 0n).toString() !== entry.contentRevision ||
        Boolean(image.contentSource?.writeToken)
      )
    })
  ) {
    throw new ArchiveExecutorError(
      'STATE_CONFLICT',
      '本地媒体或归档版本已变化，补全已停止；原有内容已保留，请通过完整更新重新确认。'
    )
  }
  return snapshot
}
