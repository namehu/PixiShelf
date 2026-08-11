import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ArchiveError } from './errors'
import { archiveProviderRegistry, type ArchiveProviderRegistry } from './provider-registry'
import { hashResolvedMetadata } from './providers/e-hentai'
import { buildArchiveStoragePaths, removeArchivePath } from './storage'
import { restorePublishedArchive, trashPublishedArchive } from './publisher'
import type {
  ArchivePreview,
  ArchiveProvider,
  ArchiveTaskAction,
  ConfirmedArchiveInput,
  ResolvedArchive
} from './types'
import { requireArchiveStorageRoot } from './config'

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
    const task = await prisma.archiveImport.findUnique({ where: { id: taskId } })
    if (!task) throw new ArchiveError('INTERNAL', '归档任务不存在')
    const scanRoot = await requireArchiveStorageRoot()
    const now = new Date()

    switch (action) {
      case 'PAUSE':
        if (!['PENDING', 'RUNNING'].includes(task.status)) break
        await updateTaskAndJob(task, { importStatus: 'PAUSED', jobStatus: 'PAUSED', message: '任务已暂停' })
        break
      case 'RESUME':
        if (task.status !== 'PAUSED') break
        if (task.decisionCode === 'USE_DISPLAY_QUALITY' && task.selectedQuality === 'ORIGINAL') {
          throw new ArchiveError('ORIGINAL_UNAVAILABLE', '请先明确选择展示质量', {
            pause: true,
            decisionCode: 'USE_DISPLAY_QUALITY'
          })
        }
        await prisma.archiveImportItem.updateMany({
          where: { archiveImportId: task.id, status: 'FAILED' },
          data: { status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null }
        })
        await updateTaskAndJob(task, { importStatus: 'PENDING', jobStatus: 'PENDING', message: '等待归档 Worker...' })
        break
      case 'CANCEL':
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status)) break
        if (task.status === 'RUNNING') {
          await updateTaskAndJob(task, { importStatus: 'CANCELLING', jobStatus: 'CANCELLING', message: '正在取消...' })
        } else {
          await updateTaskAndJob(task, {
            importStatus: 'CANCELLED',
            jobStatus: 'CANCELLED',
            message: '任务已取消',
            finishedAt: now,
            retainUntil: new Date(now.getTime() + FAILED_STAGING_RETENTION_MS)
          })
        }
        break
      case 'RETRY':
        if (!['FAILED', 'CANCELLED'].includes(task.status)) break
        await prisma.$transaction([
          prisma.archiveImportItem.updateMany({
            where: { archiveImportId: task.id, status: 'FAILED' },
            data: { status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null }
          }),
          prisma.archiveImport.update({
            where: { id: task.id },
            data: {
              status: 'PENDING',
              failedItems: 0,
              errorCode: null,
              errorMessage: null,
              finishedAt: null,
              retainUntil: null
            }
          }),
          prisma.systemJob.update({
            where: { id: task.systemJobId },
            data: { status: 'PENDING', message: '等待重试...', error: null, finishedAt: null, progress: 0 }
          })
        ])
        break
      case 'USE_DISPLAY_QUALITY':
        if (!['PAUSED', 'FAILED'].includes(task.status)) break
        await prisma.$transaction([
          prisma.archiveImportItem.updateMany({
            where: { archiveImportId: task.id, status: 'FAILED' },
            data: { status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null }
          }),
          prisma.archiveImport.update({
            where: { id: task.id },
            data: {
              selectedQuality: 'DISPLAY',
              decisionCode: null,
              status: 'PENDING',
              errorCode: null,
              errorMessage: null,
              failedItems: 0,
              finishedAt: null,
              retainUntil: null
            }
          }),
          prisma.systemJob.update({
            where: { id: task.systemJobId },
            data: { status: 'PENDING', message: '已选择展示质量，等待继续...', error: null, finishedAt: null }
          })
        ])
        break
      case 'DELETE_STAGING':
        if (['RUNNING', 'CANCELLING'].includes(task.status)) {
          throw new ArchiveError('INTERNAL', '运行中的任务不能删除暂存文件')
        }
        await removeArchivePath(scanRoot, task.stagingPath).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        })
        await prisma.$transaction([
          prisma.archiveImportItem.updateMany({
            where: { archiveImportId: task.id },
            data: {
              status: 'PENDING',
              attempts: 0,
              stagedPath: null,
              byteCount: null,
              mimeType: null,
              quality: null,
              width: null,
              height: null,
              sha256: null,
              errorCode: null,
              errorMessage: null,
              startedAt: null,
              finishedAt: null
            }
          }),
          prisma.archiveImport.update({
            where: { id: task.id },
            data: { completedItems: 0, failedItems: 0 }
          })
        ])
        break
      case 'DELETE_ARCHIVE':
        if (!task.publishedArtworkId) throw new ArchiveError('INTERNAL', '任务尚未发布作品')
        await trashPublishedArchive(task.publishedArtworkId, scanRoot)
        break
      case 'RESTORE_ARCHIVE':
        if (!task.publishedArtworkId) throw new ArchiveError('INTERNAL', '任务尚未发布作品')
        await restorePublishedArchive(task.publishedArtworkId, scanRoot)
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

async function updateTaskAndJob(
  task: { id: string; systemJobId: string },
  input: {
    importStatus: 'PENDING' | 'RUNNING' | 'PAUSED' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
    jobStatus: 'PENDING' | 'RUNNING' | 'PAUSED' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
    message: string
    finishedAt?: Date
    retainUntil?: Date
  }
) {
  await prisma.$transaction([
    prisma.archiveImport.update({
      where: { id: task.id },
      data: {
        status: input.importStatus,
        ...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
        ...(input.retainUntil ? { retainUntil: input.retainUntil } : {})
      }
    }),
    prisma.systemJob.update({
      where: { id: task.systemJobId },
      data: {
        status: input.jobStatus,
        message: input.message,
        ...(input.finishedAt ? { finishedAt: input.finishedAt } : {})
      }
    })
  ])
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
