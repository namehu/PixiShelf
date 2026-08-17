import 'server-only'

import path from 'path'
import { PendingReplaceBatchStatus, PendingReplaceItemStatus, Prisma } from '@prisma/client'
import logger from '@/lib/logger'
import {
  assertLegacyBackgroundExecutionAllowed,
  isCentralDispatcherCutoverEnabled
} from '@/services/background-task/dispatcher-cutover'
import { prisma } from '@/lib/prisma'
import {
  PENDING_REPLACE_HEARTBEAT_INTERVAL_MS,
  PENDING_REPLACE_STALE_JOB_MS,
  type PendingReplaceManifestFile,
  type PendingReplaceMediaSnapshot,
  parsePendingReplaceManifest,
  parsePendingReplaceMediaSnapshot,
  parsePendingReplaceTargetFileSnapshot,
  pendingReplaceWarningsSchema
} from '@/schemas/pending-replace.dto'
import { resolveCanonicalChapterPath } from '@/services/artwork-service/video-chapters'
import * as JobService from '@/services/job-service'
import { getSystemSettings } from '@/services/setting.service'
import {
  cancelCentralPendingReplaceBatch,
  enqueueCentralPendingReplaceBatch,
  enqueueCentralPendingReplaceCleanup,
  enqueueCentralPendingReplacePreview,
  enqueueCentralPendingReplaceRestore,
  lockCentralPendingReplacePreviewMutation,
  recoverCentralPendingReplaceBatch
} from '@/services/pending-replace-central-service'
import { preparePendingReplaceBinding, previewPendingReplacements } from './discovery'
import {
  cleanupPendingReplaceBackups,
  PendingReplaceCommitOutcomeUnknownError,
  PendingReplaceLeaseLostError,
  recoverInterruptedPendingReplaceBatch,
  restorePendingReplaceItem,
  runPendingReplaceBatch,
  settleFailedPendingReplaceRestore,
  syncPendingReplaceBatchCounters
} from './executor'

export { previewPendingReplacements } from './discovery'

export async function getPendingReplaceBatch(batchId?: string) {
  const batch = batchId
    ? await prisma.pendingReplaceBatch.findUnique({
        where: { id: batchId },
        include: { items: { orderBy: { sourceDirectoryName: 'asc' } }, systemJob: true }
      })
    : await prisma.pendingReplaceBatch.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { items: { orderBy: { sourceDirectoryName: 'asc' } }, systemJob: true }
      })
  return batch ? serializePendingReplaceBatch(batch) : null
}

export async function createPendingReplacePreview(scanPath: string, requestedByUserId?: string) {
  if (isCentralDispatcherCutoverEnabled()) {
    if (!requestedByUserId) throw new Error('Central pending replacement requires an authenticated administrator')
    return enqueueCentralPendingReplacePreview(requestedByUserId)
  }
  const activeJob = await JobService.getActivePendingReplaceJob()
  if (activeJob) throw new Error('Pending replacement job already in progress')
  return serializePendingReplaceBatch(await previewPendingReplacements(scanPath))
}

