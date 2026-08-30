import * as fs from 'node:fs/promises'
import sharp from 'sharp'
import {
  buildChapterAudioSampleWindows,
  isAudibleMaxVolume,
  parseVolumedetectMaxVolume
} from '../video-audio/detection.ts'
import { createChapterManifestHash, readChapterManifest } from './chapter-manifest.ts'
import { assertNoFinalSymlink, resolveCreatablePathWithinRoot, resolveExistingPathWithinRoot } from './paths.ts'
import { throwIfAborted } from './process-runner.ts'
import type {
  RunFencedVideoMutation,
  VideoProcessingDatabase,
  VideoProcessingProgress,
  VideoProcessingRuntimeConfig,
  VideoProcessRunner
} from './types.ts'
import { VideoProcessingRecoveryError } from './types.ts'

const FAILED_SAMPLE_LIMIT = 20
const CAPTURE_EPSILON_SECONDS = 0.05
const BLACK_FRAME_LUMA_THRESHOLD = 16
const MAX_PAGE_SIZE = 200
const MAX_CHAPTERS_PER_VIDEO = 1_000
const WEBP_VALIDATION_CONCURRENCY = 8
const FILE_OPERATION_RETRY_DELAYS_MS = [0, 50, 100, 250, 500, 1_000]

export type VideoChapterPreviewGenerationMode = 'FULL' | 'INCREMENTAL'

export interface VideoChapterPreviewGenerationResult {
  mode: VideoChapterPreviewGenerationMode
  pending: number
  processed: number
  reused: number
  generated: number
  failed: number
  audioProcessed: number
  audioAudible: number
  audioSilent: number
  audioFailed: number
  gcEntriesCreated: number
  orphanedFilesDeleted: 0
  deferredCleanup: true
  failedSamples: Array<{ imageId: number; path: string; chapterOrder: number | null; error: string }>
}

