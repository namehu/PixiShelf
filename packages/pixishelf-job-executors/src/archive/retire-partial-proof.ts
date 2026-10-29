import { z } from 'zod'
import { archiveCompletionSnapshotSchema, type ArchiveMaintenancePayload } from '@pixishelf/job-contracts'
import {
  assertArtworkDedupWritable,
  assertNoArtworkDedupArchiveSourceHold,
  lockCreatorCatalog,
  type Prisma
} from '@pixishelf/db'
import { ArchiveExecutorError } from './errors.ts'
type Payload = Extract<ArchiveMaintenancePayload, { action: 'RETIRE_PARTIAL_REVISION' }>
const storedMediaSchema = z.array(
  archiveCompletionSnapshotSchema.shape.media.element.omit({ imagePath: true, contentRevision: true })
)
const activeStatuses = ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] as const

export async function readPartialRetirementSnapshot(tx: Prisma.TransactionClient, payload: Payload) {
  await lockCreatorCatalog(tx)
  await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', 7_341_902_117)
  const [old, replacement] = await Promise.all([
    tx.archiveRevision.findUnique({ where: { id: payload.revisionId }, include: { archiveImport: true } }),
    tx.archiveRevision.findUnique({
      where: { id: payload.replacementRevisionId },
      include: { archiveImport: true, artwork: true }
    })
  ])
  if (
    !old ||
    !replacement ||
    old.id === replacement.id ||
    old.artworkId !== replacement.artworkId ||
    old.isCurrent ||
    old.downloadScope !== 'FIRST_20' ||
    !old.retirementRequestedAt ||
    old.replacedByRevisionId !== replacement.id ||
    !replacement.isCurrent ||
    replacement.downloadScope !== 'ALL' ||
    !old.archiveImport?.sealedManifestSha256 ||
    !replacement.archiveImport?.sealedManifestSha256 ||
    replacement.artwork.deletedAt ||
    replacement.artwork.archiveLifecycleState !== 'ACTIVE' ||
    replacement.artwork.storagePath !== replacement.archivePath ||
    replacement.archiveImport.selectedQuality !== old.archiveImport.selectedQuality
  ) {
    throw new ArchiveExecutorError('STATE_CONFLICT', '部分归档清理条件已变化，保留旧文件等待核查。')
  }
  const frozen = archiveCompletionSnapshotSchema.parse(old.retirementSnapshot)
  const media = storedMediaSchema.parse(replacement.mediaSnapshot)
  if (
    frozen.revisionId !== old.id ||
    frozen.archivePath !== old.archivePath ||
    frozen.sourceTotalItems !== media.length ||
    replacement.sourceTotalItems !== media.length ||
    frozen.sourcePlanDigest !== replacement.sourcePlanDigest ||
    frozen.media.some((item) => {
      const copy = media.find((entry) => entry.imageId === item.imageId && entry.index === item.index)
      return !copy || copy.sha256 !== item.sha256 || copy.size !== item.size
    })
  )
    throw new ArchiveExecutorError('STATE_CONFLICT', '完整归档不能证明包含旧版的全部原图，保留旧文件。')
  await assertNoArtworkDedupArchiveSourceHold(tx, old.archiveImport)
  await assertArtworkDedupWritable(tx, { artworkId: old.artworkId, kind: 'DELETE' })
  const prefix = `${old.archivePath}/`
  const [imageReferences, artworkReferences, imports, migrations, pathJobs] = await Promise.all([
    tx.image.count({ where: { OR: [{ path: { startsWith: prefix } }, { chaptersPath: { startsWith: prefix } }] } }),
    tx.artwork.count({ where: { OR: [{ storagePath: old.archivePath }, { storagePath: { startsWith: prefix } }] } }),
    tx.archiveImport.count({
      where: {
        providerKey: old.archiveImport.providerKey,
        externalId: old.archiveImport.externalId,
        status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] }
      }
    }),
    tx.migrationJobItem.count({
      where: { artworkIdSnapshot: old.artworkId, systemJob: { status: { in: [...activeStatuses] } } }
    }),
    tx.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM system_jobs WHERE status IN ('PENDING','RUNNING','PAUSING','PAUSED','RETRY_WAIT','CANCELLING') AND strpos(payload::text, $1) > 0`,
      old.archivePath
    )
  ])
  if (imageReferences || artworkReferences || imports || migrations || Number(pathJobs[0]?.count ?? 0) > 0)
    throw new ArchiveExecutorError('STATE_CONFLICT', '旧部分归档仍被媒体或活动任务引用，稍后可重试清理。')
  return { old, replacement, frozen, media }
}
