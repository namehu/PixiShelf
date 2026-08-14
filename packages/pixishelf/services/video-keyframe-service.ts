import * as childProcess from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { buildDerivedMediaPublicUrl } from '@/lib/derived-media'
import { isVideoFile } from '@/lib/media'
import { resolveExistingPathWithinRoot } from '@/lib/safe-path'
import {
  resolveDerivedMediaStoragePath,
  VIDEO_KEYFRAME_STORAGE_ROOT,
  VIDEO_POSTER_STORAGE_ROOT
} from '@/services/derived-media-storage-paths'
import { VIDEO_POSTER_LOCK_NAMESPACE } from '@/services/video-poster-lock'
import {
  buildVideoKeyframeCandidateTimes,
  getVideoKeyframeTargetCount,
  selectRepresentativeKeyframes,
  VIDEO_KEYFRAME_POLICY_VERSION,
  VIDEO_KEYFRAME_QUEUE_LOCK_ID
} from '@/services/video-keyframe-policy'

const FRAME_TIMEOUT_MS = 2 * 60 * 1000
const PROBE_TIMEOUT_MS = 2 * 60 * 1000
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024

export type VideoKeyframeControlReason = 'PAUSED' | 'CANCELLED' | 'SHUTDOWN' | 'LEASE_LOST'

export class VideoKeyframeControlError extends Error {
  constructor(
    public readonly reason: VideoKeyframeControlReason,
    message: string
  ) {
    super(message)
    this.name = 'VideoKeyframeControlError'
  }
}

export type VideoKeyframePermanentErrorCode =
  | 'IMAGE_NOT_FOUND'
  | 'NOT_A_VIDEO'
  | 'INVALID_DURATION'
  | 'NO_CANDIDATES'
  | 'INSUFFICIENT_DISTINCT_FRAMES'

export class VideoKeyframePermanentError extends Error {
  constructor(
    public readonly code: VideoKeyframePermanentErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'VideoKeyframePermanentError'
  }
}

export interface VideoKeyframeProgress {
  percentage: number
  message: string
}

export interface VideoKeyframeGenerationResult {
  imageId: number
  setId: string
  path: string
  duration: number
  targetCount: number
  publishedCount: number
  warning: string | null
}

export interface VideoKeyframeSourceFingerprint {
  size: bigint
  mtimeMs: bigint
}

export async function resolveVideoKeyframeTarget(imageId: number, scanPath: string) {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
    select: {
      id: true,
      path: true,
      mediaType: true,
      videoMetadata: {
        select: {
          duration: true
        }
      }
    }
  })
  if (!image) throw new VideoKeyframePermanentError('IMAGE_NOT_FOUND', 'Image not found')
  if (String(image.mediaType).toUpperCase() !== 'VIDEO' && !isVideoFile(image.path)) {
    throw new VideoKeyframePermanentError('NOT_A_VIDEO', 'Image is not a video')
  }

  const sourcePath = await resolveExistingPathWithinRoot(scanPath, image.path.replace(/^[/\\]+/, ''))
  const stat = await fs.stat(sourcePath)
  if (!stat.isFile()) throw new Error('Video path is not a file')

  return {
    ...image,
    sourcePath,
    fingerprint: sourceFingerprintFromStat(stat)
  }
}

