import type { EnqueuedChildJob, ExecutionContext, JobExecutionOutcome, QueueSqlExecutor } from '@pixishelf/job-runtime'
import type { VideoMediaProbePayload } from './executors.js'
import { probeVideoMetadata } from './media-process.js'
import { inspectGcCandidate, resolveVideoSource } from './paths.js'
import {
  VideoMediaPermanentError,
  type VideoMediaDatabase,
  type VideoMediaRuntimeConfig,
  type VideoMediaTransaction
} from './types.js'

const CLASSIFICATION_BATCH_SIZE = 500
const PROBE_BATCH_SIZE = 20
const POSTER_BACKLOG_BATCH_SIZE = 100
const FAILED_SAMPLE_LIMIT = 20

export interface VideoMediaProbeResult {
  classifiedVideos: number
  classifiedImages: number
  classifiedAnimations: number
  unknown: number
  metadataRowsCreated: number
  processed: number
  failed: number
  remaining: number
  posterChildrenEnqueued: number
  posterChildrenReused: number
  posterEnqueueFailed: number
  posterBacklogScanned: number
  posterFilesMissing: number
  failedSamples: Array<{ imageId: number; path: string; error: string }>
}

type ProbeContext = ExecutionContext<VideoMediaProbePayload, EnqueuedChildJob>

