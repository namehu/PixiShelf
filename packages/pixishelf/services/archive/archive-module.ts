import { randomUUID } from 'node:crypto'
import {
  archiveImportPayloadSchema,
  archiveMaintenancePayloadSchema,
  JOB_DEFINITION_VERSION
} from '@pixishelf/job-contracts'
import { ArchiveImportStatus, JobStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isCentralDispatcherCutoverEnabled } from '@/services/background-task/dispatcher-cutover'
import { writeJobEvent } from '@/services/background-task/job-event-service'
import { redactArchiveUrl } from './archive-redaction'
import { ArchiveError } from './errors'
import { archiveProviderRegistry, type ArchiveProviderRegistry } from './provider-registry'
import { hashResolvedMetadata } from './providers/e-hentai'
import { buildArchiveStoragePaths } from './storage'
import { ARCHIVE_PUBLISH_ADVISORY_LOCK_ID, restorePublishedArchive, trashPublishedArchive } from './publisher'
import type {
  ArchivePreview,
  ArchiveItemStatusFilter,
  ArchiveProvider,
  ArchiveTaskAction,
  ConfirmedArchiveInput,
  ResolvedArchive
} from './types'
import { requireArchiveStorageRoot } from './config'
import type { ArchiveTransactionClient } from './relationships'

const PREVIEW_TTL_MS = 30 * 60 * 1000
const FAILED_STAGING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const PARTIAL_FAILED_STAGING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const ARCHIVE_IMPORT_JOB_TYPE = 'ARCHIVE_IMPORT'

type ArchiveWorkflowStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

type ArchiveTransitionInput = {
  importStatus: ArchiveWorkflowStatus
  message: string
  finishedAt?: Date
  retainUntil?: Date
  importData?: Omit<Prisma.ArchiveImportUpdateManyMutationInput, 'status'>
  jobData?: Omit<Prisma.SystemJobUpdateManyMutationInput, 'status'>
  mutate?: (tx: ArchiveTransactionClient) => Promise<void>
} & ({ jobStatus: ArchiveWorkflowStatus; preserveJobStatus?: false } | { jobStatus?: never; preserveJobStatus: true })

type ArchiveTaskSummaryRecord = Prisma.ArchiveImportGetPayload<{
  include: {
    systemJob: true
    publishedRevision: true
    publishedArtwork: { select: { id: true; title: true; deletedAt: true } }
  }
}>

type ArchiveTaskRecord = Prisma.ArchiveImportGetPayload<{
  include: {
    systemJob: true
    publishedRevision: true
    publishedArtwork: { select: { id: true; title: true; deletedAt: true } }
    items: true
  }
}>
type ArchiveControlTaskRecord = Prisma.ArchiveImportGetPayload<{ include: { systemJob: true } }>

export class ArchiveModule {
  constructor(private readonly providers: ArchiveProviderRegistry = archiveProviderRegistry) {}

