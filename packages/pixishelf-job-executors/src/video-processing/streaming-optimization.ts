import { constants as fsConstants } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { assertNoFinalSymlink, normalizeArtifactId, resolveCreatablePathWithinRoot } from './paths.js'
import { throwIfAborted } from './process-runner.js'
import type {
  RunFencedVideoMutation,
  VideoProcessingDatabase,
  VideoProcessingProgress,
  VideoProcessingRuntimeConfig,
  VideoProcessingTransaction,
  VideoProcessRunner
} from './types.js'
import { VideoProcessingPermanentError, VideoProcessingRecoveryError } from './types.js'

interface MediaStreamFingerprint {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  channels?: number
}

interface MediaFingerprint {
  streams?: MediaStreamFingerprint[]
  format?: { duration?: string }
}

export interface VideoStreamingOptimizationResult {
  imageId: number
  path: string
  originalSize: number
  optimizedSize: number
  savedBytes: number
  duration: number | null
  backupGcScheduled: true
}

export interface PreparedVideoStreamingOptimization {
  result: VideoStreamingOptimizationResult
  publish(transaction: VideoProcessingTransaction): Promise<void>
  rollback(): Promise<void>
  discard(): Promise<void>
}

export async function prepareVideoStreamingOptimization(input: {
  jobId: string
  systemJobId?: string
  attempt: number
  imageId: number
  relativePath: string
  database: VideoProcessingDatabase
  config: VideoProcessingRuntimeConfig
  processRunner: VideoProcessRunner
  signal: AbortSignal
  progress: (progress: VideoProcessingProgress) => Promise<void>
  mutate: RunFencedVideoMutation
  now?: () => Date
}): Promise<PreparedVideoStreamingOptimization> {
  const now = input.now ?? (() => new Date())
  const image = await input.database.image.findUnique({
    where: { id: input.imageId },
    select: { id: true, path: true, mediaType: true }
  })
  if (!image) throw new VideoProcessingPermanentError('IMAGE_NOT_FOUND', 'Video image was not found')
  if (normalizePath(image.path) !== normalizePath(input.relativePath)) {
    throw new VideoProcessingPermanentError('SOURCE_CHANGED', 'Queued video path no longer matches the image record')
  }
  if (image.mediaType !== 'VIDEO' && !isVideoPath(image.path)) {
    throw new VideoProcessingPermanentError('NOT_A_VIDEO', 'Image is not a video')
  }
  if (path.extname(image.path).toLowerCase() !== '.mp4') {
    throw new VideoProcessingPermanentError('UNSUPPORTED_CONTAINER', 'Only MP4 videos support streaming remux')
  }
  await input.progress({ percentage: 2, stage: 'VALIDATE', message: '正在校验视频路径' })
  const sourcePath = await resolveCreatablePathWithinRoot(input.config.scanRoot, image.path)
  await recoverPriorStreamingArtifacts(sourcePath, input.jobId, input.attempt)
  const sourceStat = await fs.stat(sourcePath)
  if (!sourceStat.isFile()) throw new VideoProcessingPermanentError('IMAGE_NOT_FOUND', 'Video path is not a file')
  try {
    await fs.access(path.dirname(sourcePath), fsConstants.W_OK)
  } catch {
    throw new VideoProcessingPermanentError('READ_ONLY_SOURCE', 'Video directory is read-only')
  }

  const operationId = normalizeArtifactId(`${input.jobId}-a${input.attempt}`)
  const artifacts = getStreamingArtifactPaths(sourcePath, operationId)
  await Promise.all([assertNoFinalSymlink(artifacts.temporaryPath), assertNoFinalSymlink(artifacts.backupPath)])
  const originalStat = await fs.stat(sourcePath)
  const temporaryRelativePath = `${normalizePath(image.path)}.pixishelf-remux-${operationId}.tmp.mp4`
  const backupRelativePath = `${normalizePath(image.path)}.pixishelf-remux-${operationId}.backup.mp4`
  await input.mutate((transaction) =>
    upsertStreamingGcIntent(transaction, {
      path: temporaryRelativePath,
      referenceId: String(image.id),
      jobId: input.systemJobId ?? null,
      reason: 'STREAMING_REMUX_TEMPORARY',
      notBefore: new Date(now().getTime() + 24 * 60 * 60_000)
    })
  )

  throwIfAborted(input.signal)
  await input.progress({ percentage: 8, stage: 'PROBE', message: '正在读取原视频流信息' })
  const sourceFingerprint = await probeMediaFingerprint({
    filePath: sourcePath,
    timeoutMs: input.config.probeTimeoutMs ?? 2 * 60_000,
    signal: input.signal,
    processRunner: input.processRunner,
    ...(input.config.ffprobePath ? { ffprobePath: input.config.ffprobePath } : {})
  })
  assertContainsVideoStream(sourceFingerprint, 'Source file')

  let progressBuffer = ''
  let lastProgress = 15
  let progressQueue = Promise.resolve()
  const duration = parseDuration(sourceFingerprint.format?.duration)
  await input.progress({ percentage: 15, stage: 'REMUX', message: '正在无损重新封装 MP4' })
  await input.processRunner({
    command: input.config.ffmpegPath ?? 'ffmpeg',
    args: buildStreamingRemuxArgs(sourcePath, artifacts.temporaryPath),
    timeoutMs: input.config.streamingProcessTimeoutMs ?? 2 * 60 * 60_000,
    signal: input.signal,
    onStdout: (chunk) => {
      progressBuffer += chunk
      const lines = progressBuffer.split(/\r?\n/)
      progressBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const [key, value] = line.split('=', 2)
        if (key !== 'out_time' || !value || !duration) continue
        const elapsed = parseFfmpegTimestamp(value)
        if (elapsed === null) continue
        const percentage = Math.min(80, Math.max(16, Math.floor(15 + (elapsed / duration) * 65)))
        if (percentage <= lastProgress) continue
        lastProgress = percentage
        progressQueue = progressQueue.then(() =>
          input.progress({ percentage, stage: 'REMUX', message: `正在无损重新封装 MP4 ${percentage}%` })
        )
      }
    }
  })
  await progressQueue
  throwIfAborted(input.signal)
  await input.progress({ percentage: 82, stage: 'VERIFY', message: '正在校验重新封装的视频' })
  const optimizedStat = await fs.stat(artifacts.temporaryPath)
  if (!optimizedStat.isFile() || optimizedStat.size <= 0) throw new Error('FFmpeg produced an empty output file')
  const optimizedFingerprint = await probeMediaFingerprint({
    filePath: artifacts.temporaryPath,
    timeoutMs: input.config.probeTimeoutMs ?? 2 * 60_000,
    signal: input.signal,
    processRunner: input.processRunner,
    ...(input.config.ffprobePath ? { ffprobePath: input.config.ffprobePath } : {})
  })
  assertCompatibleFingerprints(sourceFingerprint, optimizedFingerprint)
  await assertSourceUnchanged(sourcePath, originalStat)
  await fs.chmod(artifacts.temporaryPath, originalStat.mode)

  let swapStarted = false
  let published = false
  const result: VideoStreamingOptimizationResult = {
    imageId: image.id,
    path: image.path,
    originalSize: originalStat.size,
    optimizedSize: optimizedStat.size,
    savedBytes: originalStat.size - optimizedStat.size,
    duration: parseDuration(optimizedFingerprint.format?.duration),
    backupGcScheduled: true
  }
  return {
    result,
    async publish(transaction) {
      throwIfAborted(input.signal)
      await Promise.all([
        assertNoFinalSymlink(sourcePath),
        assertNoFinalSymlink(artifacts.temporaryPath),
        assertNoFinalSymlink(artifacts.backupPath)
      ])
      await assertSourceUnchanged(sourcePath, originalStat)
      await fs.rm(artifacts.backupPath, { force: true }).catch(() => undefined)
      await fs.rename(sourcePath, artifacts.backupPath)
      swapStarted = true
      try {
        await fs.rename(artifacts.temporaryPath, sourcePath)
        await transaction.image.update({ where: { id: image.id }, data: { size: BigInt(optimizedStat.size) } })
        await upsertStreamingGcIntent(transaction, {
          path: backupRelativePath,
          referenceId: String(image.id),
          jobId: input.systemJobId ?? null,
          reason: 'STREAMING_REMUX_BACKUP',
          notBefore: new Date(now().getTime() + 60 * 60_000)
        })
        published = true
      } catch (error) {
        try {
          await restoreStreamingBackup(artifacts)
          swapStarted = false
        } catch (recoveryError) {
          throw new VideoProcessingRecoveryError(
            'Streaming publication failed and the original video could not be restored; manual action is required',
            error,
            recoveryError
          )
        }
        throw error
      }
    },
    async rollback() {
      if (!swapStarted && !published) {
        await fs.rm(artifacts.temporaryPath, { force: true }).catch(() => undefined)
        return
      }
      await restoreStreamingBackup(artifacts)
      swapStarted = false
      published = false
    },
    async discard() {
      await fs.rm(artifacts.temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

export function buildStreamingRemuxArgs(sourcePath: string, temporaryPath: string) {
  return [
    '-nostdin',
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    sourcePath,
    '-map',
    '0',
    '-map_metadata',
    '0',
    '-map_chapters',
    '0',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    temporaryPath
  ]
}

export function getStreamingArtifactPaths(sourcePath: string, operationId: string) {
  return {
    sourcePath,
    temporaryPath: `${sourcePath}.pixishelf-remux-${operationId}.tmp.mp4`,
    backupPath: `${sourcePath}.pixishelf-remux-${operationId}.backup.mp4`
  }
}

export async function recoverVideoStreamingOptimizationArtifacts(sourcePath: string, operationId: string) {
  await recoverPriorStreamingArtifacts(sourcePath, operationId, 1)
}

async function recoverPriorStreamingArtifacts(sourcePath: string, jobId: string, attempt: number) {
  // A lease can expire after the filesystem swap but before the fenced transaction
  // commits. The next claim has a higher attempt, so inspect the bounded prior
  // attempt names instead of scanning the source directory.
  for (let currentAttempt = attempt; currentAttempt >= 1; currentAttempt -= 1) {
    const artifacts = getStreamingArtifactPaths(sourcePath, normalizeArtifactId(`${jobId}-a${currentAttempt}`))
    await Promise.all([
      assertNoFinalSymlink(sourcePath),
      assertNoFinalSymlink(artifacts.temporaryPath),
      assertNoFinalSymlink(artifacts.backupPath)
    ])
    const backupExists = await fileExists(artifacts.backupPath)
    if (backupExists) {
      await fs.rm(sourcePath, { force: true }).catch(() => undefined)
      await fs.rename(artifacts.backupPath, sourcePath)
    }
    await fs.rm(artifacts.temporaryPath, { force: true }).catch(() => undefined)
  }
  if (!(await fileExists(sourcePath))) {
    throw missingExpectedBackupError('Streaming recovery found neither the source video nor an expected backup')
  }
}

async function restoreStreamingBackup(artifacts: ReturnType<typeof getStreamingArtifactPaths>) {
  const [, , backupStat] = await Promise.all([
    assertNoFinalSymlink(artifacts.sourcePath),
    assertNoFinalSymlink(artifacts.temporaryPath),
    assertNoFinalSymlink(artifacts.backupPath)
  ])
  if (!backupStat?.isFile()) {
    throw missingExpectedBackupError('The expected streaming publication backup is missing')
  }
  await fs.rm(artifacts.sourcePath, { force: true }).catch(() => undefined)
  await fs.rename(artifacts.backupPath, artifacts.sourcePath)
  await fs.rm(artifacts.temporaryPath, { force: true }).catch(() => undefined)
}

function missingExpectedBackupError(message: string) {
  return new VideoProcessingRecoveryError(message, null, new Error('Expected recovery backup was not available'))
}

async function probeMediaFingerprint(input: {
  filePath: string
  ffprobePath?: string
  timeoutMs: number
  signal: AbortSignal
  processRunner: VideoProcessRunner
}) {
  const result = await input.processRunner({
    command: input.ffprobePath ?? 'ffprobe',
    args: [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height,channels',
      input.filePath
    ],
    timeoutMs: input.timeoutMs,
    signal: input.signal
  })
  try {
    return JSON.parse(result.stdout) as MediaFingerprint
  } catch {
    throw new Error('FFprobe returned invalid JSON')
  }
}

function assertContainsVideoStream(fingerprint: MediaFingerprint, label: string) {
  if (!fingerprint.streams?.some((stream) => stream.codec_type === 'video')) {
    throw new Error(`${label} does not contain a video stream`)
  }
}

function assertCompatibleFingerprints(source: MediaFingerprint, optimized: MediaFingerprint) {
  assertContainsVideoStream(optimized, 'Optimized file')
  const normalize = (stream: MediaStreamFingerprint) => ({
    codec_type: stream.codec_type ?? null,
    codec_name: stream.codec_name ?? null,
    width: stream.width ?? null,
    height: stream.height ?? null,
    channels: stream.channels ?? null
  })
  const sourceStreams = (source.streams ?? []).map(normalize)
  const optimizedStreams = (optimized.streams ?? []).map(normalize)
  if (JSON.stringify(sourceStreams) !== JSON.stringify(optimizedStreams)) {
    throw new Error('Optimized media streams differ from the source')
  }
}

async function assertSourceUnchanged(sourcePath: string, before: { size: number; mtimeMs: number }) {
  const after = await fs.stat(sourcePath)
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new VideoProcessingPermanentError('SOURCE_CHANGED', 'Source video changed during streaming optimization')
  }
}

async function upsertStreamingGcIntent(
  transaction: VideoProcessingTransaction,
  input: { path: string; referenceId: string; jobId: string | null; reason: string; notBefore: Date }
) {
  await transaction.derivedMediaGcEntry.upsert({
    where: { mediaKind_relativePath: { mediaKind: 'VIDEO_STREAMING_ARTIFACT', relativePath: input.path } },
    create: {
      mediaKind: 'VIDEO_STREAMING_ARTIFACT',
      relativePath: input.path,
      referenceType: 'IMAGE',
      referenceId: input.referenceId,
      reason: input.reason,
      status: 'PENDING',
      notBefore: input.notBefore,
      ...(input.jobId ? { lastSystemJobId: input.jobId } : {})
    },
    update: {
      referenceType: 'IMAGE',
      referenceId: input.referenceId,
      reason: input.reason,
      status: 'PENDING',
      notBefore: input.notBefore,
      attempt: 0,
      error: null,
      deletedAt: null,
      ...(input.jobId ? { lastSystemJobId: input.jobId } : {})
    }
  })
}

function parseDuration(value: string | undefined) {
  if (!value) return null
  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

function parseFfmpegTimestamp(value: string) {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function isVideoPath(value: string) {
  return ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi'].includes(path.extname(value).toLowerCase())
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