export async function generateVideoKeyframes(options: {
  jobId: string
  attempt: number
  imageId: number
  scanPath: string
  ffmpegThreads: number
  signal?: AbortSignal
  onProgress?: (progress: VideoKeyframeProgress) => Promise<void> | void
}): Promise<VideoKeyframeGenerationResult> {
  const report = (percentage: number, message: string) => options.onProgress?.({ percentage, message })
  await report(1, '正在校验视频和源文件指纹...')

  const target = await resolveVideoKeyframeTarget(options.imageId, options.scanPath)
  const duration = await probeVideoDuration(target.sourcePath, options.signal)
  const targetCount = getVideoKeyframeTargetCount(duration)
  if (targetCount <= 0) throw new VideoKeyframePermanentError('INVALID_DURATION', 'Video duration is unavailable')
  const candidateTimes = buildVideoKeyframeCandidateTimes(duration, targetCount)
  if (candidateTimes.length === 0) {
    throw new VideoKeyframePermanentError('NO_CANDIDATES', 'No keyframe candidate timestamps could be generated')
  }

  const alreadyPublished = await resolveAlreadyPublishedJobResult({
    jobId: options.jobId,
    imageId: target.id,
    path: target.path,
    fingerprint: target.fingerprint,
    duration,
    targetCount
  })
  if (alreadyPublished) {
    await report(100, alreadyPublished.warning || `代表帧已经发布：${alreadyPublished.publishedCount} 张`)
    return alreadyPublished
  }

  const set = await getOrCreateStagingSet({
    jobId: options.jobId,
    imageId: target.id,
    fingerprint: target.fingerprint,
    duration,
    targetCount,
    candidateTimes
  })
  const setDirectory = resolveKeyframeSetDirectory(target.id, set.id)
  await fs.mkdir(setDirectory, { recursive: true })

  const frames = await prisma.mediaVideoKeyframe.findMany({
    where: { setId: set.id },
    orderBy: { candidateIndex: 'asc' }
  })
  await repairInvalidCompletedFrameCheckpoints(frames)
  let completed = frames.filter((frame) => frame.status === 'COMPLETED' || frame.status === 'REJECTED').length

  for (const frame of frames) {
    throwIfAborted(options.signal)
    if (frame.status === 'COMPLETED' || frame.status === 'REJECTED') continue

    const relativePath = `${target.id}/${set.id}/${String(frame.candidateIndex).padStart(3, '0')}.webp`
    const outputPath = resolveDerivedMediaStoragePath(VIDEO_KEYFRAME_STORAGE_ROOT, relativePath)
    const temporaryPath = `${outputPath}.tmp.webp`

    // 工作进程可能在文件落盘后、保存候选检查点前中断。
    // 暂存文件未对外发布，因此需要重新生成。
    await fs.rm(outputPath, { force: true }).catch(() => undefined)

    await prisma.mediaVideoKeyframe.update({
      where: { id: frame.id },
      data: { status: 'GENERATING', error: null, rejectionReason: null }
    })

    try {
      await extractVideoFrame({
        sourcePath: target.sourcePath,
        outputPath: temporaryPath,
        captureTime: frame.captureTime,
        width: 640,
        threads: options.ffmpegThreads,
        signal: options.signal
      })
      const { metrics, rejectionReason } = await finalizeExtractedVideoKeyframeCandidate(temporaryPath, outputPath)

      await prisma.mediaVideoKeyframe.update({
        where: { id: frame.id },
        data: {
          status: rejectionReason ? 'REJECTED' : 'COMPLETED',
          path: rejectionReason ? null : relativePath,
          luma: metrics.luma,
          sharpness: metrics.sharpness,
          perceptualHash: metrics.perceptualHash,
          rejectionReason,
          error: null
        }
      })
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      if (error instanceof VideoKeyframeControlError) {
        await prisma.mediaVideoKeyframe.update({
          where: { id: frame.id },
          data: { status: 'PENDING', error: null }
        })
        throw error
      }
      const message = error instanceof Error ? error.message : 'Unknown keyframe extraction error'
      await prisma.mediaVideoKeyframe.update({
        where: { id: frame.id },
        data: { status: 'FAILED', error: message }
      })
    }

    completed += 1
    await prisma.mediaVideoKeyframeSet.update({
      where: { id: set.id },
      data: { completedCandidates: completed }
    })
    const percentage = Math.min(90, 5 + Math.floor((completed / frames.length) * 85))
    await report(percentage, `正在抽取候选帧 ${completed}/${frames.length}`)
  }

  throwIfAborted(options.signal)
  await report(92, '正在筛选代表帧...')
  const completedFrames = await prisma.mediaVideoKeyframe.findMany({
    where: { setId: set.id, status: 'COMPLETED', path: { not: null } },
    orderBy: { candidateIndex: 'asc' }
  })
  const selected = selectRepresentativeKeyframes(
    completedFrames.flatMap((frame) =>
      frame.path && frame.luma !== null && frame.sharpness !== null && frame.perceptualHash
        ? [
            {
              candidateIndex: frame.candidateIndex,
              captureTime: frame.captureTime,
              path: frame.path,
              luma: frame.luma,
              sharpness: frame.sharpness,
              perceptualHash: frame.perceptualHash
            }
          ]
        : []
    ),
    targetCount
  )

  const failedCandidates = await prisma.mediaVideoKeyframe.count({ where: { setId: set.id, status: 'FAILED' } })
  const selectionWarning = getVideoKeyframeSelectionWarning(selected.length, targetCount, failedCandidates)

  const selectedIndexes = new Map(selected.map((frame, index) => [frame.candidateIndex, index]))

  const finalStat = await fs.stat(target.sourcePath)
  const finalFingerprint = sourceFingerprintFromStat(finalStat)
  if (!sameSourceFingerprint(target.fingerprint, finalFingerprint)) {
    throw new Error('Source video changed during keyframe generation')
  }
  await verifySelectedKeyframeFiles(selected)
  throwIfAborted(options.signal)

  const publishStat = await fs.stat(target.sourcePath)
  if (!sameSourceFingerprint(target.fingerprint, sourceFingerprintFromStat(publishStat))) {
    throw new Error('Source video changed before keyframe publication')
  }
  await verifySelectedKeyframeFiles(selected)

  const warning = selectionWarning
  const publishedResult: VideoKeyframeGenerationResult = {
    imageId: target.id,
    setId: set.id,
    path: target.path,
    duration,
    targetCount,
    publishedCount: selected.length,
    warning
  }
  const previousSets = await prisma.mediaVideoKeyframeSet.findMany({
    where: { imageId: target.id, status: 'PUBLISHED', id: { not: set.id } },
    select: { id: true }
  })

  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_KEYFRAME_QUEUE_LOCK_ID)
    const leaseUpdate = await tx.systemJob.updateMany({
      where: {
        id: options.jobId,
        type: 'VIDEO_KEYFRAME_GENERATION',
        status: 'RUNNING',
        targetImageId: target.id,
        attempt: options.attempt
      },
      data: {
        status: 'COMPLETED',
        progress: 100,
        message: '视频代表帧生成完成',
        result: publishedResult,
        error: null,
        finishedAt: new Date(),
        heartbeatAt: new Date()
      }
    })
    if (leaseUpdate.count !== 1) {
      throw new VideoKeyframeControlError('LEASE_LOST', 'Video keyframe job is no longer publishable')
    }
    await tx.mediaVideoKeyframe.updateMany({
      where: {
        setId: set.id,
        status: 'COMPLETED',
        candidateIndex: { notIn: [...selectedIndexes.keys()] }
      },
      data: { status: 'REJECTED', selectedOrder: null, rejectionReason: 'NOT_SELECTED' }
    })
    for (const frame of selected) {
      await tx.mediaVideoKeyframe.updateMany({
        where: { setId: set.id, candidateIndex: frame.candidateIndex, status: 'COMPLETED' },
        data: { selectedOrder: selectedIndexes.get(frame.candidateIndex)!, rejectionReason: null }
      })
    }
    await tx.mediaVideoKeyframeSet.updateMany({
      where: { imageId: target.id, status: 'PUBLISHED', id: { not: set.id } },
      data: { status: 'FAILED', error: 'Superseded by a newer published generation' }
    })
    await tx.mediaVideoKeyframeSet.update({
      where: { id: set.id },
      data: {
        status: 'PUBLISHED',
        publishedCount: selected.length,
        warning,
        error: null,
        publishedAt: new Date()
      }
    })
  })

  await cleanupUnselectedKeyframeFiles(set.id)
  for (const previous of previousSets) {
    await removeKeyframeSetDirectory(target.id, previous.id).catch(() => undefined)
    await prisma.mediaVideoKeyframeSet.delete({ where: { id: previous.id } }).catch(() => undefined)
  }

  return publishedResult
}