  async preview(url: string): Promise<ArchivePreview> {
    const provider = this.providers.getForUrl(url)
    const resolved = await provider.resolve(url)
    const metadataHash = hashResolvedMetadata(resolved.normalizedMetadata)
    const [existingRef, activeImport] = await Promise.all([
      prisma.artworkExternalRef.findUnique({
        where: { providerKey_externalId: { providerKey: resolved.providerKey, externalId: resolved.externalId } },
        include: { artwork: true, archiveRevisions: { where: { isCurrent: true }, take: 1 } }
      }),
      prisma.archiveImport.findFirst({
        where: {
          providerKey: resolved.providerKey,
          externalId: resolved.externalId,
          status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] }
        },
        select: { id: true }
      })
    ])
    const warnings = [...resolved.warnings]
    if (existingRef && (existingRef.artwork.deletedAt || existingRef.artwork.archiveLifecycleState !== 'ACTIVE')) {
      throw new ArchiveError('STATE_CONFLICT', '该作品已在归档回收站中，请先显式恢复后再更新', {
        recoverable: true
      })
    }
    const currentRevision = existingRef?.archiveRevisions[0]
    const isUpdate = Boolean(existingRef)
    const previousMediaCount = Array.isArray(currentRevision?.mediaSnapshot)
      ? currentRevision.mediaSnapshot.length
      : null
    if (previousMediaCount !== null && previousMediaCount !== resolved.media.length) {
      warnings.push(`媒体数量将从 ${previousMediaCount} 变为 ${resolved.media.length}；旧媒体会保留在上一个归档版本中`)
    }
    if (currentRevision && currentRevision.metadataHash !== metadataHash) {
      warnings.push('远端元数据或媒体计划与当前版本不同；确认后会发布新版本并保留旧版本')
    } else if (existingRef) {
      warnings.push('该作品已经归档；确认后将执行完整性检查并创建修复/刷新任务')
    }
    if (activeImport) warnings.push('同一作品已有活动任务，本次确认会复用该任务')

    await prisma.archivePreviewSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    const session = await prisma.archivePreviewSession.create({
      data: {
        providerKey: resolved.providerKey,
        externalId: resolved.externalId,
        resolved: toJsonValue({ ...resolved, submittedUrl: url }),
        metadataHash,
        expiresAt: new Date(Date.now() + PREVIEW_TTL_MS)
      }
    })
    return {
      previewToken: session.id,
      providerKey: resolved.providerKey,
      externalId: resolved.externalId,
      canonicalUrl: resolved.canonicalUrl,
      title: resolved.title,
      titleAliases: resolved.titleAliases,
      category: resolved.category,
      uploader: resolved.uploader,
      thumbnailUrl: resolved.thumbnailUrl,
      pageCount: resolved.media.length,
      tags: resolved.tags,
      creatorBucket: resolved.creatorBucket,
      requestedQuality: 'ORIGINAL',
      existingArtworkId: existingRef?.artworkId ?? null,
      activeTaskId: activeImport?.id ?? null,
      isUpdate,
      warnings
    }
  }

  async enqueue(input: ConfirmedArchiveInput, options: { requestedByUserId?: string } = {}) {
    const session = await prisma.archivePreviewSession.findUnique({ where: { id: input.previewToken } })
    if (!session || session.expiresAt <= new Date()) {
      throw new ArchiveError('INVALID_URL', '归档预览已过期，请重新解析链接')
    }
    const resolved = restoreResolvedArchive(session.resolved)
    if (resolved.providerKey !== session.providerKey || resolved.externalId !== session.externalId) {
      throw new ArchiveError('INTERNAL', '归档预览身份校验失败')
    }
    const active = await findActiveImport(resolved.providerKey, resolved.externalId)
    if (active) return { taskId: active.id, reused: true }

    const importId = randomUUID()
    const jobId = randomUUID()
    const centralDispatcher = isCentralDispatcherCutoverEnabled()
    if (centralDispatcher && !options.requestedByUserId) {
      throw new ArchiveError('STATE_CONFLICT', 'Central archive enqueue requires an authenticated administrator')
    }
    const scanRoot = await requireArchiveStorageRoot()
    const paths = buildArchiveStoragePaths({
      scanRoot,
      importId,
      providerKey: resolved.providerKey,
      creatorBucket: resolved.creatorBucket,
      externalId: resolved.externalId
    })
    try {
      await prisma.$transaction(async (tx) => {
        const existingRef = await tx.artworkExternalRef.findUnique({
          where: {
            providerKey_externalId: {
              providerKey: resolved.providerKey,
              externalId: resolved.externalId
            }
          },
          include: { artwork: true }
        })
        if (existingRef && (existingRef.artwork.deletedAt || existingRef.artwork.archiveLifecycleState !== 'ACTIVE')) {
          throw new ArchiveError('STATE_CONFLICT', '该作品已在归档回收站中，请先显式恢复后再更新', {
            recoverable: true
          })
        }
        await tx.systemJob.create({
          data: {
            id: jobId,
            type: ARCHIVE_IMPORT_JOB_TYPE,
            ...(centralDispatcher
              ? {
                  definitionVersion: JOB_DEFINITION_VERSION,
                  triggerSource: 'MANUAL' as const,
                  requestedByUserId: options.requestedByUserId,
                  payload: archiveImportPayloadSchema.parse({ archiveImportId: importId }),
                  queuePriority: 10,
                  effectivePriority: 10,
                  availableAt: new Date(),
                  maxAttempts: 3
                }
              : {}),
            status: 'PENDING',
            progress: 0,
            message: centralDispatcher ? '等待中央 Worker...' : '等待归档 Worker...'
          }
        })
        await tx.archiveImport.create({
          data: {
            id: importId,
            systemJobId: jobId,
            providerKey: resolved.providerKey,
            externalId: resolved.externalId,
            submittedUrl: stringField(session.resolved, 'submittedUrl') ?? resolved.canonicalUrl,
            canonicalUrl: resolved.canonicalUrl,
            locator: toJsonValue(resolved.locator),
            requestedQuality: input.quality,
            selectedQuality: input.quality,
            normalizedMetadata: toJsonValue(resolved.normalizedMetadata),
            rawMetadata: toJsonValue(resolved.rawMetadata),
            metadataHash: session.metadataHash,
            creatorBucket: resolved.creatorBucket,
            stagingPath: paths.stagingRelativePath,
            totalItems: resolved.media.length,
            warning: resolved.warnings.join('\n') || null,
            items: {
              create: resolved.media.map((item) => ({
                pageIndex: item.index,
                sourcePageUrl: item.sourcePageUrl,
                locator: toJsonValue(item.locator),
                expectedFilename: item.expectedFilename
              }))
            }
          }
        })
        if (centralDispatcher) {
          await writeArchiveJobEvent(tx, {
            jobId,
            type: 'job.queued',
            attempt: 0,
            message: 'Archive import queued',
            data: { triggerSource: 'MANUAL', priority: 10, archiveImportId: importId }
          })
        }
        await tx.archivePreviewSession.delete({ where: { id: session.id } })
      })
      return { taskId: importId, reused: false }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await findActiveImport(resolved.providerKey, resolved.externalId)
        if (raced) return { taskId: raced.id, reused: true }
      }
      throw error
    }
  }

  async getTask(taskId: string) {
    const task = await prisma.archiveImport.findUnique({
      where: { id: taskId },
      include: {
        systemJob: true,
        publishedRevision: true,
        publishedArtwork: { select: { id: true, title: true, deletedAt: true } },
        items: { orderBy: { pageIndex: 'asc' } }
      }
    })
    return task ? toTaskView(task) : null
  }

  async listTasks(limit = 30) {
    const tasks = await prisma.archiveImport.findMany({
      take: Math.min(Math.max(limit, 1), 100),
      orderBy: { createdAt: 'desc' },
      include: {
        systemJob: true,
        publishedRevision: true,
        publishedArtwork: { select: { id: true, title: true, deletedAt: true } }
      }
    })
    return tasks.map(toTaskSummary)
  }

  async listTaskItems(
    taskId: string,
    cursor: number | null | undefined = null,
    limit = 50,
    status: ArchiveItemStatusFilter = 'ALL'
  ) {
    const normalizedLimit = Math.min(Math.max(limit, 1), 100)
    const task = await prisma.archiveImport.findUnique({
      where: { id: taskId },
      select: { id: true, totalItems: true }
    })
    if (!task) throw new ArchiveError('INTERNAL', '归档任务不存在')

    const rows = await prisma.archiveImportItem.findMany({
      where: {
        archiveImportId: task.id,
        ...(cursor == null ? {} : { pageIndex: { gt: cursor } }),
        ...(status === 'ALL' ? {} : { status })
      },
      orderBy: { pageIndex: 'asc' },
      take: normalizedLimit + 1,
      select: {
        id: true,
        pageIndex: true,
        sourcePageUrl: true,
        expectedFilename: true,
        status: true,
        attempts: true,
        byteCount: true,
        mimeType: true,
        quality: true,
        width: true,
        height: true,
        errorCode: true,
        errorMessage: true,
        errorStage: true,
        remoteHost: true,
        startedAt: true,
        finishedAt: true,
        updatedAt: true
      }
    })
    const hasNextPage = rows.length > normalizedLimit
    const items = hasNextPage ? rows.slice(0, normalizedLimit) : rows

    return {
      totalItems: task.totalItems,
      nextCursor: hasNextPage ? items.at(-1)?.pageIndex : undefined,
      items: items.map((item) => ({
        id: item.id,
        pageIndex: item.pageIndex,
        sourcePageUrl: redactArchiveUrl(item.sourcePageUrl),
        expectedFilename: item.expectedFilename,
        status: item.status,
        attempts: item.attempts,
        byteCount: item.byteCount?.toString() ?? null,
        mimeType: item.mimeType,
        quality: item.quality,
        width: item.width,
        height: item.height,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage ? '图片处理失败，请根据错误码与失败阶段排查。' : null,
        errorStage: item.errorStage,
        remoteHost: item.remoteHost,
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        updatedAt: item.updatedAt
      }))
    }
  }

  async getTaskItemCounts(taskId: string) {
    const task = await prisma.archiveImport.findUnique({ where: { id: taskId }, select: { id: true } })
    if (!task) throw new ArchiveError('INTERNAL', '归档任务不存在')
    const groups = await prisma.archiveImportItem.groupBy({
      by: ['status'],
      where: { archiveImportId: task.id },
      _count: { _all: true }
    })
    const counts = { all: 0, completed: 0, failed: 0, pending: 0, downloading: 0 }
    for (const group of groups) {
      const count = group._count._all
      counts.all += count
      if (group.status === 'COMPLETED') counts.completed = count
      else if (group.status === 'FAILED') counts.failed = count
      else if (group.status === 'PENDING') counts.pending = count
      else counts.downloading = count
    }
    return counts
  }

  async retryTaskItem(taskId: string, itemId: string, options: { requestedByUserId?: string } = {}) {
    const task = await prisma.archiveImport.findUnique({ where: { id: taskId }, include: { systemJob: true } })
    if (!task) throw new ArchiveError('INTERNAL', '归档任务不存在')
    if (task.status !== 'FAILED' || task.errorCode !== 'PARTIAL_FAILURE' || task.failedItems <= 0) {
      throw stateConflict('只有部分失败的终态任务可以重试单张图片')
    }
    const item = await prisma.archiveImportItem.findFirst({
      where: { id: itemId, archiveImportId: task.id },
      select: { id: true, status: true }
    })
    if (!item || item.status !== 'FAILED') throw stateConflict('该图片当前不是可重试的失败状态')

    if (isCentralDispatcherCutoverEnabled()) {
      return this.retryCentralArchiveImport(task, {
        requestedByUserId: requireCentralRequestedBy(options.requestedByUserId),
        message: 'Retry selected archive media item',
        retryItemId: item.id
      })
    }

    await transitionTaskAndJob(task, {
      importStatus: 'PENDING',
      jobStatus: 'PENDING',
      message: '等待重试选中的图片...',
      importData: {
        failedItems: Math.max(0, task.failedItems - 1),
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
        retainUntil: null
      },
      jobData: {
        error: null,
        finishedAt: null,
        progress: taskProgress(task.completedItems, task.totalItems)
      },
      mutate: async (tx) => {
        const updated = await tx.archiveImportItem.updateMany({
          where: { id: item.id, archiveImportId: task.id, status: 'FAILED' },
          data: {
            status: 'PENDING',
            attempts: 0,
            errorCode: null,
            errorMessage: null,
            errorStage: null,
            remoteHost: null,
            startedAt: null,
            finishedAt: null
          }
        })
        if (updated.count !== 1) throw stateConflict('图片状态已改变，请刷新后重试')
      }
    })
    return this.getTask(taskId)
  }

  async requestAction(taskId: string, action: ArchiveTaskAction, options: { requestedByUserId?: string } = {}) {
    const task = await prisma.archiveImport.findUnique({ where: { id: taskId }, include: { systemJob: true } })
    if (!task) throw new ArchiveError('INTERNAL', '归档任务不存在')
    const now = new Date()
    // 清理暂存为独立入口：其他动作遇到 cleanupRequestedAt 会被拒绝，避免状态与清理执行器互相覆盖。
    if (task.cleanupRequestedAt && action !== 'DELETE_STAGING') {
      throw stateConflict('暂存目录正在由归档 Worker 清理，请等待清理完成')
    }
    if (isCentralDispatcherCutoverEnabled()) {
      return this.requestCentralAction(task, action, {
        requestedByUserId: requireCentralRequestedBy(options.requestedByUserId),
        now
      })
    }
    if (task.cleanupRequestedAt) {
      return this.getTask(taskId)
    }

    switch (action) {
      case 'PAUSE':
        assertActionStatus(action, task.status, ['PENDING', 'RUNNING'])
        await transitionTaskAndJob(task, {
          importStatus: 'PAUSED',
          jobStatus: 'PAUSED',
          message: '任务已暂停'
        })
        break
      case 'RESUME':
        assertActionStatus(action, task.status, ['PAUSED'])
        if (task.decisionCode === 'USE_DISPLAY_QUALITY' && task.selectedQuality === 'ORIGINAL') {
          throw new ArchiveError('ORIGINAL_UNAVAILABLE', '请先明确选择展示质量', {
            pause: true,
            decisionCode: 'USE_DISPLAY_QUALITY'
          })
        }
        await transitionTaskAndJob(task, {
          importStatus: 'PENDING',
          jobStatus: 'PENDING',
          message: '等待归档 Worker...',
          importData: { failedItems: 0 },
          mutate: async (tx) => {
            await tx.archiveImportItem.updateMany({
              where: { archiveImportId: task.id, status: { not: 'COMPLETED' } },
              data: {
                status: 'PENDING',
                attempts: 0,
                errorCode: null,
                errorMessage: null,
                errorStage: null,
                remoteHost: null,
                startedAt: null,
                finishedAt: null
              }
            })
          }
        })
        break
      case 'CANCEL':
        assertActionStatus(action, task.status, ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'])
        if (task.status === 'CANCELLING') throw stateConflict('任务已经在取消中')
        if (task.status === 'RUNNING') {
          await transitionTaskAndJob(task, {
            importStatus: 'CANCELLING',
            jobStatus: 'CANCELLING',
            message: '正在取消...'
          })
        } else {
          await transitionTaskAndJob(task, {
            importStatus: 'CANCELLED',
            jobStatus: 'CANCELLED',
            message: '任务已取消',
            finishedAt: now,
            retainUntil: new Date(now.getTime() + FAILED_STAGING_RETENTION_MS)
          })
        }
        break
      case 'RETRY':
        assertActionStatus(action, task.status, ['FAILED', 'CANCELLED'])
        await transitionTaskAndJob(task, {
          importStatus: 'PENDING',
          jobStatus: 'PENDING',
          message: '等待重试...',
          importData: { failedItems: 0, errorCode: null, errorMessage: null, finishedAt: null, retainUntil: null },
          jobData: { error: null, finishedAt: null, progress: taskProgress(task.completedItems, task.totalItems) },
          mutate: async (tx) => {
            await tx.archiveImportItem.updateMany({
              where: { archiveImportId: task.id, status: { not: 'COMPLETED' } },
              data: {
                status: 'PENDING',
                attempts: 0,
                errorCode: null,
                errorMessage: null,
                errorStage: null,
                remoteHost: null,
                startedAt: null,
                finishedAt: null
              }
            })
          }
        })
        break
      case 'USE_DISPLAY_QUALITY':
        assertActionStatus(action, task.status, ['PAUSED', 'FAILED'])
        await transitionTaskAndJob(task, {
          importStatus: 'PENDING',
          jobStatus: 'PENDING',
          message: '已选择展示质量，等待继续...',
          importData: {
            selectedQuality: 'DISPLAY',
            decisionCode: null,
            errorCode: null,
            errorMessage: null,
            failedItems: 0,
            finishedAt: null,
            retainUntil: null
          },
          jobData: { error: null, finishedAt: null },
          mutate: async (tx) => {
            await tx.archiveImportItem.updateMany({
              where: { archiveImportId: task.id, status: { not: 'COMPLETED' } },
              data: {
                status: 'PENDING',
                attempts: 0,
                errorCode: null,
                errorMessage: null,
                errorStage: null,
                remoteHost: null,
                startedAt: null,
                finishedAt: null
              }
            })
          }
        })
        break
      case 'DELETE_STAGING':
        assertActionStatus(action, task.status, ['PENDING', 'PAUSED', 'FAILED', 'CANCELLED'])
        await transitionTaskAndJob(task, {
          importStatus: task.status,
          preserveJobStatus: true,
          message: '等待归档 Worker 清理暂存目录...',
          importData: { cleanupRequestedAt: now }
        })
        break
      case 'DELETE_ARCHIVE':
        if (!task.publishedArtworkId) throw new ArchiveError('INTERNAL', '任务尚未发布作品')
        await trashPublishedArchive(task.publishedArtworkId)
        break
      case 'RESTORE_ARCHIVE':
        if (!task.publishedArtworkId) throw new ArchiveError('INTERNAL', '任务尚未发布作品')
        await restorePublishedArchive(task.publishedArtworkId)
        break
    }
    return this.getTask(taskId)
  }

  private async requestCentralAction(
    task: ArchiveControlTaskRecord,
    action: ArchiveTaskAction,
    options: { requestedByUserId: string; now: Date }
  ) {
    if (action === 'RETRY') {
      assertActionStatus(action, task.status, ['FAILED', 'CANCELLED'])
      return this.retryCentralArchiveImport(task, {
        requestedByUserId: options.requestedByUserId,
        message: 'Retry archive import'
      })
    }
    if (action === 'USE_DISPLAY_QUALITY') {
      assertActionStatus(action, task.status, ['PAUSED', 'FAILED'])
      if (task.status === 'FAILED') {
        return this.retryCentralArchiveImport(task, {
          requestedByUserId: options.requestedByUserId,
          message: 'Retry archive import with display quality',
          useDisplayQuality: true
        })
      }
      await transitionCentralArchiveControl(task, 'RESUME', options.now, { useDisplayQuality: true })
      return this.getTask(task.id)
    }
    if (action === 'PAUSE' || action === 'RESUME' || action === 'CANCEL') {
      await transitionCentralArchiveControl(task, action, options.now)
      return this.getTask(task.id)
    }
    await requestCentralArchiveMaintenance(task, action, options)
    return this.getTask(task.id)
  }

  private async retryCentralArchiveImport(
    task: ArchiveControlTaskRecord,
    options: {
      requestedByUserId: string
      message: string
      retryItemId?: string
      useDisplayQuality?: boolean
    }
  ) {
    const nextJobId = randomUUID()
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
      const current = await tx.archiveImport.findUnique({ where: { id: task.id }, include: { systemJob: true } })
      if (
        !current ||
        current.systemJobId !== task.systemJobId ||
        !['FAILED', 'CANCELLED', 'PAUSED'].includes(current.status)
      ) {
        throw stateConflict('归档任务状态已改变，请刷新后重试')
      }
      if (options.retryItemId) {
        const item = await tx.archiveImportItem.updateMany({
          where: { id: options.retryItemId, archiveImportId: current.id, status: 'FAILED' },
          data: resetArchiveItemForRetry()
        })
        if (item.count !== 1) throw stateConflict('该图片状态已改变，请刷新后重试')
      } else {
        await tx.archiveImportItem.updateMany({
          where: { archiveImportId: current.id, status: { not: 'COMPLETED' } },
          data: resetArchiveItemForRetry()
        })
      }
      const priority = Math.min(99, Math.max(0, current.systemJob.queuePriority))
      await tx.systemJob.create({
        data: {
          id: nextJobId,
          type: ARCHIVE_IMPORT_JOB_TYPE,
          definitionVersion: JOB_DEFINITION_VERSION,
          status: 'PENDING',
          triggerSource: 'RETRY',
          requestedByUserId: options.requestedByUserId,
          parentJobId: current.systemJobId,
          payload: archiveImportPayloadSchema.parse({ archiveImportId: current.id }),
          queuePriority: priority,
          effectivePriority: priority,
          availableAt: new Date(),
          maxAttempts: current.systemJob.maxAttempts,
          progress: taskProgress(current.completedItems, current.totalItems),
          message: options.message
        }
      })
      const changed = await tx.archiveImport.updateMany({
        where: { id: current.id, systemJobId: current.systemJobId, status: current.status },
        data: {
          systemJobId: nextJobId,
          status: 'PENDING',
          ...(options.useDisplayQuality ? { selectedQuality: 'DISPLAY' as const } : {}),
          decisionCode: null,
          errorCode: null,
          errorMessage: null,
          failedItems: Math.max(0, current.failedItems - (options.retryItemId ? 1 : current.failedItems)),
          finishedAt: null,
          retainUntil: null
        }
      })
      if (changed.count !== 1) throw stateConflict('归档任务状态已改变，请刷新后重试')
      await writeArchiveJobEvent(tx, {
        jobId: current.systemJobId,
        type: 'job.retry_scheduled',
        attempt: current.systemJob.attempt,
        message: options.message,
        data: { retryJobId: nextJobId }
      })
      await writeArchiveJobEvent(tx, {
        jobId: nextJobId,
        type: 'job.queued',
        attempt: 0,
        message: options.message,
        data: { retryOfJobId: current.systemJobId, archiveImportId: current.id, priority }
      })
    })
    return this.getTask(task.id)
  }

  getProvider(key: string): ArchiveProvider {
    return this.providers.getByKey(key)
  }
}

