import * as fs from 'node:fs/promises'
import { JobStatus, Prisma, VideoKeyframeSetStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { VIDEO_EXTENSIONS } from '@/lib/constant'
import { isVideoFile } from '@/lib/media'
import { resolveExistingPathWithinRoot } from '@/lib/safe-path'
import { resolveDerivedMediaStoragePath, VIDEO_KEYFRAME_STORAGE_ROOT } from '@/services/derived-media-storage-paths'
import { getScanPath } from '@/services/setting.service'
import {
  normalizeVideoKeyframeBatchAccumulator,
  publishedVideoKeyframeFilesExist,
  toVideoKeyframeBatchAccumulator,
  type VideoKeyframeBatchAccumulator
} from '@/services/video-keyframe-discovery-state'
import {
  getPublishedVideoKeyframes,
  probeVideoDuration,
  regenerateManualVideoPoster,
  removeJobStagingSet,
  sourceFingerprintFromStat
} from '@/services/video-keyframe-service'
import {
  matchesVideoKeyframeFilter,
  normalizeVideoKeyframeFilter,
  VIDEO_KEYFRAME_POLICY_VERSION,
  VIDEO_KEYFRAME_QUEUE_LOCK_ID,
  type VideoKeyframeFilter
} from '@/services/video-keyframe-policy'

export const VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE = 'VIDEO_KEYFRAME_DISCOVERY'
export const VIDEO_KEYFRAME_GENERATION_JOB_TYPE = 'VIDEO_KEYFRAME_GENERATION'
export const VIDEO_KEYFRAME_QUEUE_CAPACITY = 100
export const VIDEO_KEYFRAME_AUTOMATIC_CAPACITY = 90
export const VIDEO_KEYFRAME_MANUAL_PRIORITY = 10
export const VIDEO_KEYFRAME_AUTOMATIC_PRIORITY = 100

const MEDIA_MAINTENANCE_LOCK_ID = 728_342
const ACTIVE_STATUSES: JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.RUNNING,
  JobStatus.PAUSING,
  JobStatus.PAUSED,
  JobStatus.CANCELLING
]
const TERMINAL_STATUSES: JobStatus[] = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]
const HEAVY_MEDIA_MAINTENANCE_TYPES = ['VIDEO_MEDIA_PROBE', 'VIDEO_CHAPTER_PREVIEW_GENERATION']

export type VideoKeyframeJobMode = 'AUTO_INCREMENTAL' | 'MANUAL_INCREMENTAL' | 'MANUAL_FORCE'
export type VideoKeyframeControlAction = 'pause' | 'resume' | 'cancel'

export function getVideoKeyframeRetryBackoffMs(attempt: number, mode?: string | null) {
  if (mode?.startsWith('MANUAL_')) {
    return Math.min(60_000, 5_000 * 3 ** Math.max(0, attempt - 1))
  }
  return Math.min(30 * 60_000, 60_000 * 5 ** Math.max(0, attempt - 1))
}

export interface VideoKeyframeBatchResult {
  discovered: number
  matched: number
  enqueued: number
  reused: number
  filtered: number
  current: number
  inaccessible: number
  capacityLimited: number
  previewOnly: boolean
  previewTruncated: boolean
  candidates: VideoKeyframePreviewCandidate[]
  failedSamples: Array<{ imageId: number; path: string; error: string }>
}

export interface VideoKeyframePreviewCandidate {
  imageId: number
  path: string
  duration: number | null
  status: 'MISSING' | 'STALE' | 'FAILED' | 'CURRENT'
  publishedCount: number
}

export interface VideoKeyframeDiscoveryRequest {
  trigger: 'manual' | 'schedule'
  force: boolean
  previewOnly: boolean
  imageIds?: number[]
  afterImageId?: number
  accumulated?: VideoKeyframeBatchAccumulator
  filter: VideoKeyframeFilter
}

const VIDEO_KEYFRAME_PREVIEW_LIMIT = 1_000

export async function requireVideoKeyframeScanPath() {
  // 工作进程允许通过环境变量覆盖 scanPath；未配置时回退到 DB 设置，避免 worker 容器与 API 容器路径源不一致。
  const configured = (await getScanPath())?.trim()
  const workerMountedPath = process.env.SCAN_PATH?.trim() || process.env.ARCHIVE_STORAGE_PATH?.trim()
  const scanPath = workerMountedPath || configured
  if (!scanPath) throw new Error('Scan path is not configured')
  return scanPath
}

export function getVideoKeyframeFfmpegThreads() {
  const parsed = Number(process.env.KEYFRAME_FFMPEG_THREADS ?? 2)
  if (!Number.isInteger(parsed) || parsed < 1) return 2
  return Math.min(parsed, 8)
}

