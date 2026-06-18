import 'server-only'

import path from 'path'
import * as childProcess from 'node:child_process'
import { prisma } from '@/lib/prisma'
import { isApngFile, isGifFile, isImageFile, isVideoFile } from '@/lib/media'

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

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  channels?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: {
    duration?: string
  }
}

export async function classifyUnknownMediaImages(): Promise<VideoMediaClassificationResult> {
  const result: VideoMediaClassificationResult = {
    classifiedVideos: 0,
    classifiedImages: 0,
    classifiedAnimations: 0,
    unknown: 0,
    metadataRowsCreated: 0
  }

  let lastSeenId = 0

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
  const audioStream = streams.find((stream) => stream.codec_type === 'audio')

  return {
    hasAudio: Boolean(audioStream),
    audioCodec: audioStream?.codec_name ?? null,
    audioChannels: typeof audioStream?.channels === 'number' ? audioStream.channels : null,
    videoCodec: videoStream?.codec_name ?? null,
    duration: parseNumber(parsed.format?.duration) ?? parseNumber(videoStream?.duration),
    fps: parseFps(videoStream?.avg_frame_rate) ?? parseFps(videoStream?.r_frame_rate)
  }
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

  await reportProgress(1, '正在分类媒体类型...')
  const classification = await classifyUnknownMediaImages()

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

  await reportProgress(5, `待探测视频 ${totalPending} 个，每批 ${PROBE_BATCH_SIZE} 个`)

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
    const percentage = Math.min(99, 5 + Math.floor((attempts / totalPending) * 94))
    await reportProgress(percentage, `已探测 ${result.processed} 个，失败 ${result.failed} 个`)
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

function parseNumber(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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
