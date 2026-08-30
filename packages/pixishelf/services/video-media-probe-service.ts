import 'server-only'

import path from 'path'
import * as childProcess from 'node:child_process'
import * as fs from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { isVideoFile } from '@/lib/media'
import { inferMediaTypeFromPath } from '@/lib/media-type'
import { createChapterManifestHash, validateChapterManifest } from '@/services/artwork-service/video-chapters'
import {
  buildChapterAudioSamplePlans,
  buildUnchapteredAudioSampleWindows,
  isAudibleMaxVolume,
  parseCompanionAudioManifest,
  parseVolumedetectMaxVolume,
  type AudioSampleWindow
} from '@pixishelf/job-executors/video-audio'

const CLASSIFY_BATCH_SIZE = 500
const PROBE_BATCH_SIZE = 20
const FAILED_SAMPLE_LIMIT = 20

export interface VideoProbeMetadata {
  hasAudio: boolean
  audioCodec: string | null
  audioChannels: number | null
  videoCodec: string | null
  duration: number | null
  fps: number | null
  chapterAudio?: {
    chaptersHash: string
    chapters: Array<{
      chapterOrder: number
      chapterIndex: number
      chapterStart: number
      hasAudibleAudio: boolean
    }>
  }
}

interface VideoChapterAudioReference {
  chaptersHash: string
  chapters: Array<{
    chapterOrder: number
    chapterIndex: number
    chapterStart: number
  }>
}

class VideoChapterAudioProbeError extends Error {
  constructor(
    message: string,
    readonly chapterAudio: VideoChapterAudioReference,
    cause?: unknown
  ) {
    super(message, { cause })
    this.name = 'VideoChapterAudioProbeError'
  }
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
  mode: 'INCREMENTAL' | 'RECHECK_HAS_AUDIO'
  processed: number
  failed: number
  remainingPending: number
  failedSamples: VideoMediaProbeFailedSample[]
}

