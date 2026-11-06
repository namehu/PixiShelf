import { archiveOriginalUpgradeSnapshotSchema, type ArchiveOriginalUpgradeSnapshot } from '@pixishelf/job-contracts'
import { lockArtworkForReading } from '@pixishelf/db'
import { ArchiveExecutorError } from './errors.ts'
import type { ArchiveTransaction } from './types.ts'

export async function assertArchiveOriginalUpgradeBase(
  tx: ArchiveTransaction,
  input: { upgradeBaseRevisionId: string | null; upgradeSnapshot: unknown }
): Promise<ArchiveOriginalUpgradeSnapshot | null> {
  if (!input.upgradeBaseRevisionId) return null
  const snapshot = archiveOriginalUpgradeSnapshotSchema.parse(input.upgradeSnapshot)
  await lockArtworkForReading(tx, snapshot.artworkId)
  const [revision, artwork, images] = await Promise.all([
    tx.archiveRevision.findUnique({ where: { id: snapshot.revisionId } }),
    tx.artwork.findUnique({ where: { id: snapshot.artworkId } }),
    tx.image.findMany({ where: { artworkId: snapshot.artworkId }, include: { contentSource: true } })
  ])
  if (
    !revision?.isCurrent ||
    revision.retiredAt ||
    revision.id !== input.upgradeBaseRevisionId ||
    revision.artworkId !== snapshot.artworkId ||
    revision.archivePath !== snapshot.archivePath ||
    revision.metadataHash !== snapshot.metadataHash ||
    revision.downloadScope !== snapshot.downloadScope ||
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
  )
    throw new ArchiveExecutorError('STATE_CONFLICT', '本地媒体或归档版本已变化，原图升级已停止；原有内容已保留。')
  return snapshot
}