export async function enqueueVideoKeyframeJob(input: {
  imageId: number
  path: string
  mode: VideoKeyframeJobMode
  parentJobId?: string
}) {
  const manual = input.mode !== 'AUTO_INCREMENTAL'
  const queuePriority = manual ? VIDEO_KEYFRAME_MANUAL_PRIORITY : VIDEO_KEYFRAME_AUTOMATIC_PRIORITY

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_KEYFRAME_QUEUE_LOCK_ID)
    const existing = await tx.systemJob.findFirst({
      where: {
        type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE,
        targetImageId: input.imageId,
        status: { in: ACTIVE_STATUSES }
      },
      orderBy: { createdAt: 'desc' }
    })
    if (existing) {
      const upgraded =
        manual && existing.status === JobStatus.PENDING && existing.queuePriority > queuePriority
          ? await tx.systemJob.update({
              where: { id: existing.id },
              data: {
                queuePriority,
                mode: input.mode,
                parentJobId: input.parentJobId ?? existing.parentJobId,
                availableAt: null,
                message: '人工任务已提升优先级，等待生成视频代表帧...',
                error: null
              }
            })
          : existing
      return { job: upgraded, reused: true }
    }

    const activeCount = await tx.systemJob.count({
      where: { type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, status: { in: ACTIVE_STATUSES } }
    })
    const automaticCount = manual
      ? 0
      : await tx.systemJob.count({
          where: {
            type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE,
            status: { in: ACTIVE_STATUSES },
            mode: 'AUTO_INCREMENTAL'
          }
        })
    const limit = manual ? VIDEO_KEYFRAME_QUEUE_CAPACITY : VIDEO_KEYFRAME_AUTOMATIC_CAPACITY
    const used = manual ? activeCount : automaticCount
    if (activeCount >= VIDEO_KEYFRAME_QUEUE_CAPACITY || used >= limit) {
      throw new Error(`Video keyframe queue is full (${limit})`)
    }

    const job = await tx.systemJob.create({
      data: {
        type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE,
        status: JobStatus.PENDING,
        progress: 0,
        message: '等待生成视频代表帧...',
        targetImageId: input.imageId,
        targetPath: input.path,
        mode: input.mode,
        parentJobId: input.parentJobId,
        queuePriority
      }
    })
    return { job, reused: false }
  })
}

export async function enqueueSingleVideoKeyframe(imageId: number, force = false) {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
    select: { id: true, path: true, mediaType: true }
  })
  if (!image) throw new Error('Image not found')
  if (String(image.mediaType).toUpperCase() !== 'VIDEO' && !isVideoFile(image.path)) {
    throw new Error('Image is not a video')
  }
  return enqueueVideoKeyframeJob({
    imageId: image.id,
    path: image.path,
    mode: force ? 'MANUAL_FORCE' : 'MANUAL_INCREMENTAL'
  })
}

export async function enqueueVideoKeyframeBatch(input: {
  trigger: 'manual' | 'schedule'
  force?: boolean
  previewOnly?: boolean
  imageIds?: number[]
  filter?: unknown
}): Promise<{ jobId: string; status: JobStatus }> {
  if (input.trigger === 'manual' && input.previewOnly !== true && (!input.imageIds || input.imageIds.length === 0)) {
    throw new Error('Manual video keyframe execution requires an explicit preview selection')
  }
  const mode: VideoKeyframeJobMode =
    input.trigger === 'schedule' ? 'AUTO_INCREMENTAL' : input.force ? 'MANUAL_FORCE' : 'MANUAL_INCREMENTAL'
  const filter = normalizeVideoKeyframeFilter(input.filter)
  const request: VideoKeyframeDiscoveryRequest = {
    trigger: input.trigger,
    force: Boolean(input.force),
    previewOnly: input.trigger === 'manual' && input.previewOnly === true,
    ...(input.imageIds !== undefined ? { imageIds: [...new Set(input.imageIds)] } : {}),
    filter
  }
  const job = await prisma.systemJob.create({
    data: {
      type: VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE,
      status: JobStatus.PENDING,
      progress: 0,
      message: '等待发现需要生成代表帧的视频...',
      mode,
      result: toJsonValue({ request }),
      queuePriority: input.trigger === 'schedule' ? VIDEO_KEYFRAME_AUTOMATIC_PRIORITY : VIDEO_KEYFRAME_MANUAL_PRIORITY
    }
  })
  return { jobId: job.id, status: job.status }
}

