import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  archiveOriginalUpgradeSnapshotSchema,
  ARCHIVE_ORIGINAL_UPGRADE_DEFINITION_VERSION,
  getVerifiedOriginalPages
} from '@pixishelf/job-contracts'
import { lockArtworkForReading, lockCreatorCatalog, Prisma, type PrismaClient } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import { createArchiveIntakeSubmissionInTransaction } from '@/services/archive-intake/archive-intake-service'
import { INTAKE_SUBMISSION_TRANSACTION_OPTIONS } from '@/services/archive-intake/intake-submission-transaction'
import { ARCHIVE_PUBLISH_ADVISORY_LOCK_ID } from './archive-coordination'
import { ArchiveError } from './errors'
import { archiveWireErrorMessage } from './archive-redaction'
import { archiveSourceSizeBytes } from './archive-source-metadata'

export const upgradeArchiveOriginalSchema = z
  .object({
    artworkId: z.number().int().positive(),
    expectedRevisionId: z.string().trim().min(1).max(128),
    idempotencyKey: z.string().trim().min(1).max(150)
  })
  .strict()

const storedMediaSchema = archiveOriginalUpgradeSnapshotSchema.shape.media.element
  .omit({
    imagePath: true,
    contentRevision: true,
    originalEvidence: true
  })
  .strip()
const planMediaSchema = z.object({
  index: z.number().int().nonnegative(),
  sourcePageUrl: z.string(),
  locator: z.record(z.string(), z.unknown())
})
const sourcePlanSchema = z.object({ media: z.array(planMediaSchema).min(1) })

function sourcePlan(base: {
  downloadScope: 'ALL' | 'FIRST_20'
  sourcePlanDigest: string | null
  sourceTotalItems: number | null
  archiveImport: {
    items: { pageIndex: number; sourcePageUrl: string; locator: Prisma.JsonValue }[]
    intakeItems: { resolvedSnapshot: Prisma.JsonValue | null }[]
  } | null
}) {
  if (base.sourcePlanDigest && base.sourceTotalItems) {
    return { digest: base.sourcePlanDigest, total: base.sourceTotalItems }
  }
  const historical = base.archiveImport?.intakeItems
    .map((item) => sourcePlanSchema.safeParse(item.resolvedSnapshot))
    .find((item) => item.success)
  const media = historical?.success
    ? historical.data.media
    : base.downloadScope === 'ALL'
      ? base.archiveImport?.items.map((item) => ({
          index: item.pageIndex,
          sourcePageUrl: item.sourcePageUrl,
          locator: item.locator
        }))
      : null
  if (
    !media?.length ||
    !base.archiveImport?.items.length ||
    base.archiveImport.items.some((item) => {
      const page = media.find((entry) => entry.index === item.pageIndex)
      return (
        !page ||
        page.sourcePageUrl !== item.sourcePageUrl ||
        JSON.stringify(page.locator) !== JSON.stringify(item.locator)
      )
    })
  ) {
    return null
  }
  return {
    digest: createHash('sha256')
      .update(JSON.stringify(media.map(({ index, sourcePageUrl, locator }) => ({ index, sourcePageUrl, locator }))))
      .digest('hex'),
    total: media.length
  }
}

