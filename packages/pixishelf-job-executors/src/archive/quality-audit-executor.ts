import {
  archiveQualityAuditCheckpointSchema,
  type ArchiveQualityAuditCheckpoint,
  type ArchiveQualityAuditPayload
} from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import type { ExecutionContext, EnqueuedChildJob, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { refreshArchiveQualityEvidence } from './quality-evidence.ts'

export const ARCHIVE_QUALITY_AUDIT_BATCH_SIZE = 10

export async function executeArchiveQualityAudit(
  context: ExecutionContext<ArchiveQualityAuditPayload, EnqueuedChildJob>,
  now: () => Date = () => new Date()
) {
  return context.finalizeInTransaction<Prisma.TransactionClient & QueueSqlExecutor>(async (scope) => {
    if (scope.executionStatus === 'CANCELLING') {
      await scope.cancel('画质核验已取消，已核验的证据会保留')
      return
    }
    if (scope.executionStatus === 'PAUSING') {
      await scope.pause({ reason: 'USER_REQUESTED', message: '画质核验已暂停，可继续执行剩余批次' })
      return
    }
    if (context.signal.aborted) {
      await scope.release('画质核验已在批次边界停止，等待恢复')
      return
    }
    const job = await scope.transaction.systemJob.findUniqueOrThrow({
      where: { id: context.job.id },
      select: { result: true, parentJobId: true }
    })
    let savedResult = job.result
    let parentJobId = job.parentJobId
    while (savedResult === null && parentJobId) {
      const parent = await scope.transaction.systemJob.findUnique({
        where: { id: parentJobId, type: 'ARCHIVE_QUALITY_AUDIT' },
        select: { result: true, parentJobId: true }
      })
      savedResult = parent?.result ?? null
      parentJobId = parent?.parentJobId ?? null
    }
    const parsed = archiveQualityAuditCheckpointSchema.safeParse(savedResult)
    const checkpoint: ArchiveQualityAuditCheckpoint = parsed.success
      ? parsed.data
      : {
          kind: 'CHECKPOINT',
          afterArtworkId: 0,
          processedArtworks: 0,
          originalPages: 0,
          displayPages: 0,
          unknownPages: 0
        }
    const artworks = await scope.transaction.artwork.findMany({
      where: {
        id: { gt: checkpoint.afterArtworkId, lte: context.payload.targetMaxArtworkId },
        archiveRevisions: { some: { isCurrent: true, externalRef: { providerKey: 'e-hentai' } } }
      },
      orderBy: { id: 'asc' },
      take: ARCHIVE_QUALITY_AUDIT_BATCH_SIZE,
      select: {
        id: true,
        archiveRevisions: { where: { isCurrent: true, externalRef: { providerKey: 'e-hentai' } }, select: { id: true } }
      }
    })
    for (const artwork of artworks) {
      for (const revision of artwork.archiveRevisions) {
        const quality = await refreshArchiveQualityEvidence(scope.transaction, revision.id, now())
        checkpoint.originalPages += quality.qualityOriginalCount
        checkpoint.displayPages += quality.qualityDisplayCount
        checkpoint.unknownPages += quality.qualityUnknownCount
      }
      checkpoint.afterArtworkId = artwork.id
      checkpoint.processedArtworks++
    }
    const message = `已核验 ${checkpoint.processedArtworks} 个作品：原图 ${checkpoint.originalPages} 页、展示图 ${checkpoint.displayPages} 页、未知 ${checkpoint.unknownPages} 页`
    if (artworks.length < ARCHIVE_QUALITY_AUDIT_BATCH_SIZE) {
      await scope.complete({ result: { ...checkpoint, kind: 'COMPLETED' }, message: `画质核验完成。${message}` })
      return
    }
    await scope.transaction.systemJob.update({
      where: { id: context.job.id },
      data: {
        result: checkpoint as Prisma.InputJsonValue,
        progress: Math.min(
          99,
          Math.floor((checkpoint.processedArtworks / Math.max(1, context.payload.targetArtworkCount)) * 100)
        ),
        stage: 'YIELDING',
        message
      }
    })
    await scope.retry({
      availableAt: new Date(now().getTime() + 1000),
      errorCode: 'RESOURCE_BUSY',
      error: 'Archive quality audit yielded after a durable batch',
      message,
      preserveAttempt: true,
      schedulingYield: true
    })
  })
}