export async function generateVideoChapterPreviews(input: {
  jobId: string
  systemJobId?: string
  attempt: number
  mode: VideoChapterPreviewGenerationMode
  database: VideoProcessingDatabase
  config: VideoProcessingRuntimeConfig
  processRunner: VideoProcessRunner
  signal: AbortSignal
  progress: (progress: VideoProcessingProgress) => Promise<void>
  mutate: RunFencedVideoMutation
}): Promise<VideoChapterPreviewGenerationResult> {
  const pageSize = Math.min(input.config.chapterPageSize ?? 50, MAX_PAGE_SIZE)
  const processTimeoutMs = input.config.chapterProcessTimeoutMs ?? 2 * 60_000
  const result: VideoChapterPreviewGenerationResult = {
    mode: input.mode,
    pending: 0,
    processed: 0,
    reused: 0,
    generated: 0,
    failed: 0,
    audioProcessed: 0,
    audioAudible: 0,
    audioSilent: 0,
    audioFailed: 0,
    gcEntriesCreated: 0,
    orphanedFilesDeleted: 0,
    deferredCleanup: true,
    failedSamples: []
  }
  await fs.mkdir(input.config.chapterPreviewRoot, { recursive: true })
  await input.progress({ percentage: 1, stage: 'DISCOVER', message: '正在分页检查视频章节预览' })

  let afterId = 0
  while (true) {
    throwIfAborted(input.signal)
    // Every query is bounded. This intentionally avoids materializing the complete
    // library in INCREMENTAL mode and keeps the worker memory profile predictable.
    const videos = await input.database.image.findMany({
      where: {
        id: { gt: afterId },
        chaptersPath: { not: null },
        mediaType: 'VIDEO'
      },
      orderBy: { id: 'asc' },
      take: pageSize,
      select: {
        id: true,
        path: true,
        chaptersPath: true,
        chapterPreviews: {
          orderBy: { chapterOrder: 'asc' },
          take: MAX_CHAPTERS_PER_VIDEO + 1,
          select: {
            id: true,
            chapterOrder: true,
            chapterIndex: true,
            chaptersHash: true,
            status: true,
            previewPath: true,
            hasAudibleAudio: true,
            audioChaptersHash: true
          }
        }
      }
    })
    if (videos.length === 0) break
    for (const video of videos) {
      afterId = video.id
      throwIfAborted(input.signal)
      try {
        if (video.chapterPreviews.length > MAX_CHAPTERS_PER_VIDEO) {
          throw new Error(`Video ${video.id} exceeds the ${MAX_CHAPTERS_PER_VIDEO} chapter preview limit`)
        }
        const manifest = await readChapterManifest(input.config.scanRoot, video.chaptersPath!)
        const chaptersHash = createChapterManifestHash(manifest)
        if (
          input.mode === 'INCREMENTAL' &&
          (await canReuseIncrementalChapterPreviews({
            imageId: video.id,
            chaptersHash,
            chapterCount: manifest.chapters.length,
            previews: video.chapterPreviews,
            previewRoot: input.config.chapterPreviewRoot
          }))
        ) {
          result.reused += manifest.chapters.length
          continue
        }
        const previews = new Map(video.chapterPreviews.map((preview) => [preview.chapterOrder, preview]))
        const obsolete = video.chapterPreviews.filter((preview) => preview.chapterOrder >= manifest.chapters.length)
        if (obsolete.length > 0) {
          result.gcEntriesCreated += await input.mutate(async (transaction) => {
            let created = 0
            for (const preview of obsolete) {
              if (preview.previewPath) {
                await upsertChapterGcIntent(transaction, {
                  path: preview.previewPath,
                  referenceId: preview.id,
                  jobId: input.systemJobId ?? null,
                  reason: 'CHAPTER_REMOVED'
                })
                created += 1
              }
            }
            await transaction.mediaChapterPreview.deleteMany({ where: { id: { in: obsolete.map((item) => item.id) } } })
            return created
          })
        }
        await input.mutate((transaction) =>
          transaction.image.update({
            where: { id: video.id },
            data: {
              chaptersHash,
              chaptersCount: manifest.chapters.length,
              chaptersDuration: manifest.duration,
              chaptersUpdatedAt: new Date()
            }
          })
        )

        let sourcePath: string | null = null
        let hasReadableAudioStream: boolean | null = null
        for (const [chapterOrder, chapter] of manifest.chapters.entries()) {
          throwIfAborted(input.signal)
          const expectedPath = buildChapterPreviewRelativePath(video.id, chaptersHash, chapterOrder)
          const current = previews.get(chapterOrder)
          const canReusePreview =
            current?.status === 'COMPLETED' &&
            current.chaptersHash === chaptersHash &&
            current.previewPath === expectedPath &&
            (await isValidWebpAtRoot(input.config.chapterPreviewRoot, expectedPath))
          const canReuseAudio =
            current?.audioChaptersHash === chaptersHash && typeof current.hasAudibleAudio === 'boolean'
          if (canReusePreview && canReuseAudio) {
            result.reused += 1
            continue
          }

          sourcePath ??= await resolveExistingPathWithinRoot(input.config.scanRoot, video.path)
          if (!canReuseAudio) {
            result.audioProcessed += 1
            try {
              const before = await sourceFingerprint(sourcePath)
              hasReadableAudioStream ??= await detectReadableAudioStream({
                sourcePath,
                timeoutMs: processTimeoutMs,
                signal: input.signal,
                processRunner: input.processRunner,
                ...(input.config.ffprobePath ? { ffprobePath: input.config.ffprobePath } : {})
              })
              const hasAudibleAudio = hasReadableAudioStream
                ? await detectChapterAudibility({
                    sourcePath,
                    chapterStart: chapter.start,
                    chapterEnd: chapter.end,
                    timeoutMs: processTimeoutMs,
                    signal: input.signal,
                    processRunner: input.processRunner,
                    ...(input.config.ffmpegPath ? { ffmpegPath: input.config.ffmpegPath } : {})
                  })
                : false
              await assertSourceUnchanged(sourcePath, before)
              await input.mutate((transaction) =>
                transaction.mediaChapterPreview.upsert({
                  where: { imageId_chapterOrder: { imageId: video.id, chapterOrder } },
                  create: {
                    imageId: video.id,
                    chapterOrder,
                    chapterIndex: chapter.index,
                    chaptersHash,
                    chapterStart: chapter.start,
                    captureTime: chapter.start,
                    status: 'PENDING',
                    hasAudibleAudio,
                    audioChaptersHash: chaptersHash,
                    audioProbeError: null
                  },
                  update: { hasAudibleAudio, audioChaptersHash: chaptersHash, audioProbeError: null }
                })
              )
              if (hasAudibleAudio) result.audioAudible += 1
              else result.audioSilent += 1
            } catch (error) {
              if (input.signal.aborted) throw error
              const message = errorMessage(error)
              result.audioFailed += 1
              pushFailure(result, { imageId: video.id, path: video.path, chapterOrder, error: message })
              await input.mutate((transaction) =>
                transaction.mediaChapterPreview.upsert({
                  where: { imageId_chapterOrder: { imageId: video.id, chapterOrder } },
                  create: {
                    imageId: video.id,
                    chapterOrder,
                    chapterIndex: chapter.index,
                    chaptersHash,
                    chapterStart: chapter.start,
                    captureTime: chapter.start,
                    status: 'PENDING',
                    hasAudibleAudio: null,
                    audioChaptersHash: chaptersHash,
                    audioProbeError: message
                  },
                  update: {
                    hasAudibleAudio: null,
                    audioChaptersHash: chaptersHash,
                    audioProbeError: message
                  }
                })
              )
            }
          }

          if (canReusePreview) {
            result.reused += 1
            await input.progress({
              percentage: Math.min(95, 5 + Math.floor((90 * result.audioProcessed) / (result.audioProcessed + 50))),
              stage: 'AUDIO_PROBE',
              message: `已检测 ${result.audioProcessed} 个章节音频`,
              data: {
                audioAudible: result.audioAudible,
                audioSilent: result.audioSilent,
                audioFailed: result.audioFailed
              }
            })
            continue
          }
          result.pending += 1
          result.processed += 1
          const oldPath = current?.previewPath ?? null
          const captureTimes = buildChapterCaptureTimes(chapter.start, chapter.end)
          const initialCaptureTime = captureTimes[0] ?? chapter.start
          const temporaryRelativePath = chapterTemporaryRelativePath(expectedPath, input.jobId, input.attempt)
          const temporaryPath = await resolveCreatablePathWithinRoot(
            input.config.chapterPreviewRoot,
            temporaryRelativePath
          )
          await input.mutate(async (transaction) => {
            const checkpoint = await transaction.mediaChapterPreview.upsert({
              where: { imageId_chapterOrder: { imageId: video.id, chapterOrder } },
              create: {
                imageId: video.id,
                chapterOrder,
                chapterIndex: chapter.index,
                chaptersHash,
                chapterStart: chapter.start,
                captureTime: initialCaptureTime,
                status: 'GENERATING'
              },
              update: {
                chapterIndex: chapter.index,
                chaptersHash,
                chapterStart: chapter.start,
                captureTime: initialCaptureTime,
                status: 'GENERATING',
                error: null
              },
              select: { id: true }
            })
            await upsertChapterGcIntent(transaction, {
              path: temporaryRelativePath,
              referenceId: checkpoint.id,
              jobId: input.systemJobId ?? null,
              reason: 'CHAPTER_ATTEMPT_OUTPUT',
              notBefore: new Date(Date.now() + 24 * 60 * 60_000)
            })
          })
          result.gcEntriesCreated += 1
          try {
            await recoverPriorChapterPublicationBackups({
              previewRoot: input.config.chapterPreviewRoot,
              expectedPath,
              jobId: input.jobId,
              attempt: input.attempt
            })
            const before = await sourceFingerprint(sourcePath)
            const captured = await extractRepresentativeChapterPreview({
              sourcePath,
              temporaryPath,
              captureTimes,
              ffmpegThreads: input.config.ffmpegThreads,
              timeoutMs: processTimeoutMs,
              signal: input.signal,
              processRunner: input.processRunner,
              ...(input.config.ffmpegPath ? { ffmpegPath: input.config.ffmpegPath } : {})
            })
            await assertSourceUnchanged(sourcePath, before)
            await publishChapterPreview({
              jobId: input.systemJobId ?? null,
              imageId: video.id,
              chapterOrder,
              expectedPath,
              oldPath,
              temporaryPath,
              captureTime: captured.captureTime,
              previewRoot: input.config.chapterPreviewRoot,
              artifactJobId: input.jobId,
              attempt: input.attempt,
              mutate: input.mutate
            })
            if (oldPath && oldPath !== expectedPath) result.gcEntriesCreated += 1
            result.generated += 1
          } catch (error) {
            await removeFileWithRetry(temporaryPath).catch(() => undefined)
            if (error instanceof VideoProcessingRecoveryError) throw error
            if (input.signal.aborted) {
              await input.mutate((transaction) =>
                transaction.mediaChapterPreview.update({
                  where: { imageId_chapterOrder: { imageId: video.id, chapterOrder } },
                  data: { status: 'PENDING', error: null }
                })
              )
              throw error
            }
            const message = errorMessage(error)
            result.failed += 1
            pushFailure(result, { imageId: video.id, path: video.path, chapterOrder, error: message })
            await input.mutate((transaction) =>
              transaction.mediaChapterPreview.update({
                where: { imageId_chapterOrder: { imageId: video.id, chapterOrder } },
                data: { status: 'FAILED', error: message }
              })
            )
          }
          await input.progress({
            percentage: Math.min(95, 5 + Math.floor((90 * result.processed) / (result.processed + 50))),
            stage: 'GENERATE',
            message: `已处理 ${result.processed} 张章节预览`,
            data: { generated: result.generated, failed: result.failed, reused: result.reused }
          })
        }
      } catch (error) {
        if (error instanceof VideoProcessingRecoveryError) throw error
        if (input.signal.aborted) throw error
        result.failed += 1
        const message = errorMessage(error)
        pushFailure(result, { imageId: video.id, path: video.path, chapterOrder: null, error: message })
        await input.mutate((transaction) =>
          transaction.mediaChapterPreview.updateMany({
            where: { imageId: video.id },
            data: { status: 'FAILED', error: message }
          })
        )
      }
    }
    if (videos.length < pageSize) break
  }

  if (input.mode === 'FULL') {
    result.gcEntriesCreated += await reconcileRemovedChapterManifests(input, pageSize)
  }
  await input.progress({
    percentage: 100,
    stage: 'COMPLETE',
    message: `章节预览完成：生成 ${result.generated}，失败 ${result.failed}，复用 ${result.reused}；音频检测 ${result.audioProcessed}，失败 ${result.audioFailed}`,
    data: { gcEntriesCreated: result.gcEntriesCreated, audioFailed: result.audioFailed }
  })
  return result
}

