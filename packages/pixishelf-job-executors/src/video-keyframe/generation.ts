import * as fs from 'node:fs/promises'
import { videoKeyframeGenerationPayloadSchema } from '@pixishelf/job-contracts'
import { extractVideoFrame, isValidWebp, probeVideoDuration } from './media-process.js'
import { resolveKeyframePath, resolveSourceFile } from './paths.js'
import {
  buildVideoKeyframeCandidateTimes,
  getVideoKeyframeTargetCount,
  selectRepresentativeKeyframes,
  VIDEO_KEYFRAME_POLICY_VERSION
} from './policy.js'
import type {
  RunFencedMutation,
  VideoKeyframeDatabase,
  VideoKeyframeGenerationResult,
  VideoKeyframeProgress,
  VideoKeyframeRuntimeConfig,
  VideoKeyframeTransaction
} from './types.js'
import { VideoKeyframePermanentError, VideoKeyframeProcessError } from './types.js'

const DEFAULT_FRAME_TIMEOUT_MS = 2 * 60 * 1_000
const DEFAULT_PROBE_TIMEOUT_MS = 2 * 60 * 1_000
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.wmv', '.flv'])

export type VideoKeyframeGenerationPayload = ReturnType<typeof videoKeyframeGenerationPayloadSchema.parse>

export interface PreparedVideoKeyframePublication {
  result: VideoKeyframeGenerationResult
  publish(transaction: VideoKeyframeTransaction): Promise<void>
}