export const archiveModule = new ArchiveModule()
export { ARCHIVE_IMPORT_JOB_TYPE, FAILED_STAGING_RETENTION_MS, PARTIAL_FAILED_STAGING_RETENTION_MS }

async function requestCentralArchiveMaintenance(
  task: ArchiveControlTaskRecord,
  action: Extract<ArchiveTaskAction, 'DELETE_STAGING' | 'DELETE_ARCHIVE' | 'RESTORE_ARCHIVE'>,
  options: { requestedByUserId: string; now: Date }
) {
  await prisma.$transaction(async (tx) => {
    // 与发布/回收站状态变更共用 advisory lock，避免入队、清理、发布链路同时改动相关归档实体。
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const current = await tx.archiveImport.findUnique({ where: { id: task.id }, include: { systemJob: true } })
    if (!current || current.systemJobId !== task.systemJobId) {
      throw stateConflict('归档任务状态已改变，请刷新后重试')
    }

    if (action === 'DELETE_STAGING') {
      assertActionStatus(action, current.status, ['PENDING', 'PAUSED', 'FAILED', 'CANCELLED'])
      const intentAt = current.cleanupRequestedAt ?? options.now
      const idempotencyKey = archiveMaintenanceIdempotencyKey('CLEAN_STAGING', current.id, intentAt)
      if (await reuseActiveArchiveMaintenanceJob(tx, idempotencyKey)) return
      const nextIntentAt = current.cleanupRequestedAt
        ? nextArchiveMaintenanceIntentAt(options.now, current.cleanupRequestedAt)
        : intentAt
      // 活动请求已在上方复用；终态失败后的再次请求推进 intent 时间，生成可重新入队的新幂等键。
      const nextKey = archiveMaintenanceIdempotencyKey('CLEAN_STAGING', current.id, nextIntentAt)
      const jobId = randomUUID()
      const changed = await tx.archiveImport.updateMany({
        where: {
          id: current.id,
          status: current.status,
          cleanupRequestedAt: current.cleanupRequestedAt
        },
        data: { cleanupRequestedAt: nextIntentAt, updatedAt: nextIntentAt }
      })
      if (changed.count !== 1) throw stateConflict('暂存清理状态已改变，请刷新后重试')
      await createArchiveMaintenanceJob(tx, {
        jobId,
        idempotencyKey: nextKey,
        requestedByUserId: options.requestedByUserId,
        parentJobId: current.systemJobId,
        payload: { action: 'CLEAN_STAGING', archiveImportId: current.id },
        availableAt: nextIntentAt,
        queuePriority: 0,
        message: 'Clean archive staging files'
      })
      return
    }

    if (!current.publishedArtworkId) throw new ArchiveError('INTERNAL', '任务尚未发布作品')
    const artwork = await tx.artwork.findUnique({
      where: { id: current.publishedArtworkId },
      include: { archiveRevisions: { include: { externalRef: true } } }
    })
    if (!artwork || artwork.createdVia !== 'URL_ARCHIVE') {
      throw new ArchiveError('INTERNAL', '只能维护 URL 归档作品')
    }
    const maintenanceAction = action === 'DELETE_ARCHIVE' ? 'TRASH_ARCHIVE' : 'RESTORE_ARCHIVE'
    const expectedPendingState = maintenanceAction === 'TRASH_ARCHIVE' ? 'TRASHING' : 'RESTORING'
    if (artwork.archiveLifecycleState === expectedPendingState) {
      const existingKey = archiveMaintenanceIdempotencyKey(maintenanceAction, String(artwork.id), artwork.updatedAt)
      if (await reuseActiveArchiveMaintenanceJob(tx, existingKey)) return
    }

    if (maintenanceAction === 'TRASH_ARCHIVE') {
      if (artwork.archiveLifecycleState === 'RESTORING') throw stateConflict('作品正在恢复，请稍后再删除')
      if (artwork.archiveLifecycleState === 'TRASHED') return
      if (!['ACTIVE', 'TRASHING'].includes(artwork.archiveLifecycleState)) {
        throw stateConflict('作品当前状态不允许移入回收站')
      }
      if (artwork.archiveLifecycleState === 'ACTIVE' && artwork.deletedAt) {
        throw stateConflict('作品删除状态不一致')
      }
    } else {
      if (artwork.archiveLifecycleState === 'ACTIVE') throw stateConflict('作品不在归档回收站中')
      if (artwork.archiveLifecycleState === 'TRASHING') throw stateConflict('作品仍在移入回收站，请稍后再恢复')
      if (!['TRASHED', 'RESTORING'].includes(artwork.archiveLifecycleState)) {
        throw stateConflict('作品当前状态不允许恢复')
      }
      if (!artwork.deletedAt || artwork.archiveRevisions.some((revision) => !revision.trashPath)) {
        throw stateConflict('作品回收站状态不完整，暂时不能恢复')
      }
    }
    if (artwork.archiveRevisions.length === 0) throw new ArchiveError('INTERNAL', '作品缺少归档版本')
    for (const revision of artwork.archiveRevisions) {
      const activeImport = await tx.archiveImport.findFirst({
        where: {
          providerKey: revision.externalRef.providerKey,
          externalId: revision.externalRef.externalId,
          status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] }
        },
        select: { id: true }
      })
      // 防止同一作品版本在归档更新进行时又被移动到回收站/恢复，避免状态版本错位。
      if (activeImport) throw stateConflict('该作品有进行中的归档更新，暂时不能删除或恢复')
    }

    const intentAt =
      artwork.archiveLifecycleState === expectedPendingState
        ? nextArchiveMaintenanceIntentAt(options.now, artwork.updatedAt)
        : options.now
    if (maintenanceAction === 'TRASH_ARCHIVE') {
      const deletedAt = artwork.deletedAt ?? intentAt
      for (const revision of artwork.archiveRevisions) {
        await tx.archiveRevision.update({
          where: { id: revision.id },
          data: {
            trashPath: revision.trashPath ?? buildArchiveMaintenanceTrashPath(artwork.id, revision.id),
            trashedAt: revision.trashedAt ?? deletedAt,
            purgeAfter: revision.purgeAfter ?? new Date(deletedAt.getTime() + FAILED_STAGING_RETENTION_MS)
          }
        })
      }
      const changed = await tx.artwork.updateMany({
        where: { id: artwork.id, archiveLifecycleState: artwork.archiveLifecycleState },
        data: { deletedAt, archiveLifecycleState: 'TRASHING', updatedAt: intentAt }
      })
      if (changed.count !== 1) throw stateConflict('作品状态已改变，未能开始删除')
    } else {
      const changed = await tx.artwork.updateMany({
        where: { id: artwork.id, archiveLifecycleState: artwork.archiveLifecycleState, deletedAt: { not: null } },
        data: { archiveLifecycleState: 'RESTORING', updatedAt: intentAt }
      })
      if (changed.count !== 1) throw stateConflict('作品状态已改变，未能开始恢复')
    }

    await createArchiveMaintenanceJob(tx, {
      jobId: randomUUID(),
      idempotencyKey: archiveMaintenanceIdempotencyKey(maintenanceAction, String(artwork.id), intentAt),
      requestedByUserId: options.requestedByUserId,
      parentJobId: current.systemJobId,
      payload: { action: maintenanceAction, artworkId: artwork.id },
      availableAt: intentAt,
      queuePriority: 20,
      message: maintenanceAction === 'TRASH_ARCHIVE' ? 'Move archived artwork to trash' : 'Restore archived artwork'
    })
  })
}