async function canReuseIncrementalChapterPreviews(input: {
  imageId: number
  chaptersHash: string
  chapterCount: number
  previews: Array<{
    chapterOrder: number
    chaptersHash: string
    status: string
    previewPath: string | null
    hasAudibleAudio: boolean | null
    audioChaptersHash: string | null
  }>
  previewRoot: string
}) {
  if (input.chapterCount > MAX_CHAPTERS_PER_VIDEO || input.previews.length !== input.chapterCount) return false
  const byOrder = new Map(input.previews.map((preview) => [preview.chapterOrder, preview]))
  if (byOrder.size !== input.chapterCount) return false

  const expectedPaths: string[] = []
  for (let chapterOrder = 0; chapterOrder < input.chapterCount; chapterOrder += 1) {
    const expectedPath = buildChapterPreviewRelativePath(input.imageId, input.chaptersHash, chapterOrder)
    const preview = byOrder.get(chapterOrder)
    if (
      !preview ||
      preview.status !== 'COMPLETED' ||
      preview.chaptersHash !== input.chaptersHash ||
      preview.previewPath !== expectedPath ||
      preview.audioChaptersHash !== input.chaptersHash ||
      typeof preview.hasAudibleAudio !== 'boolean'
    ) {
      return false
    }
    expectedPaths.push(expectedPath)
  }

  return everyWithConcurrency(expectedPaths, WEBP_VALIDATION_CONCURRENCY, (relativePath) =>
    isValidWebpAtRoot(input.previewRoot, relativePath)
  )
}

