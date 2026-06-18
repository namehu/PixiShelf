import 'server-only'

import path from 'path'
import * as childProcess from 'node:child_process'
import * as fs from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { isApngFile, isGifFile, isImageFile, isVideoFile } from '@/lib/media'

const CLASSIFY_BATCH_SIZE = 500
const PROBE_BATCH_SIZE = 20
const FAILED_SAMPLE_LIMIT = 20
const AUDIO_SAMPLE_SECONDS = 10
const AUDIBLE_MAX_VOLUME_THRESHOLD_DB = -50

export interface VideoProbeMetadata {
  hasAudio: boolean
  audioCodec: string | null
  audioChannels: number | null
  videoCodec: string | null
  duration: number | null
  fps: number | null
}

export interface VideoMediaReprobeResult extends VideoProbeMetadata {
  imageId: number
  probeStatus: 'COMPLETED'
  probeUpdatedAt: Date
  probeError: null
}

interface ReprobeVideoImage {
  id: number
  path: string
  mediaType?: string | null
}

export interface VideoMediaClassificationResult {
  classifiedVideos: number
  classifiedImages: number
  classifiedAnimations: number
  unknown: number
  metadataRowsCreated: number
}

export interface VideoMediaProbeFailedSample {
  imageId: number
  path: string
  error: string
}

export interface VideoMediaProbeProgress {
  percentage: number
  message: string
}

export interface VideoMediaProbeResult extends VideoMediaClassificationResult {
  processed: number
  failed: number
  remainingPending: number
  failedSamples: VideoMediaProbeFailedSample[]
}

interface ClassifyUnknownMediaImagesOptions {
  onProgress?: (progress: { processed: number; total: number; result: VideoMediaClassificationResult }) => Promise<void> | void
}

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  channels?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  nb_read_packets?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: {
    duration?: string
  }
}

export async function classifyUnknownMediaImages(
  options: ClassifyUnknownMediaImagesOptions = {}
): Promise<VideoMediaClassificationResult> {
  const result: VideoMediaClassificationResult = {
    classifiedVideos: 0,
    classifiedImages: 0,
    classifiedAnimations: 0,
    unknown: 0,
    metadataRowsCreated: 0
  }

  const total = options.onProgress
    ? await prisma.image.count({
        where: { mediaType: 'UNKNOWN' }
      })
    : 0
  let lastSeenId = 0
  let processed = 0

  while (true) {
    const batch = await prisma.image.findMany({
      where: {
        mediaType: 'UNKNOWN',
        id: { gt: lastSeenId }
      },
      orderBy: { id: 'asc' },
      take: CLASSIFY_BATCH_SIZE,
      select: { id: true, path: true }
    })

    if (batch.length === 0) break

    lastSeenId = batch[batch.length - 1]!.id
    processed += batch.length

    const videoIds: number[] = []
    const imageIds: number[] = []
    const animationIds: number[] = []

    for (const image of batch) {
      if (isVideoFile(image.path)) {
        videoIds.push(image.id)
      } else if (isApngFile(image.path) || isGifFile(image.path)) {
        animationIds.push(image.id)
      } else if (isImageFile(image.path)) {
        imageIds.push(image.id)
      } else {
        result.unknown += 1
      }
    }

    if (videoIds.length > 0) {
      await prisma.image.updateMany({
        where: { id: { in: videoIds } },
        data: { mediaType: 'VIDEO' }
      })
      const createResult = await prisma.mediaVideoMetadata.createMany({
        data: videoIds.map((imageId) => ({ imageId, probeStatus: 'PENDING' })),
        skipDuplicates: true
      })
      result.classifiedVideos += videoIds.length
      result.metadataRowsCreated += createResult.count
    }

    if (imageIds.length > 0) {
      await prisma.image.updateMany({
        where: { id: { in: imageIds } },
        data: { mediaType: 'IMAGE' }
      })
      result.classifiedImages += imageIds.length
    }

    if (animationIds.length > 0) {
      await prisma.image.updateMany({
        where: { id: { in: animationIds } },
        data: { mediaType: 'ANIMATION' }
      })
      result.classifiedAnimations += animationIds.length
    }

    await options.onProgress?.({ processed, total, result: { ...result } })
  }

  if (total === 0) {
    await options.onProgress?.({ processed: 0, total: 0, result: { ...result } })
  }

  return result
}