export async function processVideoKeyframeDiscoveryJob(input: {
  jobId: string
  attempt: number
  request: VideoKeyframeDiscoveryRequest
  signal?: AbortSignal
}): Promise<VideoKeyframeBatchResult> {
  const mode: VideoKeyframeJobMode =
    input.request.trigger === 'schedule'
      ? 'AUTO_INCREMENTAL'
      : input.request.force
        ? 'MANUAL_FORCE'
        : 'MANUAL_INCREMENTAL'
  const filter = normalizeVideoKeyframeFilter(input.request.filter)
  const accumulated = input.request.accumulated
  const result: VideoKeyframeBatchResult = {
    discovered: accumulated?.discovered ?? 0,
    matched: accumulated?.matched ?? 0,
    enqueued: accumulated?.enqueued ?? 0,
    reused: accumulated?.reused ?? 0,
    filtered: accumulated?.filtered ?? 0,
    current: accumulated?.current ?? 0,
    inaccessible: accumulated?.inaccessible ?? 0,
    capacityLimited: 0,
    previewOnly: input.request.previewOnly,
    previewTruncated: false,
    candidates: [],
    failedSamples: [...(accumulated?.failedSamples ?? [])]
  }

  const scanPath = await requireVideoKeyframeScanPath()
  throwIfDiscoveryAborted(input.signal)
  // 发现阶段按 imageId 正序扫描，允许带 afterImageId 续跑；容量不足时会将 job 标记回 PENDING 并持久化累计状态。
  const images = await prisma.image.findMany({
    where: {
      AND: [
        ...(input.request.imageIds !== undefined ? [{ id: { in: input.request.imageIds } }] : []),
        ...(input.request.afterImageId !== undefined ? [{ id: { gt: input.request.afterImageId } }] : []),
        {
          OR: [
            { mediaType: 'VIDEO' },
            ...VIDEO_EXTENSIONS.map((extension) => ({ path: { endsWith: extension, mode: 'insensitive' as const } }))
          ]
        }
      ]
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      path: true,
      videoMetadata: { select: { duration: true } },
      keyframeSets: {
        where: { status: { in: ['PUBLISHED', 'FAILED'] } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: {
          status: true,
          sourceSize: true,
          sourceMtimeMs: true,
          policyVersion: true,
          publishedCount: true,
          frames: {
            where: { status: 'COMPLETED', selectedOrder: { not: null }, path: { not: null } },
            select: { path: true }
          }
        }
      }
    }
  })
  if (!accumulated) result.discovered = images.length

  for (let index = 0; index < images.length; index += 1) {
    throwIfDiscoveryAborted(input.signal)
    const image = images[index]!
    const pathOnlyFilter = { ...filter, minDuration: null, maxDuration: null }
    if (!matchesVideoKeyframeFilter({ duration: null, path: image.path }, pathOnlyFilter)) {
      result.filtered += 1
      continue
    }

    try {
      const sourcePath = await resolveExistingPathWithinRoot(scanPath, image.path.replace(/^[/\\]+/, ''))
      const stat = await fs.stat(sourcePath)
      if (!stat.isFile()) throw new Error('Video path is not a file')
      const fingerprint = sourceFingerprintFromStat(stat)
      const published = image.keyframeSets.find((set) => set.status === 'PUBLISHED')
      const publishedFilesCurrent = published ? await publishedVideoKeyframeFilesExist(published) : false
      const sourceCurrent =
        published?.sourceSize === fingerprint.size &&
        published.sourceMtimeMs === fingerprint.mtimeMs &&
        published.policyVersion === VIDEO_KEYFRAME_POLICY_VERSION &&
        publishedFilesCurrent
      if (!input.request.force && sourceCurrent) {
        result.current += 1
        continue
      }
      const discoveryStatus = published
        ? sourceCurrent
          ? ('CURRENT' as const)
          : ('STALE' as const)
        : image.keyframeSets.some((set) => set.status === 'FAILED')
          ? ('FAILED' as const)
          : ('MISSING' as const)
      const duration =
        filter.minDuration !== null || filter.maxDuration !== null
          ? await probeVideoDuration(sourcePath, input.signal)
          : (image.videoMetadata?.duration ?? null)
      const filterStatus = discoveryStatus === 'CURRENT' ? ('STALE' as const) : discoveryStatus
      if (!matchesVideoKeyframeFilter({ duration, path: image.path, status: filterStatus }, filter)) {
        result.filtered += 1
        continue
      }

      if (input.request.previewOnly) {
        result.matched += 1
        if (result.candidates.length < VIDEO_KEYFRAME_PREVIEW_LIMIT) {
          result.candidates.push({
            imageId: image.id,
            path: image.path,
            duration,
            status: discoveryStatus,
            publishedCount: published?.publishedCount ?? 0
          })
        } else {
          result.previewTruncated = true
        }
      } else {
        const queued = await enqueueVideoKeyframeJob({
          imageId: image.id,
          path: image.path,
          mode,
          parentJobId: input.jobId
        })
        result.matched += 1
        if (queued.reused) result.reused += 1
        else result.enqueued += 1
      }
    } catch (error) {
      throwIfDiscoveryAborted(input.signal)
      const message = error instanceof Error ? error.message : 'Unknown enqueue error'
      if (message.startsWith('Video keyframe queue is full')) {
        result.capacityLimited = images.length - index
        break
      }
      result.inaccessible += 1
      if (result.failedSamples.length < 20) {
        result.failedSamples.push({ imageId: image.id, path: image.path, error: message })
      }
    }

    if ((index + 1) % 20 === 0 || index === images.length - 1) {
      const updated = await prisma.systemJob.updateMany({
        where: {
          id: input.jobId,
          type: VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE,
          status: JobStatus.RUNNING,
          attempt: input.attempt
        },
        data: {
          progress: images.length > 0 ? Math.min(99, Math.floor(((index + 1) / images.length) * 100)) : 100,
          message: input.request.previewOnly
            ? `已检查 ${index + 1}/${images.length} 个视频，匹配 ${result.matched} 个`
            : `已检查 ${index + 1}/${images.length} 个视频，新增 ${result.enqueued} 个任务`,
          heartbeatAt: new Date()
        }
      })
      if (updated.count !== 1) throw new Error('Video keyframe discovery lease was lost')
    }
  }

  if (result.capacityLimited > 0) {
    const processedCount = images.length - result.capacityLimited
    const previousImageId = processedCount > 0 ? images[processedCount - 1]?.id : undefined
    const afterImageId = previousImageId ?? input.request.afterImageId
    const deferred = await prisma.systemJob.updateMany({
      where: {
        id: input.jobId,
        type: VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE,
        status: JobStatus.RUNNING,
        attempt: input.attempt
      },
      data: {
        status: JobStatus.PENDING,
        message: `生成队列已满，剩余 ${result.capacityLimited} 个视频待继续检查并入队`,
        heartbeatAt: null,
        availableAt: new Date(Date.now() + 5_000),
        attempt: { decrement: 1 },
        result: toJsonValue({
          request: {
            ...input.request,
            ...(afterImageId !== undefined ? { afterImageId } : {}),
            accumulated: toVideoKeyframeBatchAccumulator(result)
          }
        })
      }
    })
    if (deferred.count !== 1) throw new Error('Video keyframe discovery lease was lost')
    return result
  }

  const completed = await prisma.systemJob.updateMany({
    where: {
      id: input.jobId,
      type: VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE,
      status: JobStatus.RUNNING,
      attempt: input.attempt
    },
    data: {
      status: JobStatus.COMPLETED,
      progress: 100,
      message: input.request.previewOnly
        ? `筛选完成：找到 ${result.matched} 个待确认视频`
        : `发现完成：新增 ${result.enqueued}，复用 ${result.reused}，已是最新 ${result.current}`,
      result: toJsonValue({ ...result, trigger: input.request.trigger, mode, force: input.request.force, filter }),
      finishedAt: new Date(),
      heartbeatAt: new Date()
    }
  })
  if (completed.count !== 1) throw new Error('Video keyframe discovery lease was lost')
  return result
}

export function parseVideoKeyframeDiscoveryRequest(value: unknown): VideoKeyframeDiscoveryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Discovery request is missing')
  const request = (value as Record<string, unknown>).request
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Discovery request is missing')
  const record = request as Record<string, unknown>
  if (record.trigger !== 'manual' && record.trigger !== 'schedule') throw new Error('Discovery trigger is invalid')
  const imageIds = Array.isArray(record.imageIds)
    ? [...new Set(record.imageIds.filter((id): id is number => Number.isInteger(id) && Number(id) > 0))]
    : undefined
  const afterImageId =
    Number.isInteger(record.afterImageId) && Number(record.afterImageId) > 0 ? Number(record.afterImageId) : undefined
  const accumulated = normalizeVideoKeyframeBatchAccumulator(record.accumulated)
  return {
    trigger: record.trigger,
    force: record.force === true,
    previewOnly: record.previewOnly === true && record.trigger === 'manual',
    ...(imageIds !== undefined ? { imageIds } : {}),
    ...(afterImageId !== undefined ? { afterImageId } : {}),
    ...(accumulated ? { accumulated } : {}),
    filter: normalizeVideoKeyframeFilter(record.filter)
  }
}

