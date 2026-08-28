import {
  archiveDefaultTagBackfillCheckpointSchema,
  type ArchiveDefaultTagBackfillCheckpoint,
  type ArchiveDefaultTagBackfillPayload,
  type ArchiveDefaultTagBackfillResult
} from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, JobExecutionOutcome, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { Prisma } from '@pixishelf/db'

export const ARCHIVE_DEFAULT_TAG_BACKFILL_BATCH_SIZE = 100
export const ARCHIVE_DEFAULT_TAG_BACKFILL_YIELD_MS = 1_000

type BackfillTransaction = Prisma.TransactionClient & QueueSqlExecutor
type BackfillContext = ExecutionContext<ArchiveDefaultTagBackfillPayload, EnqueuedChildJob>

export interface ArchiveDefaultTagBackfillExecutorDependencies {
  now?: () => Date
}

export async function executeArchiveDefaultTagBackfill(
  context: BackfillContext,
  dependencies: ArchiveDefaultTagBackfillExecutorDependencies = {}
): Promise<JobExecutionOutcome<ArchiveDefaultTagBackfillResult>> {
  return context.finalizeInTransaction<BackfillTransaction>(async (scope) => {
    if (scope.executionStatus === 'CANCELLING') {
      await scope.cancel('历史归档标签补全已取消，已追加的标签会保留')
      return
    }
    if (scope.executionStatus === 'PAUSING') {
      await scope.pause({ reason: 'USER_REQUESTED', message: '历史归档标签补全已暂停' })
      return
    }
    if (context.signal.aborted) {
      await scope.release('历史归档标签补全已在批次边界停止，等待 Worker 恢复')
      return
    }

    const currentJob = await scope.transaction.systemJob.findUnique({
      where: { id: context.job.id },
      select: { result: true }
    })
    if (!currentJob) throw new Error('Archive default tag backfill job disappeared')

    const checkpoint = parseCheckpoint(currentJob.result)
    const configuredTagIds = context.payload.defaultTagIds
    const existingTags = await scope.transaction.tag.findMany({
      where: { id: { in: configuredTagIds } },
      orderBy: { id: 'asc' },
      select: { id: true }
    })
    const validTagIds = existingTags.map(({ id }) => id)
    const validTagIdSet = new Set(validTagIds)
    const skippedTagIds = [
      ...new Set([...checkpoint.skippedTagIds, ...configuredTagIds.filter((id) => !validTagIdSet.has(id))])
    ].sort((left, right) => left - right)

    if (validTagIds.length === 0) {
      await scope.complete({
        result: completedResult(context.payload, { ...checkpoint, skippedTagIds }),
        message: '历史归档标签补全结束：配置中的标签均已不存在'
      })
      return
    }

    const artworks = await scope.transaction.artwork.findMany({
      where: {
        id: { gt: checkpoint.afterArtworkId, lte: context.payload.targetMaxArtworkId },
        createdVia: 'URL_ARCHIVE',
        deletedAt: null,
        archiveLifecycleState: 'ACTIVE'
      },
      orderBy: { id: 'asc' },
      take: ARCHIVE_DEFAULT_TAG_BACKFILL_BATCH_SIZE,
      select: { id: true }
    })

    if (artworks.length === 0) {
      await scope.complete({
        result: completedResult(context.payload, { ...checkpoint, skippedTagIds }),
        message: completionMessage(checkpoint.addedRelations, checkpoint.processedArtworks)
      })
      return
    }

    const artworkIds = artworks.map(({ id }) => id)
    const addedRelations = (
      await scope.transaction.artworkTag.createMany({
        data: artworkIds.flatMap((artworkId) =>
          validTagIds.map((tagId) => ({ artworkId, tagId, provenance: 'MANUAL' as const }))
        ),
        skipDuplicates: true
      })
    ).count
    const nextCheckpoint: ArchiveDefaultTagBackfillCheckpoint = {
      kind: 'CHECKPOINT',
      afterArtworkId: artworkIds.at(-1)!,
      processedArtworks: checkpoint.processedArtworks + artworkIds.length,
      addedRelations: checkpoint.addedRelations + addedRelations,
      existingRelations:
        checkpoint.existingRelations + Math.max(0, artworkIds.length * validTagIds.length - addedRelations),
      skippedTagIds
    }
    const nextArtwork = await scope.transaction.artwork.findFirst({
      where: {
        id: { gt: nextCheckpoint.afterArtworkId, lte: context.payload.targetMaxArtworkId },
        createdVia: 'URL_ARCHIVE',
        deletedAt: null,
        archiveLifecycleState: 'ACTIVE'
      },
      orderBy: { id: 'asc' },
      select: { id: true }
    })

    if (!nextArtwork) {
      await scope.complete({
        result: completedResult(context.payload, nextCheckpoint),
        message: completionMessage(nextCheckpoint.addedRelations, nextCheckpoint.processedArtworks)
      })
      return
    }

    const progress = Math.min(
      99,
      Math.max(1, Math.floor((nextCheckpoint.processedArtworks / Math.max(1, context.payload.targetArtworkCount)) * 99))
    )
    await scope.transaction.systemJob.update({
      where: { id: context.job.id },
      data: {
        result: nextCheckpoint as Prisma.InputJsonValue,
        progress,
        stage: 'YIELDING',
        message: `已检查 ${nextCheckpoint.processedArtworks}/${context.payload.targetArtworkCount} 个历史归档作品，准备让出 Worker`
      }
    })
    const now = dependencies.now?.() ?? new Date()
    await scope.retry({
      availableAt: new Date(now.getTime() + ARCHIVE_DEFAULT_TAG_BACKFILL_YIELD_MS),
      errorCode: 'RESOURCE_BUSY',
      error: 'Archive default tag backfill yielded after a durable batch',
      message: `已完成一批历史归档标签补全，累计新增 ${nextCheckpoint.addedRelations} 个标签关系`,
      preserveAttempt: true
    })
  })
}

function parseCheckpoint(value: unknown): ArchiveDefaultTagBackfillCheckpoint {
  const parsed = archiveDefaultTagBackfillCheckpointSchema.safeParse(value)
  return parsed.success
    ? parsed.data
    : {
        kind: 'CHECKPOINT',
        afterArtworkId: 0,
        processedArtworks: 0,
        addedRelations: 0,
        existingRelations: 0,
        skippedTagIds: []
      }
}

function completedResult(
  payload: ArchiveDefaultTagBackfillPayload,
  checkpoint: ArchiveDefaultTagBackfillCheckpoint
): ArchiveDefaultTagBackfillResult {
  return {
    kind: 'COMPLETED',
    targetArtworks: payload.targetArtworkCount,
    processedArtworks: checkpoint.processedArtworks,
    addedRelations: checkpoint.addedRelations,
    existingRelations: checkpoint.existingRelations,
    skippedArtworks: Math.max(0, payload.targetArtworkCount - checkpoint.processedArtworks),
    failedArtworks: 0,
    skippedTagIds: checkpoint.skippedTagIds
  }
}

function completionMessage(addedRelations: number, processedArtworks: number) {
  return `历史归档标签补全完成：检查 ${processedArtworks} 个作品，新增 ${addedRelations} 个标签关系`
}