export async function executeVideoMediaProbe(
  context: ProbeContext,
  dependencies: { database: VideoMediaDatabase; config: VideoMediaRuntimeConfig }
): Promise<JobExecutionOutcome<VideoMediaProbeResult>> {
  let activeImageId: number | null = null
  try {
    const classification = context.payload.imageId
      ? await prepareTargetedVideoProbe(context, dependencies.database, context.payload.imageId)
      : await classifyUnknownMedia(context, dependencies.database)
    if (!context.payload.imageId) await ensureMissingVideoMetadata(context, dependencies.database)
    const statuses = context.payload.force
      ? (['PENDING', 'PROBING', 'FAILED'] as const)
      : (['PENDING', 'PROBING'] as const)
    const targetWhere = context.payload.imageId ? { imageId: context.payload.imageId } : {}
    const total = await dependencies.database.mediaVideoMetadata.count({
      where: { probeStatus: { in: [...statuses] }, ...targetWhere }
    })
    const result: VideoMediaProbeResult = {
      ...classification,
      processed: 0,
      failed: 0,
      remaining: total,
      posterChildrenEnqueued: 0,
      posterChildrenReused: 0,
      posterEnqueueFailed: 0,
      posterBacklogScanned: 0,
      posterFilesMissing: 0,
      failedSamples: []
    }
    let cursor = 0
    while (true) {
      throwIfAborted(context.signal)
      const batch = await dependencies.database.mediaVideoMetadata.findMany({
        where: {
          probeStatus: { in: [...statuses] },
          imageId: context.payload.imageId ?? { gt: cursor }
        },
        orderBy: { imageId: 'asc' },
        take: PROBE_BATCH_SIZE,
        select: {
          imageId: true,
          posterStatus: true,
          posterPath: true,
          image: { select: { path: true } }
        }
      })
      if (batch.length === 0) break
      cursor = batch.at(-1)!.imageId
      for (const item of batch) {
        throwIfAborted(context.signal)
        const claimed = await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor, boolean>(
          async (transaction) =>
            (
              await transaction.mediaVideoMetadata.updateMany({
                where: { imageId: item.imageId, probeStatus: { in: [...statuses] } },
                data: { probeStatus: 'PROBING', probeUpdatedAt: new Date(), probeError: null }
              })
            ).count === 1
        )
        if (!claimed) continue
        activeImageId = item.imageId
        try {
          const source = await resolveVideoSource(dependencies.config.scanRoot, item.image.path)
          const metadata = await probeVideoMetadata({
            sourcePath: source.sourcePath,
            timeoutMs: dependencies.config.probeTimeoutMs ?? 60_000,
            signal: context.signal,
            ...(dependencies.config.ffprobePath ? { ffprobePath: dependencies.config.ffprobePath } : {}),
            ...(dependencies.config.ffmpegPath ? { ffmpegPath: dependencies.config.ffmpegPath } : {})
          })
          await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (transaction) => {
            const updated = await transaction.mediaVideoMetadata.updateMany({
              where: { imageId: item.imageId, probeStatus: 'PROBING' },
              data: { probeStatus: 'COMPLETED', probeUpdatedAt: new Date(), probeError: null, ...metadata }
            })
            if (updated.count !== 1) throw new Error('Video probe checkpoint changed before completion')
          })
          activeImageId = null
          result.processed += 1
        } catch (error) {
          if (context.signal.aborted) throw error
          const message = error instanceof Error ? error.message : 'Unknown video probe failure'
          await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (transaction) => {
            await transaction.mediaVideoMetadata.updateMany({
              where: { imageId: item.imageId, probeStatus: 'PROBING' },
              data: { probeStatus: 'FAILED', probeUpdatedAt: new Date(), probeError: message }
            })
          })
          activeImageId = null
          result.failed += 1
          if (result.failedSamples.length < FAILED_SAMPLE_LIMIT) {
            result.failedSamples.push({ imageId: item.imageId, path: item.image.path, error: message })
          }
        }
        const attempted = result.processed + result.failed
        await context.progress({
          progress: Math.min(99, 20 + Math.floor((attempted / Math.max(total, 1)) * 79)),
          stage: 'PROBING',
          message: `已探测 ${attempted}/${total} 个视频，失败 ${result.failed} 个`
        })
      }
    }
    if (context.payload.enqueueMissingPosters) {
      await materializePosterBacklog(context, dependencies, result)
    }
    result.remaining = await dependencies.database.mediaVideoMetadata.count({
      where: { probeStatus: { in: [...statuses] }, ...targetWhere }
    })
    if (context.payload.imageId && result.failed > 0) {
      const message = result.failedSamples[0]?.error ?? 'Targeted video probe failed'
      return context.job.attempt < context.job.maxAttempts
        ? {
            kind: 'retry',
            availableAt: new Date(Date.now() + 60_000),
            errorCode: 'INTERNAL_ERROR',
            error: message,
            message: '单视频媒体重探测失败，等待重试'
          }
        : { kind: 'failed', errorCode: 'INTERNAL_ERROR', error: message, message: '单视频媒体重探测失败' }
    }
    return { kind: 'completed', result, message: `视频媒体探测完成：成功 ${result.processed}，失败 ${result.failed}` }
  } catch (error) {
    if (context.signal.aborted) {
      return context.finalizeInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (scope) => {
        if (activeImageId !== null) {
          await scope.transaction.mediaVideoMetadata.updateMany({
            where: { imageId: activeImageId, probeStatus: 'PROBING' },
            data: { probeStatus: 'PENDING', probeError: null }
          })
        }
        if (scope.executionStatus === 'PAUSING') {
          await scope.pause({ reason: 'USER_REQUESTED', message: '视频媒体探测已暂停' })
        } else if (scope.executionStatus === 'CANCELLING') {
          await scope.cancel('视频媒体探测已取消')
        } else {
          await scope.release('视频媒体探测 Worker 已停止')
        }
      })
    }
    if (error instanceof VideoMediaPermanentError) {
      return { kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: error.message }
    }
    const message = error instanceof Error ? error.message : 'Unknown video media probe failure'
    return context.job.attempt < context.job.maxAttempts
      ? {
          kind: 'retry',
          availableAt: new Date(Date.now() + 60_000),
          errorCode: 'INTERNAL_ERROR',
          error: message,
          message: '视频媒体探测异常，等待重试'
        }
      : { kind: 'failed', errorCode: 'INTERNAL_ERROR', error: message, message: '视频媒体探测失败' }
  }
}