async function createArchiveMaintenanceJob(
  transaction: ArchiveTransactionClient,
  input: {
    jobId: string
    idempotencyKey: string
    requestedByUserId: string
    parentJobId: string
    payload:
      | { action: 'CLEAN_STAGING'; archiveImportId: string }
      | { action: 'TRASH_ARCHIVE' | 'RESTORE_ARCHIVE'; artworkId: number }
    availableAt: Date
    queuePriority: number
    message: string
  }
) {
  const payload = archiveMaintenancePayloadSchema.parse(input.payload)
  await transaction.systemJob.create({
    data: {
      id: input.jobId,
      type: 'ARCHIVE_MAINTENANCE',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: JOB_DEFINITION_VERSION,
      status: 'PENDING',
      triggerSource: 'MANUAL',
      requestedByUserId: input.requestedByUserId,
      parentJobId: input.parentJobId,
      idempotencyKey: input.idempotencyKey,
      payload,
      queuePriority: input.queuePriority,
      effectivePriority: input.queuePriority,
      availableAt: input.availableAt,
      maxAttempts: 3,
      progress: 0,
      message: input.message
    }
  })
  await writeArchiveJobEvent(transaction, {
    jobId: input.jobId,
    type: 'job.queued',
    attempt: 0,
    message: input.message,
    data: { action: payload.action }
  })
}

