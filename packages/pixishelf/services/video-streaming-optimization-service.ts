import 'server-only'

import * as childProcess from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import logger from '@/lib/logger'
import { isVideoFile } from '@/lib/media'
import { prisma } from '@/lib/prisma'
import { resolveExistingPathWithinRoot } from '@/lib/safe-path'

const FFMPEG_TIMEOUT_MS = 2 * 60 * 60 * 1000
const FFPROBE_TIMEOUT_MS = 2 * 60 * 1000
const CANCELLATION_POLL_INTERVAL_MS = 500
const PROCESS_TERMINATION_GRACE_MS = 2_000
const MAX_PROCESS_OUTPUT_BYTES = 10 * 1024 * 1024

type CancellationCheck = () => Promise<boolean> | boolean

interface MediaStreamFingerprint {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  channels?: number
}

interface MediaFingerprint {
  streams?: MediaStreamFingerprint[]
  format?: {
    duration?: string
  }
}

export interface VideoStreamingOptimizationProgress {
  percentage: number
  message: string
}

export interface VideoStreamingOptimizationResult {
  imageId: number
  path: string
  originalSize: number
  optimizedSize: number
  savedBytes: number
  duration: number | null
}

export interface VideoStreamingOptimizationTarget {
  id: number
  path: string
  sourcePath: string
}

export async function resolveVideoStreamingOptimizationTarget(
  imageId: number,
  scanPath: string
): Promise<VideoStreamingOptimizationTarget> {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
    select: { id: true, path: true, mediaType: true }
  })

  if (!image) throw new Error('Image not found')
  const isVideo = String(image.mediaType ?? '').toUpperCase() === 'VIDEO' || isVideoFile(image.path)
  if (!isVideo) throw new Error('Image is not a video')
  if (path.extname(image.path).toLowerCase() !== '.mp4') throw new Error('Only MP4 videos can be optimized')

  const sourcePath = await resolveExistingPathWithinRoot(scanPath, image.path.replace(/^[/\\]+/, ''))
  const sourceStat = await fs.stat(sourcePath)
  if (!sourceStat.isFile()) throw new Error('Video path is not a file')

  try {
    await fs.access(path.dirname(sourcePath), fsConstants.W_OK)
  } catch {
    throw new Error('Video directory is read-only; mount SCAN_PATH as writable before optimizing videos')
  }

  return { id: image.id, path: image.path, sourcePath }
}

export async function optimizeVideoForStreaming(options: {
  imageId: number
  scanPath: string
  onProgress?: (progress: VideoStreamingOptimizationProgress) => Promise<void> | void
  checkCancelled?: CancellationCheck
}): Promise<VideoStreamingOptimizationResult> {
  const report = (percentage: number, message: string) => options.onProgress?.({ percentage, message })
  const ensureNotCancelled = async () => {
    if (await options.checkCancelled?.()) throw new Error('Task cancelled')
  }

  await report(2, '正在校验视频路径...')
  const image = await resolveVideoStreamingOptimizationTarget(options.imageId, options.scanPath)
  const sourcePath = image.sourcePath
  const sourceStat = await fs.stat(sourcePath)
  await ensureNotCancelled()

  const operationId = `${process.pid}-${Date.now()}-${randomUUID()}`
  const temporaryPath = path.join(path.dirname(sourcePath), `.pixishelf-remux-${operationId}.mp4`)

  try {
    await report(8, '正在读取原视频流信息...')
    const sourceFingerprint = await probeMediaFingerprint(sourcePath)
    assertContainsVideoStream(sourceFingerprint, 'Source file')
    await ensureNotCancelled()

    await report(15, '正在使用 FFmpeg 无损重新封装，请勿关闭服务...')
    await runFfmpegRemux(
      [
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
      ],
      {
        duration: parseDuration(sourceFingerprint.format?.duration),
        checkCancelled: options.checkCancelled,
        onProgress: async (percentage) => {
          await report(percentage, `正在无损重新封装 MP4... ${percentage}%`)
        }
      }
    )

    await report(82, '正在校验优化后的视频...')
    const optimizedStat = await fs.stat(temporaryPath)
    if (!optimizedStat.isFile() || optimizedStat.size <= 0) throw new Error('FFmpeg produced an empty output file')

    const optimizedFingerprint = await probeMediaFingerprint(temporaryPath)
    assertCompatibleFingerprints(sourceFingerprint, optimizedFingerprint)
    await ensureNotCancelled()
    await assertSourceUnchanged(sourcePath, sourceStat)

    await fs.chmod(temporaryPath, sourceStat.mode)
    await report(92, '校验通过，正在替换原视频...')
    await replaceFileWithRollback(temporaryPath, sourcePath, operationId)

    const finalStat = await fs.stat(sourcePath)
    await prisma.image.update({
      where: { id: image.id },
      data: { size: BigInt(finalStat.size) }
    })

    const duration = parseDuration(optimizedFingerprint.format?.duration)
    await report(100, 'MP4 无损播放优化完成')

    return {
      imageId: image.id,
      path: image.path,
      originalSize: sourceStat.size,
      optimizedSize: finalStat.size,
      savedBytes: sourceStat.size - finalStat.size,
      duration
    }
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function probeMediaFingerprint(filePath: string): Promise<MediaFingerprint> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height,channels',
        filePath
      ],
      {
        maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
        timeout: FFPROBE_TIMEOUT_MS,
        killSignal: 'SIGKILL'
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stringifyProcessOutput(stderr) || error.message))
          return
        }

        try {
          resolve(JSON.parse(stringifyProcessOutput(stdout)) as MediaFingerprint)
        } catch {
          reject(new Error('Invalid ffprobe JSON output'))
        }
      }
    )
  })
}

