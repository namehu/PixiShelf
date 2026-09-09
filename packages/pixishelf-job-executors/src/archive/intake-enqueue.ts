import { z } from 'zod'
import { ARCHIVE_IMPORT_DEFINITION_VERSION, archiveImportV2PayloadSchema } from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import { redactSensitiveText } from '@pixishelf/job-runtime'
import { ArchiveExecutorError } from './errors.ts'
import { buildArchiveStoragePaths } from './storage.ts'
import type { ResolvedArchive } from './types.ts'

export const ARCHIVE_INTAKE_PUBLISH_LOCK_ID = 7_341_902_117
const ARCHIVE_PUBLISH_ADVISORY_LOCK_ID = ARCHIVE_INTAKE_PUBLISH_LOCK_ID
export interface ArchiveIntakeEnqueueResult {
  result: 'CREATED' | 'REUSED' | 'SKIPPED' | 'CONFLICT'
  relatedId?: string | null
  code?: string | null
  message?: string | null
}

// Callers own the transaction and cancellation/lease fence. No network or media writes happen here.
export async function enqueueArchiveIntakeItemInTransaction(
  transaction: Prisma.TransactionClient,
  itemId: string,
  options: {
    quality: 'ORIGINAL' | 'DISPLAY'
    requestedByUserId: string | null
    timestamp: Date
    uuid: () => string
    defaultTagIds: number[]
    autoOnly?: boolean
  }
): Promise<ArchiveIntakeEnqueueResult> {
  const { quality, requestedByUserId, timestamp, uuid, defaultTagIds } = options
  const item = await transaction.archiveIntakeItem.findUnique({ where: { id: itemId } })
  if (!item) return { result: 'SKIPPED', code: 'NOT_FOUND', message: '收件项目不存在' }
  if (item.status === 'ENQUEUED' && item.archiveImportId) {
    // ENQUEUED 且已有 import 时，直接回写当前归档引用，保证页面多次点击不会重复创建新任务。
    const reusedImport = await transaction.archiveImport.findUnique({
      where: { id: item.archiveImportId },
      select: { id: true, selectedQuality: true }
    })
    if (!reusedImport) {
      return { result: 'CONFLICT', code: 'ARCHIVE_IMPORT_MISSING', message: '已入队的归档任务不存在' }
    }
    await transaction.archiveIntakeItem.update({
      where: { id: item.id },
      data: {
        archiveImportId: reusedImport.id,
        activeArchiveImportId: reusedImport.id,
        selectedQuality: reusedImport.selectedQuality
      }
    })
    await linkCatalogToArchiveImport(transaction, item, reusedImport.id, timestamp)
    return reusedResult(reusedImport, quality, '收件项目已入队')
  }
  if (item.status !== 'READY' || item.cancelRequestedAt) {
    return { result: 'SKIPPED', code: 'INVALID_STATE', message: `状态 ${item.status} 不能入队` }
  }
  if (!item.expiresAt || item.expiresAt <= timestamp) {
    return { result: 'CONFLICT', code: 'SNAPSHOT_EXPIRED', message: '解析快照已过期，请先重新解析' }
  }
  if (!item.providerKey || !item.externalId || !item.resolvedSnapshot || !item.metadataHash) {
    return { result: 'CONFLICT', code: 'INVALID_SNAPSHOT', message: '解析快照不完整，请重新解析' }
  }

  const resolved = restoreResolvedArchive(item.resolvedSnapshot)
  if (resolved.providerKey !== item.providerKey || resolved.externalId !== item.externalId) {
    return { result: 'CONFLICT', code: 'IDENTITY_MISMATCH', message: '解析快照身份不一致，请重新解析' }
  }

  // runArchiveBulkOperation 已先取得稳定 target lock；随后统一取得 publish lock，保持
  // target -> publish 的固定顺序，并与 trash/restore/publication 串行化身份与生命周期裁决。
  await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
  const active = await findActiveImport(transaction, item.providerKey, item.externalId)
  if (active) {
    // 同一作品已有活动归档任务时，入队动作复用已有任务而不是创建重复任务。
    const changed = await transaction.archiveIntakeItem.updateMany({
      where: { id: item.id, status: 'READY', archiveImportId: null },
      data: {
        status: 'ENQUEUED',
        archiveImportId: active.id,
        activeArchiveImportId: active.id,
        selectedQuality: active.selectedQuality,
        finishedAt: timestamp
      }
    })
    if (changed.count !== 1) {
      return { result: 'CONFLICT', code: 'CONCURRENT_MODIFICATION', message: '收件项目状态已改变' }
    }
    await linkCatalogToArchiveImport(transaction, item, active.id, timestamp)
    return reusedResult(active, quality, '复用同一作品的活动归档任务')
  }

  const existingRef = await transaction.artworkExternalRef.findUnique({
    where: { providerKey_externalId: { providerKey: item.providerKey, externalId: item.externalId } },
    include: {
      artwork: { select: { deletedAt: true, archiveLifecycleState: true } },
      archiveRevisions: { where: { isCurrent: true }, select: { metadataHash: true }, take: 1 }
    }
  })
  if (existingRef && (existingRef.artwork.deletedAt || existingRef.artwork.archiveLifecycleState !== 'ACTIVE')) {
    return { result: 'CONFLICT', code: 'ARCHIVE_TRASHED', message: '该作品在归档回收站中，请先恢复' }
  }
  if (options.autoOnly && existingRef) {
    const unchanged = existingRef.archiveRevisions[0]?.metadataHash === item.metadataHash
    await transaction.archiveIntakeItem.update({
      where: { id: item.id },
      data: { status: unchanged ? 'SKIPPED' : 'READY', resolutionKind: unchanged ? 'UNCHANGED' : 'UPDATE' }
    })
    return { result: 'SKIPPED', code: unchanged ? 'UNCHANGED' : 'UPDATE_REQUIRES_CONFIRMATION' }
  }
  const importId = uuid()
  const jobId = uuid()
  const paths = buildArchiveStoragePaths({
    scanRoot: '.',
    archiveImportId: importId,
    providerKey: resolved.providerKey,
    creatorBucket: resolved.creatorBucket,
    externalId: resolved.externalId
  })
  await transaction.systemJob.create({
    data: {
      id: jobId,
      type: 'ARCHIVE_IMPORT',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: ARCHIVE_IMPORT_DEFINITION_VERSION,
      status: 'PENDING',
      triggerSource: 'MANUAL',
      requestedByUserId,
      payload: archiveImportV2PayloadSchema.parse({ archiveImportId: importId, defaultTagIds }),
      queuePriority: 10,
      effectivePriority: 10,
      availableAt: timestamp,
      maxAttempts: 3,
      progress: 0,
      message: '等待中央后台任务进程...'
    }
  })
  await transaction.archiveImport.create({
    data: {
      id: importId,
      systemJobId: jobId,
      providerKey: resolved.providerKey,
      externalId: resolved.externalId,
      submittedUrl: item.submittedUrl,
      canonicalUrl: resolved.canonicalUrl,
      locator: toJsonValue(resolved.locator),
      requestedQuality: quality,
      selectedQuality: quality,
      normalizedMetadata: toJsonValue(resolved.normalizedMetadata),
      rawMetadata: toJsonValue(resolved.rawMetadata),
      metadataHash: item.metadataHash,
      creatorBucket: resolved.creatorBucket,
      stagingPath: paths.stagingRelativePath,
      totalItems: resolved.media.length,
      warning: redactArchiveText(resolved.warnings.join('\n') || null),
      items: {
        create: resolved.media.map((media) => ({
          pageIndex: media.index,
          sourcePageUrl: media.sourcePageUrl,
          locator: toJsonValue(media.locator),
          expectedFilename: media.expectedFilename
        }))
      }
    }
  })
  const changed = await transaction.archiveIntakeItem.updateMany({
    where: { id: item.id, status: 'READY', archiveImportId: null },
    data: {
      status: 'ENQUEUED',
      archiveImportId: importId,
      activeArchiveImportId: importId,
      selectedQuality: quality,
      finishedAt: timestamp
    }
  })
  if (changed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', '收件项目状态已改变')
  await linkCatalogToArchiveImport(transaction, item, importId, timestamp)
  await transaction.systemJobEvent.create({
    data: {
      jobId,
      type: 'job.queued',
      attempt: 0,
      message: '归档导入已从收件箱加入队列',
      data: { archiveImportId: importId, intakeItemId: item.id, priority: 10 }
    }
  })
  return { result: 'CREATED', relatedId: importId }
}

export async function recoverArchiveIntakeEnqueueRace(
  transaction: Prisma.TransactionClient,
  itemId: string,
  quality: 'ORIGINAL' | 'DISPLAY',
  error: unknown,
  timestamp: Date
): Promise<ArchiveIntakeEnqueueResult | null> {
  if (!isUniqueConstraintError(error)) return null
  const item = await transaction.archiveIntakeItem.findUnique({ where: { id: itemId } })
  if (!item) return null
  if (item.status === 'ENQUEUED' && item.archiveImportId) {
    const reusedImport = await transaction.archiveImport.findUnique({
      where: { id: item.archiveImportId },
      select: { id: true, selectedQuality: true }
    })
    if (!reusedImport) return null
    await transaction.archiveIntakeItem.update({
      where: { id: item.id },
      data: {
        archiveImportId: reusedImport.id,
        activeArchiveImportId: reusedImport.id,
        selectedQuality: reusedImport.selectedQuality
      }
    })
    await linkCatalogToArchiveImport(transaction, item, reusedImport.id, timestamp)
    return reusedResult(reusedImport, quality, '并发命令已将收件项目入队')
  }
  if (!item.providerKey || !item.externalId || item.status !== 'READY') return null
  const active = await findActiveImport(transaction, item.providerKey, item.externalId)
  if (!active) return null
  const changed = await transaction.archiveIntakeItem.updateMany({
    where: { id: item.id, status: 'READY', archiveImportId: null },
    data: {
      status: 'ENQUEUED',
      archiveImportId: active.id,
      activeArchiveImportId: active.id,
      selectedQuality: active.selectedQuality,
      finishedAt: timestamp
    }
  })
  if (changed.count !== 1) {
    return { result: 'CONFLICT', code: 'CONCURRENT_MODIFICATION', message: '收件项目状态已改变' }
  }
  await linkCatalogToArchiveImport(transaction, item, active.id, timestamp)
  return reusedResult(active, quality, '复用并发创建的活动归档任务')
}

function linkCatalogToArchiveImport(
  transaction: Prisma.TransactionClient,
  intakeItem: {
    id: string
    providerKey: string | null
    externalId: string | null
    canonicalUrl: string | null
    submittedUrl: string
  },
  archiveImportId: string,
  timestamp: Date
) {
  const identityFilters: Prisma.ArchiveUploaderCatalogItemWhereInput[] = []
  if (intakeItem.providerKey && intakeItem.externalId) {
    identityFilters.push({ providerKey: intakeItem.providerKey, externalId: intakeItem.externalId })
  }
  if (intakeItem.canonicalUrl) identityFilters.push({ canonicalUrl: intakeItem.canonicalUrl })
  identityFilters.push({ canonicalUrl: intakeItem.submittedUrl })
  return transaction.archiveUploaderCatalogItem.updateMany({
    where: { OR: [{ lastIntakeItemId: intakeItem.id }, ...identityFilters] },
    data: {
      lastIntakeItemId: intakeItem.id,
      lastArchiveImportId: archiveImportId,
      lastOutcome: 'SUBMITTED',
      lastOutcomeAt: timestamp,
      lastErrorCode: null,
      lastErrorMessage: null
    }
  })
}

function findActiveImport(transaction: Prisma.TransactionClient, providerKey: string, externalId: string) {
  return transaction.archiveImport.findFirst({
    where: { providerKey, externalId, status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] } },
    select: { id: true, selectedQuality: true }
  })
}

