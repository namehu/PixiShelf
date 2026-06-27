import { prisma } from '@/lib/prisma'
import logger from '@/lib/logger'
import type { ScanResult } from '@/types'
import { Prisma, ScanRunItemAction, ScanRunItemStatus, ScanRunMode, ScanRunStatus, ScanRunType } from '@prisma/client'
import type { ScanAuditItemInput } from './scan-service/types'
import { ESource } from '@/enums/ESource'
import type { ArtworkSource } from '@/schemas/models'

const DEFAULT_ITEM_BATCH_SIZE = 200
const MAX_HISTORY_LIMIT = 50
const MAX_DETAIL_LIMIT = 500
const DEFAULT_RETENTION_MAX_AGE_DAYS = 180
const DEFAULT_RETENTION_MAX_RUNS_PER_TYPE = 100
const TERMINAL_SCAN_RUN_STATUSES = [ScanRunStatus.COMPLETED, ScanRunStatus.FAILED, ScanRunStatus.CANCELLED]
const DEFAULT_HISTORY_RUN_WHERE: Prisma.ScanRunWhereInput = {
  mode: {
    not: ScanRunMode.LOCAL_CREATE
  }
}

export interface StartScanRunInput {
  systemJobId?: string | null
  type: ScanRunType
  mode: ScanRunMode
  startedAt?: Date
}

export interface AppendScanRunItemInput extends ScanAuditItemInput {
  scanRunId: string
}

export interface ListScanRunsInput {
  limit?: number
}

export interface GetScanRunDetailInput {
  scanRunId: string
  status?: ScanRunItemStatus
  limit?: number
  cursor?: string
}

export interface CompleteScanRunSummaryInput {
  totalArtworks?: number
  skippedArtworks?: number
  newArtists?: number
  newTags?: number
  newImages?: number
  durationMs?: number
  errorMessage?: string | null
}

export interface UpdateScanRunItemMediaInput {
  scanRunId: string
  externalId: string
  mediaCount: number
  newImageCount: number
  errorMessage?: string | null
}

export interface CleanupScanRunHistoryInput {
  now?: Date
  maxAgeDays?: number
  maxRunsPerType?: number
}

export interface CleanupScanRunHistoryResult {
  deletedRuns: number
}

export function getScanRunTypeForArtworkSource(source: ArtworkSource) {
  switch (source) {
    case ESource.LOCAL_IMPORT:
      return ScanRunType.LOCAL_IMPORT
    case ESource.LOCAL_CREATED:
      return ScanRunType.LOCAL_CREATE
    case ESource.PIXIV_IMPORTED:
    default:
      return ScanRunType.PIXIV
  }
}

/** 启动一次新的扫描运行，创建 ScanRun 记录 */
export async function startScanRun(input: StartScanRunInput) {
  return prisma.scanRun.create({
    data: {
      systemJobId: input.systemJobId ?? null,
      type: input.type,
      mode: input.mode,
      startedAt: input.startedAt ?? new Date()
    }
  })
}

/** 批量追加扫描运行条目，写入 ScanRunItem 表 */
export async function appendScanRunItems(items: AppendScanRunItemInput[]) {
  if (items.length === 0) return { count: 0 }

  return prisma.scanRunItem.createMany({
    data: items.map((item) => ({
      scanRunId: item.scanRunId,
      externalId: item.externalId ?? null,
      title: item.title ?? null,
      artistName: item.artistName ?? null,
      relativeDirectory: item.relativeDirectory ?? null,
      metadataRelativePath: item.metadataRelativePath ?? null,
      status: item.status as ScanRunItemStatus,
      action: item.action as ScanRunItemAction,
      mediaCount: item.mediaCount ?? 0,
      newImageCount: item.newImageCount ?? 0,
      errorMessage: item.errorMessage ?? null,
      startedAt: item.startedAt ?? new Date(),
      finishedAt: item.finishedAt ?? null,
      durationMs: item.durationMs ?? null
    }))
  })
}

/** 创建扫描运行条目的缓冲区，支持批量写入以减少数据库往返 */
export function createScanRunItemBuffer(scanRunId: string, batchSize = DEFAULT_ITEM_BATCH_SIZE) {
  let pending: AppendScanRunItemInput[] = []

  async function flush() {
    if (pending.length === 0) return
    const items = pending
    pending = []
    try {
      await appendScanRunItems(items)
    } catch (error) {
      logger.error('Failed to append scan run items', { error, scanRunId, count: items.length })
    }
  }

  async function recordItems(items: ScanAuditItemInput[]) {
    for (const item of items) {
      pending.push({ ...item, scanRunId })
    }

    if (pending.length >= batchSize) {
      await flush()
    }
  }

  return { recordItems, flush }
}