function runFfmpegRemux(
  args: string[],
  options: {
    duration: number | null
    checkCancelled?: CancellationCheck
    onProgress?: (percentage: number) => Promise<void> | void
  }
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let cancellationTimer: ReturnType<typeof setTimeout> | undefined
    let terminationTimer: ReturnType<typeof setTimeout> | undefined
    let processTimeout: ReturnType<typeof setTimeout> | undefined
    let terminationError: Error | undefined
    let child: ReturnType<typeof childProcess.spawn> | undefined
    let stderr = ''
    let progressBuffer = ''
    let lastProgress = 15
    let progressQueue = Promise.resolve()

    const finish = async (error?: Error) => {
      if (settled) return
      settled = true
      if (cancellationTimer) clearTimeout(cancellationTimer)
      if (terminationTimer) clearTimeout(terminationTimer)
      if (processTimeout) clearTimeout(processTimeout)
      await progressQueue.catch(() => undefined)
      if (error) reject(error)
      else resolve()
    }

    const terminate = (error: Error) => {
      if (settled || terminationError) return
      terminationError = error
      if (!child?.kill('SIGKILL')) {
        void finish(error)
        return
      }
      terminationTimer = setTimeout(() => void finish(error), PROCESS_TERMINATION_GRACE_MS)
    }

    const pollCancellation = async () => {
      if (settled || !options.checkCancelled) return
      try {
        if (await options.checkCancelled()) {
          terminate(new Error('Task cancelled'))
          return
        }
      } catch (error) {
        terminate(error instanceof Error ? error : new Error('Failed to check task cancellation'))
        return
      }
      if (!settled) cancellationTimer = setTimeout(() => void pollCancellation(), CANCELLATION_POLL_INTERVAL_MS)
    }

    const enqueueProgress = (percentage: number) => {
      if (percentage <= lastProgress || percentage >= 82) return
      lastProgress = percentage
      progressQueue = progressQueue.then(() => options.onProgress?.(percentage)).then(() => undefined)
    }

    const consumeProgress = (chunk: string) => {
      progressBuffer += chunk
      const lines = progressBuffer.split(/\r?\n/)
      progressBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const [key, value] = line.split('=', 2)
        if (key !== 'out_time' || !value || !options.duration) continue
        const elapsed = parseFfmpegTimestamp(value)
        if (elapsed === null) continue
        enqueueProgress(Math.min(81, Math.max(16, Math.floor(15 + (elapsed / options.duration) * 67))))
      }
    }

    child = childProcess.spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout?.on('data', (chunk) => consumeProgress(processChunkToString(chunk)))
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${processChunkToString(chunk)}`.slice(-MAX_PROCESS_OUTPUT_BYTES)
    })
    child.once('error', (error) => void finish(error))
    child.once('close', (code) => {
      if (terminationError) {
        void finish(terminationError)
        return
      }
      if (code !== 0) {
        void finish(new Error(stderr.trim() || `FFmpeg exited with code ${code ?? 'unknown'}`))
        return
      }
      void finish()
    })

    processTimeout = setTimeout(
      () => terminate(new Error(`FFmpeg timed out after ${FFMPEG_TIMEOUT_MS}ms`)),
      FFMPEG_TIMEOUT_MS
    )

    void pollCancellation()
  })
}

function parseFfmpegTimestamp(value: string) {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const total = hours * 3600 + minutes * 60 + seconds
  return Number.isFinite(total) && total >= 0 ? total : null
}

function processChunkToString(output: unknown) {
  if (typeof output === 'string') return output
  if (Buffer.isBuffer(output)) return output.toString('utf8')
  return String(output ?? '')
}

function assertContainsVideoStream(fingerprint: MediaFingerprint, label: string) {
  if (!fingerprint.streams?.some((stream) => stream.codec_type === 'video')) {
    throw new Error(`${label} does not contain a video stream`)
  }
}

function assertCompatibleFingerprints(source: MediaFingerprint, optimized: MediaFingerprint) {
  assertContainsVideoStream(optimized, 'Optimized file')

  const sourceStreams = comparableStreams(source)
  const optimizedStreams = comparableStreams(optimized)
  if (sourceStreams.length !== optimizedStreams.length) {
    throw new Error('Optimized file stream count does not match the source')
  }

  for (const [index, sourceStream] of sourceStreams.entries()) {
    const optimizedStream = optimizedStreams[index]
    if (
      !optimizedStream ||
      sourceStream.codec_type !== optimizedStream.codec_type ||
      sourceStream.codec_name !== optimizedStream.codec_name
    ) {
      throw new Error('Optimized file codecs do not match the source')
    }
  }

  const sourceDuration = parseDuration(source.format?.duration)
  const optimizedDuration = parseDuration(optimized.format?.duration)
  if (sourceDuration !== null && optimizedDuration !== null) {
    const tolerance = Math.max(1, sourceDuration * 0.001)
    if (Math.abs(sourceDuration - optimizedDuration) > tolerance) {
      throw new Error('Optimized file duration does not match the source')
    }
  }
}

async function assertSourceUnchanged(sourcePath: string, originalStat: Awaited<ReturnType<typeof fs.stat>>) {
  const currentStat = await fs.stat(sourcePath)
  const inodeChanged = originalStat.ino > 0 && currentStat.ino > 0 && originalStat.ino !== currentStat.ino
  if (inodeChanged || currentStat.size !== originalStat.size || currentStat.mtimeMs !== originalStat.mtimeMs) {
    throw new Error('Source video changed while FFmpeg was running; optimized output was not installed')
  }
}

function comparableStreams(fingerprint: MediaFingerprint) {
  return (fingerprint.streams ?? []).filter((stream) => stream.codec_type === 'video' || stream.codec_type === 'audio')
}

function parseDuration(value: string | undefined) {
  if (!value) return null
  const duration = Number(value)
  return Number.isFinite(duration) && duration >= 0 ? duration : null
}

function stringifyProcessOutput(output: unknown): string {
  if (typeof output === 'string') return output.trim()
  if (Buffer.isBuffer(output)) return output.toString('utf8').trim()
  if (output && typeof output === 'object') {
    const nestedOutput = output as { stdout?: unknown; stderr?: unknown }
    return stringifyProcessOutput(nestedOutput.stderr) || stringifyProcessOutput(nestedOutput.stdout)
  }
  return ''
}

async function replaceFileWithRollback(temporaryPath: string, sourcePath: string, operationId: string) {
  try {
    await fs.rename(temporaryPath, sourcePath)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(code ?? '')) throw error
  }

  const backupPath = path.join(
    path.dirname(sourcePath),
    `.pixishelf-remux-backup-${operationId}${path.extname(sourcePath) || '.mp4'}`
  )
  await fs.rename(sourcePath, backupPath)
  try {
    await fs.rename(temporaryPath, sourcePath)
  } catch (error) {
    await fs.rename(backupPath, sourcePath).catch((rollbackError) => {
      throw new AggregateError([error, rollbackError], 'Failed to replace video and restore its backup')
    })
    throw error
  }

  await fs.rm(backupPath, { force: true }).catch((error) => {
    logger.warn('Optimized video installed but backup cleanup failed', { backupPath, error })
  })
}
