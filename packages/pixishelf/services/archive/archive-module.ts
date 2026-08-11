import { randomUUID } from 'node:crypto'
import { ArchiveImportStatus, JobStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ArchiveError } from './errors'
import { archiveProviderRegistry, type ArchiveProviderRegistry } from './provider-registry'
import { hashResolvedMetadata } from './providers/e-hentai'
import { buildArchiveStoragePaths } from './storage'
import { ARCHIVE_PUBLISH_ADVISORY_LOCK_ID, restorePublishedArchive, trashPublishedArchive } from './publisher'
import type {
  ArchivePreview,
  ArchiveProvider,
  ArchiveTaskAction,
  ConfirmedArchiveInput,
  ResolvedArchive
} from './types'
import { requireArchiveStorageRoot } from './config'
import type { ArchiveTransactionClient } from './relationships'

const PREVIEW_TTL_MS = 30 * 60 * 1000
const FAILED_STAGING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const ARCHIVE_IMPORT_JOB_TYPE = 'ARCHIVE_IMPORT'

type ArchiveTaskRecord = Prisma.ArchiveImportGetPayload<{
  include: {
    systemJob: true
    publishedRevision: true
    publishedArtwork: { select: { id: true; title: true; deletedAt: true } }
    items: true
  }
}>

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
    if (
      existingRef &&
      (existingRef.artwork.deletedAt || existingRef.artwork.archiveLifecycleState !== 'ACTIVE')
    ) {
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

  async enqueue(input: ConfirmedArchiveInput) {
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
        if (
          existingRef &&
          (existingRef.artwork.deletedAt || existingRef.artwork.archiveLifecycleState !== 'ACTIVE')
        ) {
          throw new ArchiveError('STATE_CONFLICT', '该作品已在归档回收站中，请先显式恢复后再更新', {
            recoverable: true
          })
        }
        await tx.systemJob.create({
          data: {
            id: jobId,
            type: ARCHIVE_IMPORT_JOB_TYPE,
            status: 'PENDING',
            progress: 0,
            message: '等待归档 Worker...'
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
        publishedArtwork: { select: { id: true, title: true, deletedAt: true } },
        items: { orderBy: { pageIndex: 'asc' } }
      }
    })
    return tasks.map(toTaskView)
  }

  async requestAction(taskId: string, action: ArchiveTaskAction) {
    const task = await prisma.archiveImport.findUnique({ where: { id: taskId }, include: { systemJob: true } })
    if (!task) throw new ArchiveError('INTERNAL', '归档任务不存在')
    if (task.cleanupRequestedAt) {
      if (action === 'DELETE_STAGING') return this.getTask(taskId)
      throw stateConflict('暂存目录正在由归档 Worker 清理，请等待清理完成')
    }
    const now = new Date()

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
          mutate: async (tx) => {
            await tx.archiveImportItem.updateMany({
              where: { archiveImportId: task.id, status: { not: 'COMPLETED' } },
              data: { status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null }
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
          jobData: { error: null, finishedAt: null, progress: 0 },
          mutate: async (tx) => {
            await tx.archiveImportItem.updateMany({
              where: { archiveImportId: task.id, status: { not: 'COMPLETED' } },
              data: { status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null }
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
            selectedQuality: 'DISPLAY', decisionCode: null, errorCode: null, errorMessage: null,
            failedItems: 0, finishedAt: null, retainUntil: null
          },
          jobData: { error: null, finishedAt: null },
          mutate: async (tx) => {
            await tx.archiveImportItem.updateMany({
              where: { archiveImportId: task.id, status: { not: 'COMPLETED' } },
              data: { status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null }
            })
          }
        })
        break
      case 'DELETE_STAGING':
        assertActionStatus(action, task.status, ['PENDING', 'PAUSED', 'FAILED', 'CANCELLED'])
        await transitionTaskAndJob(task, {
          importStatus: task.status,
          jobStatus: task.systemJob.status,
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

  getProvider(key: string): ArchiveProvider {
    return this.providers.getByKey(key)
  }
}

export const archiveModule = new ArchiveModule()
export { ARCHIVE_IMPORT_JOB_TYPE, FAILED_STAGING_RETENTION_MS }

async function transitionTaskAndJob(
  task: {
    id: string
    systemJobId: string
    status: ArchiveImportStatus
    systemJob: { status: JobStatus }
  },
  input: {
    importStatus: 'PENDING' | 'RUNNING' | 'PAUSED' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
    jobStatus: 'PENDING' | 'RUNNING' | 'PAUSED' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
    message: string
    finishedAt?: Date
    retainUntil?: Date
    importData?: Prisma.ArchiveImportUpdateManyMutationInput
    jobData?: Prisma.SystemJobUpdateManyMutationInput
    mutate?: (tx: ArchiveTransactionClient) => Promise<void>
  }
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const job = await tx.systemJob.updateMany({
      where: { id: task.systemJobId, status: task.systemJob.status },
      data: {
        ...input.jobData,
        status: input.jobStatus,
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

function assertActionStatus(
  action: ArchiveTaskAction,
  actual: string,
  allowed: readonly string[]
): void {
  if (!allowed.includes(actual)) throw stateConflict(`任务状态 ${actual} 不允许执行 ${action}`)
}

function stateConflict(message: string): ArchiveError {
  return new ArchiveError('STATE_CONFLICT', message, { recoverable: true })
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

function toTaskView(task: ArchiveTaskRecord) {
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
    revisionId: task.publishedRevision?.id ?? null,
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
      errorMessage: item.errorMessage
    }))
  }
}

function nestedTitle(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const titles = value.titles
  if (!titles || typeof titles !== 'object' || Array.isArray(titles)) return null
  return typeof titles.display === 'string' ? titles.display : null
}