export async function upgradeArchiveOriginal(
  input: z.infer<typeof upgradeArchiveOriginalSchema>,
  requestedByUserId: string,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  return database.$transaction(async (tx) => {
    const base = await tx.archiveRevision.findUnique({
      where: { id: input.expectedRevisionId },
      include: {
        externalRef: true,
        archiveImport: {
          include: { items: { orderBy: { pageIndex: 'asc' } }, intakeItems: { select: { resolvedSnapshot: true } } }
        }
      }
    })
    if (!base || base.artworkId !== input.artworkId || !base.archiveImport) {
      throw new ArchiveError('STATE_CONFLICT', '当前归档缺少可核对的来源记录，不能安全升级原图。')
    }
    if (base.externalRef.providerKey !== 'e-hentai') {
      throw new ArchiveError('STATE_CONFLICT', '该来源暂不支持原图质量升级。')
    }
    const submission = await createArchiveIntakeSubmissionInTransaction(
      {
        idempotencyKey: `archive-original:${input.idempotencyKey}`,
        urls: [base.externalRef.canonicalUrl],
        downloadMode: 'MANUAL',
        quality: 'ORIGINAL',
        downloadScope: base.downloadScope
      },
      requestedByUserId,
      tx
    )
    const intake = await tx.archiveIntakeItem.findFirst({ where: { submissionId: submission.id } })
    if (!intake) throw new ArchiveError('STATE_CONFLICT', '收件箱容量不足，暂时不能升级原图。')
    if (intake.upgradeBaseRevisionId) {
      if (intake.upgradeBaseRevisionId !== base.id) {
        throw new ArchiveError('STATE_CONFLICT', '该请求已绑定其他归档版本。')
      }
      return { intakeItemId: intake.id, archiveImportId: intake.archiveImportId }
    }
    if (intake.status !== 'QUEUED') {
      throw new ArchiveError('STATE_CONFLICT', '该来源已有收件或下载任务，请等待完成后重试。')
    }
    await lockCreatorCatalog(tx)
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    await lockArtworkForReading(tx, input.artworkId)
    const current = await tx.archiveRevision.findUniqueOrThrow({ where: { id: base.id } })
    const artwork = await tx.artwork.findUniqueOrThrow({
      where: { id: input.artworkId },
      include: {
        contentSource: true,
        images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { contentSource: true } }
      }
    })
    if (
      !current.isCurrent ||
      current.retiredAt ||
      artwork.deletedAt ||
      artwork.archiveLifecycleState !== 'ACTIVE' ||
      artwork.contentSource?.writeToken ||
      artwork.storagePath !== base.archivePath
    ) {
      throw new ArchiveError('STATE_CONFLICT', '作品或归档版本已变化，请刷新后重试。')
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
      throw new ArchiveError('STATE_CONFLICT', '作品已有下载任务，请等待完成后再升级原图。')
    }
    const plan = sourcePlan(base)
    const stored = storedMediaSchema.array().min(1).safeParse(base.mediaSnapshot)
    if (
      !plan ||
      !stored.success ||
      stored.data.length !== artwork.images.length ||
      (base.downloadScope === 'ALL' && stored.data.length !== plan.total) ||
      new Set(stored.data.map((entry) => entry.index)).size !== stored.data.length ||
      new Set(stored.data.map((entry) => entry.imageId)).size !== stored.data.length
    ) {
      throw new ArchiveError('STATE_CONFLICT', '历史来源计划或本地媒体证据不完整，不能安全升级原图。')
    }
    const evidence = getVerifiedOriginalPages(current)
    const media = stored.data.map((entry) => {
      const image = artwork.images.find((image) => image.id === entry.imageId)
      if (
        !image ||
        image.sortOrder !== entry.index ||
        image.path !== `${base.archivePath}/${entry.path}` ||
        image.size?.toString() !== entry.size ||
        image.contentSource?.writeToken ||
        image.chaptersPath
      ) {
        throw new ArchiveError('STATE_CONFLICT', '本地媒体已修改或正在维护，不能安全升级原图。')
      }
      const original = evidence.get(entry.index)
      return {
        ...entry,
        imagePath: image.path,
        contentRevision: (image.contentSource?.revision ?? 0n).toString(),
        ...(original ? { originalEvidence: original } : {})
      }
    })
    if (media.every((entry) => entry.originalEvidence)) {
      throw new ArchiveError('STATE_CONFLICT', '当前归档已全部证实为原图，无需升级。')
    }
    const snapshot = archiveOriginalUpgradeSnapshotSchema.parse({
      intent: 'ORIGINAL_UPGRADE',
      artworkId: artwork.id,
      revisionId: base.id,
      archivePath: base.archivePath,
      metadataHash: base.metadataHash,
      sourcePlanDigest: plan.digest,
      sourceTotalItems: plan.total,
      mediaRevision: artwork.mediaRevision,
      quality: 'ORIGINAL',
      downloadScope: base.downloadScope,
      media
    })
    await tx.archiveIntakeItem.update({
      where: { id: intake.id },
      data: { upgradeBaseRevisionId: base.id, upgradeSnapshot: snapshot as Prisma.InputJsonValue }
    })
    if (intake.currentSystemJobId) {
      await tx.systemJob.update({
        where: { id: intake.currentSystemJobId },
        data: { definitionVersion: ARCHIVE_ORIGINAL_UPGRADE_DEFINITION_VERSION }
      })
    }
    return { intakeItemId: intake.id, archiveImportId: null }
  }, INTAKE_SUBMISSION_TRANSACTION_OPTIONS)
}