export async function claimNextVideoKeyframeJob() {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', MEDIA_MAINTENANCE_LOCK_ID)
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_KEYFRAME_QUEUE_LOCK_ID)
    const running = await tx.systemJob.findFirst({
      where: {
        type: { in: [VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE, VIDEO_KEYFRAME_GENERATION_JOB_TYPE] },
        status: { in: [JobStatus.RUNNING, JobStatus.PAUSING, JobStatus.CANCELLING] }
      },
      select: { id: true }
    })
    if (running) return null

    const maintenance = await tx.systemJob.findFirst({
      where: { type: { in: HEAVY_MEDIA_MAINTENANCE_TYPES }, status: { in: [JobStatus.RUNNING, JobStatus.CANCELLING] } },
      select: { id: true }
    })
    if (maintenance) return null

    const now = new Date()
    const next = await tx.systemJob.findFirst({
      where: {
        type: { in: [VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE, VIDEO_KEYFRAME_GENERATION_JOB_TYPE] },
        status: JobStatus.PENDING,
        OR: [{ availableAt: null }, { availableAt: { lte: now } }]
      },
      orderBy: [{ queuePriority: 'asc' }, { availableAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    })
    if (!next) return null

    return tx.systemJob.update({
      where: { id: next.id },
      data: {
        status: JobStatus.RUNNING,
        progress: Math.max(1, next.progress),
        message:
          next.type === VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE ? '正在发现需要生成代表帧的视频...' : '正在准备视频代表帧...',
        startedAt: next.startedAt ?? now,
        heartbeatAt: now,
        finishedAt: null,
        error: null,
        availableAt: null,
        attempt: { increment: 1 }
      }
    })
  })
}

export async function controlVideoKeyframeJob(jobId: string, action: VideoKeyframeControlAction) {
  let cleanup = false
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_KEYFRAME_QUEUE_LOCK_ID)
    const job = await tx.systemJob.findUnique({ where: { id: jobId } })
    if (!job || job.type !== VIDEO_KEYFRAME_GENERATION_JOB_TYPE) return null
    const now = new Date()

    if (action === 'pause' && job.status === JobStatus.PENDING) {
      return tx.systemJob.update({
        where: { id: job.id },
        data: { status: JobStatus.PAUSED, message: '任务已暂停', heartbeatAt: now }
      })
    }
    if (action === 'pause' && job.status === JobStatus.RUNNING) {
      return tx.systemJob.update({
        where: { id: job.id },
        data: { status: JobStatus.PAUSING, message: '正在暂停代表帧任务...', heartbeatAt: now }
      })
    }
    if (action === 'resume' && job.status === JobStatus.PAUSED) {
      return tx.systemJob.update({
        where: { id: job.id },
        data: { status: JobStatus.PENDING, message: '等待恢复生成代表帧...', heartbeatAt: null, availableAt: null }
      })
    }
    if (action === 'cancel' && (job.status === JobStatus.PENDING || job.status === JobStatus.PAUSED)) {
      cleanup = true
      return tx.systemJob.update({
        where: { id: job.id },
        data: { status: JobStatus.CANCELLING, message: '正在取消代表帧任务...', heartbeatAt: now }
      })
    }
    if (action === 'cancel' && (job.status === JobStatus.RUNNING || job.status === JobStatus.PAUSING)) {
      return tx.systemJob.update({
        where: { id: job.id },
        data: { status: JobStatus.CANCELLING, message: '正在取消代表帧任务...', heartbeatAt: now }
      })
    }
    return job
  })
  if (!cleanup || !result) return result
  await finalizeVideoKeyframeCancelled(jobId, result.attempt)
  return prisma.systemJob.findUnique({ where: { id: jobId } })
}

