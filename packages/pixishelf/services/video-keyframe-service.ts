import { buildDerivedMediaPublicUrl } from '@/lib/derived-media'
import { isVideoFile } from '@/lib/media'
import { prisma } from '@/lib/prisma'
import { resolveExistingPathWithinRoot } from '@/lib/safe-path'
import { resolveDerivedMediaStoragePath, VIDEO_POSTER_STORAGE_ROOT } from '@/services/derived-media-storage-paths'
import { VIDEO_POSTER_LOCK_NAMESPACE } from '@/services/video-poster-lock'
import * as childProcess from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

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
    await lockVideoPosterForKeyframe(tx, target.id)
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
      await lockVideoPosterForKeyframe(tx, target.id)
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

export async function lockVideoPosterForKeyframe(
  transaction: { $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown> },
  imageId: number
) {
  await transaction.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock($1::integer, $2::integer)::text',
    VIDEO_POSTER_LOCK_NAMESPACE,
    imageId
  )
}

export function sourceFingerprintFromStat(stat: { size: number; mtimeMs: number }): VideoKeyframeSourceFingerprint {
  return { size: BigInt(stat.size), mtimeMs: BigInt(Math.round(stat.mtimeMs)) }
}

export function sameSourceFingerprint(left: VideoKeyframeSourceFingerprint, right: VideoKeyframeSourceFingerprint) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs
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