async function reuseActiveArchiveMaintenanceJob(
  transaction: ArchiveTransactionClient,
  idempotencyKey: string
): Promise<boolean> {
  const existing = await transaction.systemJob.findUnique({ where: { idempotencyKey }, select: { status: true } })
  return Boolean(
    existing && ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'].includes(existing.status)
  )
}

function archiveMaintenanceIdempotencyKey(
  action: 'CLEAN_STAGING' | 'TRASH_ARCHIVE' | 'RESTORE_ARCHIVE',
  targetId: string,
  intentAt: Date
): string {
  return `archive-maintenance:${action}:${targetId}:${intentAt.getTime()}`
}

function nextArchiveMaintenanceIntentAt(now: Date, previous: Date): Date {
  return new Date(Math.max(now.getTime(), previous.getTime() + 1))
}

function buildArchiveMaintenanceTrashPath(artworkId: number, revisionId: string): string {
  return `.trash/archive/${artworkId}/${revisionId}`
}

async function transitionCentralArchiveControl(
  task: ArchiveControlTaskRecord,
  action: 'PAUSE' | 'RESUME' | 'CANCEL',
  now: Date,
  options: { useDisplayQuality?: boolean } = {}
) {
  const allowedImportStatuses =
    action === 'PAUSE' ? ['PENDING', 'RUNNING'] : action === 'RESUME' ? ['PAUSED'] : ['PENDING', 'RUNNING', 'PAUSED']
  assertActionStatus(action, task.status, allowedImportStatuses)

  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const current = await tx.archiveImport.findUnique({ where: { id: task.id }, include: { systemJob: true } })
    if (!current || current.systemJobId !== task.systemJobId || current.status !== task.status) {
      throw stateConflict('归档任务状态已改变，请刷新后重试')
    }

    const running = ['RUNNING', 'PAUSING'].includes(current.systemJob.status)
    const direct = !running
    const nextJobStatus =
      action === 'CANCEL'
        ? direct
          ? 'CANCELLED'
          : 'CANCELLING'
        : action === 'PAUSE'
          ? direct
            ? 'PAUSED'
            : 'PAUSING'
          : 'PENDING'
    const allowedJobStatuses =
      action === 'PAUSE'
        ? ['PENDING', 'RETRY_WAIT', 'RUNNING']
        : action === 'RESUME'
          ? ['PAUSED']
          : ['PENDING', 'RETRY_WAIT', 'PAUSED', 'RUNNING', 'PAUSING']
    if (!allowedJobStatuses.includes(current.systemJob.status)) {
      throw stateConflict(`任务状态 ${current.systemJob.status} 不允许执行 ${action}`)
    }

    const job = await tx.systemJob.updateMany({
      where: { id: current.systemJobId, status: current.systemJob.status },
      data: {
        status: nextJobStatus,
        message:
          action === 'CANCEL'
            ? direct
              ? 'Archive import cancelled before execution'
              : 'Archive import cancellation requested'
            : action === 'PAUSE'
              ? direct
                ? 'Archive import paused before execution'
                : 'Archive import pause requested'
              : 'Archive import resumed',
        ...(action === 'CANCEL' ? { cancelRequestedAt: now } : {}),
        ...(action === 'PAUSE' ? { pauseRequestedAt: now } : {}),
        ...(action === 'RESUME' ? { pauseRequestedAt: null, availableAt: now } : {}),
        ...(direct || action === 'RESUME'
          ? { workerId: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null }
          : {}),
        ...(action === 'CANCEL' && direct ? { finishedAt: now } : {})
      }
    })
    if (job.count !== 1) throw stateConflict('归档任务状态已改变，请刷新后重试')

    if (direct || action === 'RESUME') {
      await tx.jobResourceLease.deleteMany({ where: { ownerJobId: current.systemJobId } })
    }
    if (action === 'RESUME') {
      await tx.archiveImportItem.updateMany({
        where: { archiveImportId: current.id, status: { not: 'COMPLETED' } },
        data: resetArchiveItemForRetry()
      })
    }
    const nextImportStatus =
      action === 'CANCEL'
        ? direct
          ? 'CANCELLED'
          : 'CANCELLING'
        : action === 'PAUSE'
          ? direct
            ? 'PAUSED'
            : 'RUNNING'
          : 'PENDING'
    const archiveImport = await tx.archiveImport.updateMany({
      where: { id: current.id, systemJobId: current.systemJobId, status: current.status },
      data: {
        status: nextImportStatus,
        ...(options.useDisplayQuality ? { selectedQuality: 'DISPLAY' as const, decisionCode: null } : {}),
        ...(action === 'RESUME'
          ? { errorCode: null, errorMessage: null, failedItems: 0, finishedAt: null, retainUntil: null }
          : {}),
        ...(action === 'CANCEL' && direct
          ? { finishedAt: now, retainUntil: new Date(now.getTime() + FAILED_STAGING_RETENTION_MS) }
          : {})
      }
    })
    if (archiveImport.count !== 1) throw stateConflict('归档任务状态已改变，请刷新后重试')

    await writeArchiveJobEvent(tx, {
      jobId: current.systemJobId,
      type:
        action === 'CANCEL'
          ? direct
            ? 'job.cancelled'
            : 'job.cancel_requested'
          : action === 'PAUSE'
            ? 'job.pause_requested'
            : 'job.queued',
      level: action === 'RESUME' ? 'INFO' : 'WARN',
      attempt: current.systemJob.attempt,
      message: `${action.toLowerCase()} archive import`,
      data: action === 'RESUME' ? { reason: 'RESUME' } : null
    })
    if (action === 'PAUSE' && direct) {
      await writeArchiveJobEvent(tx, {
        jobId: current.systemJobId,
        type: 'job.paused',
        level: 'WARN',
        attempt: current.systemJob.attempt,
        message: 'Archive import paused before execution'
      })
    }
  })
}

