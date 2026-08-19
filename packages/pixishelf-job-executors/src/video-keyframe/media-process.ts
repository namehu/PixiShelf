import * as childProcess from 'node:child_process'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { VideoKeyframePermanentError, VideoKeyframeProcessError } from './types.ts'

const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024

export async function probeVideoDuration(input: {
  sourcePath: string
  ffprobePath?: string
  timeoutMs: number
  signal: AbortSignal
}) {
  const output = await runProcess(
    input.ffprobePath ?? 'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input.sourcePath],
    { timeoutMs: input.timeoutMs, signal: input.signal }
  )
  const duration = Number(output.stdout.trim())
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new VideoKeyframePermanentError('INVALID_DURATION', 'FFprobe returned an invalid video duration')
  }
  return duration
}

export async function extractVideoFrame(input: {
  sourcePath: string
  temporaryPath: string
  outputPath: string
  captureTime: number
  threads: number
  ffmpegPath?: string
  timeoutMs: number
  signal: AbortSignal
}) {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true })
  await fs.rm(input.temporaryPath, { force: true }).catch(() => undefined)
  await runProcess(
    input.ffmpegPath ?? 'ffmpeg',
    buildVideoFrameExtractionArgs({
      sourcePath: input.sourcePath,
      outputPath: input.temporaryPath,
      captureTime: input.captureTime,
      width: 640,
      threads: input.threads
    }),
    { timeoutMs: input.timeoutMs, signal: input.signal }
  )
  await validateWebp(input.temporaryPath)
  const metrics = await calculateFrameMetrics(input.temporaryPath)
  const rejectionReason = classifyQualityRejection(metrics)
  if (rejectionReason) {
    await fs.rm(input.temporaryPath, { force: true })
    return { metrics, rejectionReason }
  }
  await fs.copyFile(input.temporaryPath, input.outputPath)
  try {
    await validateWebpWithRetry(input.outputPath, input.signal)
  } catch (error) {
    await fs.rm(input.outputPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await fs.rm(input.temporaryPath, { force: true }).catch(() => undefined)
  }
  return { metrics, rejectionReason: null }
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

export async function isValidWebp(filePath: string) {
  try {
    await validateWebpWithRetry(filePath)
    return true
  } catch {
    return false
  }
}

async function validateWebp(filePath: string) {
  const metadata = await sharp(filePath).metadata()
  if (metadata.format !== 'webp' || !metadata.width || !metadata.height) {
    throw new Error('FFmpeg produced an invalid WebP frame')
  }
}

async function validateWebpWithRetry(filePath: string, signal?: AbortSignal) {
  let lastError: unknown
  for (const delay of [0, 100, 500, 2_000]) {
    throwIfAborted(signal)
    if (delay > 0) await abortableDelay(delay, signal)
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
  const bits: string[] = []
  for (let y = 2; y < 32; y += 4) {
    for (let x = 2; x < 32; x += 4) bits.push(values[y * 32 + x]! >= luma ? '1' : '0')
  }
  let perceptualHash = ''
  for (let index = 0; index < bits.length; index += 4) {
    perceptualHash += Number.parseInt(bits.slice(index, index + 4).join(''), 2).toString(16)
  }
  return { luma, sharpness, perceptualHash }
}

function classifyQualityRejection(metrics: { luma: number; sharpness: number }) {
  if (metrics.luma < 8) return 'TOO_DARK'
  if (metrics.luma > 247) return 'TOO_BRIGHT'
  if (metrics.sharpness < 4) return 'LOW_INFORMATION'
  return null
}

function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs: number; signal: AbortSignal }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    throwIfAborted(options.signal)
    const child = childProcess.spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    let terminationError: Error | null = null
    let killTimeout: NodeJS.Timeout | undefined
    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString()}`.slice(-MAX_PROCESS_OUTPUT_BYTES)
    child.stdout.on('data', (chunk: Buffer) => (stdout = append(stdout, chunk)))
    child.stderr.on('data', (chunk: Buffer) => (stderr = append(stderr, chunk)))
    const cleanup = () => {
      clearTimeout(timeout)
      if (killTimeout) clearTimeout(killTimeout)
      options.signal.removeEventListener('abort', onAbort)
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
      } else finish(error)
    }
    const onAbort = () => terminate(abortReason(options.signal))
    const timeout = setTimeout(
      () => terminate(new VideoKeyframeProcessError('EXTERNAL_PROCESS_TIMEOUT', `${command} timed out`)),
      options.timeoutMs
    )
    timeout.unref()
    options.signal.addEventListener('abort', onAbort, { once: true })
    child.on('error', (error) => finish(new VideoKeyframeProcessError('EXTERNAL_PROCESS_FAILED', error.message)))
    child.on('close', (code) => {
      if (settled) return
      if (terminationError) finish(terminationError)
      else if (code === 0) finish()
      else
        finish(
          new VideoKeyframeProcessError(
            'EXTERNAL_PROCESS_FAILED',
            stderr.trim() || `${command} exited with code ${code}`
          )
        )
    })
  })
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal)
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error('Video keyframe execution was interrupted')
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds)
    timer.unref()
    signal.addEventListener('abort', abort, { once: true })
    function finish() {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      clearTimeout(timer)
      reject(abortReason(signal!))
    }
  })
}