function reusedResult(
  archiveImport: { id: string; selectedQuality: 'ORIGINAL' | 'DISPLAY' },
  requestedQuality: 'ORIGINAL' | 'DISPLAY',
  message: string
): ArchiveIntakeEnqueueResult {
  // 复用已有任务时，返回 REUSED 且附带 quality 不匹配原因，便于前端给出更清晰提示。
  return archiveImport.selectedQuality === requestedQuality
    ? { result: 'REUSED', relatedId: archiveImport.id, message }
    : {
        result: 'REUSED',
        relatedId: archiveImport.id,
        code: 'QUALITY_ALREADY_FIXED',
        message: `${message}；已保留活动任务的 ${archiveImport.selectedQuality} 质量`
      }
}

function restoreResolvedArchive(value: Prisma.JsonValue): ResolvedArchive {
  const raw = value as unknown as ResolvedArchive & { postedAt?: string | Date | null }
  if (!raw || !Array.isArray(raw.media) || typeof raw.providerKey !== 'string' || typeof raw.externalId !== 'string') {
    throw new ArchiveExecutorError('STATE_CONFLICT', '解析快照格式无效，请重新解析')
  }
  return { ...raw, postedAt: raw.postedAt ? new Date(raw.postedAt) : null }
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

function redactArchiveText(value: string | null) {
  if (value === null) return null
  return redactSensitiveText(
    value
      .replace(/https?:\/\/[^\s<>]+/gi, '[REDACTED_URL]')
      .replace(/(\blocator["']?\s*[:=]\s*["']?)[^\s,;}"']+/gi, '$1[REDACTED]')
  ).slice(0, 4096)
}

export function parseArchiveIntakeDefaultTagIds(value: string | null | undefined): number[] {
  const tagIds = z.array(z.coerce.number().int().positive()).parse(value ? JSON.parse(value) : [])
  return archiveImportV2PayloadSchema.shape.defaultTagIds.parse(
    [...new Set(tagIds)].sort((left, right) => left - right)
  )
}