export async function getPublishedVideoKeyframes(imageId: number) {
  const set = await prisma.mediaVideoKeyframeSet.findFirst({
    where: { imageId, status: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    include: {
      frames: {
        where: { selectedOrder: { not: null }, status: 'COMPLETED', path: { not: null } },
        orderBy: { selectedOrder: 'asc' }
      }
    }
  })
  if (!set) return null

  return {
    id: set.id,
    imageId: set.imageId,
    targetCount: set.targetCount,
    publishedCount: set.publishedCount,
    warning: set.warning,
    publishedAt: set.publishedAt,
    frames: set.frames.flatMap((frame) =>
      frame.path
        ? [
            {
              id: frame.id,
              captureTime: frame.captureTime,
              selectedOrder: frame.selectedOrder,
              url: buildDerivedMediaPublicUrl('VIDEO_KEYFRAME', frame.path, frame.updatedAt)
            }
          ]
        : []
    )
  }
}

export async function regenerateManualVideoPoster(options: {
  imageId: number
  scanPath: string
  captureTime: number
  expectedManualPosterTimestamp?: number
  ffmpegThreads: number
  signal?: AbortSignal
}) {
  const target = await resolveVideoKeyframeTarget(options.imageId, options.scanPath)
  const ownsSelection = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1, $2)::text', VIDEO_POSTER_LOCK_NAMESPACE, target.id)
    if (options.expectedManualPosterTimestamp !== undefined) {
      const current = await tx.mediaVideoMetadata.findUnique({
        where: { imageId: target.id },
        select: { manualPosterTimestamp: true }
      })
      return current?.manualPosterTimestamp === options.expectedManualPosterTimestamp
    }
    const current = await tx.mediaVideoMetadata.findUnique({
      where: { imageId: target.id },
      select: { posterPath: true }
    })
    if (current) {
      await tx.mediaVideoMetadata.update({
        where: { imageId: target.id },
        data: {
          manualPosterTimestamp: options.captureTime,
          manualPosterWarning: null,
          posterStatus: current.posterPath ? 'COMPLETED' : 'PENDING',
          posterError: null
        }
      })
    } else {
      await tx.mediaVideoMetadata.create({
        data: { imageId: target.id, manualPosterTimestamp: options.captureTime, posterStatus: 'PENDING' }
      })
    }
    return true
  })
  if (!ownsSelection) {
    return { imageId: target.id, posterPath: null, captureTime: options.captureTime, skipped: true }
  }

  const digest = `${target.fingerprint.size.toString()}-${target.fingerprint.mtimeMs.toString()}`
  const captureKey = Math.max(0, Math.round(options.captureTime * 1000))
  const relativePath = `${target.id}-manual-${digest}-${captureKey}-${randomUUID()}.webp`
  const outputPath = resolveDerivedMediaStoragePath(VIDEO_POSTER_STORAGE_ROOT, relativePath)
  const temporaryPath = `${outputPath}.tmp.webp`
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  try {
    await extractVideoFrame({
      sourcePath: target.sourcePath,
      outputPath: temporaryPath,
      captureTime: options.captureTime,
      width: 960,
      threads: options.ffmpegThreads,
      signal: options.signal
    })
    await validateWebp(temporaryPath)
    const finalStat = await fs.stat(target.sourcePath)
    if (!sameSourceFingerprint(target.fingerprint, sourceFingerprintFromStat(finalStat))) {
      throw new Error('Source video changed during poster generation')
    }
    const posterData = {
      posterStatus: 'COMPLETED' as const,
      posterPath: relativePath,
      posterUpdatedAt: new Date(),
      posterError: null,
      manualPosterTimestamp: options.captureTime,
      manualPosterSourceSize: target.fingerprint.size,
      manualPosterSourceMtimeMs: target.fingerprint.mtimeMs,
      manualPosterWarning: null
    }
    let previousPosterPath: string | null = null
    const published = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1, $2)::text', VIDEO_POSTER_LOCK_NAMESPACE, target.id)
      const current = await tx.mediaVideoMetadata.findUnique({
        where: { imageId: target.id },
        select: { posterPath: true, manualPosterTimestamp: true }
      })
      if (current?.manualPosterTimestamp !== options.captureTime) return false
      previousPosterPath = current.posterPath
      await fs.rename(temporaryPath, outputPath)
      const updated = await tx.mediaVideoMetadata.updateMany({
        where: { imageId: target.id, manualPosterTimestamp: options.captureTime },
        data: posterData
      })
      if (updated.count !== 1) throw new Error('Manual poster ownership was lost')
      return true
    })
    if (!published) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      return { imageId: target.id, posterPath: null, captureTime: options.captureTime, skipped: true }
    }
    if (previousPosterPath && previousPosterPath !== relativePath) {
      await fs
        .rm(resolveDerivedMediaStoragePath(VIDEO_POSTER_STORAGE_ROOT, previousPosterPath), { force: true })
        .catch(() => undefined)
    }
    return { imageId: target.id, posterPath: relativePath, captureTime: options.captureTime }
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    const message = error instanceof Error ? error.message : 'Unknown poster generation error'
    await prisma.mediaVideoMetadata.updateMany({
      where: { imageId: target.id, manualPosterTimestamp: options.captureTime },
      data: { manualPosterWarning: message }
    })
    throw error
  }
}

