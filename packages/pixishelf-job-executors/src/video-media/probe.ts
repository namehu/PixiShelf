import type { EnqueuedChildJob, ExecutionContext, JobExecutionOutcome, QueueSqlExecutor } from '@pixishelf/job-runtime'
import type { Prisma } from '@pixishelf/db'
import type { VideoMediaProbePayload } from './executors.ts'
import { probeVideoMetadata } from './media-process.ts'
import { resolveVideoSource } from './paths.ts'
import { generatePendingVideoPoster } from './poster.ts'
import {
  VideoChapterAudioProbeError,
  VideoMediaPermanentError,
  type VideoChapterAudioReference,
  type VideoMediaDatabase,
  type VideoMediaRuntimeConfig,
  type VideoMediaTransaction,
  type VideoProbeMetadata
} from './types.ts'

const CLASSIFICATION_BATCH_SIZE = 500
const PROBE_BATCH_SIZE = 20
const POSTER_BATCH_SIZE = 20
const FAILED_SAMPLE_LIMIT = 20

export interface VideoMediaProbeResult {
  mode: 'INCREMENTAL' | 'RECHECK_HAS_AUDIO'
  classification: {
    videos: number
    images: number
    animations: number
    unknown: number
    metadataRowsCreated: number
  }
  probe: { total: number; processed: number; failed: number; remaining: number }
  poster: { total: number; processed: number; generated: number; skipped: number; failed: number; remaining: number }
  failedSamples: Array<{ stage: 'PROBE' | 'POSTER'; imageId: number; path: string; error: string }>
}

type ProbeContext = ExecutionContext<VideoMediaProbePayload, EnqueuedChildJob>