async function detectReadableAudioStream(input: {
  sourcePath: string
  ffprobePath?: string
  timeoutMs: number
  signal: AbortSignal
  processRunner: VideoProcessRunner
}) {
  const output = await input.processRunner({
    command: input.ffprobePath ?? 'ffprobe',
    args: [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-count_packets',
      '-show_entries',
      'stream=nb_read_packets',
      '-of',
      'json',
      input.sourcePath
    ],
    timeoutMs: input.timeoutMs,
    signal: input.signal
  })
  let parsed: { streams?: Array<{ nb_read_packets?: string }> }
  try {
    parsed = JSON.parse(output.stdout) as { streams?: Array<{ nb_read_packets?: string }> }
  } catch {
    throw new Error('FFprobe returned invalid chapter audio stream JSON')
  }
  const stream = parsed.streams?.[0]
  if (!stream) return false
  if (stream.nb_read_packets === undefined) return true
  const packetCount = Number(stream.nb_read_packets)
  return !Number.isFinite(packetCount) || packetCount > 0
}

async function detectChapterAudibility(input: {
  sourcePath: string
  chapterStart: number
  chapterEnd: number
  ffmpegPath?: string
  timeoutMs: number
  signal: AbortSignal
  processRunner: VideoProcessRunner
}) {
  const windows = buildChapterAudioSampleWindows(input.chapterStart, input.chapterEnd)
  if (windows.length === 0) throw new Error('Chapter audio bounds are invalid')

  for (const window of windows) {
    const output = await input.processRunner({
      command: input.ffmpegPath ?? 'ffmpeg',
      args: [
        '-nostdin',
        '-hide_banner',
        '-v',
        'info',
        '-ss',
        window.start.toFixed(3),
        '-t',
        window.duration.toFixed(3),
        '-i',
        input.sourcePath,
        '-vn',
        '-map',
        '0:a:0',
        '-af',
        'volumedetect',
        '-f',
        'null',
        '-'
      ],
      timeoutMs: input.timeoutMs,
      signal: input.signal
    })
    const maxVolume = parseVolumedetectMaxVolume(output.stderr)
    if (maxVolume === null) throw new Error('FFmpeg did not report a valid chapter audio volume')
    if (isAudibleMaxVolume(maxVolume)) return true
  }

  return false
}