export async function probeVideoFile(absolutePath: string): Promise<VideoProbeMetadata> {
  const output = await execFfprobe([
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-count_packets',
    '-show_streams',
    absolutePath
  ])

  let parsed: FfprobeOutput
  try {
    parsed = JSON.parse(output) as FfprobeOutput
  } catch {
    throw new Error('Invalid ffprobe JSON output')
  }

  const streams = parsed.streams ?? []
  const videoStream = streams.find((stream) => stream.codec_type === 'video')
  const audioStream = streams.find(isReadableAudioStream)
  const duration = parseNumber(parsed.format?.duration) ?? parseNumber(videoStream?.duration)
  const companionHasAudio = await readCompanionChaptersAudioMetadata(absolutePath)
  const sampledHasAudio =
    audioStream && companionHasAudio === null ? await detectAudibleAudioBySamples(absolutePath, duration) : null
  const hasAudio = Boolean(audioStream) && companionHasAudio !== false && sampledHasAudio !== false
  const resolvedAudioStream = hasAudio ? audioStream : null

  return {
    hasAudio,
    audioCodec: resolvedAudioStream?.codec_name ?? null,
    audioChannels: typeof resolvedAudioStream?.channels === 'number' ? resolvedAudioStream.channels : null,
    videoCodec: videoStream?.codec_name ?? null,
    duration,
    fps: parseFps(videoStream?.avg_frame_rate) ?? parseFps(videoStream?.r_frame_rate)
  }
}

export async function reprobeVideoMediaByImageId(imageId: number, scanPath: string): Promise<VideoMediaReprobeResult> {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
    select: { id: true, path: true, mediaType: true }
  })

  if (!image) {
    throw new Error('Image not found')
  }

  if (!isVideoImageForProbe(image)) {
    throw new Error('Image is not a video')
  }

  const now = new Date()
  await prisma.mediaVideoMetadata.upsert({
    where: { imageId },
    create: {
      imageId,
      probeStatus: 'PROBING',
      probeUpdatedAt: now,
      probeError: null
    },
    update: {
      probeStatus: 'PROBING',
      probeUpdatedAt: now,
      probeError: null
    }
  })

  try {
    const absolutePath = resolvePathWithinScanRoot(scanPath, image.path)
    const metadata = await probeVideoFile(absolutePath)
    const probeUpdatedAt = new Date()

    await prisma.mediaVideoMetadata.update({
      where: { imageId },
      data: {
        probeStatus: 'COMPLETED',
        probeUpdatedAt,
        probeError: null,
        ...metadata
      }
    })

    return {
      imageId,
      probeStatus: 'COMPLETED',
      probeUpdatedAt,
      probeError: null,
      ...metadata
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await prisma.mediaVideoMetadata.update({
      where: { imageId },
      data: {
        probeStatus: 'FAILED',
        probeUpdatedAt: new Date(),
        probeError: message
      }
    })
    throw new Error(message)
  }
}

export async function resolveVideoImageForReprobePath(inputPath: string, scanPath: string): Promise<ReprobeVideoImage> {
  const trimmedPath = inputPath.trim()
  if (!trimmedPath) {
    throw new Error('Path is required')
  }

  const relativePath = normalizeReprobeRelativePath(trimmedPath, scanPath)
  const withoutLeadingSlash = relativePath.replace(/^\/+/, '')
  const withLeadingSlash = `/${withoutLeadingSlash}`
  const candidates = Array.from(new Set([withLeadingSlash, withoutLeadingSlash]))

  const image = await prisma.image.findFirst({
    where: {
      path: { in: candidates }
    },
    orderBy: { id: 'asc' },
    select: { id: true, path: true, mediaType: true }
  })

  if (!image) {
    throw new Error('Video image not found')
  }

  if (!isVideoImageForProbe(image)) {
    throw new Error('Image is not a video')
  }

  return image
}