async function enqueuePosterChild(
  context: ProbeContext,
  result: VideoMediaProbeResult,
  imageId: number,
  relativePath: string,
  stateVersion: string
) {
  try {
    const child = await context.enqueueChild({
      type: 'VIDEO_POSTER_GENERATION',
      payload: { imageId, relativePath: normalizeRelativePath(relativePath) },
      idempotencyKey: `video-poster:${imageId}:${stateVersion}`
    })
    if (child.created) result.posterChildrenEnqueued += 1
    else result.posterChildrenReused += 1
    return true
  } catch (error) {
    result.posterEnqueueFailed += 1
    context.logger.warn('video-media.poster-child-enqueue-failed', {
      imageId,
      error: error instanceof Error ? error.message : 'Unknown child enqueue failure'
    })
    return false
  }
}

async function materializePosterBacklog(
  context: ProbeContext,
  dependencies: { database: VideoMediaDatabase; config: VideoMediaRuntimeConfig },
  result: VideoMediaProbeResult
) {
  throwIfAborted(context.signal)
  const batch = await dependencies.database.mediaVideoMetadata.findMany({
    where: {
      probeStatus: 'COMPLETED',
      manualPosterTimestamp: null,
      ...(context.payload.imageId ? { imageId: context.payload.imageId } : {}),
      posterStatus: { in: ['PENDING', 'FAILED', 'COMPLETED'] }
    },
    orderBy: [
      { posterBacklogCheckedAt: { sort: 'asc', nulls: 'first' } },
      { imageId: 'asc' }
    ],
    take: context.payload.imageId ? 1 : POSTER_BACKLOG_BATCH_SIZE,
    select: {
      imageId: true,
      posterStatus: true,
      posterPath: true,
      posterUpdatedAt: true,
      image: { select: { path: true } }
    }
  })
  const checkedImageIds: number[] = []
  for (const item of batch) {
    throwIfAborted(context.signal)
    result.posterBacklogScanned += 1
    if (item.posterStatus === 'COMPLETED') {
      let exists = false
      if (item.posterPath) {
        try {
          exists = (await inspectGcCandidate(dependencies.config.posterStorageRoot, item.posterPath)).exists
        } catch (error) {
          context.logger.warn('video-media.poster-file-invalid', {
            imageId: item.imageId,
            error: error instanceof Error ? error.message : 'Unknown poster validation failure'
          })
        }
      }
      if (exists) {
        checkedImageIds.push(item.imageId)
        continue
      }
      result.posterFilesMissing += 1
    }
    const stateVersion = [
      item.posterStatus,
      item.posterUpdatedAt?.getTime() ?? 0,
      item.posterPath ?? 'none'
    ].join(':')
    await enqueuePosterChild(context, result, item.imageId, item.image.path, stateVersion)
    // A poison row must advance the fairness cursor even when its child enqueue failed. The
    // parent still retries below; after untouched rows get a turn, this older checkpoint rotates
    // back to the front and retries the failed row instead of permanently dropping it.
    checkedImageIds.push(item.imageId)
  }
  if (checkedImageIds.length > 0) {
    await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (transaction) => {
      await transaction.mediaVideoMetadata.updateMany({
        where: { imageId: { in: checkedImageIds } },
        data: { posterBacklogCheckedAt: new Date() }
      })
    })
  }
  if (result.posterEnqueueFailed > 0) {
    throw new Error(`Failed to durably enqueue ${result.posterEnqueueFailed} video poster jobs`)
  }
}

async function prepareTargetedVideoProbe(context: ProbeContext, database: VideoMediaDatabase, imageId: number) {
  throwIfAborted(context.signal)
  const image = await database.image.findUnique({
    where: { id: imageId },
    select: { id: true, path: true, mediaType: true }
  })
  if (!image) throw new VideoMediaPermanentError('SOURCE_NOT_FOUND', 'Video image was not found')
  if (image.mediaType !== 'VIDEO' && inferMediaType(image.path) !== 'VIDEO') {
    throw new VideoMediaPermanentError('NOT_A_VIDEO', 'Image is not a video')
  }
  await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (transaction) => {
    if (image.mediaType !== 'VIDEO') {
      await transaction.image.updateMany({ where: { id: image.id }, data: { mediaType: 'VIDEO' } })
    }
    await transaction.mediaVideoMetadata.upsert({
      where: { imageId: image.id },
      create: { imageId: image.id, probeStatus: 'PENDING', posterStatus: 'PENDING' },
      update: { probeStatus: 'PENDING', probeError: null }
    })
  })
  await context.progress({ progress: 10, stage: 'CLASSIFYING', message: `已准备重探测视频 ${image.id}` })
  return {
    classifiedVideos: image.mediaType === 'VIDEO' ? 0 : 1,
    classifiedImages: 0,
    classifiedAnimations: 0,
    unknown: 0,
    metadataRowsCreated: 0
  }
}

