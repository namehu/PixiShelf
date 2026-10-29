import { createHash } from 'node:crypto'
import { assertArchiveSourceSnapshot } from './dedup-source-snapshot.ts'
import { lockArchiveUploaderCatalogIdentities } from './uploader-catalog-lock.ts'
import { z } from 'zod'
import {
  archiveImportV2PayloadSchema,
  archiveCompletionSnapshotSchema,
  ARCHIVE_COVERAGE_DEFINITION_VERSION
} from '@pixishelf/job-contracts'
import { Prisma, lockCreatorCatalog } from '@pixishelf/db'
import { redactSensitiveText } from '@pixishelf/job-runtime'
import { ArchiveExecutorError } from './errors.ts'
import { buildArchiveStoragePaths } from './storage.ts'
import type { ResolvedArchive } from './types.ts'
import { isPublishedArchiveUnchanged } from './metadata-comparison.ts'

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
    downloadScope?: 'ALL' | 'FIRST_20'
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
  if (!['READY', 'ENQUEUED'].includes(item.status) || item.cancelRequestedAt) {
    return { result: 'SKIPPED', code: 'INVALID_STATE' }
  }
  await lockCreatorCatalog(transaction)
  await lockIntakeSource(transaction, item)
  const dedupSourceSnapshot = await assertArchiveSourceSnapshot(transaction, {
    providerKey: item.providerKey ?? '',
    externalId: item.externalId ?? '',
    dedupSourceSnapshot: item.dedupSourceSnapshot
  })
  if (item.status === 'ENQUEUED' && item.archiveImportId) {
    // ENQUEUED 且已有 import 时，直接回写当前归档引用，保证页面多次点击不会重复创建新任务。
    const reusedImport = await transaction.archiveImport.findUnique({
      where: { id: item.archiveImportId },
      select: { id: true, selectedQuality: true, providerKey: true, externalId: true, dedupSourceSnapshot: true }
    })
    if (!reusedImport) {
      return { result: 'CONFLICT', code: 'ARCHIVE_IMPORT_MISSING', message: '已入队的归档任务不存在' }
    }
    await assertArchiveSourceSnapshot(transaction, {
      ...reusedImport,
      providerKey: item.providerKey ?? '',
      externalId: item.externalId ?? ''
    })
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
  const deletion = await transaction.archiveDeletedIdentity.findUnique({
    where: { providerKey_externalId: { providerKey: item.providerKey, externalId: item.externalId } }
  })
  if (
    deletion &&
    (options.autoOnly || item.downloadMode === 'AUTO' || !deletion.purgedAt || item.createdAt <= deletion.purgedAt)
  ) {
    return { result: 'CONFLICT', code: 'ARCHIVE_DELETED', message: '该作品已删除，文件清理完成后请手动重新提交归档' }
  }
  const active = await findActiveImport(transaction, item.providerKey, item.externalId)
  if (active) {
    await assertArchiveSourceSnapshot(transaction, active)
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
      archiveRevisions: {
        where: { isCurrent: true },
        select: { id: true, metadataHash: true, downloadScope: true, sourceTotalItems: true, sourcePlanDigest: true },
        take: 1
      }
    }
  })
  if (existingRef && (existingRef.artwork.deletedAt || existingRef.artwork.archiveLifecycleState !== 'ACTIVE')) {
    return { result: 'CONFLICT', code: 'ARCHIVE_TRASHED', message: '该作品在归档回收站中，请先恢复' }
  }
  if (options.autoOnly && existingRef && !item.completionBaseRevisionId) {
    const unchanged = await isPublishedArchiveUnchanged(transaction, existingRef, resolved, item.metadataHash)
    await transaction.archiveIntakeItem.update({
      where: { id: item.id },
      data: { status: unchanged ? 'SKIPPED' : 'READY', resolutionKind: unchanged ? 'UNCHANGED' : 'UPDATE' }
    })
    return { result: 'SKIPPED', code: unchanged ? 'UNCHANGED' : 'UPDATE_REQUIRES_CONFIRMATION' }
  }
  const previousRevision = existingRef?.archiveRevisions[0]
  const sourcePlanDigest = hashArchiveMediaPlan(resolved.media)
  const completion = item.completionBaseRevisionId
    ? archiveCompletionSnapshotSchema.parse(item.completionSnapshot)
    : null
  if (
    completion &&
    (previousRevision?.id !== completion.revisionId ||
      item.completionBaseRevisionId !== completion.revisionId ||
      existingRef?.artworkId !== completion.artworkId ||
      sourcePlanDigest !== completion.sourcePlanDigest ||
      resolved.media.length !== completion.sourceTotalItems ||
      quality !== completion.quality)
  )
    return {
      result: 'CONFLICT',
      code: 'SOURCE_CHANGED',
      message: '来源内容或本地归档已变化，补全已停止；请通过完整更新重新确认。'
    }
  // An ordinary resubmission preserves existing coverage; only the completion command expands a partial archive.
  const downloadScope = completion
    ? 'ALL'
    : (previousRevision?.downloadScope ?? options.downloadScope ?? item.downloadScope ?? 'ALL')
  const mediaPlan = downloadScope === 'FIRST_20' ? resolved.media.slice(0, 20) : resolved.media
  const importId = uuid()
  const jobId = uuid()
  const paths = buildArchiveStoragePaths({
    scanRoot: '.',
    archiveImportId: importId,
    providerKey: resolved.providerKey,
    creatorBucket: resolved.creatorBucket,
    externalId: resolved.externalId
  })
  const origin = options.autoOnly ? 'AUTO' : 'MANUAL'
  const priority = origin === 'AUTO' ? 900 : 10
  await transaction.systemJob.create({
    data: {
      id: jobId,
      type: 'ARCHIVE_DOWNLOAD',
      executionLane: 'ARCHIVE_DOWNLOAD',
      definitionVersion: ARCHIVE_COVERAGE_DEFINITION_VERSION,
      status: 'PENDING',
      triggerSource: origin === 'AUTO' ? 'SYSTEM' : 'MANUAL',
      requestedByUserId,
      payload: archiveImportV2PayloadSchema.parse({ archiveImportId: importId, defaultTagIds }),
      queuePriority: priority,
      effectivePriority: priority,
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
      phase: 'DOWNLOAD',
      origin,
      executions: { create: { jobId, phase: 'DOWNLOAD' } },
      providerKey: resolved.providerKey,
      externalId: resolved.externalId,
      dedupSourceSnapshot,
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
      downloadScope,
      sourceTotalItems: resolved.media.length,
      sourcePlanDigest,
      completionBaseRevisionId: completion?.revisionId ?? null,
      completionSnapshot: completion ? toJsonValue(completion) : Prisma.DbNull,
      totalItems: mediaPlan.length,
      warning: redactArchiveText(resolved.warnings.join('\n') || null),
      items: {
        create: mediaPlan.map((media) => {
          const reused = completion?.media.find((entry) => entry.index === media.index)
          return {
            pageIndex: media.index,
            sourcePageUrl: media.sourcePageUrl,
            locator: toJsonValue(media.locator),
            expectedFilename: media.expectedFilename,
            ...(reused
              ? {
                  status: 'COMPLETED' as const,
                  stagedGenerationPath: completion!.archivePath,
                  stagedPath: reused.path,
                  byteCount: BigInt(reused.size),
                  sha256: reused.sha256,
                  width: reused.width,
                  height: reused.height,
                  mimeType: reused.mimeType,
                  quality: completion!.quality,
                  finishedAt: timestamp
                }
              : {})
          }
        })
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
      data: { archiveImportId: importId, intakeItemId: item.id, priority }
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
  if (!['READY', 'ENQUEUED'].includes(item.status) || item.cancelRequestedAt) return null
  await lockIntakeSource(transaction, item)
  await assertArchiveSourceSnapshot(transaction, {
    providerKey: item.providerKey ?? '',
    externalId: item.externalId ?? '',
    dedupSourceSnapshot: item.dedupSourceSnapshot
  })
  if (item.status === 'ENQUEUED' && item.archiveImportId) {
    const reusedImport = await transaction.archiveImport.findUnique({
      where: { id: item.archiveImportId },
      select: { id: true, selectedQuality: true, providerKey: true, externalId: true, dedupSourceSnapshot: true }
    })
    if (!reusedImport) return null
    await assertArchiveSourceSnapshot(transaction, {
      ...reusedImport,
      providerKey: item.providerKey ?? '',
      externalId: item.externalId ?? ''
    })
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
  await assertArchiveSourceSnapshot(transaction, active)
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
    select: { id: true, selectedQuality: true, providerKey: true, externalId: true, dedupSourceSnapshot: true }
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

async function lockIntakeSource(
  transaction: Prisma.TransactionClient,
  item: { providerKey: string | null; externalId: string | null; submittedUrl: string; canonicalUrl: string | null }
) {
  await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
  await lockArchiveUploaderCatalogIdentities(transaction, [
    {
      providerKey: item.providerKey,
      externalId: item.externalId,
      canonicalUrls: [item.submittedUrl, item.canonicalUrl]
    }
  ])
}

export function hashArchiveMediaPlan(media: ResolvedArchive['media']) {
  return createHash('sha256')
    .update(JSON.stringify(media.map(({ index, sourcePageUrl, locator }) => ({ index, sourcePageUrl, locator }))))
    .digest('hex')
}