export async function runVideoMediaProbeJob(options: {
  scanPath: string
  onProgress?: (progress: VideoMediaProbeProgress) => Promise<void> | void
  checkCancelled?: () => Promise<boolean> | boolean
}): Promise<VideoMediaProbeResult> {
  const reportProgress = async (percentage: number, message: string) => {
    await options.onProgress?.({ percentage, message })
  }

  const ensureNotCancelled = async () => {
    if (await options.checkCancelled?.()) {
      throw new Error('Task cancelled')
    }
  }

  await reportProgress(1, '正在统计待分类媒体...')
  const classification = await classifyUnknownMediaImages({
    onProgress: async ({ processed, total, result }) => {
      const percentage = total > 0 ? Math.min(29, 1 + Math.floor((processed / total) * 28)) : 2
      await reportProgress(
        percentage,
        total > 0
          ? `正在分类媒体 ${processed}/${total}：视频 ${result.classifiedVideos} 个，图片 ${result.classifiedImages} 个，动图 ${result.classifiedAnimations} 个，未知 ${result.unknown} 个`
          : '没有待分类媒体'
      )
    }
  })

  await prisma.mediaVideoMetadata.updateMany({
    where: { probeStatus: 'FAILED' },
    data: { probeStatus: 'PENDING' }
  })

  await ensureNotCancelled()
  const totalPending = await prisma.mediaVideoMetadata.count({
    where: { probeStatus: 'PENDING' }
  })

  const result: VideoMediaProbeResult = {
    ...classification,
    processed: 0,
    failed: 0,
    remainingPending: totalPending,
    failedSamples: []
  }

  if (totalPending === 0) {
    await reportProgress(100, `没有待探测视频，本次分类视频 ${classification.classifiedVideos} 个`)
    return result
  }

  await reportProgress(30, `待探测视频 ${totalPending} 个，每批 ${PROBE_BATCH_SIZE} 个`)

  while (true) {
    await ensureNotCancelled()

    const batch = await prisma.mediaVideoMetadata.findMany({
      where: { probeStatus: 'PENDING' },
      orderBy: { imageId: 'asc' },
      take: PROBE_BATCH_SIZE,
      select: {
        imageId: true,
        image: {
          select: { path: true }
        }
      }
    })

    if (batch.length === 0) break

    for (const item of batch) {
      await ensureNotCancelled()

      try {
        await prisma.mediaVideoMetadata.update({
          where: { imageId: item.imageId },
          data: {
            probeStatus: 'PROBING',
            probeUpdatedAt: new Date(),
            probeError: null
          }
        })

        const absolutePath = resolvePathWithinScanRoot(options.scanPath, item.image.path)
        const metadata = await probeVideoFile(absolutePath)

        await prisma.mediaVideoMetadata.update({
          where: { imageId: item.imageId },
          data: {
            probeStatus: 'COMPLETED',
            probeUpdatedAt: new Date(),
            probeError: null,
            ...metadata
          }
        })

        result.processed += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        result.failed += 1
        if (result.failedSamples.length < FAILED_SAMPLE_LIMIT) {
          result.failedSamples.push({
            imageId: item.imageId,
            path: item.image.path,
            error: message
          })
        }
        await prisma.mediaVideoMetadata.update({
          where: { imageId: item.imageId },
          data: {
            probeStatus: 'FAILED',
            probeUpdatedAt: new Date(),
            probeError: message
          }
        })
      }
    }

    const attempts = result.processed + result.failed
    const percentage = Math.min(99, 30 + Math.floor((attempts / totalPending) * 69))
    await reportProgress(percentage, `已探测 ${attempts}/${totalPending} 个：成功 ${result.processed} 个，失败 ${result.failed} 个`)
  }

  result.remainingPending = await prisma.mediaVideoMetadata.count({
    where: { probeStatus: 'PENDING' }
  })

  await reportProgress(100, `视频媒体探测完成：成功 ${result.processed} 个，失败 ${result.failed} 个`)

  return result
}

function execFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile('ffprobe', args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message))
        return
      }

      if (typeof stdout === 'string') {
        resolve(stdout)
        return
      }

      const stdoutObject = stdout as unknown as { stdout?: unknown }
      const output = stdoutObject && typeof stdoutObject === 'object' && 'stdout' in stdoutObject ? String(stdoutObject.stdout) : ''
      resolve(output)
    })
  })
}

function execFfmpegForStderr(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile('ffmpeg', args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      const stderrText = stringifyExecOutput(stderr, 'stderr') || stringifyExecOutput(stdout, 'stderr')
      if (error) {
        reject(new Error(stderrText.trim() || error.message))
        return
      }

      resolve(stderrText)
    })
  })
}

function stringifyExecOutput(output: unknown, key: 'stdout' | 'stderr'): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object' && key in output) {
    return String((output as Record<typeof key, unknown>)[key] ?? '')
  }
  return ''
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isReadableAudioStream(stream: FfprobeStream): boolean {
  if (stream.codec_type !== 'audio') return false

  const packetCount = parseNumber(stream.nb_read_packets)
  if (packetCount !== null) return packetCount > 0

  return true
}