/** 完成扫描运行，从 ScanResult 提取汇总信息并写入 ScanRun */
export async function completeScanRun(scanRunId: string, result: ScanResult) {
  return completeScanRunSummary(scanRunId, {
    totalArtworks: result.totalArtworks,
    skippedArtworks: result.skippedArtworks,
    newArtists: result.newArtists,
    newTags: result.newTags,
    newImages: result.newImages,
    durationMs: result.processingTime,
    errorMessage: result.errors.length > 0 ? result.errors.slice(0, 5).join('\n') : null
  })
}

/** 以结构化汇总数据完成扫描运行，更新状态为 COMPLETED 并写入各项统计数据 */
export async function completeScanRunSummary(scanRunId: string, summary: CompleteScanRunSummaryInput) {
  const finishedAt = new Date()
  const counts = await countRunItems(scanRunId)
  const itemImageCount = await sumRunItemNewImages(scanRunId)

  return prisma.scanRun.update({
    where: { id: scanRunId },
    data: {
      status: ScanRunStatus.COMPLETED,
      finishedAt,
      durationMs: summary.durationMs,
      totalArtworks: summary.totalArtworks,
      processedArtworks: counts.processedArtworks,
      succeededArtworks: counts.succeededArtworks,
      skippedArtworks: Math.max(summary.skippedArtworks ?? 0, counts.skippedArtworks),
      failedArtworks: counts.failedArtworks,
      newArtists: summary.newArtists,
      newTags: summary.newTags,
      newImages: summary.newImages ?? itemImageCount,
      errorMessage: summary.errorMessage ?? null
    }
  })
}

/** 更新扫描运行条目的媒体相关统计（媒体数、新图片数等），并标记完成时间 */
export async function updateScanRunItemMedia(input: UpdateScanRunItemMediaInput) {
  return prisma.scanRunItem.updateMany({
    where: {
      scanRunId: input.scanRunId,
      externalId: input.externalId
    },
    data: {
      mediaCount: input.mediaCount,
      newImageCount: input.newImageCount,
      errorMessage: input.errorMessage ?? null,
      finishedAt: new Date()
    }
  })
}

/** 将扫描运行标记为失败状态 */
export async function failScanRun(scanRunId: string, errorMessage: string, result?: ScanResult | null) {
  const counts = await countRunItems(scanRunId)
  return updateTerminalScanRun(scanRunId, ScanRunStatus.FAILED, counts, errorMessage, result)
}

/** 取消正在进行的扫描运行 */
export async function cancelScanRun(scanRunId: string, result?: ScanResult | null) {
  const counts = await countRunItems(scanRunId)
  return updateTerminalScanRun(scanRunId, ScanRunStatus.CANCELLED, counts, '扫描已取消', result)
}

/** 分页列出历史扫描运行记录，排除本地创建的记录 */
export async function listScanRuns(input: ListScanRunsInput = {}) {
  const take = Math.min(Math.max(input.limit ?? 10, 1), MAX_HISTORY_LIMIT)
  return prisma.scanRun.findMany({
    where: DEFAULT_HISTORY_RUN_WHERE,
    orderBy: { startedAt: 'desc' },
    take,
    include: {
      _count: {
        select: { items: true }
      }
    }
  })
}

/** 获取最近一次扫描运行记录 */
export async function getLatestScanRun() {
  return prisma.scanRun.findFirst({
    where: DEFAULT_HISTORY_RUN_WHERE,
    orderBy: { startedAt: 'desc' },
    include: {
      _count: {
        select: { items: true }
      }
    }
  })
}

