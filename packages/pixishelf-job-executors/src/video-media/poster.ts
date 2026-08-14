import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import type { JobErrorCode } from '@pixishelf/job-contracts'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  FencedExecutionTransaction,
  JobExecutionOutcome,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import type { VideoPosterPayload } from './executors.js'
import { lockVideoPoster } from './lock.js'
import { generateVideoPoster } from './media-process.js'
import { inspectGcCandidate, resolvePosterOutput, resolveVideoSource } from './paths.js'
import {
  VideoMediaPermanentError,
  VideoMediaProcessError,
  type VideoMediaDatabase,
  type VideoMediaRuntimeConfig,
  type VideoMediaTransaction
} from './types.js'

const GC_DELAY_MS = 60 * 60_000

type PosterContext = ExecutionContext<VideoPosterPayload, EnqueuedChildJob>

export async function executeVideoPoster(
  context: PosterContext,
  dependencies: { database: VideoMediaDatabase; config: VideoMediaRuntimeConfig; now?: () => Date }
): Promise<JobExecutionOutcome> {
  const now = dependencies.now ?? (() => new Date())
  let temporaryPath: string | null = null
  let outputPath: string | null = null
  let relativePosterPath: string | null = null
  let relativeTemporaryPath: string | null = null
  let claimed = false
  let finalizationStarted = false
  try {
    const image = await dependencies.database.image.findUnique({
      where: { id: context.payload.imageId },
      select: {
        id: true,
        path: true,
        mediaType: true,
        videoMetadata: {
          select: { posterStatus: true, posterPath: true, manualPosterTimestamp: true }
        }
      }
    })
    if (!image) throw new VideoMediaPermanentError('SOURCE_NOT_FOUND', 'Video image was not found')
    if (normalizePath(image.path) !== normalizePath(context.payload.relativePath)) {
      throw new VideoMediaPermanentError('PRECONDITION_FAILED', 'Poster payload path no longer matches the image')
    }
    if (image.mediaType !== 'VIDEO' && !isVideoPath(image.path)) {
      throw new VideoMediaPermanentError('NOT_A_VIDEO', 'Image is not a video')
    }
    if (image.videoMetadata?.manualPosterTimestamp !== null && image.videoMetadata?.manualPosterTimestamp !== undefined) {
      return { kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: '视频已有人工封面' }
    }
    const completedPosterMissing =
      image.videoMetadata?.posterStatus === 'COMPLETED' &&
      (!image.videoMetadata.posterPath ||
        !(await posterFileExists(dependencies.config.posterStorageRoot, image.videoMetadata.posterPath)))
    if (image.videoMetadata?.posterStatus === 'COMPLETED' && !completedPosterMissing) {
      return { kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: '视频封面已存在' }
    }
    const source = await resolveVideoSource(dependencies.config.scanRoot, image.path)
    relativePosterPath = posterRelativePath(
      image.id,
      image.path,
      source.stat.size,
      source.stat.mtimeMs,
      context.job.executionToken
    )
    outputPath = await resolvePosterOutput(dependencies.config.posterStorageRoot, relativePosterPath)
    relativeTemporaryPath = `${relativePosterPath}.${context.job.executionToken}.tmp.webp`
    temporaryPath = await resolvePosterOutput(dependencies.config.posterStorageRoot, relativeTemporaryPath)
    claimed = await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor, boolean>(async (transaction) => {
      await lockVideoPoster(transaction, image.id)
      await transaction.mediaVideoMetadata.upsert({
        where: { imageId: image.id },
        create: { imageId: image.id, probeStatus: 'PENDING', posterStatus: 'PENDING' },
        update: {}
      })
      return (
        await transaction.mediaVideoMetadata.updateMany({
          where: {
            imageId: image.id,
            OR: [
              { posterStatus: { in: ['PENDING', 'FAILED', 'GENERATING'] } },
              ...(completedPosterMissing
                ? [{ posterStatus: 'COMPLETED' as const, posterPath: image.videoMetadata?.posterPath ?? null }]
                : [])
            ],
            manualPosterTimestamp: null
          },
          data: { posterStatus: 'GENERATING', posterError: null }
        })
      ).count === 1
    })
    if (!claimed) return { kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: '视频封面状态已变化' }
    // Register the attempt-owned final path before touching the filesystem. If the later
    // publication transaction rolls back after rename, this durable entry makes the orphan
    // eligible for ordinary GC instead of relying on a weekly directory reconciliation.
    await context.mutateInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (transaction) => {
      await transaction.derivedMediaGcEntry.upsert({
        where: { mediaKind_relativePath: { mediaKind: 'VIDEO_POSTER', relativePath: relativePosterPath! } },
        create: {
          mediaKind: 'VIDEO_POSTER',
          relativePath: relativePosterPath!,
          referenceType: 'MEDIA_VIDEO_METADATA_POSTER',
          referenceId: String(image.id),
          reason: 'POSTER_ATTEMPT_OUTPUT',
          status: 'PENDING',
          notBefore: new Date(now().getTime() + GC_DELAY_MS),
          lastSystemJobId: context.job.id
        },
        update: {
          status: 'PENDING',
          notBefore: new Date(now().getTime() + GC_DELAY_MS),
          error: null,
          deletedAt: null,
          lastSystemJobId: context.job.id
        }
      })
      await transaction.derivedMediaGcEntry.upsert({
        where: { mediaKind_relativePath: { mediaKind: 'VIDEO_POSTER', relativePath: relativeTemporaryPath! } },
        create: {
          mediaKind: 'VIDEO_POSTER',
          relativePath: relativeTemporaryPath!,
          referenceType: 'MEDIA_VIDEO_METADATA_POSTER',
          referenceId: String(image.id),
          reason: 'POSTER_ATTEMPT_TEMPORARY',
          status: 'PENDING',
          notBefore: new Date(now().getTime() + GC_DELAY_MS),
          lastSystemJobId: context.job.id
        },
        update: {
          status: 'PENDING',
          notBefore: new Date(now().getTime() + GC_DELAY_MS),
          error: null,
          deletedAt: null,
          lastSystemJobId: context.job.id
        }
      })
    })
    await context.progress({ progress: 20, stage: 'GENERATING', message: `正在生成视频 ${image.id} 的封面` })
    await generateVideoPoster({
      sourcePath: source.sourcePath,
      temporaryPath,
      timeoutMs: dependencies.config.posterTimeoutMs ?? 120_000,
      signal: context.signal,
      ...(dependencies.config.ffmpegPath ? { ffmpegPath: dependencies.config.ffmpegPath } : {})
    })
    finalizationStarted = true
    const outcome = await context.finalizeInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (scope) => {
      if (await finalizePosterControl(scope, image.id, claimed)) return
      await lockVideoPoster(scope.transaction, image.id)
      const current = await scope.transaction.mediaVideoMetadata.findUnique({
        where: { imageId: image.id },
        select: { posterStatus: true, posterPath: true, manualPosterTimestamp: true }
      })
      if (current?.posterStatus !== 'GENERATING' || current.manualPosterTimestamp !== null) {
        await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '视频封面所有权已变化' })
        return
      }
      const previousPath = current.posterPath
      await fs.rename(temporaryPath!, outputPath!)
      const updated = await scope.transaction.mediaVideoMetadata.updateMany({
        where: { imageId: image.id, posterStatus: 'GENERATING', manualPosterTimestamp: null },
        data: {
          posterStatus: 'COMPLETED',
          posterPath: relativePosterPath,
          posterUpdatedAt: now(),
          posterError: null
        }
      })
      if (updated.count !== 1) throw new Error('Video poster ownership changed during publication')
      if (previousPath && previousPath !== relativePosterPath) {
        await scope.transaction.derivedMediaGcEntry.upsert({
          where: { mediaKind_relativePath: { mediaKind: 'VIDEO_POSTER', relativePath: previousPath } },
          create: {
            mediaKind: 'VIDEO_POSTER',
            relativePath: previousPath,
            referenceType: 'MEDIA_VIDEO_METADATA_POSTER',
            referenceId: String(image.id),
            reason: 'POSTER_REPLACED',
            status: 'PENDING',
            notBefore: new Date(now().getTime() + GC_DELAY_MS),
            lastSystemJobId: context.job.id
          },
          update: {
            referenceType: 'MEDIA_VIDEO_METADATA_POSTER',
            referenceId: String(image.id),
            reason: 'POSTER_REPLACED',
            status: 'PENDING',
            notBefore: new Date(now().getTime() + GC_DELAY_MS),
            error: null,
            deletedAt: null,
            lastSystemJobId: context.job.id
          }
        })
      }
      await scope.transaction.derivedMediaGcEntry.deleteMany({
        where: {
          mediaKind: 'VIDEO_POSTER',
          OR: [
            { relativePath: relativePosterPath!, reason: 'POSTER_ATTEMPT_OUTPUT' },
            { relativePath: relativeTemporaryPath!, reason: 'POSTER_ATTEMPT_TEMPORARY' }
          ]
        }
      })
      await scope.complete({ result: { imageId: image.id, posterPath: relativePosterPath }, message: '视频封面生成完成' })
    })
    await fs.rm(temporaryPath!, { force: true }).catch(() => undefined)
    return outcome
  } catch (error) {
    if (temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    if (finalizationStarted) throw error
    if (context.signal.aborted) {
      return context.finalizeInTransaction<VideoMediaTransaction & QueueSqlExecutor>((scope) =>
        finalizePosterControl(scope, context.payload.imageId, claimed, true).then(async (handled) => {
          if (!handled) await scope.release('视频封面 Worker 已停止')
        })
      )
    }
    const failure = classifyPosterError(error)
    if (error instanceof VideoMediaPermanentError && !claimed) {
      return { kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: failure.message }
    }
    return context.finalizeInTransaction<VideoMediaTransaction & QueueSqlExecutor>(async (scope) => {
      if (await finalizePosterControl(scope, context.payload.imageId, claimed)) return
      if (claimed) {
        await scope.transaction.mediaVideoMetadata.updateMany({
          where: { imageId: context.payload.imageId, posterStatus: 'GENERATING' },
          data: { posterStatus: 'FAILED', posterUpdatedAt: now(), posterError: failure.message }
        })
      }
      if (!(error instanceof VideoMediaPermanentError) && context.job.attempt < context.job.maxAttempts) {
        await scope.retry({
          availableAt: new Date(now().getTime() + Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, context.job.attempt - 1))),
          errorCode: failure.errorCode,
          error: failure.message,
          message: '视频封面生成失败，等待重试'
        })
      } else {
        await scope.fail({ errorCode: failure.errorCode, error: failure.message, message: '视频封面生成失败' })
      }
    })
  }
}