export async function removeJobStagingSet(jobId: string) {
  const set = await prisma.mediaVideoKeyframeSet.findUnique({
    where: { systemJobId: jobId },
    select: { id: true, imageId: true, status: true }
  })
  if (!set || set.status === 'PUBLISHED') return
  await removeKeyframeSetDirectory(set.imageId, set.id)
  await prisma.mediaVideoKeyframeSet.delete({ where: { id: set.id } }).catch(() => undefined)
}

export function sourceFingerprintFromStat(stat: { size: number; mtimeMs: number }): VideoKeyframeSourceFingerprint {
  return { size: BigInt(stat.size), mtimeMs: BigInt(Math.round(stat.mtimeMs)) }
}

export function sameSourceFingerprint(left: VideoKeyframeSourceFingerprint, right: VideoKeyframeSourceFingerprint) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs
}

async function resolveAlreadyPublishedJobResult(input: {
  jobId: string
  imageId: number
  path: string
  fingerprint: VideoKeyframeSourceFingerprint
  duration: number
  targetCount: number
}): Promise<VideoKeyframeGenerationResult | null> {
  const set = await prisma.mediaVideoKeyframeSet.findUnique({
    where: { systemJobId: input.jobId },
    include: {
      frames: {
        where: { status: 'COMPLETED', selectedOrder: { not: null }, path: { not: null } }
      }
    }
  })
  if (
    !set ||
    set.status !== 'PUBLISHED' ||
    set.imageId !== input.imageId ||
    set.sourceSize !== input.fingerprint.size ||
    set.sourceMtimeMs !== input.fingerprint.mtimeMs ||
    set.policyVersion !== VIDEO_KEYFRAME_POLICY_VERSION
  ) {
    return null
  }

  const allFilesExist = await Promise.all(set.frames.flatMap((frame) => (frame.path ? [isValidWebp(frame.path)] : [])))
  if (set.frames.length !== set.publishedCount || allFilesExist.some((exists) => !exists)) return null

  return {
    imageId: input.imageId,
    setId: set.id,
    path: input.path,
    duration: input.duration,
    targetCount: input.targetCount,
    publishedCount: set.publishedCount,
    warning: set.warning
  }
}

