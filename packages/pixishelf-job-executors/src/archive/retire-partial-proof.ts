import { z } from 'zod'
import {
  archiveCompletionSnapshotSchema,
  archiveOriginalUpgradeSnapshotSchema,
  getVerifiedOriginalPages,
  type ArchiveMaintenancePayload
} from '@pixishelf/job-contracts'
import {
  assertArtworkDedupWritable,
  assertNoArtworkDedupArchiveSourceHold,
  lockCreatorCatalog,
  type Prisma
} from '@pixishelf/db'
import { ArchiveExecutorError } from './errors.ts'
type Payload = Extract<ArchiveMaintenancePayload, { action: 'RETIRE_PARTIAL_REVISION' | 'RETIRE_ORIGINAL_REVISION' }>
const storedMediaSchema = z.array(
  archiveCompletionSnapshotSchema.shape.media.element.omit({ imagePath: true, contentRevision: true })
)
const activeStatuses = ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] as const

export async function readPartialRetirementSnapshot(tx: Prisma.TransactionClient, payload: Payload) {
  const originalUpgrade = payload.action === 'RETIRE_ORIGINAL_REVISION'
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
    (!originalUpgrade && old.downloadScope !== 'FIRST_20') ||
    !old.retirementRequestedAt ||
    old.replacedByRevisionId !== replacement.id ||
    !replacement.isCurrent ||
    (!originalUpgrade && replacement.downloadScope !== 'ALL') ||
    !old.archiveImport ||
    (!originalUpgrade && !old.archiveImport.sealedManifestSha256) ||
    !replacement.archiveImport?.sealedManifestSha256 ||
    (originalUpgrade && replacement.archiveImport.upgradeBaseRevisionId !== old.id) ||
    replacement.artwork.deletedAt ||
    replacement.artwork.archiveLifecycleState !== 'ACTIVE' ||
    replacement.artwork.storagePath !== replacement.archivePath ||
    (originalUpgrade
      ? replacement.archiveImport.selectedQuality !== 'ORIGINAL' || replacement.downloadScope !== old.downloadScope
      : replacement.archiveImport.selectedQuality !== old.archiveImport.selectedQuality)
  ) {
    throw new ArchiveExecutorError('STATE_CONFLICT', '旧归档清理条件已变化，保留旧文件等待核查。')
  }
  const frozen = originalUpgrade
    ? archiveOriginalUpgradeSnapshotSchema.parse(old.retirementSnapshot)
    : archiveCompletionSnapshotSchema.parse(old.retirementSnapshot)
  const media = storedMediaSchema.parse(replacement.mediaSnapshot)
  const verifiedOriginals = getVerifiedOriginalPages(replacement)
  if (
    frozen.revisionId !== old.id ||
    frozen.archivePath !== old.archivePath ||
    (originalUpgrade
      ? frozen.media.length !== media.length || replacement.sourceTotalItems !== frozen.sourceTotalItems
      : frozen.sourceTotalItems !== media.length || replacement.sourceTotalItems !== media.length) ||
    frozen.sourcePlanDigest !== replacement.sourcePlanDigest ||
    frozen.media.some((item) => {
      const copy = media.find((entry) => entry.imageId === item.imageId && entry.index === item.index)
      return (
        !copy ||
        (originalUpgrade ? !verifiedOriginals.has(item.index) : copy.sha256 !== item.sha256 || copy.size !== item.size)
      )
    })
  )
    throw new ArchiveExecutorError('STATE_CONFLICT', '新归档不能证明覆盖旧版的全部页面，保留旧文件。')
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
    throw new ArchiveExecutorError('STATE_CONFLICT', '旧归档仍被媒体或活动任务引用，稍后可重试清理。')
  return { old, replacement, frozen, media }
}