function resetArchiveItemForRetry(): Prisma.ArchiveImportItemUpdateManyMutationInput {
  return {
    status: 'PENDING',
    attempts: 0,
    errorCode: null,
    errorMessage: null,
    errorStage: null,
    remoteHost: null,
    startedAt: null,
    finishedAt: null
  }
}

function requireCentralRequestedBy(value: string | undefined): string {
  if (!value) throw stateConflict('Central archive command requires an authenticated administrator')
  return value
}

function writeArchiveJobEvent(transaction: unknown, input: Parameters<typeof writeJobEvent>[1]) {
  return writeJobEvent(transaction as Parameters<typeof writeJobEvent>[0], input)
}

async function transitionTaskAndJob(
  task: {
    id: string
    systemJobId: string
    status: ArchiveImportStatus
    systemJob: { status: JobStatus }
  },
  input: ArchiveTransitionInput
) {
  await prisma.$transaction(async (tx) => {
    // 与发布管线共享同一把 advisory lock，清理路径与任务控制命令必须串行，且只在 cleanupRequestedAt 未置位时更新任务。
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const job = await tx.systemJob.updateMany({
      where: { id: task.systemJobId, status: task.systemJob.status },
      data: {
        ...input.jobData,
        ...(input.preserveJobStatus ? {} : { status: input.jobStatus }),
        message: input.message,
        ...(input.finishedAt ? { finishedAt: input.finishedAt } : {})
      }
    })
    if (job.count !== 1) throw stateConflict('归档任务状态已改变，请刷新后重试')
    const archiveImport = await tx.archiveImport.updateMany({
      where: { id: task.id, status: task.status, cleanupRequestedAt: null },
      data: {
        ...input.importData,
        status: input.importStatus,
        ...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
        ...(input.retainUntil ? { retainUntil: input.retainUntil } : {})
      }
    })
    if (archiveImport.count !== 1) throw stateConflict('归档任务状态已改变，请刷新后重试')
    await input.mutate?.(tx)
  })
}