async function getOrCreateStagingSet(input: {
  jobId: string
  imageId: number
  fingerprint: VideoKeyframeSourceFingerprint
  duration: number
  targetCount: number
  candidateTimes: number[]
}) {
  const existing = await prisma.mediaVideoKeyframeSet.findUnique({
    where: { systemJobId: input.jobId }
  })
  if (
    existing &&
    existing.status === 'STAGING' &&
    existing.sourceSize === input.fingerprint.size &&
    existing.sourceMtimeMs === input.fingerprint.mtimeMs &&
    existing.policyVersion === VIDEO_KEYFRAME_POLICY_VERSION
  ) {
    await prisma.mediaVideoKeyframe.updateMany({
      where: { setId: existing.id, status: 'REJECTED', rejectionReason: 'NOT_SELECTED', path: { not: null } },
      data: { status: 'COMPLETED', selectedOrder: null, rejectionReason: null, error: null }
    })
    await prisma.mediaVideoKeyframe.updateMany({
      where: { setId: existing.id, status: { in: ['GENERATING', 'FAILED'] } },
      data: { status: 'PENDING', error: null }
    })
    return existing
  }

  if (existing) {
    await removeKeyframeSetDirectory(existing.imageId, existing.id)
    await prisma.mediaVideoKeyframeSet.delete({ where: { id: existing.id } })
  }

  const obsoleteSets = await prisma.mediaVideoKeyframeSet.findMany({
    where: { imageId: input.imageId, status: { in: ['FAILED', 'CANCELLED'] } },
    select: { id: true, imageId: true }
  })
  for (const obsolete of obsoleteSets) {
    await removeKeyframeSetDirectory(obsolete.imageId, obsolete.id)
    await prisma.mediaVideoKeyframeSet.delete({ where: { id: obsolete.id } })
  }

  return prisma.mediaVideoKeyframeSet.create({
    data: {
      imageId: input.imageId,
      systemJobId: input.jobId,
      status: 'STAGING',
      sourceSize: input.fingerprint.size,
      sourceMtimeMs: input.fingerprint.mtimeMs,
      policyVersion: VIDEO_KEYFRAME_POLICY_VERSION,
      duration: input.duration,
      targetCount: input.targetCount,
      candidateCount: input.candidateTimes.length,
      frames: {
        create: input.candidateTimes.map((captureTime, candidateIndex) => ({ candidateIndex, captureTime }))
      }
    }
  })
}