async function everyWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  predicate: (value: T) => Promise<boolean>
) {
  let nextIndex = 0
  let valid = true
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (valid) {
        const index = nextIndex
        nextIndex += 1
        if (index >= values.length) return
        if (!(await predicate(values[index]!))) valid = false
      }
    })
  )
  return valid
}

async function reconcileRemovedChapterManifests(
  input: Pick<Parameters<typeof generateVideoChapterPreviews>[0], 'database' | 'systemJobId' | 'mutate' | 'signal'>,
  pageSize: number
) {
  let afterId: string | undefined
  let created = 0
  while (true) {
    throwIfAborted(input.signal)
    const previews = await input.database.mediaChapterPreview.findMany({
      where: {
        image: { chaptersPath: null },
        ...(afterId ? { id: { gt: afterId } } : {})
      },
      orderBy: { id: 'asc' },
      take: pageSize,
      select: { id: true, previewPath: true }
    })
    if (previews.length === 0) break
    afterId = previews.at(-1)!.id
    created += await input.mutate(async (transaction) => {
      let pageCreated = 0
      for (const preview of previews) {
        if (!preview.previewPath) continue
        await upsertChapterGcIntent(transaction, {
          path: preview.previewPath,
          referenceId: preview.id,
          jobId: input.systemJobId ?? null,
          reason: 'CHAPTER_MANIFEST_REMOVED'
        })
        pageCreated += 1
      }
      await transaction.mediaChapterPreview.deleteMany({ where: { id: { in: previews.map((item) => item.id) } } })
      return pageCreated
    })
    if (previews.length < pageSize) break
  }
  return created
}

async function extractRepresentativeChapterPreview(input: {
  sourcePath: string
  temporaryPath: string
  captureTimes: number[]
  ffmpegPath?: string
  ffmpegThreads: number
  timeoutMs: number
  signal: AbortSignal
  processRunner: VideoProcessRunner
}) {
  for (const captureTime of input.captureTimes) {
    throwIfAborted(input.signal)
    await removeFileWithRetry(input.temporaryPath).catch(() => undefined)
    await input.processRunner({
      command: input.ffmpegPath ?? 'ffmpeg',
      args: buildChapterPreviewArgs({
        sourcePath: input.sourcePath,
        outputPath: input.temporaryPath,
        captureTime,
        threads: input.ffmpegThreads
      }),
      timeoutMs: input.timeoutMs,
      signal: input.signal
    })
    const metrics = await validateChapterPreview(input.temporaryPath)
    if (metrics.luma >= BLACK_FRAME_LUMA_THRESHOLD) return { captureTime }
  }
  throw new Error('FFmpeg only produced dark chapter preview candidates')
}