interface ClassifyUnknownMediaImagesOptions {
  onProgress?: (progress: {
    processed: number
    total: number
    result: VideoMediaClassificationResult
  }) => Promise<void> | void
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
      switch (inferMediaTypeFromPath(image.path)) {
        case 'VIDEO':
          videoIds.push(image.id)
          break
        case 'ANIMATION':
          animationIds.push(image.id)
          break
        case 'IMAGE':
          imageIds.push(image.id)
          break
        default:
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
  const companion = await readCompanionChaptersAudioManifest(absolutePath)
  let hasAudio = false
  let chapterAudio: VideoProbeMetadata['chapterAudio']

  if (companion) {
    const plans = buildChapterAudioSamplePlans(companion.chapters)
    const reference: VideoChapterAudioReference = {
      chaptersHash: companion.chaptersHash,
      chapters: plans.map((plan) => ({
        chapterOrder: plan.chapterOrder,
        chapterIndex: plan.index,
        chapterStart: plan.start
      }))
    }
    try {
      const chapters = []
      for (const plan of plans) {
        const hasAudibleAudio = audioStream
          ? await detectAudibleAudioWindows(absolutePath, plan.windows)
          : false
        chapters.push({
          chapterOrder: plan.chapterOrder,
          chapterIndex: plan.index,
          chapterStart: plan.start,
          hasAudibleAudio
        })
      }
      hasAudio = chapters.some((chapter) => chapter.hasAudibleAudio)
      chapterAudio = { chaptersHash: companion.chaptersHash, chapters }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown chapter audio probe failure'
      throw new VideoChapterAudioProbeError(message, reference, error)
    }
  } else if (audioStream) {
    hasAudio = await detectAudibleAudioWindows(absolutePath, buildUnchapteredAudioSampleWindows(duration))
  }

  const resolvedAudioStream = hasAudio ? audioStream : null

  return {
    hasAudio,
    audioCodec: resolvedAudioStream?.codec_name ?? null,
    audioChannels: typeof resolvedAudioStream?.channels === 'number' ? resolvedAudioStream.channels : null,
    videoCodec: videoStream?.codec_name ?? null,
    duration,
    fps: parseFps(videoStream?.avg_frame_rate) ?? parseFps(videoStream?.r_frame_rate),
    ...(chapterAudio ? { chapterAudio } : {})
  }
}

export async function reprobeVideoMediaByImageId(imageId: number, scanPath: string): Promise<VideoMediaReprobeResult> {
  const image = await findVideoImageForReprobeId(imageId)

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
    if (metadata.chapterAudio) {
      await persistChapterAudioMeasurements(imageId, metadata.chapterAudio)
    }
    const videoMetadata = toPersistedVideoMetadata(metadata)

    await prisma.mediaVideoMetadata.update({
      where: { imageId },
      data: {
        probeStatus: 'COMPLETED',
        probeUpdatedAt,
        probeError: null,
        ...videoMetadata
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
    if (error instanceof VideoChapterAudioProbeError) {
      await persistChapterAudioFailure(imageId, error.chapterAudio, message)
    }
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

export async function resolveVideoImageForReprobeId(imageId: number, scanPath: string): Promise<ReprobeVideoImage> {
  const image = await findVideoImageForReprobeId(imageId)
  resolvePathWithinScanRoot(scanPath, image.path)
  return image
}

async function findVideoImageForReprobeId(imageId: number): Promise<ReprobeVideoImage> {
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
  return image
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
  mode?: 'INCREMENTAL' | 'RECHECK_HAS_AUDIO'
  force?: boolean
  checkpointCreatedAt?: Date
  onProgress?: (progress: VideoMediaProbeProgress) => Promise<void> | void
  checkCancelled?: () => Promise<boolean> | boolean
}): Promise<VideoMediaProbeResult> {
  const mode = options.mode ?? 'INCREMENTAL'
  const recheckHasAudio = mode === 'RECHECK_HAS_AUDIO'
  if (recheckHasAudio && !options.force) {
    throw new Error('Audio recalibration must be an explicit force run')
  }
  const checkpointCreatedAt = options.checkpointCreatedAt ?? new Date()
  const reportProgress = async (percentage: number, message: string) => {
    await options.onProgress?.({ percentage, message })
  }

  const ensureNotCancelled = async () => {
    if (await options.checkCancelled?.()) {
      throw new Error('Task cancelled')
    }
  }

  await reportProgress(1, '正在统计待分类媒体...')
  const classification = recheckHasAudio
    ? {
        classifiedVideos: 0,
        classifiedImages: 0,
        classifiedAnimations: 0,
        unknown: 0,
        metadataRowsCreated: 0
      }
    : await classifyUnknownMediaImages({
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

  // 新入库媒体已经直接写入 mediaType；为这些视频补齐探测队列，避免依赖 UNKNOWN 分类流程。
  if (!recheckHasAudio) {
    const videosWithoutMetadata = await prisma.image.findMany({
      where: {
        mediaType: 'VIDEO',
        videoMetadata: null
      },
      select: { id: true }
    })
    if (videosWithoutMetadata.length > 0) {
      await prisma.mediaVideoMetadata.createMany({
        data: videosWithoutMetadata.map(({ id }) => ({ imageId: id, probeStatus: 'PENDING' })),
        skipDuplicates: true
      })
    }
  }

  // Failed probes are deliberately sticky. Reprocessing every failure on each scheduled run creates
  // an unbounded failure storm; only an explicit force run may make them pending again.
  if (!recheckHasAudio && options.force) {
    await prisma.mediaVideoMetadata.updateMany({
      where: { probeStatus: 'FAILED' },
      data: { probeStatus: 'PENDING' }
    })
  }

  await ensureNotCancelled()
  const candidateWhere = recheckHasAudio
    ? {
        hasAudio: true,
        OR: [
          { probeStatus: { in: ['PENDING' as const, 'PROBING' as const, 'FAILED' as const] } },
          {
            probeStatus: 'COMPLETED' as const,
            OR: [{ probeUpdatedAt: null }, { probeUpdatedAt: { lt: checkpointCreatedAt } }]
          }
        ]
      }
    : { probeStatus: 'PENDING' as const }
  const totalPending = await prisma.mediaVideoMetadata.count({ where: candidateWhere })

  const result: VideoMediaProbeResult = {
    ...classification,
    mode,
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

  let lastSeenImageId = 0
  while (true) {
    await ensureNotCancelled()

    const batch = await prisma.mediaVideoMetadata.findMany({
      where: { ...candidateWhere, imageId: { gt: lastSeenImageId } },
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
    lastSeenImageId = batch[batch.length - 1]!.imageId

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
        if (metadata.chapterAudio) {
          await persistChapterAudioMeasurements(item.imageId, metadata.chapterAudio)
        }
        const videoMetadata = toPersistedVideoMetadata(metadata)

        await prisma.mediaVideoMetadata.update({
          where: { imageId: item.imageId },
          data: {
            probeStatus: 'COMPLETED',
            probeUpdatedAt: new Date(),
            probeError: null,
            ...videoMetadata
          }
        })

        result.processed += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (error instanceof VideoChapterAudioProbeError) {
          await persistChapterAudioFailure(item.imageId, error.chapterAudio, message)
        }
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
    await reportProgress(
      percentage,
      `已探测 ${attempts}/${totalPending} 个：成功 ${result.processed} 个，失败 ${result.failed} 个`
    )
  }

  result.remainingPending = await prisma.mediaVideoMetadata.count({
    where: candidateWhere
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
      const output =
        stdoutObject && typeof stdoutObject === 'object' && 'stdout' in stdoutObject ? String(stdoutObject.stdout) : ''
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
  if (
    resolvedInput !== normalizedScanRoot &&
    !resolvedInput.toLowerCase().startsWith(rootWithSeparator.toLowerCase())
  ) {
    throw new Error(`Path escapes scan root: ${inputPath}`)
  }

  const relativePath = resolvedInput.slice(normalizedScanRoot.length).replace(/^\/+/, '')
  return `/${relativePath}`
}

async function readCompanionChaptersAudioManifest(absolutePath: string) {
  const parsedPath = path.parse(absolutePath)
  const chaptersPath = path.join(parsedPath.dir, `${parsedPath.name}.chapters.json`)

  try {
    const raw = await fs.readFile(chaptersPath, 'utf8')
    const value = JSON.parse(raw) as unknown
    const audio = parseCompanionAudioManifest(value, parsedPath.base)
    if (!audio) return null
    const manifest = await validateChapterManifest(value)
    return { ...audio, chaptersHash: createChapterManifestHash(manifest) }
  } catch {
    return null
  }
}

async function detectAudibleAudioWindows(
  absolutePath: string,
  windows: readonly AudioSampleWindow[]
): Promise<boolean> {
  for (const window of windows) {
    const stderr = await detectAudioWindow(absolutePath, window)

    const maxVolume = parseVolumedetectMaxVolume(stderr)
    if (maxVolume === null) throw new Error('FFmpeg did not report a valid audio volume')
    if (isAudibleMaxVolume(maxVolume)) return true
  }

  return false
}

async function persistChapterAudioMeasurements(
  imageId: number,
  chapterAudio: NonNullable<VideoProbeMetadata['chapterAudio']>
) {
  await persistChapterAudioInBatches(imageId, chapterAudio, (chapter) => ({
    hasAudibleAudio: chapter.hasAudibleAudio,
    audioProbeError: null
  }))
}

function toPersistedVideoMetadata(metadata: VideoProbeMetadata): Omit<VideoProbeMetadata, 'chapterAudio'> {
  return {
    hasAudio: metadata.hasAudio,
    audioCodec: metadata.audioCodec,
    audioChannels: metadata.audioChannels,
    videoCodec: metadata.videoCodec,
    duration: metadata.duration,
    fps: metadata.fps
  }
}

async function persistChapterAudioFailure(
  imageId: number,
  chapterAudio: VideoChapterAudioReference,
  message: string
) {
  await persistChapterAudioInBatches(imageId, chapterAudio, () => ({
    hasAudibleAudio: null,
    audioProbeError: message
  }))
}

async function persistChapterAudioInBatches<TChapter extends VideoChapterAudioReference['chapters'][number]>(
  imageId: number,
  chapterAudio: { chaptersHash: string; chapters: TChapter[] },
  resultForChapter: (chapter: TChapter) => {
    hasAudibleAudio: boolean | null
    audioProbeError: string | null
  }
) {
  for (let offset = 0; offset < chapterAudio.chapters.length; offset += 50) {
    const batch = chapterAudio.chapters.slice(offset, offset + 50)
    await prisma.$transaction(
      batch.map((chapter) => {
        const result = resultForChapter(chapter)
        return prisma.mediaChapterPreview.upsert({
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
      })
    )
  }
}

function detectAudioWindow(absolutePath: string, window: AudioSampleWindow) {
  return execFfmpegForStderr([
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

export function resolvePathWithinScanRoot(scanRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(scanRoot)
  const resolvedPath = path.resolve(normalizedRoot, relativePath.replace(/^[/\\]+/, ''))
  const rootWithSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`

  if (resolvedPath !== normalizedRoot && !resolvedPath.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    throw new Error(`Path escapes scan root: ${relativePath}`)
  }

  return resolvedPath
}