export async function retryVideoKeyframeJob(jobId: string, targetPath?: string) {
  const job = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_KEYFRAME_QUEUE_LOCK_ID)
    const current = await tx.systemJob.findUnique({ where: { id: jobId } })
    if (!current || current.type !== VIDEO_KEYFRAME_GENERATION_JOB_TYPE) return null
    if (current.status !== JobStatus.FAILED && current.status !== JobStatus.CANCELLED) return current
    if (current.targetImageId !== null) {
      const activeForTarget = await tx.systemJob.findFirst({
        where: {
          id: { not: current.id },
          type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE,
          targetImageId: current.targetImageId,
          status: { in: ACTIVE_STATUSES }
        }
      })
      if (activeForTarget) return activeForTarget
    }
    const activeCount = await tx.systemJob.count({
      where: { type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, status: { in: ACTIVE_STATUSES } }
    })
    if (activeCount >= VIDEO_KEYFRAME_QUEUE_CAPACITY) {
      throw new Error(`Video keyframe queue is full (${VIDEO_KEYFRAME_QUEUE_CAPACITY})`)
    }
    await tx.mediaVideoKeyframeSet.updateMany({
      where: { systemJobId: current.id, status: 'FAILED' },
      data: { status: 'STAGING', error: null }
    })
    await tx.mediaVideoKeyframe.updateMany({
      where: { set: { systemJobId: current.id }, status: { in: ['FAILED', 'GENERATING'] } },
      data: { status: 'PENDING', error: null }
    })
    return tx.systemJob.update({
      where: { id: current.id },
      data: {
        status: JobStatus.PENDING,
        progress: 0,
        message: '等待重试生成代表帧...',
        error: null,
        result: Prisma.DbNull,
        attempt: 0,
        heartbeatAt: null,
        finishedAt: null,
        availableAt: null,
        queuePriority: VIDEO_KEYFRAME_MANUAL_PRIORITY,
        mode: 'MANUAL_FORCE',
        ...(targetPath ? { targetPath } : {})
      }
    })
  })
  return job
}

export async function retryFailedVideoKeyframeJobs(filterValue?: unknown) {
  const filter = normalizeVideoKeyframeFilter(filterValue)
  const jobs = await prisma.systemJob.findMany({
    where: { type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, targetImageId: { not: null } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      targetImageId: true,
      targetPath: true,
      status: true
    }
  })
  const latestByImageId = new Map<number, (typeof jobs)[number]>()
  for (const job of jobs) {
    if (job.targetImageId !== null && !latestByImageId.has(job.targetImageId)) {
      latestByImageId.set(job.targetImageId, job)
    }
  }
  for (const [imageId, job] of latestByImageId) {
    if (job.status !== JobStatus.FAILED) latestByImageId.delete(imageId)
  }
  const images = await prisma.image.findMany({
    where: { id: { in: [...latestByImageId.keys()] } },
    select: { id: true, path: true, mediaType: true, videoMetadata: { select: { duration: true } } }
  })
  const currentImages = new Map(images.map((item) => [item.id, item]))
  const scanPath = latestByImageId.size > 0 ? await requireVideoKeyframeScanPath() : null
  let retried = 0
  let filtered = 0
  let capacityLimited = 0

  for (const [imageId, job] of latestByImageId) {
    const image = currentImages.get(imageId)
    if (!image || (String(image.mediaType).toUpperCase() !== 'VIDEO' && !isVideoFile(image.path)) || !scanPath) {
      filtered += 1
      continue
    }
    if (
      !matchesVideoKeyframeFilter(
        { duration: null, path: image.path, status: 'FAILED' },
        { ...filter, minDuration: null, maxDuration: null }
      )
    ) {
      filtered += 1
      continue
    }
    let duration = image.videoMetadata?.duration ?? null
    try {
      const sourcePath = await resolveExistingPathWithinRoot(scanPath, image.path.replace(/^[/\\]+/, ''))
      const stat = await fs.stat(sourcePath)
      if (!stat.isFile()) throw new Error('Video path is not a file')
      if (filter.minDuration !== null || filter.maxDuration !== null) duration = await probeVideoDuration(sourcePath)
    } catch {
      filtered += 1
      continue
    }
    if (!matchesVideoKeyframeFilter({ duration, path: image.path, status: 'FAILED' }, filter)) {
      filtered += 1
      continue
    }
    try {
      await retryVideoKeyframeJob(job.id, image.path)
      retried += 1
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Video keyframe queue is full')) {
        capacityLimited = latestByImageId.size - retried - filtered
        break
      }
      throw error
    }
  }
  return { retried, filtered, capacityLimited }
}