export async function getArchiveOriginalUpgrade(
  artworkId: number,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const revision = await database.archiveRevision.findFirst({
    where: {
      artworkId,
      externalRef: { providerKey: 'e-hentai' },
      isCurrent: true,
      retiredAt: null,
      artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
    },
    select: {
      id: true,
      archiveImportId: true,
      sourcePlanDigest: true,
      sourceTotalItems: true,
      qualityStatus: true,
      qualityOriginalCount: true,
      qualityDisplayCount: true,
      qualityUnknownCount: true,
      qualityVerifiedAt: true,
      archiveImport: { select: { normalizedMetadata: true } }
    }
  })
  if (!revision) return null
  const hasFrozenPlan = Boolean(revision.sourcePlanDigest && revision.sourceTotalItems)
  const [historical, intake] = await Promise.all([
    hasFrozenPlan || revision.qualityStatus === 'ORIGINAL'
      ? Promise.resolve(null)
      : database.archiveRevision.findUnique({
          where: { id: revision.id },
          select: {
            downloadScope: true,
            sourcePlanDigest: true,
            sourceTotalItems: true,
            archiveImport: {
              select: {
                items: {
                  orderBy: { pageIndex: 'asc' },
                  select: { pageIndex: true, sourcePageUrl: true, locator: true }
                },
                intakeItems: { select: { resolvedSnapshot: true } }
              }
            }
          }
        }),
    database.archiveIntakeItem.findFirst({
      where: { upgradeBaseRevisionId: revision.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        errorCode: true,
        errorMessage: true,
        archiveImport: { select: { id: true, status: true, errorCode: true, errorMessage: true } }
      }
    })
  ])
  const task = intake?.archiveImport
  const active = task
    ? ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'].includes(task.status)
    : Boolean(intake && ['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'].includes(intake.status))
  const blockedReason =
    revision.qualityStatus === 'ORIGINAL'
      ? '当前归档已全部证实为原图。'
      : !hasFrozenPlan && !(historical && sourcePlan(historical))
        ? '历史来源计划不完整，不能安全升级原图。'
        : null
  return {
    revisionId: revision.id,
    qualityTaskId: revision.archiveImportId,
    sourceSizeBytes: archiveSourceSizeBytes(revision.archiveImport?.normalizedMetadata),
    quality: {
      status: revision.qualityStatus,
      originalCount: revision.qualityOriginalCount,
      displayCount: revision.qualityDisplayCount,
      unknownCount: revision.qualityUnknownCount,
      verifiedAt: revision.qualityVerifiedAt
    },
    canUpgrade: !active && !blockedReason,
    active,
    taskId: task?.id ?? null,
    intakeItemId: intake?.id ?? null,
    blockedReason,
    error: archiveWireErrorMessage(
      task?.errorCode ?? intake?.errorCode ?? null,
      task?.errorMessage ?? intake?.errorMessage ?? null
    )
  }
}