async function finalizePosterControl(
  scope: FencedExecutionTransaction<VideoMediaTransaction & QueueSqlExecutor>,
  imageId: number,
  claimed: boolean,
  shutdown = false
) {
  if (scope.executionStatus === 'PAUSING') {
    if (claimed) await resetPoster(scope.transaction as VideoMediaTransaction, imageId, 'PENDING', null)
    await scope.pause({ reason: 'USER_REQUESTED', message: '视频封面生成已暂停' })
    return true
  }
  if (scope.executionStatus === 'CANCELLING') {
    if (claimed) await resetPoster(scope.transaction as VideoMediaTransaction, imageId, 'FAILED', '视频封面生成已取消')
    await scope.cancel('视频封面生成已取消')
    return true
  }
  if (shutdown) {
    if (claimed) await resetPoster(scope.transaction as VideoMediaTransaction, imageId, 'PENDING', null)
    await scope.release('视频封面 Worker 已停止')
    return true
  }
  return false
}

async function resetPoster(
  transaction: VideoMediaTransaction,
  imageId: number,
  status: 'PENDING' | 'FAILED',
  posterError: string | null
) {
  await transaction.mediaVideoMetadata.updateMany({
    where: { imageId, posterStatus: 'GENERATING' },
    data: {
      posterStatus: status,
      ...(status === 'FAILED' ? { posterUpdatedAt: new Date() } : {}),
      posterError
    }
  })
}