/** 获取扫描运行的详细信息，包含分页的条目列表和游标 */
export async function getScanRunDetail(input: GetScanRunDetailInput) {
  const take = Math.min(Math.max(input.limit ?? 100, 1), MAX_DETAIL_LIMIT)
  const where: Prisma.ScanRunItemWhereInput = {
    scanRunId: input.scanRunId,
    ...(input.status ? { status: input.status } : {})
  }

  const [run, items] = await Promise.all([
    prisma.scanRun.findUnique({
      where: { id: input.scanRunId }
    }),
    prisma.scanRunItem.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: take + 1,
      ...(input.cursor
        ? {
            cursor: { id: input.cursor },
            skip: 1
          }
        : {})
    })
  ])

  const hasMore = items.length > take
  const pageItems = hasMore ? items.slice(0, take) : items
  return {
    run,
    items: pageItems,
    nextCursor: hasMore ? (pageItems[pageItems.length - 1]?.id ?? null) : null
  }
}

/** 清理 ScanRun 审计历史：只删除终态记录，包含默认历史列表隐藏的 LOCAL_CREATE，明细依赖数据库级联删除 */
export async function cleanupScanRunHistory(input: CleanupScanRunHistoryInput = {}): Promise<CleanupScanRunHistoryResult> {
  const now = input.now ?? new Date()
  const maxAgeDays = input.maxAgeDays ?? DEFAULT_RETENTION_MAX_AGE_DAYS
  const maxRunsPerType = input.maxRunsPerType ?? DEFAULT_RETENTION_MAX_RUNS_PER_TYPE
  const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000)
  const idsToDelete = new Set<string>()

  const expiredRuns = await prisma.scanRun.findMany({
    where: {
      status: { in: TERMINAL_SCAN_RUN_STATUSES },
      finishedAt: { lt: cutoff }
    },
    select: { id: true }
  })

  expiredRuns.forEach((run) => idsToDelete.add(run.id))

  for (const type of Object.values(ScanRunType)) {
    const overflowRuns = await prisma.scanRun.findMany({
      where: {
        type,
        status: { in: TERMINAL_SCAN_RUN_STATUSES }
      },
      orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
      skip: maxRunsPerType,
      select: { id: true }
    })

    overflowRuns.forEach((run) => idsToDelete.add(run.id))
  }

  if (idsToDelete.size === 0) {
    return { deletedRuns: 0 }
  }

  const result = await prisma.scanRun.deleteMany({
    where: {
      id: { in: Array.from(idsToDelete) }
    }
  })

  return { deletedRuns: result.count }
}

/** 按状态分组统计扫描运行条目数量 */
async function countRunItems(scanRunId: string) {
  const grouped = await prisma.scanRunItem.groupBy({
    by: ['status'],
    where: { scanRunId },
    _count: { _all: true }
  })

  const getCount = (status: ScanRunItemStatus) => grouped.find((item) => item.status === status)?._count._all ?? 0

  const succeededArtworks = getCount(ScanRunItemStatus.SUCCESS)
  const skippedArtworks = getCount(ScanRunItemStatus.SKIPPED)
  const failedArtworks = getCount(ScanRunItemStatus.FAILED)

  return {
    processedArtworks: succeededArtworks + skippedArtworks + failedArtworks,
    succeededArtworks,
    skippedArtworks,
    failedArtworks
  }
}

/** 汇总扫描运行条目中的 newImageCount 总和 */
async function sumRunItemNewImages(scanRunId: string) {
  const result = await prisma.scanRunItem.aggregate({
    where: { scanRunId },
    _sum: { newImageCount: true }
  })
  return result._sum.newImageCount ?? 0
}

/** 将扫描运行更新为终态（失败或取消），写入汇总统计信息 */
async function updateTerminalScanRun(
  scanRunId: string,
  status: ScanRunStatus,
  counts: Awaited<ReturnType<typeof countRunItems>>,
  errorMessage: string,
  result?: ScanResult | null
) {
  const run = await prisma.scanRun.findUnique({
    where: { id: scanRunId },
    select: { startedAt: true }
  })
  const finishedAt = new Date()

  return prisma.scanRun.update({
    where: { id: scanRunId },
    data: {
      status,
      finishedAt,
      durationMs: result?.processingTime ?? (run ? finishedAt.getTime() - run.startedAt.getTime() : null),
      totalArtworks: result?.totalArtworks,
      processedArtworks: counts.processedArtworks,
      succeededArtworks: counts.succeededArtworks,
      skippedArtworks: Math.max(result?.skippedArtworks ?? 0, counts.skippedArtworks),
      failedArtworks: counts.failedArtworks,
      newArtists: result?.newArtists,
      newTags: result?.newTags,
      newImages: result?.newImages,
      errorMessage
    }
  })
}