export async function generateVideoKeyframes(input: {
  jobId: string
  payload: VideoKeyframeGenerationPayload
  database: VideoKeyframeDatabase
  mutate: RunFencedMutation
  config: VideoKeyframeRuntimeConfig
  signal: AbortSignal
  progress(update: VideoKeyframeProgress): Promise<void>
}): Promise<PreparedVideoKeyframePublication> {
  await input.progress({ percentage: 1, stage: 'VALIDATING', message: '正在校验视频和源文件指纹...' })
  const image = await input.database.image.findUnique({
    where: { id: input.payload.imageId },
    select: { id: true, path: true, mediaType: true }
  })
  if (!image) throw new VideoKeyframePermanentError('IMAGE_NOT_FOUND', 'Image not found')
  if (!isVideo(image.mediaType, image.path))
    throw new VideoKeyframePermanentError('NOT_A_VIDEO', 'Image is not a video')
  if (normalizeRelativePath(image.path) !== normalizeRelativePath(input.payload.relativePath)) {
    throw new VideoKeyframePermanentError('IMAGE_NOT_FOUND', 'Image path changed after the job was queued')
  }
  const source = await resolveSourceFile(input.config.scanRoot, image.path)
  const fingerprint = sourceFingerprint(source.stat)
  const duration = await probeVideoDuration({
    sourcePath: source.sourcePath,
    ...(input.config.ffprobePath ? { ffprobePath: input.config.ffprobePath } : {}),
    timeoutMs: input.config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    signal: input.signal
  })
  const targetCount = getVideoKeyframeTargetCount(duration)
  if (targetCount <= 0) throw new VideoKeyframePermanentError('INVALID_DURATION', 'Video duration is unavailable')
  const candidateTimes = buildVideoKeyframeCandidateTimes(duration, targetCount)
  if (candidateTimes.length === 0) {
    throw new VideoKeyframePermanentError('NO_CANDIDATES', 'No keyframe candidate timestamps could be generated')
  }
  const set = await getOrCreateStagingSet({
    database: input.database,
    mutate: input.mutate,
    jobId: input.jobId,
    imageId: image.id,
    fingerprint,
    duration,
    targetCount,
    candidateTimes
  })
  let frames = await input.database.mediaVideoKeyframe.findMany({
    where: { setId: set.id },
    orderBy: { candidateIndex: 'asc' }
  })
  await repairInvalidCheckpoints(frames, input.config.keyframeStorageRoot, input.mutate)
  frames = await input.database.mediaVideoKeyframe.findMany({
    where: { setId: set.id },
    orderBy: { candidateIndex: 'asc' }
  })
  let completed = frames.filter((frame) => frame.status === 'COMPLETED' || frame.status === 'REJECTED').length
  let lastCandidateError: unknown

  for (const frame of frames) {
    throwIfAborted(input.signal)
    if (frame.status === 'COMPLETED' || frame.status === 'REJECTED') continue
    const relativePath = `${image.id}/${set.id}/${String(frame.candidateIndex).padStart(3, '0')}.webp`
    const outputPath = await resolveKeyframePath(input.config.keyframeStorageRoot, relativePath)
    const temporaryPath = `${outputPath}.tmp.webp`
    await input.mutate(async (transaction) => {
      await transaction.mediaVideoKeyframe.update({
        where: { id: frame.id },
        data: { status: 'GENERATING', error: null, rejectionReason: null }
      })
    })
    try {
      const extracted = await extractVideoFrame({
        sourcePath: source.sourcePath,
        temporaryPath,
        outputPath,
        captureTime: frame.captureTime,
        threads: input.config.ffmpegThreads,
        ...(input.config.ffmpegPath ? { ffmpegPath: input.config.ffmpegPath } : {}),
        timeoutMs: input.config.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS,
        signal: input.signal
      })
      await input.mutate(async (transaction) => {
        await transaction.mediaVideoKeyframe.update({
          where: { id: frame.id },
          data: {
            status: extracted.rejectionReason ? 'REJECTED' : 'COMPLETED',
            path: extracted.rejectionReason ? null : relativePath,
            luma: extracted.metrics.luma,
            sharpness: extracted.metrics.sharpness,
            perceptualHash: extracted.metrics.perceptualHash,
            rejectionReason: extracted.rejectionReason,
            error: null
          }
        })
      })
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      if (input.signal.aborted) throw error
      lastCandidateError = error
      await input.mutate(async (transaction) => {
        await transaction.mediaVideoKeyframe.update({
          where: { id: frame.id },
          data: { status: 'FAILED', error: error instanceof Error ? error.message : 'Unknown frame extraction error' }
        })
      })
    }
    completed += 1
    await input.mutate(async (transaction) => {
      await transaction.mediaVideoKeyframeSet.update({
        where: { id: set.id },
        data: { completedCandidates: completed }
      })
    })
    await input.progress({
      percentage: Math.min(90, 5 + Math.floor((completed / frames.length) * 85)),
      stage: 'EXTRACTING',
      message: `正在抽取候选帧 ${completed}/${frames.length}`,
      data: { completed, total: frames.length }
    })
  }

  throwIfAborted(input.signal)
  await input.progress({ percentage: 92, stage: 'SELECTING', message: '正在筛选代表帧...' })
  const completedFrames = await input.database.mediaVideoKeyframe.findMany({
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
  const failedCandidates = await input.database.mediaVideoKeyframe.count({
    where: { setId: set.id, status: 'FAILED' }
  })
  if (selected.length === 0 && failedCandidates > 0) {
    throw new VideoKeyframeProcessError('EXTERNAL_PROCESS_FAILED', 'All video keyframe candidates failed')
  }
  const warning = selectionWarning(selected.length, targetCount, failedCandidates, lastCandidateError)
  const finalSource = await fs.stat(source.sourcePath)
  if (!sameFingerprint(fingerprint, sourceFingerprint(finalSource))) {
    throw new Error('Source video changed during keyframe generation')
  }
  for (const frame of selected) {
    if (!(await isValidWebp(await resolveKeyframePath(input.config.keyframeStorageRoot, frame.path)))) {
      throw new Error(`Selected keyframe is missing or invalid: ${frame.path}`)
    }
  }
  throwIfAborted(input.signal)

  const result: VideoKeyframeGenerationResult = {
    imageId: image.id,
    setId: set.id,
    path: image.path,
    duration,
    targetCount,
    publishedCount: selected.length,
    warning,
    deferredCleanup: true,
    posterRegeneration: 'NOT_REQUESTED'
  }
  const selectedOrders = new Map(selected.map((frame, index) => [frame.candidateIndex, index]))
  return {
    result,
    publish: async (transaction) => {
      await transaction.mediaVideoKeyframe.updateMany({
        where: { setId: set.id, status: 'COMPLETED', candidateIndex: { notIn: [...selectedOrders.keys()] } },
        data: { status: 'REJECTED', selectedOrder: null, rejectionReason: 'NOT_SELECTED' }
      })
      for (const frame of selected) {
        const updated = await transaction.mediaVideoKeyframe.updateMany({
          where: { setId: set.id, candidateIndex: frame.candidateIndex, status: 'COMPLETED' },
          data: { selectedOrder: selectedOrders.get(frame.candidateIndex)!, rejectionReason: null }
        })
        if (updated.count !== 1)
          throw new Error(`Keyframe checkpoint changed before publication: ${frame.candidateIndex}`)
      }
      await transaction.mediaVideoKeyframeSet.updateMany({
        where: { imageId: image.id, status: 'PUBLISHED', id: { not: set.id } },
        data: { status: 'FAILED', error: 'Superseded by a newer published generation' }
      })
      const published = await transaction.mediaVideoKeyframeSet.updateMany({
        where: {
          id: set.id,
          imageId: image.id,
          systemJobId: input.jobId,
          status: 'STAGING',
          sourceSize: fingerprint.size,
          sourceMtimeMs: fingerprint.mtimeMs
        },
        data: {
          status: 'PUBLISHED',
          publishedCount: selected.length,
          warning,
          error: null,
          publishedAt: new Date()
        }
      })
      if (published.count !== 1) throw new Error('Video keyframe staging set changed before publication')
    }
  }
}

async function getOrCreateStagingSet(input: {
  database: VideoKeyframeDatabase
  mutate: RunFencedMutation
  jobId: string
  imageId: number
  fingerprint: { size: bigint; mtimeMs: bigint }
  duration: number
  targetCount: number
  candidateTimes: number[]
}) {
  const existing = await input.database.mediaVideoKeyframeSet.findUnique({ where: { systemJobId: input.jobId } })
  if (
    existing?.status === 'STAGING' &&
    existing.sourceSize === input.fingerprint.size &&
    existing.sourceMtimeMs === input.fingerprint.mtimeMs &&
    existing.policyVersion === VIDEO_KEYFRAME_POLICY_VERSION
  ) {
    await input.mutate(async (transaction) => {
      await transaction.mediaVideoKeyframe.updateMany({
        where: { setId: existing.id, status: { in: ['GENERATING', 'FAILED'] } },
        data: { status: 'PENDING', error: null }
      })
      await transaction.mediaVideoKeyframe.updateMany({
        where: { setId: existing.id, status: 'REJECTED', rejectionReason: 'NOT_SELECTED', path: { not: null } },
        data: { status: 'COMPLETED', selectedOrder: null, rejectionReason: null, error: null }
      })
    })
    return existing
  }
  return input.mutate(async (transaction) => {
    if (existing) {
      await transaction.mediaVideoKeyframeSet.update({
        where: { id: existing.id },
        data: { systemJobId: null, status: 'CANCELLED', error: 'Source changed before the attempt resumed' }
      })
    }
    return transaction.mediaVideoKeyframeSet.create({
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
  })
}

async function repairInvalidCheckpoints(
  frames: Array<{ id: string; status: string; path: string | null }>,
  storageRoot: string,
  mutate: RunFencedMutation
) {
  for (const frame of frames) {
    if (frame.status !== 'COMPLETED') continue
    const valid = frame.path ? await isValidWebp(await resolveKeyframePath(storageRoot, frame.path)) : false
    if (valid) continue
    await mutate(async (transaction) => {
      await transaction.mediaVideoKeyframe.update({
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
    })
    frame.status = 'PENDING'
    frame.path = null
  }
}

function selectionWarning(
  selectedCount: number,
  targetCount: number,
  failedCandidates: number,
  lastCandidateError: unknown
) {
  if (selectedCount <= 0) {
    if (failedCandidates > 0 && lastCandidateError) throw lastCandidateError
    throw new VideoKeyframePermanentError(
      'INSUFFICIENT_DISTINCT_FRAMES',
      `没有候选帧通过质量检查（目标 ${targetCount} 张）${failedCandidates > 0 ? `，另有 ${failedCandidates} 个候选帧抽取失败` : ''}`
    )
  }
  const warnings = [
    ...(selectedCount < targetCount ? [`仅生成 ${selectedCount}/${targetCount} 张有效代表帧`] : []),
    ...(failedCandidates > 0 ? [`${failedCandidates} 个候选帧抽取失败`] : [])
  ]
  return warnings.length > 0 ? warnings.join('；') : null
}

function isVideo(mediaType: unknown, relativePath: string) {
  if (String(mediaType).toUpperCase() === 'VIDEO') return true
  const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase()
  return VIDEO_EXTENSIONS.has(extension)
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
}

function sourceFingerprint(stat: { size: number; mtimeMs: number }) {
  return { size: BigInt(stat.size), mtimeMs: BigInt(Math.round(stat.mtimeMs)) }
}

function sameFingerprint(left: { size: bigint; mtimeMs: bigint }, right: { size: bigint; mtimeMs: bigint }) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Video keyframe generation was interrupted')
}
