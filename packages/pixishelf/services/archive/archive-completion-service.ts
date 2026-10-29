import { z } from 'zod'
import { archiveCompletionSnapshotSchema } from '@pixishelf/job-contracts'
import { lockArtworkForReading, lockCreatorCatalog, Prisma, type PrismaClient } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import { ArchiveError } from './errors'
import { ARCHIVE_PUBLISH_ADVISORY_LOCK_ID } from './archive-coordination'
import { createArchiveIntakeSubmissionInTransaction } from '@/services/archive-intake/archive-intake-service'
import { INTAKE_SUBMISSION_TRANSACTION_OPTIONS } from '@/services/archive-intake/intake-submission-transaction'

export const completeArchiveArtworkSchema = z
  .object({
    artworkId: z.number().int().positive(),
    expectedRevisionId: z.string().trim().min(1).max(128),
    idempotencyKey: z.string().trim().min(1).max(150)
  })
  .strict()

const mediaSnapshotSchema = archiveCompletionSnapshotSchema.shape.media.element.omit({
  imagePath: true,
  contentRevision: true
})

export async function completeArchiveArtwork(
  input: z.infer<typeof completeArchiveArtworkSchema>,
  requestedByUserId: string,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  return database.$transaction(async (tx) => {
    const base = await tx.archiveRevision.findUnique({
      where: { id: input.expectedRevisionId },
      include: { externalRef: true, archiveImport: true }
    })
    if (
      !base ||
      base.artworkId !== input.artworkId ||
      !base.archiveImport ||
      !base.sourceTotalItems ||
      !base.sourcePlanDigest
    ) {
      throw new ArchiveError('STATE_CONFLICT', '当前归档缺少可安全补全的来源记录，请通过完整更新重新确认。')
    }
    // Submission owns the established creator -> identity -> capacity lock order. No worker sees it before this transaction commits.
    const submission = await createArchiveIntakeSubmissionInTransaction(
      {
        idempotencyKey: `archive-complete:${input.idempotencyKey}`,
        urls: [base.externalRef.canonicalUrl],
        downloadMode: 'MANUAL',
        quality: base.archiveImport.selectedQuality,
        downloadScope: 'ALL'
      },
      requestedByUserId,
      tx
    )
    const intake = await tx.archiveIntakeItem.findFirst({ where: { submissionId: submission.id } })
    if (!intake) throw new ArchiveError('STATE_CONFLICT', '收件箱容量不足，暂时不能补全。')
    if (intake.completionBaseRevisionId) {
      if (intake.completionBaseRevisionId !== base.id) {
        throw new ArchiveError('STATE_CONFLICT', '该补全请求已绑定其他归档版本。')
      }
      return { intakeItemId: intake.id, archiveImportId: intake.archiveImportId }
    }
    if (intake.status !== 'QUEUED') {
      throw new ArchiveError('STATE_CONFLICT', '该作品已有收件或下载任务，请等待完成后再补全。')
    }
    await lockCreatorCatalog(tx)
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    await lockArtworkForReading(tx, input.artworkId)
    const current = await tx.archiveRevision.findUniqueOrThrow({ where: { id: base.id } })
    const artwork = await tx.artwork.findUniqueOrThrow({
      where: { id: input.artworkId },
      include: { images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { contentSource: true } } }
    })
    if (
      !current.isCurrent ||
      current.retiredAt ||
      current.downloadScope !== 'FIRST_20' ||
      artwork.deletedAt ||
      artwork.archiveLifecycleState !== 'ACTIVE' ||
      artwork.storagePath !== base.archivePath ||
      artwork.images.length >= base.sourceTotalItems
    ) {
      throw new ArchiveError('STATE_CONFLICT', '作品已完整下载或归档版本已变化，请刷新后重试。')
    }
    if (
      await tx.archiveImport.count({
        where: {
          providerKey: base.externalRef.providerKey,
          externalId: base.externalRef.externalId,
          status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] }
        }
      })
    ) {
      throw new ArchiveError('STATE_CONFLICT', '作品已有下载任务，请等待完成后再补全。')
    }
    const mediaResult = mediaSnapshotSchema.array().min(1).max(20).safeParse(base.mediaSnapshot)
    if (!mediaResult.success || mediaResult.data.length !== artwork.images.length) {
      throw new ArchiveError('STATE_CONFLICT', '本地媒体记录已改变，不能安全补全；请通过完整更新重新确认。')
    }
    const media = mediaResult.data.map((entry) => {
      const image = artwork.images.find((image) => image.id === entry.imageId)
      if (
        !image ||
        image.sortOrder !== entry.index ||
        image.path !== `${base.archivePath}/${entry.path}` ||
        image.size?.toString() !== entry.size ||
        image.contentSource?.writeToken ||
        image.chaptersPath
      ) {
        throw new ArchiveError('STATE_CONFLICT', '本地媒体已修改或正在维护，不能安全补全。')
      }
      return { ...entry, imagePath: image.path, contentRevision: (image.contentSource?.revision ?? 0n).toString() }
    })
    const snapshot = archiveCompletionSnapshotSchema.parse({
      artworkId: artwork.id,
      revisionId: base.id,
      archivePath: base.archivePath,
      metadataHash: base.metadataHash,
      sourcePlanDigest: base.sourcePlanDigest,
      sourceTotalItems: base.sourceTotalItems,
      mediaRevision: artwork.mediaRevision,
      quality: base.archiveImport.selectedQuality,
      media
    })
    await tx.archiveIntakeItem.update({
      where: { id: intake.id },
      data: { completionBaseRevisionId: base.id, completionSnapshot: snapshot as Prisma.InputJsonValue }
    })
    return { intakeItemId: intake.id, archiveImportId: null }
  }, INTAKE_SUBMISSION_TRANSACTION_OPTIONS)
}