export async function executeVideoMediaProbe(
  context: ProbeContext,
  dependencies: { database: VideoMediaDatabase; config: VideoMediaRuntimeConfig }
): Promise<JobExecutionOutcome<VideoMediaProbeResult>> {
  let activeImageId: number | null = null
  try {
    const recheckHasAudio = context.payload.mode === 'RECHECK_HAS_AUDIO'
    const classification = recheckHasAudio
      ? emptyClassification()
      : context.payload.imageId
        ? await prepareTargetedVideoProbe(context, dependencies.database, context.payload.imageId)
        : await classifyUnknownMedia(context, dependencies.database)
    if (!context.payload.imageId && !recheckHasAudio) {
      await ensureMissingVideoMetadata(context, dependencies.database)
    }
    const statuses = context.payload.force
      ? (['PENDING', 'PROBING', 'FAILED'] as const)
      : (['PENDING', 'PROBING'] as const)
    const targetWhere = context.payload.imageId ? { imageId: context.payload.imageId } : {}
    const probeWhere: Prisma.MediaVideoMetadataWhereInput = recheckHasAudio
      ? {
          hasAudio: true,
          OR: [
            { probeStatus: { in: ['PENDING', 'PROBING', 'FAILED'] } },
            {
              probeStatus: 'COMPLETED',
              OR: [{ probeUpdatedAt: null }, { probeUpdatedAt: { lt: context.job.createdAt } }]
            }
          ]
        }
      : { probeStatus: { in: [...statuses] }, ...targetWhere }
    const total = await dependencies.database.mediaVideoMetadata.count({
      where: probeWhere
    })
    const result: VideoMediaProbeResult = {
      mode: context.payload.mode,
      classification: {
        videos: classification.classifiedVideos,
        images: classification.classifiedImages,
        animations: classification.classifiedAnimations,
        unknown: classification.unknown,
        metadataRowsCreated: classification.metadataRowsCreated
      },
      probe: { total, processed: 0, failed: 0, remaining: total },
      poster: { total: 0, processed: 0, generated: 0, skipped: 0, failed: 0, remaining: 0 },
      failedSamples: []
    }
    let cursor = 0
    while (true) {
      throwIfAborted(context.signal)
      const batch = await dependencies.database.mediaVideoMetadata.findMany({
        where: {
          ...probeWhere,
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
                where: { imageId: item.imageId, ...probeWhere },
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
          if (metadata.chapterAudio) {
            await persistChapterAudioMeasurements(context, item.imageId, metadata.chapterAudio)
          }
          await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (transaction) => {
            const { chapterAudio: _chapterAudio, ...videoMetadata } = metadata
            const updated = await transaction.mediaVideoMetadata.updateMany({
              where: { imageId: item.imageId, probeStatus: 'PROBING' },
              data: { probeStatus: 'COMPLETED', probeUpdatedAt: new Date(), probeError: null, ...videoMetadata }
            })
            if (updated.count !== 1) throw new Error('Video probe checkpoint changed before completion')
          })
          activeImageId = null
          result.probe.processed += 1
        } catch (error) {
          if (context.signal.aborted) throw error
          const message = error instanceof Error ? error.message : 'Unknown video probe failure'
          if (error instanceof VideoChapterAudioProbeError) {
            await persistChapterAudioFailure(context, item.imageId, error.chapterAudio, message)
          }
          await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (transaction) => {
            await transaction.mediaVideoMetadata.updateMany({
              where: { imageId: item.imageId, probeStatus: 'PROBING' },
              data: { probeStatus: 'FAILED', probeUpdatedAt: new Date(), probeError: message }
            })
          })
          activeImageId = null
          result.probe.failed += 1
          if (result.failedSamples.length < FAILED_SAMPLE_LIMIT) {
            result.failedSamples.push({ stage: 'PROBE', imageId: item.imageId, path: item.image.path, error: message })
          }
        }
        const attempted = result.probe.processed + result.probe.failed
        await context.progress({
          progress: Math.min(50, 10 + Math.floor((attempted / Math.max(total, 1)) * 40)),
          stage: 'PROBING',
          message: `已探测 ${attempted}/${total} 个视频，失败 ${result.probe.failed} 个`
        })
      }
    }
    result.probe.remaining = await dependencies.database.mediaVideoMetadata.count({
      where: probeWhere
    })
    if (context.payload.imageId && result.probe.failed > 0) {
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
    if (!recheckHasAudio) await processPendingPosters(context, dependencies, result)
    return {
      kind: 'completed',
      result,
      message: recheckHasAudio
        ? `视频音频标记校准完成：成功 ${result.probe.processed}，失败 ${result.probe.failed}，剩余 ${result.probe.remaining}`
        : `视频媒体探测与封面生成完成：探测成功 ${result.probe.processed}，封面生成 ${result.poster.generated}，失败 ${result.probe.failed + result.poster.failed}`
    }
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

async function persistChapterAudioMeasurements(
  context: ProbeContext,
  imageId: number,
  chapterAudio: NonNullable<VideoProbeMetadata['chapterAudio']>
) {
  await persistChapterAudioInBatches(context, imageId, chapterAudio, (chapter) => ({
    hasAudibleAudio: chapter.hasAudibleAudio,
    audioProbeError: null
  }))
}

async function persistChapterAudioFailure(
  context: ProbeContext,
  imageId: number,
  chapterAudio: VideoChapterAudioReference,
  message: string
) {
  await persistChapterAudioInBatches(context, imageId, chapterAudio, () => ({
    hasAudibleAudio: null,
    audioProbeError: message
  }))
}

async function persistChapterAudioInBatches<TChapter extends VideoChapterAudioReference['chapters'][number]>(
  context: ProbeContext,
  imageId: number,
  chapterAudio: { chaptersHash: string; chapters: TChapter[] },
  resultForChapter: (chapter: TChapter) => {
    hasAudibleAudio: boolean | null
    audioProbeError: string | null
  }
) {
  for (let offset = 0; offset < chapterAudio.chapters.length; offset += 50) {
    const batch = chapterAudio.chapters.slice(offset, offset + 50)
    await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (transaction) => {
      for (const chapter of batch) {
        const result = resultForChapter(chapter)
        await transaction.mediaChapterPreview.upsert({
          where: { imageId_chapterOrder: { imageId, chapterOrder: chapter.chapterOrder } },
          create: {
            imageId,
            chapterOrder: chapter.chapterOrder,
            chapterIndex: chapter.chapterIndex,
            chaptersHash: chapterAudio.chaptersHash,
            chapterStart: chapter.chapterStart,
            captureTime: chapter.chapterStart,
            status: 'PENDING',
            hasAudibleAudio: result.hasAudibleAudio,
            audioChaptersHash: chapterAudio.chaptersHash,
            audioProbeError: result.audioProbeError
          },
          update: {
            hasAudibleAudio: result.hasAudibleAudio,
            audioChaptersHash: chapterAudio.chaptersHash,
            audioProbeError: result.audioProbeError
          }
        })
      }
    })
  }
}

function emptyClassification() {
  return {
    classifiedVideos: 0,
    classifiedImages: 0,
    classifiedAnimations: 0,
    unknown: 0,
    metadataRowsCreated: 0
  }
}

async function processPendingPosters(
  context: ProbeContext,
  dependencies: { database: VideoMediaDatabase; config: VideoMediaRuntimeConfig },
  result: VideoMediaProbeResult
) {
  throwIfAborted(context.signal)
  const targetWhere = context.payload.imageId ? { imageId: context.payload.imageId } : {}
  const candidateWhere: Prisma.MediaVideoMetadataWhereInput = {
    probeStatus: 'COMPLETED' as const,
    manualPosterTimestamp: null,
    posterStatus: { in: ['PENDING', 'FAILED', 'GENERATING'] },
    ...targetWhere
  }
  result.poster.total = await dependencies.database.mediaVideoMetadata.count({ where: candidateWhere })
  let cursor = 0
  while (true) {
    throwIfAborted(context.signal)
    const batch = await dependencies.database.mediaVideoMetadata.findMany({
      where: {
        ...candidateWhere,
        imageId: context.payload.imageId ?? { gt: cursor }
      },
      orderBy: { imageId: 'asc' },
      take: context.payload.imageId ? 1 : POSTER_BATCH_SIZE,
      select: { imageId: true, image: { select: { path: true } } }
    })
    if (batch.length === 0) break
    cursor = batch.at(-1)!.imageId
    for (const item of batch) {
      throwIfAborted(context.signal)
      const outcome = await generatePendingVideoPoster(context, dependencies, {
        imageId: item.imageId,
        relativePath: normalizeRelativePath(item.image.path)
      })
      result.poster.processed += 1
      if (outcome.kind === 'generated') {
        result.poster.generated += 1
      } else if (outcome.kind === 'skipped') {
        result.poster.skipped += 1
      } else if (outcome.kind === 'failed') {
        result.poster.failed += 1
        if (result.failedSamples.length < FAILED_SAMPLE_LIMIT) {
          result.failedSamples.push({
            stage: 'POSTER',
            imageId: item.imageId,
            path: item.image.path,
            error: outcome.message
          })
        }
      }
      await context.progress({
        progress: Math.min(99, 50 + Math.floor((result.poster.processed / Math.max(result.poster.total, 1)) * 49)),
        stage: 'GENERATING_POSTERS',
        message: `已处理封面 ${result.poster.processed}/${result.poster.total}，生成 ${result.poster.generated}，跳过 ${result.poster.skipped}，失败 ${result.poster.failed}`
      })
    }
  }
  result.poster.remaining = await dependencies.database.mediaVideoMetadata.count({
    where: {
      probeStatus: 'COMPLETED',
      manualPosterTimestamp: null,
      posterStatus: { in: ['PENDING', 'GENERATING'] },
      ...targetWhere
    }
  })
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
          await transaction.image.updateMany({
            where: { id: { in: videos }, mediaType: 'UNKNOWN' },
            data: { mediaType: 'VIDEO' }
          })
        }
        if (images.length > 0) {
          await transaction.image.updateMany({
            where: { id: { in: images }, mediaType: 'UNKNOWN' },
            data: { mediaType: 'IMAGE' }
          })
        }
        if (animations.length > 0) {
          await transaction.image.updateMany({
            where: { id: { in: animations }, mediaType: 'UNKNOWN' },
            data: { mediaType: 'ANIMATION' }
          })
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
  await context.progress({
    progress: 10,
    stage: 'CLASSIFYING',
    message: `媒体分类完成，发现视频 ${result.classifiedVideos} 个`
  })
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