export async function listVideoKeyframeQueue(recentLimit = 30) {
  const [active, recent, discoveryActive, discoveryRecent] = await Promise.all([
    prisma.systemJob.findMany({
      where: { type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, status: { in: ACTIVE_STATUSES } },
      orderBy: [{ queuePriority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    }),
    prisma.systemJob.findMany({
      where: { type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, status: { in: TERMINAL_STATUSES } },
      orderBy: { updatedAt: 'desc' },
      take: recentLimit
    }),
    prisma.systemJob.findMany({
      where: { type: VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE, status: { in: ACTIVE_STATUSES } },
      orderBy: [{ queuePriority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    }),
    prisma.systemJob.findMany({
      where: { type: VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE, status: { in: TERMINAL_STATUSES } },
      orderBy: { updatedAt: 'desc' },
      take: recentLimit
    })
  ])
  const pendingIds = active.filter((job) => job.status === JobStatus.PENDING).map((job) => job.id)
  const positions = new Map(pendingIds.map((id, index) => [id, index + 1]))
  return {
    capacity: VIDEO_KEYFRAME_QUEUE_CAPACITY,
    automaticCapacity: VIDEO_KEYFRAME_AUTOMATIC_CAPACITY,
    active: active.map((job) => ({ ...job, queuePosition: positions.get(job.id) ?? null })),
    recent: recent.map((job) => ({ ...job, queuePosition: null as number | null })),
    discoveryActive: discoveryActive.map((job) => ({ ...job, queuePosition: null as number | null })),
    discoveryRecent: discoveryRecent.map((job) => ({ ...job, queuePosition: null as number | null }))
  }
}

export async function getLatestVideoKeyframeJobsByImageIds(imageIds: number[]) {
  if (imageIds.length === 0) return []
  const jobs = await prisma.systemJob.findMany({
    where: { type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, targetImageId: { in: imageIds } },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
  })
  const latest = new Map<number, (typeof jobs)[number]>()
  for (const job of jobs) {
    if (job.targetImageId === null) continue
    const current = latest.get(job.targetImageId)
    if (!current || (ACTIVE_STATUSES.includes(job.status) && !ACTIVE_STATUSES.includes(current.status))) {
      latest.set(job.targetImageId, job)
    }
  }
  const pending = await prisma.systemJob.findMany({
    where: { type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, status: JobStatus.PENDING },
    orderBy: [{ queuePriority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true }
  })
  const positions = new Map(pending.map((job, index) => [job.id, index + 1]))
  return [...latest.values()].map((job) => ({ ...job, queuePosition: positions.get(job.id) ?? null }))
}

export async function getVideoKeyframeDetails(imageId: number) {
  const [published, jobs, videoMetadata] = await Promise.all([
    getPublishedVideoKeyframes(imageId),
    getLatestVideoKeyframeJobsByImageIds([imageId]),
    prisma.mediaVideoMetadata.findUnique({
      where: { imageId },
      select: { manualPosterTimestamp: true, manualPosterWarning: true }
    })
  ])
  return {
    published,
    job: jobs[0] ?? null,
    manualPosterTimestamp: videoMetadata?.manualPosterTimestamp ?? null,
    manualPosterWarning: videoMetadata?.manualPosterWarning ?? null
  }
}

export async function selectVideoKeyframePoster(imageId: number, frameId: string) {
  const frame = await prisma.mediaVideoKeyframe.findFirst({
    where: { id: frameId, set: { imageId, status: 'PUBLISHED' }, selectedOrder: { not: null } },
    select: { captureTime: true }
  })
  if (!frame) throw new Error('Published keyframe not found')
  return regenerateManualVideoPoster({
    imageId,
    scanPath: await requireVideoKeyframeScanPath(),
    captureTime: frame.captureTime,
    ffmpegThreads: getVideoKeyframeFfmpegThreads()
  })
}

export async function touchVideoKeyframeLease(jobId: string, attempt: number) {
  const result = await prisma.systemJob.updateMany({
    where: {
      id: jobId,
      type: { in: [VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE, VIDEO_KEYFRAME_GENERATION_JOB_TYPE] },
      status: { in: [JobStatus.RUNNING, JobStatus.PAUSING, JobStatus.CANCELLING] },
      attempt
    },
    data: { heartbeatAt: new Date() }
  })
  if (result.count === 1) return true
  const current = await prisma.systemJob.findUnique({ where: { id: jobId }, select: { status: true, attempt: true } })
  return current?.status === JobStatus.COMPLETED && current.attempt === attempt
}

export async function finalizeVideoKeyframeDiscoveryFailure(input: {
  jobId: string
  attempt: number
  error: string
  recoverable: boolean
  mode?: string | null
  staleBefore?: Date
}) {
  const retry = input.recoverable && input.attempt < 3
  const retryDelayMs = getVideoKeyframeRetryBackoffMs(input.attempt, input.mode)
  const updated = await prisma.systemJob.updateMany({
    where: {
      id: input.jobId,
      type: VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE,
      status: JobStatus.RUNNING,
      attempt: input.attempt,
      ...(input.staleBefore ? staleLeaseWhere(input.staleBefore) : {})
    },
    data: retry
      ? {
          status: JobStatus.PENDING,
          message: `发现失败，将在 ${formatRetryDelay(retryDelayMs)}后进行第 ${input.attempt + 1} 次尝试`,
          error: input.error,
          heartbeatAt: null,
          availableAt: new Date(Date.now() + retryDelayMs)
        }
      : {
          status: JobStatus.FAILED,
          message: '视频代表帧发现失败',
          error: input.error,
          finishedAt: new Date(),
          heartbeatAt: new Date()
        }
  })
  return updated.count === 1
}

export async function requeueVideoKeyframeDiscoveryOnShutdown(jobId: string, attempt: number) {
  await prisma.systemJob.updateMany({
    where: {
      id: jobId,
      type: VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE,
      status: JobStatus.RUNNING,
      attempt
    },
    data: { status: JobStatus.PENDING, message: 'Worker 已停止，等待恢复发现', heartbeatAt: null, availableAt: null }
  })
}

export async function acknowledgeVideoKeyframePaused(jobId: string, attempt: number, staleBefore?: Date) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_KEYFRAME_QUEUE_LOCK_ID)
    await tx.systemJob.updateMany({
      where: {
        id: jobId,
        type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE,
        attempt,
        status: JobStatus.PAUSING,
        ...(staleBefore ? staleLeaseWhere(staleBefore) : {})
      },
      data: { status: JobStatus.PAUSED, message: '任务已暂停', heartbeatAt: new Date() }
    })
    return tx.systemJob.findUnique({ where: { id: jobId }, select: { status: true, attempt: true } })
  })
}

export async function updateVideoKeyframeProgress(jobId: string, attempt: number, progress: number, message: string) {
  const result = await prisma.systemJob.updateMany({
    where: { id: jobId, type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, status: JobStatus.RUNNING, attempt },
    data: { progress, message, heartbeatAt: new Date() }
  })
  if (result.count !== 1) throw new Error('Video keyframe job lease was lost')
}

export async function completeVideoKeyframeJob(jobId: string, attempt: number, result: unknown) {
  const updated = await prisma.systemJob.updateMany({
    where: { id: jobId, type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, status: JobStatus.RUNNING, attempt },
    data: {
      status: JobStatus.COMPLETED,
      progress: 100,
      message: '视频代表帧生成完成',
      result: toJsonValue(result),
      error: null,
      finishedAt: new Date(),
      heartbeatAt: new Date()
    }
  })
  if (updated.count === 1) return
  const current = await prisma.systemJob.findUnique({ where: { id: jobId }, select: { status: true, attempt: true } })
  if (current?.status === JobStatus.COMPLETED && current.attempt === attempt) return
  throw new Error('Video keyframe job lease was lost')
}

export async function finalizeVideoKeyframeFailure(input: {
  jobId: string
  attempt: number
  error: string
  recoverable: boolean
  mode?: string | null
  staleBefore?: Date
}) {
  const retry = input.recoverable && input.attempt < 3
  const retryDelayMs = getVideoKeyframeRetryBackoffMs(input.attempt, input.mode)
  const availableAt = retry ? new Date(Date.now() + retryDelayMs) : null
  let cancelling = false
  let pausing = false
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_KEYFRAME_QUEUE_LOCK_ID)
    const control = await tx.systemJob.findFirst({
      where: {
        id: input.jobId,
        ...(input.staleBefore ? staleLeaseWhere(input.staleBefore) : {})
      },
      select: { type: true, status: true, attempt: true }
    })
    if (input.staleBefore && !control) return
    if (
      control?.type === VIDEO_KEYFRAME_GENERATION_JOB_TYPE &&
      control.attempt === input.attempt &&
      control.status === JobStatus.CANCELLING
    ) {
      cancelling = true
      return
    }
    if (
      control?.type === VIDEO_KEYFRAME_GENERATION_JOB_TYPE &&
      control.attempt === input.attempt &&
      control.status === JobStatus.PAUSING
    ) {
      pausing = true
      return
    }
    const updated = await tx.systemJob.updateMany({
      where: {
        id: input.jobId,
        type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE,
        attempt: input.attempt,
        status: JobStatus.RUNNING,
        ...(input.staleBefore ? staleLeaseWhere(input.staleBefore) : {})
      },
      data: retry
        ? {
            status: JobStatus.PENDING,
            message: `生成失败，将在 ${formatRetryDelay(retryDelayMs)}后进行第 ${input.attempt + 1} 次尝试`,
            error: input.error,
            heartbeatAt: null,
            availableAt
          }
        : {
            status: JobStatus.FAILED,
            message: '视频代表帧生成失败',
            error: input.error,
            finishedAt: new Date(),
            heartbeatAt: new Date()
          }
    })
    if (updated.count === 1 && !retry) {
      await tx.mediaVideoKeyframeSet.updateMany({
        where: { systemJobId: input.jobId, status: 'STAGING' },
        data: { status: 'FAILED', error: input.error }
      })
    }
  })
  if (cancelling) {
    await finalizeVideoKeyframeCancelled(input.jobId, input.attempt, input.staleBefore)
  } else if (pausing) {
    const acknowledged = await acknowledgeVideoKeyframePaused(input.jobId, input.attempt, input.staleBefore)
    if (acknowledged?.status === JobStatus.CANCELLING) {
      await finalizeVideoKeyframeCancelled(input.jobId, input.attempt)
    }
  }
}