function posterRelativePath(imageId: number, sourcePath: string, size: number, mtimeMs: number, executionToken: string) {
  const digest = createHash('sha256')
    .update(`${normalizePath(sourcePath)}:${size}:${mtimeMs}:${executionToken}`)
    .digest('hex')
    .slice(0, 16)
  return `${imageId}-${digest}.webp`
}

function classifyPosterError(error: unknown): { errorCode: JobErrorCode; message: string } {
  const message = error instanceof Error ? error.message : 'Unknown video poster failure'
  if (error instanceof VideoMediaProcessError) return { errorCode: error.code, message }
  if (error instanceof VideoMediaPermanentError) {
    if (error.code === 'SOURCE_NOT_FOUND') return { errorCode: 'SOURCE_NOT_FOUND', message }
    if (error.code === 'PATH_OUTSIDE_ALLOWED_ROOT') return { errorCode: 'PATH_OUTSIDE_ALLOWED_ROOT', message }
    return { errorCode: 'PRECONDITION_FAILED', message }
  }
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') return { errorCode: 'SOURCE_NOT_FOUND', message }
  if (code === 'EACCES' || code === 'EPERM') return { errorCode: 'FILESYSTEM_PERMISSION_DENIED', message }
  return { errorCode: 'INTERNAL_ERROR', message }
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function isVideoPath(value: string) {
  return /\.(?:mp4|webm|mkv|mov|avi|m4v|wmv|flv)$/i.test(value)
}

async function posterFileExists(root: string, relativePath: string) {
  try {
    return (await inspectGcCandidate(root, relativePath)).exists
  } catch {
    return false
  }
}
