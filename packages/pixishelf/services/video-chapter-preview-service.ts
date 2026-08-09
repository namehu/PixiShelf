import 'server-only'

import * as childProcess from 'node:child_process'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import {
  createChapterManifestHash,
  readChapterManifestByStoredPath,
  type VideoChapter,
  type VideoChapterManifest
} from '@/services/artwork-service/video-chapters'
import { resolvePathWithinScanRoot } from '@/services/video-media-probe-service'

const PREVIEW_ROOT =
  process.env.VIDEO_CHAPTER_PREVIEW_STORAGE_PATH || path.join(process.cwd(), '.local-data', 'video-chapter-previews')
const FAILED_SAMPLE_LIMIT = 20
const BLACK_FRAME_LUMA_THRESHOLD = 16
const CAPTURE_EPSILON_SECONDS = 0.05
const FFMPEG_TIMEOUT_MS = 2 * 60 * 1000
const CANCELLATION_POLL_INTERVAL_MS = 1000
const PROCESS_TERMINATION_GRACE_MS = 5000
const FILE_LOCK_RETRY_DELAYS_MS = [50, 100, 250, 500, 1000]

type CancellationCheck = () => Promise<boolean> | boolean

export type VideoChapterPreviewGenerationMode = 'FULL' | 'INCREMENTAL'

export interface VideoChapterPreviewGenerationResult {
  mode: VideoChapterPreviewGenerationMode
  pending: number
  processed: number
  reused: number
  generated: number
  failed: number
  orphanedFilesDeleted: number
  failedSamples: Array<{ imageId: number; path: string; chapterOrder: number | null; error: string }>
}

export interface VideoChapterPreviewProgress {
  percentage: number
  message: string
}

interface ChapterWorkItem {
  imageId: number
  videoPath: string
  chaptersHash: string
  chapterOrder: number
  chapter: VideoChapter
  expectedPath: string
  captureTimes: number[]
  reusable: boolean
}