export async function finalizeVideoKeyframeCancelled(jobId: string, attempt: number, staleBefore?: Date) {
  const owned = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_KEYFRAME_QUEUE_LOCK_ID)
    const current = await tx.systemJob.findFirst({
      where: {
        id: jobId,
        type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE,
        attempt,
        status: { in: [JobStatus.CANCELLING, JobStatus.RUNNING, JobStatus.PAUSING, JobStatus.PAUSED] },
        ...(staleBefore ? staleLeaseWhere(staleBefore) : {})
      },
      select: { id: true }
    })
    if (!current) return false
    await tx.mediaVideoKeyframeSet.updateMany({
      where: { systemJobId: jobId, status: 'STAGING' },
      data: { status: 'CANCELLED', error: 'Video keyframe job was cancelled' }
    })
    return true
  })
  if (!owned) return
  await removeJobStagingSet(jobId)
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_KEYFRAME_QUEUE_LOCK_ID)
    await tx.systemJob.updateMany({
      where: {
        id: jobId,
        type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE,
        attempt,
        status: { in: [JobStatus.CANCELLING, JobStatus.RUNNING, JobStatus.PAUSING, JobStatus.PAUSED] }
      },
      data: {
        status: JobStatus.CANCELLED,
        message: '视频代表帧任务已取消',
        finishedAt: new Date(),
        heartbeatAt: new Date()
      }
    })
  })
}

export async function requeueVideoKeyframeOnShutdown(jobId: string, attempt: number) {
  let cancelling = false
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_KEYFRAME_QUEUE_LOCK_ID)
    const current = await tx.systemJob.findUnique({
      where: { id: jobId },
      select: { type: true, status: true, attempt: true }
    })
    if (current?.type !== VIDEO_KEYFRAME_GENERATION_JOB_TYPE || current.attempt !== attempt) return
    if (current.status === JobStatus.CANCELLING) {
      cancelling = true
      return
    }
    if (current.status === JobStatus.PAUSING) {
      await tx.systemJob.updateMany({
        where: { id: jobId, type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, attempt, status: JobStatus.PAUSING },
        data: { status: JobStatus.PAUSED, message: '任务已暂停', heartbeatAt: new Date() }
      })
      return
    }
    await tx.systemJob.updateMany({
      where: { id: jobId, type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, attempt, status: JobStatus.RUNNING },
      data: { status: JobStatus.PENDING, message: 'Worker 已停止，等待恢复', heartbeatAt: null, availableAt: null }
    })
  })
  if (cancelling) await finalizeVideoKeyframeCancelled(jobId, attempt)
}