export async function probeVideoDuration(sourcePath: string, signal?: AbortSignal) {
  const output = await runProcess(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', sourcePath],
    { timeoutMs: PROBE_TIMEOUT_MS, signal }
  )
  return parseProbedVideoDuration(output.stdout)
}

export function parseProbedVideoDuration(stdout: string) {
  const duration = Number(stdout.trim())
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new VideoKeyframePermanentError('INVALID_DURATION', 'FFprobe returned an invalid video duration')
  }
  return duration
}

export function getVideoKeyframeSelectionWarning(selectedCount: number, targetCount: number, failedCandidates: number) {
  if (selectedCount <= 0) {
    const message = `没有候选帧通过质量检查（目标 ${targetCount} 张）`
    if (failedCandidates > 0) throw new Error(`${message}，另有 ${failedCandidates} 个候选帧抽取失败`)
    throw new VideoKeyframePermanentError('INSUFFICIENT_DISTINCT_FRAMES', message)
  }
  const warningParts = [
    ...(selectedCount < targetCount ? [`仅生成 ${selectedCount}/${targetCount} 张有效代表帧`] : []),
    ...(failedCandidates > 0 ? [`${failedCandidates} 个候选帧抽取失败`] : [])
  ]
  return warningParts.length > 0 ? warningParts.join('；') : null
}