function isVideoImageForProbe(image: ReprobeVideoImage): boolean {
  return String(image.mediaType ?? '').toUpperCase() === 'VIDEO' || isVideoFile(image.path)
}

function normalizeReprobeRelativePath(inputPath: string, scanPath: string): string {
  const normalizedInput = inputPath.replace(/\\/g, '/')
  const normalizedScanRoot = path.resolve(scanPath).replace(/\\/g, '/').replace(/\/+$/, '')
  const inputLooksAbsolute =
    /^[a-zA-Z]:\//.test(normalizedInput) ||
    normalizedInput.startsWith('//') ||
    (normalizedScanRoot.startsWith('/') &&
      (normalizedInput === normalizedScanRoot || normalizedInput.startsWith(`${normalizedScanRoot}/`)))

  if (!inputLooksAbsolute) {
    return normalizedInput
  }

  const resolvedInput = path.resolve(inputPath).replace(/\\/g, '/')
  const rootWithSeparator = `${normalizedScanRoot}/`
  if (resolvedInput !== normalizedScanRoot && !resolvedInput.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    throw new Error(`Path escapes scan root: ${inputPath}`)
  }

  const relativePath = resolvedInput.slice(normalizedScanRoot.length).replace(/^\/+/, '')
  return `/${relativePath}`
}

async function readCompanionChaptersAudioMetadata(absolutePath: string): Promise<boolean | null> {
  const parsedPath = path.parse(absolutePath)
  const chaptersPath = path.join(parsedPath.dir, `${parsedPath.name}.chapters.json`)

  try {
    const raw = await fs.readFile(chaptersPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null

    const metadata = parsed as { video?: unknown; hasAudio?: unknown }
    if (metadata.video !== parsedPath.base) return null
    return typeof metadata.hasAudio === 'boolean' ? metadata.hasAudio : null
  } catch {
    return null
  }
}

async function detectAudibleAudioBySamples(absolutePath: string, duration: number | null): Promise<boolean | null> {
  const windows = buildAudioSampleWindows(duration)

  for (const window of windows) {
    let stderr: string
    try {
      stderr = await execFfmpegForStderr([
        '-v',
        'info',
        '-ss',
        formatFfmpegSeconds(window.start),
        '-t',
        formatFfmpegSeconds(window.duration),
        '-i',
        absolutePath,
        '-vn',
        '-map',
        '0:a:0',
        '-af',
        'volumedetect',
        '-f',
        'null',
        '-'
      ])
    } catch {
      return null
    }

    const maxVolume = parseVolumedetectMaxVolume(stderr)
    if (maxVolume === null) return null
    if (maxVolume > AUDIBLE_MAX_VOLUME_THRESHOLD_DB) return true
  }

  return false
}

function buildAudioSampleWindows(duration: number | null): Array<{ start: number; duration: number }> {
  if (duration === null || duration <= 0) {
    return [{ start: 0, duration: AUDIO_SAMPLE_SECONDS }]
  }

  if (duration <= AUDIO_SAMPLE_SECONDS * 3) {
    return [{ start: 0, duration }]
  }

  const middleStart = Math.max(0, duration / 2 - AUDIO_SAMPLE_SECONDS / 2)
  const endingStart = Math.max(0, duration - AUDIO_SAMPLE_SECONDS)
  return [
    { start: 0, duration: AUDIO_SAMPLE_SECONDS },
    { start: middleStart, duration: AUDIO_SAMPLE_SECONDS },
    { start: endingStart, duration: AUDIO_SAMPLE_SECONDS }
  ]
}

function parseVolumedetectMaxVolume(stderr: string): number | null {
  const match = stderr.match(/max_volume:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*dB/i)
  if (!match) return null

  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function formatFfmpegSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3)
}

function parseFps(value: string | undefined): number | null {
  if (!value || value === '0/0') return null
  const [numeratorRaw, denominatorRaw] = value.split('/')
  const numerator = Number(numeratorRaw)
  const denominator = Number(denominatorRaw)

  if (!Number.isFinite(numerator)) return null
  if (!denominatorRaw) return numerator
  if (!Number.isFinite(denominator) || denominator === 0) return null

  return numerator / denominator
}

function resolvePathWithinScanRoot(scanRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(scanRoot)
  const resolvedPath = path.resolve(normalizedRoot, relativePath.replace(/^[/\\]+/, ''))
  const rootWithSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`

  if (resolvedPath !== normalizedRoot && !resolvedPath.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    throw new Error(`Path escapes scan root: ${relativePath}`)
  }

  return resolvedPath
}