export async function bindPendingReplaceItem(input: { scanPath: string; itemId: string; artworkId: number }) {
  const bindableStatuses = new Set<PendingReplaceItemStatus>([
    PendingReplaceItemStatus.INVALID,
    PendingReplaceItemStatus.READY,
    PendingReplaceItemStatus.EXCLUDED
  ])
  const item = await prisma.pendingReplaceItem.findUnique({
    where: { id: input.itemId },
    include: { batch: true }
  })
  if (!item) throw new Error('未找到待配对目录')
  if (item.batch.status !== PendingReplaceBatchStatus.PREVIEWED) {
    throw new Error('批次已开始，不能调整目录配对')
  }
  if (!bindableStatuses.has(item.status)) {
    throw new Error('当前目录状态不能调整配对')
  }

  const prepared = await preparePendingReplaceBinding({
    scanPath: input.scanPath,
    sourceDirectoryName: item.sourceDirectoryName,
    artworkId: input.artworkId
  })

  await prisma.$transaction(
    async (tx) => {
      if (isCentralDispatcherCutoverEnabled()) {
        await lockCentralPendingReplacePreviewMutation(tx as unknown as Prisma.TransactionClient, item.batchId)
      }
      const locked = await tx.pendingReplaceBatch.updateMany({
        where: { id: item.batchId, status: PendingReplaceBatchStatus.PREVIEWED },
        data: { updatedAt: new Date() }
      })
      if (locked.count !== 1) throw new Error('批次已开始，不能调整目录配对')
      const duplicate = await tx.pendingReplaceItem.findFirst({
        where: {
          batchId: item.batchId,
          artworkId: prepared.artworkId,
          id: { not: item.id }
        },
        select: { sourceDirectoryName: true }
      })
      if (duplicate) {
        throw new Error(`该作品已绑定目录：${duplicate.sourceDirectoryName}`)
      }
      const updated = await tx.pendingReplaceItem.updateMany({
        where: {
          id: item.id,
          batchId: item.batchId,
          status: {
            in: [PendingReplaceItemStatus.INVALID, PendingReplaceItemStatus.READY, PendingReplaceItemStatus.EXCLUDED]
          }
        },
        data: {
          artworkId: prepared.artworkId,
          externalId: prepared.externalId,
          artworkTitle: prepared.artworkTitle,
          artistName: prepared.artistName,
          targetDirectory: prepared.targetDirectory,
          status: PendingReplaceItemStatus.READY,
          included: true,
          fingerprint: prepared.fingerprint,
          sourceManifest: prepared.sourceManifest as unknown as Prisma.InputJsonValue,
          oldMediaSnapshot: prepared.oldMediaSnapshot as unknown as Prisma.InputJsonValue,
          newMediaSnapshot: prepared.newMediaSnapshot as unknown as Prisma.InputJsonValue,
          targetFileSnapshot: prepared.targetFileSnapshot as unknown as Prisma.InputJsonValue,
          warnings: prepared.warnings as unknown as Prisma.InputJsonValue,
          error: null,
          finishedAt: null
        }
      })
      if (updated.count !== 1) throw new Error('目录配对状态已经变化，请刷新后重试')
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  )
  await syncPendingReplaceBatchCounters(item.batchId)
  return { success: true, batchId: item.batchId, itemId: item.id }
}

export async function unbindPendingReplaceItem(input: { itemId: string }) {
  const bindableStatuses: PendingReplaceItemStatus[] = [
    PendingReplaceItemStatus.INVALID,
    PendingReplaceItemStatus.READY,
    PendingReplaceItemStatus.EXCLUDED
  ]
  const item = await prisma.pendingReplaceItem.findUnique({
    where: { id: input.itemId },
    include: { batch: true }
  })
  if (!item) throw new Error('未找到待配对目录')
  if (item.batch.status !== PendingReplaceBatchStatus.PREVIEWED) {
    throw new Error('批次已开始，不能解除目录配对')
  }
  if (!bindableStatuses.includes(item.status)) {
    throw new Error('当前目录状态不能解除配对')
  }
  if (!item.artworkId) throw new Error('该目录尚未绑定作品')

  await prisma.$transaction(
    async (tx) => {
      if (isCentralDispatcherCutoverEnabled()) {
        await lockCentralPendingReplacePreviewMutation(tx as unknown as Prisma.TransactionClient, item.batchId)
      }
      const locked = await tx.pendingReplaceBatch.updateMany({
        where: { id: item.batchId, status: PendingReplaceBatchStatus.PREVIEWED },
        data: { updatedAt: new Date() }
      })
      if (locked.count !== 1) throw new Error('批次已开始，不能解除目录配对')

      const updated = await tx.pendingReplaceItem.updateMany({
        where: {
          id: item.id,
          batchId: item.batchId,
          artworkId: item.artworkId,
          status: { in: bindableStatuses }
        },
        data: {
          artworkId: null,
          externalId: null,
          artworkTitle: null,
          artistName: null,
          targetDirectory: null,
          status: PendingReplaceItemStatus.INVALID,
          included: false,
          fingerprint: null,
          oldMediaSnapshot: [] as unknown as Prisma.InputJsonValue,
          targetFileSnapshot: [] as unknown as Prisma.InputJsonValue,
          warnings: [] as unknown as Prisma.InputJsonValue,
          error: '尚未绑定作品，请在快速配对区选择目标作品',
          backupDirectory: null,
          completedDirectory: null,
          startedAt: null,
          finishedAt: null
        }
      })
      if (updated.count !== 1) throw new Error('目录配对状态已经变化，请刷新后重试')
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  )

  await syncPendingReplaceBatchCounters(item.batchId)
  return { success: true, batchId: item.batchId, itemId: item.id }
}

export async function reorderPendingReplaceItem(input: { itemId: string; orderedSourceNames: string[] }) {
  const item = await prisma.pendingReplaceItem.findUnique({
    where: { id: input.itemId },
    include: { batch: true }
  })
  if (!item || item.status !== PendingReplaceItemStatus.READY) throw new Error('只有待执行项目可以调整顺序')
  if (item.batch.status !== PendingReplaceBatchStatus.PREVIEWED) throw new Error('批次已开始，不能再调整顺序')
  if (!item.externalId) throw new Error('替换项目缺少 externalId')

  const manifest = asManifest(item.sourceManifest)
  const mediaByName = new Map(asMediaSnapshot(item.newMediaSnapshot).map((media) => [media.sourceName, media]))
  const expectedNames = manifest.filter((file) => file.kind === 'media').map((file) => file.name)
  if (
    input.orderedSourceNames.length !== expectedNames.length ||
    new Set(input.orderedSourceNames).size !== expectedNames.length ||
    input.orderedSourceNames.some((name) => !mediaByName.has(name))
  ) {
    throw new Error('媒体顺序必须完整且不能重复')
  }

  const reorderedMedia = input.orderedSourceNames.map((sourceName, order) => {
    const current = mediaByName.get(sourceName)!
    const extension = path.extname(sourceName).toLowerCase()
    return { ...current, order, targetName: `${item.externalId}_p${order}${extension}` }
  })
  const targetBySource = new Map(reorderedMedia.map((media) => [media.sourceName, media.targetName]))
  const reorderedManifest = manifest.map((file) => {
    if (file.kind === 'media') return { ...file, targetName: targetBySource.get(file.name) }
    if (file.kind !== 'chapter' || !file.relatedMediaName) return file
    const targetMediaName = targetBySource.get(file.relatedMediaName)
    return targetMediaName
      ? { ...file, targetName: path.posix.basename(resolveCanonicalChapterPath(targetMediaName)) }
      : file
  })

  await prisma.$transaction(async (tx) => {
    if (isCentralDispatcherCutoverEnabled()) {
      await lockCentralPendingReplacePreviewMutation(tx as unknown as Prisma.TransactionClient, item.batchId)
    }
    const updated = await tx.pendingReplaceItem.updateMany({
      where: {
        id: item.id,
        status: PendingReplaceItemStatus.READY,
        batch: { status: PendingReplaceBatchStatus.PREVIEWED }
      },
      data: {
        sourceManifest: reorderedManifest as unknown as Prisma.InputJsonValue,
        newMediaSnapshot: reorderedMedia as unknown as Prisma.InputJsonValue
      }
    })
    if (updated.count !== 1) throw new Error('批次已开始，不能再调整顺序')
  })
  return getPendingReplaceBatch(item.batchId)
}

export async function startPendingReplaceBatch(input: {
  scanPath: string
  batchId: string
  itemIds?: string[]
  requestedByUserId?: string
}) {
  if (isCentralDispatcherCutoverEnabled()) {
    if (!input.requestedByUserId) throw new Error('Central pending replacement requires an authenticated administrator')
    return enqueueCentralPendingReplaceBatch({
      batchId: input.batchId,
      ...(input.itemIds ? { itemIds: input.itemIds } : {}),
      requestedByUserId: input.requestedByUserId
    })
  }
  assertLegacyBackgroundExecutionAllowed('PENDING_REPLACE')
  const batch = await prisma.pendingReplaceBatch.findUnique({
    where: { id: input.batchId },
    include: { items: true }
  })
  if (!batch) throw new Error('Pending replacement batch not found')
  if (batch.status === PendingReplaceBatchStatus.RUNNING || batch.status === PendingReplaceBatchStatus.CANCELLING) {
    throw new Error('Pending replacement batch already in progress')
  }

  const requestedIds = input.itemIds ? new Set(input.itemIds) : null
  const selectableStatuses: PendingReplaceItemStatus[] = [
    PendingReplaceItemStatus.READY,
    PendingReplaceItemStatus.FAILED,
    PendingReplaceItemStatus.EXCLUDED
  ]
  const selectableItems = batch.items.filter((item) => selectableStatuses.includes(item.status))
  const selectedItems = selectableItems.filter((item) => !requestedIds || requestedIds.has(item.id))
  if (selectedItems.length === 0) throw new Error('没有可执行的替换项目')

  // 固定当前执行轮次的默认标签配置，确保每个被选中的作品都使用同一套标签。
  const systemSettings = await getSystemSettings()
  const appendTagIds = [...systemSettings.replace_default_tag_ids]

  const job = await JobService.createPendingReplaceJob(batch.id, 'BATCH', async (tx, createdJob) => {
    await tx.pendingReplaceItem.updateMany({
      where: { batchId: batch.id, id: { in: selectedItems.map((item) => item.id) } },
      data: { status: PendingReplaceItemStatus.READY, included: true, error: null, finishedAt: null }
    })
    await tx.pendingReplaceItem.updateMany({
      where: {
        batchId: batch.id,
        status: PendingReplaceItemStatus.READY,
        id: { notIn: selectedItems.map((item) => item.id) }
      },
      data: { status: PendingReplaceItemStatus.EXCLUDED, included: false }
    })
    await tx.pendingReplaceBatch.update({
      where: { id: batch.id },
      data: {
        systemJobId: createdJob.id,
        status: PendingReplaceBatchStatus.RUNNING,
        startedAt: new Date(),
        finishedAt: null
      }
    })
  })
  await syncPendingReplaceBatchCounters(batch.id)

  void (async () => {
    const heartbeat = setInterval(() => {
      void JobService.touchJobHeartbeat(job.id, job.attempt).catch((error) => {
        logger.warn('Failed to update pending replacement heartbeat', { error, batchId: batch.id, jobId: job.id })
      })
    }, PENDING_REPLACE_HEARTBEAT_INTERVAL_MS)
    heartbeat.unref()
    try {
      await JobService.touchJobHeartbeat(job.id, job.attempt)
      const result = await runPendingReplaceBatch({
        scanPath: input.scanPath,
        batchId: batch.id,
        jobId: job.id,
        leaseAttempt: job.attempt,
        appendTagIds
      })
      await JobService.finalizePendingReplaceJob(
        job.id,
        job.attempt,
        result.cancelled ? { status: 'CANCELLED' } : { status: 'COMPLETED', result }
      )
    } catch (error) {
      if (error instanceof PendingReplaceLeaseLostError || error instanceof PendingReplaceCommitOutcomeUnknownError) {
        return
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Pending replacement batch failed', { error, batchId: batch.id, jobId: job.id })
      if (!(await JobService.hasPendingReplaceJobLease(job.id, job.attempt))) return
      const currentJob = await JobService.getJob(job.id)
      if (currentJob?.status === 'CANCELLING') {
        await JobService.finalizePendingReplaceJob(job.id, job.attempt, { status: 'CANCELLED' }, async (tx) => {
          await tx.pendingReplaceBatch.update({
            where: { id: batch.id },
            data: { status: PendingReplaceBatchStatus.CANCELLED, finishedAt: new Date() }
          })
        })
      } else {
        await JobService.finalizePendingReplaceJob(
          job.id,
          job.attempt,
          { status: 'FAILED', error: message },
          async (tx) => {
            await tx.pendingReplaceBatch.update({
              where: { id: batch.id },
              data: { status: PendingReplaceBatchStatus.PARTIAL_FAILED, finishedAt: new Date() }
            })
          }
        )
      }
    } finally {
      clearInterval(heartbeat)
    }
  })().catch((error) => {
    logger.error('Pending replacement background task terminated unexpectedly', {
      error,
      batchId: batch.id,
      jobId: job.id
    })
  })

  return { batchId: batch.id, jobId: job.id }
}

export async function recoverInterruptedPendingReplaceBatchById(
  scanPath: string,
  batchId: string,
  requestedByUserId?: string
) {
  if (isCentralDispatcherCutoverEnabled()) {
    if (!requestedByUserId) throw new Error('Central pending replacement requires an authenticated administrator')
    const result = await recoverCentralPendingReplaceBatch({ batchId, requestedByUserId })
    return { ...result, success: true, recoveredItems: 0 }
  }
  assertLegacyBackgroundExecutionAllowed('PENDING_REPLACE')
  return recoverInterruptedPendingReplaceBatch({
    scanPath,
    batchId,
    staleBefore: new Date(Date.now() - PENDING_REPLACE_STALE_JOB_MS)
  })
}

export async function cancelPendingReplaceBatch(batchId: string) {
  if (isCentralDispatcherCutoverEnabled()) return cancelCentralPendingReplaceBatch(batchId)
  const batch = await prisma.pendingReplaceBatch.findUnique({ where: { id: batchId }, include: { systemJob: true } })
  if (!batch?.systemJob || !['PENDING', 'RUNNING', 'PAUSED'].includes(batch.systemJob.status)) {
    return { success: false }
  }
  await prisma.pendingReplaceBatch.update({
    where: { id: batchId },
    data: { status: PendingReplaceBatchStatus.CANCELLING }
  })
  await JobService.cancelJob(batch.systemJob.id)
  return { success: true }
}

export async function restorePendingReplaceItemById(scanPath: string, itemId: string, requestedByUserId?: string) {
  if (isCentralDispatcherCutoverEnabled()) {
    if (!requestedByUserId) throw new Error('Central pending replacement requires an authenticated administrator')
    return enqueueCentralPendingReplaceRestore({ itemId, requestedByUserId })
  }
  assertLegacyBackgroundExecutionAllowed('PENDING_REPLACE')
  const item = await prisma.pendingReplaceItem.findUnique({ where: { id: itemId } })
  if (!item || item.status !== PendingReplaceItemStatus.SUCCESS) {
    throw new Error('该作品没有可恢复的旧媒体备份')
  }
  const job = await JobService.createPendingReplaceJob(itemId, 'RESTORE', async (tx, createdJob) => {
    const claimed = await tx.pendingReplaceItem.updateMany({
      where: { id: itemId, status: PendingReplaceItemStatus.SUCCESS },
      data: { status: PendingReplaceItemStatus.RESTORING, error: null, finishedAt: null }
    })
    if (claimed.count !== 1) throw new Error('该作品恢复状态已经变化')
    await tx.pendingReplaceBatch.update({
      where: { id: item.batchId },
      data: {
        systemJobId: createdJob.id,
        status: PendingReplaceBatchStatus.RUNNING,
        startedAt: new Date(),
        finishedAt: null
      }
    })
  })
  const heartbeat = startPendingReplaceHeartbeat(job, { itemId, action: 'RESTORE' })
  try {
    await JobService.touchJobHeartbeat(job.id, job.attempt)
    const result = await restorePendingReplaceItem({
      scanPath,
      itemId,
      jobId: job.id,
      leaseAttempt: job.attempt
    })
    const finalStatus = await getPendingReplaceMaintenanceBatchStatus(item.batchId)
    await JobService.finalizePendingReplaceJob(
      job.id,
      job.attempt,
      { status: 'COMPLETED', result: { itemId, action: 'RESTORE' } },
      async (tx) => {
        await tx.pendingReplaceBatch.update({
          where: { id: item.batchId },
          data: { status: finalStatus, finishedAt: new Date() }
        })
      }
    )
    return result
  } catch (error) {
    if (error instanceof PendingReplaceLeaseLostError || error instanceof PendingReplaceCommitOutcomeUnknownError) {
      throw error
    }
    if (!(await JobService.hasPendingReplaceJobLease(job.id, job.attempt))) {
      throw new PendingReplaceLeaseLostError()
    }
    const message = error instanceof Error ? error.message : '恢复旧媒体失败'
    await settleFailedPendingReplaceRestore({
      itemId,
      message,
      jobId: job.id,
      leaseAttempt: job.attempt
    })
    const finalStatus = await getPendingReplaceMaintenanceBatchStatus(item.batchId).catch(
      () => PendingReplaceBatchStatus.PARTIAL_FAILED
    )
    await JobService.finalizePendingReplaceJob(
      job.id,
      job.attempt,
      { status: 'FAILED', error: message },
      async (tx) => {
        await tx.pendingReplaceBatch.update({
          where: { id: item.batchId },
          data: { status: finalStatus, finishedAt: new Date() }
        })
      }
    ).catch(() => undefined)
    throw error
  } finally {
    clearInterval(heartbeat)
  }
}

export async function cleanupPendingReplaceBatchBackups(scanPath: string, batchId: string, requestedByUserId?: string) {
  if (isCentralDispatcherCutoverEnabled()) {
    if (!requestedByUserId) throw new Error('Central pending replacement requires an authenticated administrator')
    return enqueueCentralPendingReplaceCleanup({ batchId, requestedByUserId })
  }
  assertLegacyBackgroundExecutionAllowed('PENDING_REPLACE')
  const batch = await prisma.pendingReplaceBatch.findUnique({ where: { id: batchId } })
  if (!batch) throw new Error('Pending replacement batch not found')
  const job = await JobService.createPendingReplaceJob(batchId, 'CLEANUP', async (tx, createdJob) => {
    await tx.pendingReplaceBatch.update({
      where: { id: batchId },
      data: {
        systemJobId: createdJob.id,
        status: PendingReplaceBatchStatus.RUNNING,
        startedAt: new Date(),
        finishedAt: null
      }
    })
  })
  const heartbeat = startPendingReplaceHeartbeat(job, { batchId, action: 'CLEANUP' })
  try {
    await JobService.touchJobHeartbeat(job.id, job.attempt)
    const result = await cleanupPendingReplaceBackups({
      scanPath,
      batchId,
      jobId: job.id,
      leaseAttempt: job.attempt
    })
    const finalStatus = await getPendingReplaceMaintenanceBatchStatus(batchId)
    await JobService.finalizePendingReplaceJob(
      job.id,
      job.attempt,
      { status: 'COMPLETED', result: { batchId, action: 'CLEANUP' } },
      async (tx) => {
        await tx.pendingReplaceBatch.update({
          where: { id: batchId },
          data: { status: finalStatus, finishedAt: new Date() }
        })
      }
    )
    return result
  } catch (error) {
    if (error instanceof PendingReplaceLeaseLostError) throw error
    if (!(await JobService.hasPendingReplaceJobLease(job.id, job.attempt))) {
      throw new PendingReplaceLeaseLostError()
    }
    const message = error instanceof Error ? error.message : '清理替换备份失败'
    const finalStatus = await getPendingReplaceMaintenanceBatchStatus(batchId).catch(
      () => PendingReplaceBatchStatus.PARTIAL_FAILED
    )
    await JobService.finalizePendingReplaceJob(
      job.id,
      job.attempt,
      { status: 'FAILED', error: message },
      async (tx) => {
        await tx.pendingReplaceBatch.update({
          where: { id: batchId },
          data: { status: finalStatus, finishedAt: new Date() }
        })
      }
    ).catch(() => undefined)
    throw error
  } finally {
    clearInterval(heartbeat)
  }
}

function startPendingReplaceHeartbeat(job: { id: string; attempt: number }, context: Record<string, string>) {
  const heartbeat = setInterval(() => {
    void JobService.touchJobHeartbeat(job.id, job.attempt).catch((error) => {
      logger.warn('Failed to update pending replacement maintenance heartbeat', {
        error,
        jobId: job.id,
        ...context
      })
    })
  }, PENDING_REPLACE_HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()
  return heartbeat
}

async function getPendingReplaceMaintenanceBatchStatus(batchId: string) {
  const counters = await syncPendingReplaceBatchCounters(batchId)
  return counters.failedItems > 0 ? PendingReplaceBatchStatus.PARTIAL_FAILED : PendingReplaceBatchStatus.COMPLETED
}

interface SerializablePendingReplaceItem {
  sourceManifest: Prisma.JsonValue
  oldMediaSnapshot: Prisma.JsonValue
  newMediaSnapshot: Prisma.JsonValue
  targetFileSnapshot: Prisma.JsonValue
  warnings: Prisma.JsonValue
}

function serializePendingReplaceBatch<T extends { backupBytes: bigint; items: SerializablePendingReplaceItem[] }>(
  batch: T
) {
  return {
    ...batch,
    backupBytes: Number(batch.backupBytes),
    items: batch.items.map((item) => ({
      ...item,
      sourceManifest: asManifest(item.sourceManifest),
      oldMediaSnapshot: asMediaSnapshot(item.oldMediaSnapshot),
      newMediaSnapshot: asMediaSnapshot(item.newMediaSnapshot),
      targetFileSnapshot: parsePendingReplaceTargetFileSnapshot(item.targetFileSnapshot),
      warnings: pendingReplaceWarningsSchema.parse(item.warnings)
    }))
  }
}

function asManifest(value: Prisma.JsonValue): PendingReplaceManifestFile[] {
  return parsePendingReplaceManifest(value)
}

function asMediaSnapshot(value: Prisma.JsonValue): PendingReplaceMediaSnapshot[] {
  return parsePendingReplaceMediaSnapshot(value)
}