async function classifyUnknownMedia(context: ProbeContext, database: VideoMediaDatabase) {
  const result = {
    classifiedVideos: 0,
    classifiedImages: 0,
    classifiedAnimations: 0,
    unknown: 0,
    metadataRowsCreated: 0
  }
  let cursor = 0
  while (true) {
    throwIfAborted(context.signal)
    const batch = await database.image.findMany({
      where: { mediaType: 'UNKNOWN', id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: CLASSIFICATION_BATCH_SIZE,
      select: { id: true, path: true }
    })
    if (batch.length === 0) break
    cursor = batch.at(-1)!.id
    const videos: number[] = []
    const images: number[] = []
    const animations: number[] = []
    for (const image of batch) {
      const kind = inferMediaType(image.path)
      if (kind === 'VIDEO') videos.push(image.id)
      else if (kind === 'IMAGE') images.push(image.id)
      else if (kind === 'ANIMATION') animations.push(image.id)
      else result.unknown += 1
    }
    const created = await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor, number>(
      async (transaction) => {
        if (videos.length > 0) {
          await transaction.image.updateMany({ where: { id: { in: videos }, mediaType: 'UNKNOWN' }, data: { mediaType: 'VIDEO' } })
        }
        if (images.length > 0) {
          await transaction.image.updateMany({ where: { id: { in: images }, mediaType: 'UNKNOWN' }, data: { mediaType: 'IMAGE' } })
        }
        if (animations.length > 0) {
          await transaction.image.updateMany({ where: { id: { in: animations }, mediaType: 'UNKNOWN' }, data: { mediaType: 'ANIMATION' } })
        }
        if (videos.length === 0) return 0
        return (
          await transaction.mediaVideoMetadata.createMany({
            data: videos.map((imageId) => ({ imageId, probeStatus: 'PENDING' as const })),
            skipDuplicates: true
          })
        ).count
      }
    )
    result.classifiedVideos += videos.length
    result.classifiedImages += images.length
    result.classifiedAnimations += animations.length
    result.metadataRowsCreated += created
  }
  await context.progress({ progress: 10, stage: 'CLASSIFYING', message: `媒体分类完成，发现视频 ${result.classifiedVideos} 个` })
  return result
}

async function ensureMissingVideoMetadata(context: ProbeContext, database: VideoMediaDatabase) {
  let cursor = 0
  while (true) {
    throwIfAborted(context.signal)
    const batch = await database.image.findMany({
      where: { mediaType: 'VIDEO', videoMetadata: null, id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: CLASSIFICATION_BATCH_SIZE,
      select: { id: true }
    })
    if (batch.length === 0) return
    cursor = batch.at(-1)!.id
    throwIfAborted(context.signal)
    await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (transaction) => {
      await transaction.mediaVideoMetadata.createMany({
        data: batch.map(({ id }) => ({ imageId: id, probeStatus: 'PENDING' as const })),
        skipDuplicates: true
      })
    })
  }
}

function inferMediaType(relativePath: string): 'VIDEO' | 'IMAGE' | 'ANIMATION' | 'UNKNOWN' {
  if (/\.(?:mp4|webm|mkv|mov|avi|m4v|wmv|flv)$/i.test(relativePath)) return 'VIDEO'
  if (/\.(?:gif|apng)$/i.test(relativePath)) return 'ANIMATION'
  if (/\.(?:jpe?g|png|webp|avif|bmp|tiff?)$/i.test(relativePath)) return 'IMAGE'
  return 'UNKNOWN'
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new Error('Video media probe was interrupted')
}