async function repairInvalidCompletedFrameCheckpoints(
  frames: Array<{ id: string; status: string; path: string | null }>
) {
  for (const frame of frames) {
    if (frame.status !== 'COMPLETED') continue
    const valid = frame.path ? await isValidWebp(frame.path) : false
    if (valid) continue
    if (frame.path) await removeKeyframeFile(frame.path)
    await prisma.mediaVideoKeyframe.update({
      where: { id: frame.id },
      data: {
        status: 'PENDING',
        path: null,
        luma: null,
        sharpness: null,
        perceptualHash: null,
        selectedOrder: null,
        rejectionReason: null,
        error: null
      }
    })
    frame.status = 'PENDING'
    frame.path = null
  }
}

async function verifySelectedKeyframeFiles(selected: Array<{ path: string }>) {
  for (const frame of selected) {
    if (!(await isValidWebp(frame.path))) throw new Error(`Selected keyframe is missing or invalid: ${frame.path}`)
  }
}

async function isValidWebp(relativePath: string) {
  return validateWebpWithRetry(resolveDerivedMediaStoragePath(VIDEO_KEYFRAME_STORAGE_ROOT, relativePath))
    .then(() => true)
    .catch(() => false)
}

async function extractVideoFrame(input: {
  sourcePath: string
  outputPath: string
  captureTime: number
  width: number
  threads: number
  signal?: AbortSignal
}) {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true })
  await runProcess('ffmpeg', buildVideoFrameExtractionArgs(input), {
    timeoutMs: FRAME_TIMEOUT_MS,
    signal: input.signal
  })
}

export function buildVideoFrameExtractionArgs(input: {
  sourcePath: string
  outputPath: string
  captureTime: number
  width: number
  threads: number
}) {
  return [
    '-nostdin',
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    input.captureTime.toFixed(3),
    '-threads',
    String(input.threads),
    '-i',
    input.sourcePath,
    '-frames:v',
    '1',
    '-filter_threads',
    String(input.threads),
    '-vf',
    `scale='min(${input.width},iw)':-2`,
    '-threads',
    String(input.threads),
    '-c:v',
    'libwebp',
    '-q:v',
    '80',
    input.outputPath
  ]
}

async function validateWebp(filePath: string) {
  const metadata = await sharp(filePath).metadata()
  if (metadata.format !== 'webp' || !metadata.width || !metadata.height) {
    throw new Error('FFmpeg produced an invalid WebP frame')
  }
}