export function buildChapterPreviewArgs(input: {
  sourcePath: string
  outputPath: string
  captureTime: number
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
    '-vf',
    "scale='min(640,iw)':-2",
    '-c:v',
    'libwebp',
    '-q:v',
    '80',
    input.outputPath
  ]
}

async function publishChapterPreview(input: {
  jobId: string | null
  imageId: number
  chapterOrder: number
  expectedPath: string
  oldPath: string | null
  temporaryPath: string
  captureTime: number
  previewRoot: string
  artifactJobId: string
  attempt: number
  mutate: RunFencedVideoMutation
}) {
  const outputPath = await resolveCreatablePathWithinRoot(input.previewRoot, input.expectedPath)
  const backupRelativePath = chapterBackupRelativePath(input.expectedPath, input.artifactJobId, input.attempt)
  const backupPath = await resolveCreatablePathWithinRoot(input.previewRoot, backupRelativePath)
  let promoted = false
  let backupCreated = false
  try {
    await input.mutate(async (transaction) => {
      const [outputStat] = await Promise.all([
        assertNoFinalSymlink(outputPath),
        assertNoFinalSymlink(input.temporaryPath),
        assertNoFinalSymlink(backupPath)
      ])
      if (outputStat) {
        await renameFileWithRetry(outputPath, backupPath)
        backupCreated = true
      }
      await renameFileWithRetry(input.temporaryPath, outputPath)
      promoted = true
      await validateChapterPreview(outputPath)
      const preview = await transaction.mediaChapterPreview.update({
        where: { imageId_chapterOrder: { imageId: input.imageId, chapterOrder: input.chapterOrder } },
        data: {
          status: 'COMPLETED',
          previewPath: input.expectedPath,
          previewUpdatedAt: new Date(),
          captureTime: input.captureTime,
          error: null
        },
        select: { id: true }
      })
      if (input.oldPath && input.oldPath !== input.expectedPath) {
        await upsertChapterGcIntent(transaction, {
          path: input.oldPath,
          referenceId: preview.id,
          jobId: input.jobId,
          reason: 'CHAPTER_PREVIEW_SUPERSEDED'
        })
      }
      if (backupCreated) {
        await upsertChapterGcIntent(transaction, {
          path: backupRelativePath,
          referenceId: preview.id,
          jobId: input.jobId,
          reason: 'CHAPTER_PUBLICATION_BACKUP'
        })
      }
    })
  } catch (error) {
    try {
      if (promoted) {
        await assertNoFinalSymlink(outputPath)
        await removeFileWithRetry(outputPath)
      }
      if (backupCreated) {
        await assertNoFinalSymlink(backupPath)
        await renameFileWithRetry(backupPath, outputPath)
      }
    } catch (recoveryError) {
      throw new VideoProcessingRecoveryError(
        'Chapter preview publication failed and the previous preview could not be restored; manual action is required',
        error,
        recoveryError
      )
    }
    throw error
  }
}

async function recoverPriorChapterPublicationBackups(input: {
  previewRoot: string
  expectedPath: string
  jobId: string
  attempt: number
}) {
  const outputPath = await resolveCreatablePathWithinRoot(input.previewRoot, input.expectedPath)
  for (let currentAttempt = input.attempt; currentAttempt >= 1; currentAttempt -= 1) {
    const backupPath = await resolveCreatablePathWithinRoot(
      input.previewRoot,
      chapterBackupRelativePath(input.expectedPath, input.jobId, currentAttempt)
    )
    const backupStat = await assertNoFinalSymlink(backupPath)
    if (!backupStat) continue
    try {
      await assertNoFinalSymlink(outputPath)
      await removeFileWithRetry(outputPath)
      await renameFileWithRetry(backupPath, outputPath)
    } catch (recoveryError) {
      throw new VideoProcessingRecoveryError(
        'A previous chapter preview attempt could not be restored; manual action is required',
        null,
        recoveryError
      )
    }
  }
}

