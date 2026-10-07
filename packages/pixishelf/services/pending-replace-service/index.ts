import { prisma } from '@/lib/prisma'
import {
  type PendingReplaceManifestFile,
  type PendingReplaceMediaSnapshot,
  parsePendingReplaceManifest,
  parsePendingReplaceMediaSnapshot,
  parsePendingReplaceTargetFileSnapshot,
  pendingReplaceWarningsSchema
} from '@/schemas/pending-replace.dto'
import { resolveCanonicalChapterPath } from '@/services/artwork-service/video-chapters'
import {
  cancelCentralPendingReplaceBatch,
  enqueueCentralPendingReplaceBatch,
  enqueueCentralPendingReplaceCleanup,
  enqueueCentralPendingReplacePreview,
  enqueueCentralPendingReplaceRestore,
  lockCentralPendingReplacePreviewMutation,
  recoverCentralPendingReplaceBatch
} from '@/services/pending-replace-central-service'
import { PendingReplaceBatchStatus, PendingReplaceItemStatus, Prisma } from '@prisma/client'
import path from 'path'
import 'server-only'
import { syncPendingReplaceBatchCounters } from './batch-counters'
import { preparePendingReplaceBinding } from './discovery'

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
  {
    if (!requestedByUserId) throw new Error('Central pending replacement requires an authenticated administrator')
    return enqueueCentralPendingReplacePreview(requestedByUserId)
  }
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
      {
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
      {
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
    {
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
  {
    if (!input.requestedByUserId) throw new Error('Central pending replacement requires an authenticated administrator')
    return enqueueCentralPendingReplaceBatch({
      batchId: input.batchId,
      ...(input.itemIds ? { itemIds: input.itemIds } : {}),
      requestedByUserId: input.requestedByUserId
    })
  }
}
export async function recoverInterruptedPendingReplaceBatchById(
  scanPath: string,
  batchId: string,
  requestedByUserId?: string
) {
  {
    if (!requestedByUserId) throw new Error('Central pending replacement requires an authenticated administrator')
    const result = await recoverCentralPendingReplaceBatch({ batchId, requestedByUserId })
    return { ...result, success: true, recoveredItems: 0 }
  }
}
export async function cancelPendingReplaceBatch(batchId: string) {
  return cancelCentralPendingReplaceBatch(batchId)
}
export async function restorePendingReplaceItemById(scanPath: string, itemId: string, requestedByUserId?: string) {
  {
    if (!requestedByUserId) throw new Error('Central pending replacement requires an authenticated administrator')
    return enqueueCentralPendingReplaceRestore({ itemId, requestedByUserId })
  }
}
export async function cleanupPendingReplaceBatchBackups(scanPath: string, batchId: string, requestedByUserId?: string) {
  {
    if (!requestedByUserId) throw new Error('Central pending replacement requires an authenticated administrator')
    return enqueueCentralPendingReplaceCleanup({ batchId, requestedByUserId })
  }
}

interface SerializablePendingReplaceItem {
  sourceManifest: Prisma.JsonValue
  oldMediaSnapshot: Prisma.JsonValue
  newMediaSnapshot: Prisma.JsonValue
  targetFileSnapshot: Prisma.JsonValue
  warnings: Prisma.JsonValue
}
function serializePendingReplaceBatch<
  T extends {
    backupBytes: bigint
    items: SerializablePendingReplaceItem[]
  }
>(batch: T) {
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