async function validateWebpWithRetry(filePath: string) {
  const retryDelays = [0, 100, 500, 2_000]
  let lastError: unknown
  for (const delay of retryDelays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      await validateWebp(filePath)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function calculateFrameMetrics(filePath: string) {
  const { data, info } = await sharp(filePath)
    .resize(32, 32, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const values = [...data]
  const luma = values.reduce((sum, value) => sum + value, 0) / values.length
  let gradient = 0
  let gradientCount = 0
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = y * info.width + x
      if (x + 1 < info.width) {
        gradient += Math.abs(values[index]! - values[index + 1]!)
        gradientCount += 1
      }
      if (y + 1 < info.height) {
        gradient += Math.abs(values[index]! - values[index + info.width]!)
        gradientCount += 1
      }
    }
  }
  const sharpness = gradientCount > 0 ? gradient / gradientCount : 0
  const hashBits: string[] = []
  for (let y = 2; y < 32; y += 4) {
    for (let x = 2; x < 32; x += 4) {
      hashBits.push(values[y * 32 + x]! >= luma ? '1' : '0')
    }
  }
  let perceptualHash = ''
  for (let index = 0; index < hashBits.length; index += 4) {
    perceptualHash += Number.parseInt(hashBits.slice(index, index + 4).join(''), 2).toString(16)
  }
  return { luma, sharpness, perceptualHash }
}

export async function finalizeExtractedVideoKeyframeCandidate(temporaryPath: string, outputPath: string) {
  // Docker Desktop 在 Windows 的绑定挂载场景可能返回重命名成功，
  // 但目标路径可能暂时缺失或暂不可解码。应先检查已完整写入的临时文件，
  // 再将接收的字节复制到未发布的最终路径，并在保存 DB 检查点前校验该副本。
  await validateWebp(temporaryPath)
  const metrics = await calculateFrameMetrics(temporaryPath)
  const rejectionReason = classifyQualityRejection(metrics)
  if (rejectionReason) await fs.rm(temporaryPath, { force: true })
  else {
    await fs.copyFile(temporaryPath, outputPath)
    try {
      await validateWebpWithRetry(outputPath)
    } catch (error) {
      await fs.rm(outputPath, { force: true }).catch(() => undefined)
      throw error
    }
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
  return { metrics, rejectionReason }
}

function classifyQualityRejection(metrics: { luma: number; sharpness: number }) {
  if (metrics.luma < 8) return 'TOO_DARK'
  if (metrics.luma > 247) return 'TOO_BRIGHT'
  if (metrics.sharpness < 4) return 'LOW_INFORMATION'
  return null
}

function resolveKeyframeSetDirectory(imageId: number, setId: string) {
  return resolveDerivedMediaStoragePath(VIDEO_KEYFRAME_STORAGE_ROOT, `${imageId}/${setId}`)
}

async function removeKeyframeSetDirectory(imageId: number, setId: string) {
  await fs.rm(resolveKeyframeSetDirectory(imageId, setId), { recursive: true, force: true })
}

async function removeKeyframeFile(relativePath: string) {
  await fs
    .rm(resolveDerivedMediaStoragePath(VIDEO_KEYFRAME_STORAGE_ROOT, relativePath), { force: true })
    .catch(() => undefined)
}

async function cleanupUnselectedKeyframeFiles(setId: string) {
  const discarded = await prisma.mediaVideoKeyframe.findMany({
    where: { setId, selectedOrder: null, path: { not: null } },
    select: { id: true, path: true }
  })
  for (const frame of discarded) {
    if (!frame.path) continue
    const removed = await fs
      .rm(resolveDerivedMediaStoragePath(VIDEO_KEYFRAME_STORAGE_ROOT, frame.path), { force: true })
      .then(() => true)
      .catch(() => false)
    if (removed) {
      await prisma.mediaVideoKeyframe.update({ where: { id: frame.id }, data: { path: null } })
    }
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof VideoKeyframeControlError) throw signal.reason
  throw new VideoKeyframeControlError('SHUTDOWN', 'Keyframe worker is shutting down')
}

function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    throwIfAborted(options.signal)
    const child = childProcess.spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    let terminationError: Error | null = null
    let killTimeout: NodeJS.Timeout | null = null

    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString()}`.slice(-MAX_PROCESS_OUTPUT_BYTES)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })

    const cleanup = () => {
      clearTimeout(timeout)
      if (killTimeout) clearTimeout(killTimeout)
      options.signal?.removeEventListener('abort', onAbort)
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve({ stdout, stderr })
    }
    const terminate = (error: Error) => {
      if (settled || terminationError) return
      terminationError = error
      if (!child.killed && child.kill('SIGKILL')) {
        killTimeout = setTimeout(() => finish(error), 5_000)
        killTimeout.unref()
        return
      }
      finish(error)
    }
    const onAbort = () => {
      const reason = options.signal?.reason
      terminate(
        reason instanceof VideoKeyframeControlError
          ? reason
          : new VideoKeyframeControlError('SHUTDOWN', 'Keyframe worker is shutting down')
      )
    }
    const timeout = setTimeout(() => terminate(new Error(`${command} timed out`)), options.timeoutMs)
    timeout.unref()
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (settled) return
      if (terminationError) finish(terminationError)
      else if (code === 0) finish()
      else finish(new Error(stderr.trim() || `${command} exited with code ${code}`))
    })
  })
}