function chapterBackupRelativePath(expectedPath: string, jobId: string, attempt: number) {
  return `${expectedPath}.job-${safeArtifactJobId(jobId)}-a${attempt}.backup.webp`
}

async function upsertChapterGcIntent(
  transaction: Parameters<RunFencedVideoMutation>[0] extends (value: infer T) => unknown ? T : never,
  input: { path: string; referenceId: string; jobId: string | null; reason: string; notBefore?: Date }
) {
  await transaction.derivedMediaGcEntry.upsert({
    where: { mediaKind_relativePath: { mediaKind: 'VIDEO_CHAPTER_PREVIEW', relativePath: input.path } },
    create: {
      mediaKind: 'VIDEO_CHAPTER_PREVIEW',
      relativePath: input.path,
      referenceType: 'MEDIA_CHAPTER_PREVIEW',
      referenceId: input.referenceId,
      reason: input.reason,
      notBefore: input.notBefore ?? new Date(),
      ...(input.jobId ? { lastSystemJobId: input.jobId } : {})
    },
    update: {
      referenceType: 'MEDIA_CHAPTER_PREVIEW',
      referenceId: input.referenceId,
      reason: input.reason,
      status: 'PENDING',
      notBefore: input.notBefore ?? new Date(),
      ...(input.jobId ? { lastSystemJobId: input.jobId } : {}),
      attempt: 0,
      error: null,
      deletedAt: null
    }
  })
}

function buildChapterPreviewRelativePath(imageId: number, chaptersHash: string, chapterOrder: number) {
  return `${imageId}/${chaptersHash}/${chapterOrder}.webp`
}

function buildChapterCaptureTimes(start: number, end: number) {
  const length = Math.max(0, end - start)
  return [0.2, 0.5, 0.8].map((ratio) =>
    Math.max(start + CAPTURE_EPSILON_SECONDS, Math.min(end - CAPTURE_EPSILON_SECONDS, start + length * ratio))
  )
}

function chapterTemporaryRelativePath(expectedPath: string, jobId: string, attempt: number) {
  return `${expectedPath}.job-${safeArtifactJobId(jobId)}-a${attempt}.tmp.webp`
}

function safeArtifactJobId(jobId: string) {
  return jobId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120)
}

async function renameFileWithRetry(source: string, target: string) {
  return retryFileOperation(() => fs.rename(source, target))
}

async function removeFileWithRetry(filePath: string) {
  return retryFileOperation(() => fs.rm(filePath, { force: true }))
}

async function retryFileOperation<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (const delay of FILE_OPERATION_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay))
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') throw error
    }
  }
  throw lastError
}

async function validateChapterPreview(filePath: string) {
  const { data, info } = await sharp(await fs.readFile(filePath))
    .resize(32, 32, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== 32 || info.height !== 32 || data.length === 0) throw new Error('FFmpeg produced an invalid WebP')
  return { luma: [...data].reduce((sum, value) => sum + value, 0) / data.length }
}

async function isValidWebpAtRoot(root: string, relativePath: string) {
  try {
    const filePath = await resolveExistingPathWithinRoot(root, relativePath)
    const metadata = await sharp(await fs.readFile(filePath)).metadata()
    return metadata.format === 'webp' && Boolean(metadata.width && metadata.height)
  } catch {
    return false
  }
}

async function sourceFingerprint(filePath: string) {
  const stat = await fs.stat(filePath)
  return { size: stat.size, mtimeMs: stat.mtimeMs }
}

async function assertSourceUnchanged(filePath: string, before: { size: number; mtimeMs: number }) {
  const after = await sourceFingerprint(filePath)
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error('Source video changed while its chapter preview was generated')
  }
}

function pushFailure(
  result: VideoChapterPreviewGenerationResult,
  failure: VideoChapterPreviewGenerationResult['failedSamples'][number]
) {
  if (result.failedSamples.length < FAILED_SAMPLE_LIMIT) result.failedSamples.push(failure)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown video chapter preview failure'
}