export async function recoverStaleVideoKeyframeJobs(staleBefore: Date) {
  const stale = await prisma.systemJob.findMany({
    where: {
      type: { in: [VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE, VIDEO_KEYFRAME_GENERATION_JOB_TYPE] },
      status: { in: [JobStatus.RUNNING, JobStatus.PAUSING, JobStatus.CANCELLING] },
      OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, updatedAt: { lt: staleBefore } }]
    }
  })
  for (const job of stale) {
    if (job.type === VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE) {
      await finalizeVideoKeyframeDiscoveryFailure({
        jobId: job.id,
        attempt: job.attempt,
        error: 'Worker heartbeat expired; discovery will be recovered',
        recoverable: true,
        mode: job.mode,
        staleBefore
      })
      continue
    }
    if (job.status === JobStatus.CANCELLING) {
      await finalizeVideoKeyframeCancelled(job.id, job.attempt, staleBefore)
    } else if (job.status === JobStatus.PAUSING) {
      await acknowledgeVideoKeyframePaused(job.id, job.attempt, staleBefore)
    } else {
      await finalizeVideoKeyframeFailure({
        jobId: job.id,
        attempt: job.attempt,
        error: 'Worker heartbeat expired; task will be recovered',
        recoverable: true,
        mode: job.mode,
        staleBefore
      })
    }
  }
  return stale.length
}

export async function cleanupOrphanedVideoKeyframeStorage() {
  let removed = 0
  let deferred = 0
  const imageEntries = await fs.readdir(VIDEO_KEYFRAME_STORAGE_ROOT, { withFileTypes: true }).catch((error) => {
    if (isMissingPathError(error)) return []
    throw error
  })

  for (const imageEntry of imageEntries) {
    if (!imageEntry.isDirectory() || !/^\d+$/.test(imageEntry.name)) continue
    const imageId = Number(imageEntry.name)
    const imageDirectory = resolveDerivedMediaStoragePath(VIDEO_KEYFRAME_STORAGE_ROOT, imageEntry.name)
    const setEntries = await fs.readdir(imageDirectory, { withFileTypes: true }).catch(() => [])
    for (const setEntry of setEntries) {
      if (!setEntry.isDirectory()) continue
      try {
        const result = await cleanupVideoKeyframeSetDirectory(imageId, setEntry.name)
        removed += result.removed
        deferred += result.deferred
      } catch {
        deferred += 1
      }
    }
    await fs.rmdir(imageDirectory).catch(() => undefined)
  }
  return { removed, deferred }
}

async function cleanupVideoKeyframeSetDirectory(imageId: number, setId: string) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_KEYFRAME_QUEUE_LOCK_ID)
      const active = await tx.systemJob.findFirst({
        where: {
          type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE,
          status: { in: ACTIVE_STATUSES },
          targetImageId: imageId
        },
        select: { id: true }
      })
      if (active) return { removed: 0, deferred: 0 }

      const set = await tx.mediaVideoKeyframeSet.findUnique({
        where: { id: setId },
        select: {
          imageId: true,
          status: true,
          frames: { select: { path: true, selectedOrder: true } }
        }
      })
      const setKey = `${imageId}/${setId}`
      const setDirectory = resolveDerivedMediaStoragePath(VIDEO_KEYFRAME_STORAGE_ROOT, setKey)
      if (!set || set.imageId !== imageId) {
        await fs.rm(setDirectory, { recursive: true, force: true })
        return { removed: 1, deferred: 0 }
      }

      const referencedFiles = new Set(
        set.frames.flatMap((frame) =>
          frame.path && (set.status !== VideoKeyframeSetStatus.PUBLISHED || frame.selectedOrder !== null)
            ? [frame.path]
            : []
        )
      )
      let removed = 0
      let deferred = 0
      const fileEntries = await fs.readdir(setDirectory, { withFileTypes: true }).catch(() => [])
      for (const fileEntry of fileEntries) {
        if (!fileEntry.isFile()) continue
        const relativePath = `${setKey}/${fileEntry.name}`
        if (referencedFiles.has(relativePath)) continue
        try {
          await fs.rm(resolveDerivedMediaStoragePath(VIDEO_KEYFRAME_STORAGE_ROOT, relativePath), { force: true })
        } catch {
          deferred += 1
          continue
        }
        // 这里不要捕获事务过期错误：必须立即终止该候选，
        // 否则后续文件系统动作可能在未持有 advisory 锁的情况下继续执行。
        await tx.mediaVideoKeyframe.updateMany({
          where: { setId, path: relativePath, selectedOrder: null },
          data: { path: null }
        })
        removed += 1
      }
      await fs.rmdir(setDirectory).catch(() => undefined)
      return { removed, deferred }
    },
    { maxWait: 10_000, timeout: 60_000 }
  )
}

export async function getVideoKeyframeJobControl(jobId: string) {
  return prisma.systemJob.findUnique({ where: { id: jobId }, select: { status: true, attempt: true } })
}

function formatRetryDelay(delayMs: number) {
  if (delayMs < 60_000) return `${Math.ceil(delayMs / 1_000)} 秒`
  return `${Math.ceil(delayMs / 60_000)} 分钟`
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function isMissingPathError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function throwIfDiscoveryAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new Error('Video keyframe discovery was interrupted')
}

function staleLeaseWhere(staleBefore: Date) {
  return {
    OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, updatedAt: { lt: staleBefore } }]
  }
}

export function normalizeScheduledVideoKeyframeFilter(value: unknown): VideoKeyframeFilter {
  return normalizeVideoKeyframeFilter(value)
}