export async function runVideoChapterPreviewGenerationJob(options: {
  scanPath: string
  mode?: VideoChapterPreviewGenerationMode
  onProgress?: (progress: VideoChapterPreviewProgress) => Promise<void> | void
  checkCancelled?: () => Promise<boolean> | boolean
}): Promise<VideoChapterPreviewGenerationResult> {
  const mode = options.mode ?? 'FULL'
  const report = (percentage: number, message: string) => options.onProgress?.({ percentage, message })
  const ensureNotCancelled = async () => {
    if (await options.checkCancelled?.()) throw new Error('Task cancelled')
  }

  await fs.mkdir(PREVIEW_ROOT, { recursive: true })
  await report(1, mode === 'FULL' ? '正在全量校验章节清单并计算待生成截图...' : '正在查询尚未完成的章节截图...')

  const result: VideoChapterPreviewGenerationResult = {
    mode,
    pending: 0,
    processed: 0,
    reused: 0,
    generated: 0,
    failed: 0,
    orphanedFilesDeleted: 0,
    failedSamples: []
  }
  const workItems: ChapterWorkItem[] = []
  const videos = await findVideosForGeneration(mode)
  if (mode === 'FULL') {
    const activeImageIds = videos.map((video) => video.id)
    await prisma.mediaChapterPreview.deleteMany({
      where: activeImageIds.length > 0 ? { imageId: { notIn: activeImageIds } } : {}
    })
  }

  for (const video of videos) {
    await ensureNotCancelled()
    try {
      const manifest = await readChapterManifestByStoredPath(video.chaptersPath!)
      if (!manifest) throw new Error('Chapter manifest not found')

      const chaptersHash = createChapterManifestHash(manifest)
      await syncImageChapterSummary(video, manifest, chaptersHash)
      const existingByOrder = new Map(video.chapterPreviews.map((preview) => [preview.chapterOrder, preview]))

      const obsolete = video.chapterPreviews.filter((preview) => preview.chapterOrder >= manifest.chapters.length)
      if (obsolete.length > 0) {
        await prisma.mediaChapterPreview.deleteMany({ where: { id: { in: obsolete.map((preview) => preview.id) } } })
      }

      for (const [chapterOrder, chapter] of manifest.chapters.entries()) {
        const expectedPath = buildPreviewRelativePath(video.id, chaptersHash, chapterOrder)
        const current = existingByOrder.get(chapterOrder)
        const reusable = Boolean(
          current &&
            current.status === 'COMPLETED' &&
            current.chaptersHash === chaptersHash &&
            current.previewPath === expectedPath &&
            (await isFile(path.join(PREVIEW_ROOT, expectedPath)))
        )

        workItems.push({
          imageId: video.id,
          videoPath: video.path,
          chaptersHash,
          chapterOrder,
          chapter,
          expectedPath,
          captureTimes: buildChapterCaptureTimes(chapter.start, chapter.end),
          reusable
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      result.failed += 1
      pushFailedSample(result, { imageId: video.id, path: video.path, chapterOrder: null, error: message })
      await prisma.mediaChapterPreview.updateMany({
        where: { imageId: video.id },
        data: { status: 'FAILED', error: message, previewPath: null, previewUpdatedAt: null }
      })
    }
  }

  result.reused = workItems.filter((item) => item.reusable).length
  const pendingItems = workItems.filter((item) => !item.reusable)
  result.pending = pendingItems.length

  if (pendingItems.length === 0) {
    if (mode === 'FULL') {
      result.orphanedFilesDeleted = await cleanupOrphanedPreviews()
      await report(100, `全量校验完成：复用 ${result.reused} 张，清理孤儿 ${result.orphanedFilesDeleted} 张`)
    } else {
      await report(100, '增量补齐完成：没有待生成章节截图')
    }
    return result
  }

  await report(2, `待生成章节截图 ${pendingItems.length} 张，复用 ${result.reused} 张`)
  for (const item of pendingItems) {
    await ensureNotCancelled()
    result.processed += 1
    const initialCaptureTime = item.captureTimes[0] ?? item.chapter.start

    await prisma.mediaChapterPreview.upsert({
      where: { imageId_chapterOrder: { imageId: item.imageId, chapterOrder: item.chapterOrder } },
      create: {
        imageId: item.imageId,
        chapterOrder: item.chapterOrder,
        chapterIndex: item.chapter.index,
        chaptersHash: item.chaptersHash,
        chapterStart: item.chapter.start,
        captureTime: initialCaptureTime,
        status: 'GENERATING'
      },
      update: {
        chapterIndex: item.chapter.index,
        chaptersHash: item.chaptersHash,
        chapterStart: item.chapter.start,
        captureTime: initialCaptureTime,
        status: 'GENERATING',
        previewPath: null,
        previewUpdatedAt: null,
        error: null
      }
    })

    try {
      const outputPath = path.join(PREVIEW_ROOT, item.expectedPath)
      const sourcePath = resolvePathWithinScanRoot(options.scanPath, item.videoPath)
      const capture = await generateRepresentativePreview(sourcePath, outputPath, item.captureTimes, {
        checkCancelled: options.checkCancelled,
        ensureNotCancelled
      })
      const now = new Date()

      await prisma.mediaChapterPreview.update({
        where: { imageId_chapterOrder: { imageId: item.imageId, chapterOrder: item.chapterOrder } },
        data: {
          status: 'COMPLETED',
          previewPath: item.expectedPath,
          captureTime: capture.captureTime,
          previewUpdatedAt: now,
          error: null
        }
      })
      result.generated += 1
    } catch (error) {
      if (isTaskCancelledError(error)) {
        await prisma.mediaChapterPreview.update({
          where: { imageId_chapterOrder: { imageId: item.imageId, chapterOrder: item.chapterOrder } },
          data: { status: 'PENDING', previewPath: null, previewUpdatedAt: null, error: null }
        })
        throw error
      }

      const message = error instanceof Error ? error.message : 'Unknown error'
      result.failed += 1
      pushFailedSample(result, {
        imageId: item.imageId,
        path: item.videoPath,
        chapterOrder: item.chapterOrder,
        error: message
      })
      await prisma.mediaChapterPreview.update({
        where: { imageId_chapterOrder: { imageId: item.imageId, chapterOrder: item.chapterOrder } },
        data: { status: 'FAILED', previewPath: null, previewUpdatedAt: null, error: message }
      })
    }

    const percentage = Math.min(99, 2 + Math.floor((result.processed / pendingItems.length) * 97))
    await report(
      percentage,
      `已处理 ${result.processed}/${pendingItems.length}：生成 ${result.generated}，失败 ${result.failed}，复用 ${result.reused}`
    )
  }

  if (mode === 'FULL') {
    result.orphanedFilesDeleted = await cleanupOrphanedPreviews()
  }
  await report(
    100,
    `${mode === 'FULL' ? '全量生成' : '增量补齐'}完成：生成 ${result.generated}，失败 ${result.failed}，复用 ${result.reused}${
      mode === 'FULL' ? `，清理孤儿 ${result.orphanedFilesDeleted}` : ''
    }`
  )
  return result
}

const VIDEO_GENERATION_SELECT = {
  id: true,
  path: true,
  chaptersPath: true,
  chaptersHash: true,
  chaptersCount: true,
  chaptersDuration: true,
  chapterPreviews: {
    orderBy: { chapterOrder: 'asc' as const },
    select: {
      id: true,
      chapterOrder: true,
      chaptersHash: true,
      status: true,
      previewPath: true
    }
  }
} as const

async function findVideosForGeneration(mode: VideoChapterPreviewGenerationMode) {
  if (mode === 'FULL') {
    return prisma.image.findMany({
      where: { chaptersPath: { not: null } },
      orderBy: { id: 'asc' },
      select: VIDEO_GENERATION_SELECT
    })
  }

  const candidates = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT image."id"
    FROM "Image" AS image
    WHERE image."chaptersPath" IS NOT NULL
      AND (
        SELECT COUNT(*)
        FROM "MediaChapterPreview" AS preview
        WHERE preview."imageId" = image."id"
          AND preview."status" = 'COMPLETED'
          AND preview."chaptersHash" = image."chaptersHash"
          AND preview."previewPath" IS NOT NULL
      ) < image."chaptersCount"
    ORDER BY image."id" ASC
  `

  if (candidates.length === 0) return []

  return prisma.image.findMany({
    where: { id: { in: candidates.map((candidate) => candidate.id) } },
    orderBy: { id: 'asc' },
    select: VIDEO_GENERATION_SELECT
  })
}

export function buildChapterCaptureTimes(start: number, end: number): number[] {
  const duration = Math.max(0, end - start)
  const midpoint = start + duration / 2
  if (duration <= 0) return [Math.max(start, 0)]

  const inset = Math.min(0.1, duration / 4)
  const minimum = start + inset
  const maximum = Math.max(minimum, end - inset)
  const clamp = (value: number) => Math.min(Math.max(value, minimum), maximum)
  const candidates = [duration >= 1.2 ? clamp(start + 1) : midpoint, clamp(start + 3), midpoint]

  return candidates.filter(
    (candidate, index) =>
      candidates.findIndex((other) => Math.abs(other - candidate) < CAPTURE_EPSILON_SECONDS) === index
  )
}

export function calculateFrameLuma(channels: Array<{ mean: number }>): number {
  if (channels.length === 0) return 0
  if (channels.length < 3) return channels[0]?.mean ?? 0
  return 0.2126 * channels[0]!.mean + 0.7152 * channels[1]!.mean + 0.0722 * channels[2]!.mean
}

function buildPreviewRelativePath(imageId: number, chaptersHash: string, chapterOrder: number) {
  return `${imageId}-${chaptersHash.slice(0, 16)}-${chapterOrder}.webp`
}

async function syncImageChapterSummary(
  video: { id: number; chaptersHash: string | null; chaptersCount: number; chaptersDuration: number | null },
  manifest: VideoChapterManifest,
  chaptersHash: string
) {
  if (
    video.chaptersHash === chaptersHash &&
    video.chaptersCount === manifest.chapters.length &&
    video.chaptersDuration === manifest.duration
  ) {
    return
  }

  await prisma.image.update({
    where: { id: video.id },
    data: {
      chaptersHash,
      chaptersCount: manifest.chapters.length,
      chaptersDuration: manifest.duration,
      chaptersUpdatedAt: new Date()
    }
  })
}

async function generateRepresentativePreview(
  sourcePath: string,
  outputPath: string,
  captureTimes: number[],
  options: {
    checkCancelled?: CancellationCheck
    ensureNotCancelled: () => Promise<void>
  }
) {
  if (captureTimes.length === 0) throw new Error('No valid chapter capture time')
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  const candidates: Array<{ path: string; captureTime: number; luma: number }> = []
  const candidatePaths: string[] = []
  let selected: (typeof candidates)[number] | undefined

  try {
    for (const [index, captureTime] of captureTimes.entries()) {
      await options.ensureNotCancelled()
      const candidatePath = `${outputPath}.${process.pid}.${Date.now()}.${index}.tmp.webp`
      candidatePaths.push(candidatePath)
      await extractFrame(sourcePath, candidatePath, captureTime, options.checkCancelled)
      await options.ensureNotCancelled()
      // Sharp/libvips may retain a path-backed file handle briefly on Windows, which prevents
      // the candidate from being renamed. Reading first closes the filesystem handle before Sharp runs.
      const candidateBuffer = await fs.readFile(candidatePath)
      const stats = await sharp(candidateBuffer).stats()
      const candidate = { path: candidatePath, captureTime, luma: calculateFrameLuma(stats.channels) }
      candidates.push(candidate)

      if (candidate.luma >= BLACK_FRAME_LUMA_THRESHOLD) {
        selected = candidate
        break
      }
    }

    selected ??= candidates.reduce((brightest, candidate) => (candidate.luma > brightest.luma ? candidate : brightest))
    await options.ensureNotCancelled()
    await removeFileWithRetry(outputPath)
    await renameFileWithRetry(selected.path, outputPath)
    return { captureTime: selected.captureTime, luma: selected.luma }
  } finally {
    await Promise.all(candidatePaths.map((candidatePath) => removeFileWithRetry(candidatePath).catch(() => undefined)))
  }
}

async function extractFrame(
  sourcePath: string,
  outputPath: string,
  captureTime: number,
  checkCancelled?: CancellationCheck
) {
  await execFfmpeg(
    [
      '-y',
      '-ss',
      captureTime.toFixed(3),
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-vf',
      "scale='min(640,iw)':-2",
      '-c:v',
      'libwebp',
      '-q:v',
      '80',
      outputPath
    ],
    checkCancelled
  )
}

async function cleanupOrphanedPreviews() {
  const rows = await prisma.mediaChapterPreview.findMany({
    where: { previewPath: { not: null } },
    select: { previewPath: true }
  })
  const referenced = new Set(rows.flatMap((row) => (row.previewPath ? [row.previewPath] : [])))
  const entries = await fs.readdir(PREVIEW_ROOT, { withFileTypes: true }).catch(() => [])
  let deleted = 0

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.webp') || referenced.has(entry.name)) continue
    try {
      await removeFileWithRetry(path.join(PREVIEW_ROOT, entry.name))
      deleted += 1
    } catch (error) {
      // A recently released FFmpeg/Sharp handle can remain busy briefly on Windows. Leave the
      // orphan for the next run instead of failing an otherwise completed generation task.
      if (!isRetryableFileLockError(error)) throw error
    }
  }
  return deleted
}

async function removeFileWithRetry(filePath: string) {
  return retryFileOperation(() => fs.rm(filePath, { force: true }))
}

async function renameFileWithRetry(sourcePath: string, destinationPath: string) {
  return retryFileOperation(() => fs.rename(sourcePath, destinationPath))
}

async function retryFileOperation<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const retryDelay = FILE_LOCK_RETRY_DELAYS_MS[attempt]
      if (retryDelay === undefined || !isRetryableFileLockError(error)) throw error
      await wait(retryDelay)
    }
  }
}

function isRetryableFileLockError(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function isFile(filePath: string) {
  return fs
    .stat(filePath)
    .then((stat) => stat.isFile())
    .catch(() => false)
}

function pushFailedSample(
  result: VideoChapterPreviewGenerationResult,
  sample: VideoChapterPreviewGenerationResult['failedSamples'][number]
) {
  if (result.failedSamples.length < FAILED_SAMPLE_LIMIT) result.failedSamples.push(sample)
}

function execFfmpeg(args: string[], checkCancelled?: CancellationCheck) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let cancellationTimer: ReturnType<typeof setTimeout> | undefined
    let terminationTimer: ReturnType<typeof setTimeout> | undefined
    let terminationError: Error | undefined
    let child: ReturnType<typeof childProcess.execFile> | undefined

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (cancellationTimer) clearTimeout(cancellationTimer)
      if (terminationTimer) clearTimeout(terminationTimer)
      if (error) reject(error)
      else resolve()
    }

    const terminate = (error: Error) => {
      if (settled || terminationError) return
      terminationError = error
      if (!child?.kill('SIGKILL')) {
        finish(error)
        return
      }
      terminationTimer = setTimeout(() => finish(error), PROCESS_TERMINATION_GRACE_MS)
    }

    const pollCancellation = async () => {
      if (settled || !checkCancelled) return
      try {
        if (await checkCancelled()) {
          terminate(new Error('Task cancelled'))
          return
        }
      } catch (error) {
        terminate(error instanceof Error ? error : new Error('Failed to check task cancellation'))
        return
      }
      if (!settled) {
        cancellationTimer = setTimeout(() => void pollCancellation(), CANCELLATION_POLL_INTERVAL_MS)
      }
    }

    child = childProcess.execFile(
      'ffmpeg',
      args,
      {
        maxBuffer: 1024 * 1024 * 10,
        timeout: FFMPEG_TIMEOUT_MS,
        killSignal: 'SIGKILL'
      },
      (error, _stdout, stderr) => {
        if (terminationError) {
          finish(terminationError)
        } else if (error) {
          const processError = error as Error & { killed?: boolean }
          finish(
            processError.killed
              ? new Error(`FFmpeg timed out after ${FFMPEG_TIMEOUT_MS}ms`)
              : new Error(String(stderr || error.message).trim())
          )
        } else {
          finish()
        }
      }
    )

    void pollCancellation()
  })
}

function isTaskCancelledError(error: unknown): error is Error {
  return error instanceof Error && error.message === 'Task cancelled'
}