function assertActionStatus(action: ArchiveTaskAction, actual: string, allowed: readonly string[]): void {
  if (!allowed.includes(actual)) throw stateConflict(`任务状态 ${actual} 不允许执行 ${action}`)
}

function stateConflict(message: string): ArchiveError {
  return new ArchiveError('STATE_CONFLICT', message, { recoverable: true })
}

function taskProgress(completed: number, total: number): number {
  return Math.max(1, Math.min(95, Math.round((completed / Math.max(total, 1)) * 90) + 5))
}

async function findActiveImport(providerKey: string, externalId: string) {
  return prisma.archiveImport.findFirst({
    where: {
      providerKey,
      externalId,
      status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] }
    },
    select: { id: true }
  })
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function restoreResolvedArchive(value: Prisma.JsonValue): ResolvedArchive {
  const raw = value as unknown as ResolvedArchive & { postedAt?: string | Date | null }
  return {
    ...raw,
    postedAt: raw.postedAt ? new Date(raw.postedAt) : null
  }
}

function stringField(value: Prisma.JsonValue, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const child = value[key]
  return typeof child === 'string' ? child : null
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function toTaskSummary(task: ArchiveTaskSummaryRecord) {
  return {
    id: task.id,
    providerKey: task.providerKey,
    externalId: task.externalId,
    title: stringField(task.normalizedMetadata, 'titles') ?? nestedTitle(task.normalizedMetadata),
    status: task.status,
    requestedQuality: task.requestedQuality,
    selectedQuality: task.selectedQuality,
    decisionCode: task.decisionCode,
    progress: task.systemJob.progress,
    message: task.systemJob.message,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    warning: task.warning,
    totalItems: task.totalItems,
    completedItems: task.completedItems,
    failedItems: task.failedItems,
    attempt: task.systemJob.attempt,
    heartbeatAt: task.systemJob.heartbeatAt,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    retainUntil: task.retainUntil,
    publishedArtwork: task.publishedArtwork,
    revisionId: task.publishedRevision?.id ?? null
  }
}

function toTaskView(task: ArchiveTaskRecord) {
  return {
    ...toTaskSummary(task),
    items: task.items.map((item) => ({
      id: item.id,
      pageIndex: item.pageIndex,
      status: item.status,
      attempts: item.attempts,
      byteCount: item.byteCount?.toString() ?? null,
      width: item.width,
      height: item.height,
      mimeType: item.mimeType,
      quality: item.quality,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      errorStage: item.errorStage,
      remoteHost: item.remoteHost
    }))
  }
}

function nestedTitle(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const titles = value.titles
  if (!titles || typeof titles !== 'object' || Array.isArray(titles)) return null
  return typeof titles.display === 'string' ? titles.display : null
}
