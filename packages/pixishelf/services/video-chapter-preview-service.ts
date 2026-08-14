import 'server-only'

import { prisma } from '@/lib/prisma'
import { assertLegacyBackgroundExecutionAllowed } from '@/services/background-task/dispatcher-cutover'
import { VIDEO_CHAPTER_PREVIEW_STORAGE_ROOT } from '@/services/derived-media-storage'
import {
  generateVideoChapterPreviews,
  runVideoProcess,
  type VideoChapterPreviewGenerationMode,
  type VideoChapterPreviewGenerationResult,
  type VideoProcessingDatabase,
  type VideoProcessingTransaction
} from '@pixishelf/job-executors'

export type { VideoChapterPreviewGenerationMode, VideoChapterPreviewGenerationResult }

/**
 * Compatibility adapter for the dark-launch period. Once the central cutover flag
 * is true this path is a hard error, so Next and pixishelf-worker cannot consume the
 * same logical work. The final cutover removes this adapter entirely.
 */
export async function runVideoChapterPreviewGenerationJob(options: {
  scanPath: string
  mode?: VideoChapterPreviewGenerationMode
  onProgress?: (progress: { percentage: number; message: string }) => Promise<void> | void
  checkCancelled?: () => Promise<boolean> | boolean
}): Promise<VideoChapterPreviewGenerationResult> {
  assertLegacyBackgroundExecutionAllowed('VIDEO_CHAPTER_PREVIEW_GENERATION')
  const controller = new AbortController()
  const poll = options.checkCancelled
    ? setInterval(() => {
        void Promise.resolve(options.checkCancelled?.())
          .then((cancelled) => {
            if (cancelled && !controller.signal.aborted) controller.abort(new Error('Task cancelled'))
          })
          .catch((error) => {
            if (!controller.signal.aborted) {
              controller.abort(error instanceof Error ? error : new Error('Cancellation check failed'))
            }
          })
      }, 250)
    : undefined
  poll?.unref()
  try {
    if (await options.checkCancelled?.()) controller.abort(new Error('Task cancelled'))
    return await generateVideoChapterPreviews({
      jobId: 'legacy-chapter-compat',
      attempt: 1,
      mode: options.mode ?? 'FULL',
      database: prisma as unknown as VideoProcessingDatabase,
      config: {
        scanRoot: options.scanPath,
        chapterPreviewRoot: VIDEO_CHAPTER_PREVIEW_STORAGE_ROOT,
        ffmpegThreads: readPositiveInteger(process.env.FFMPEG_THREADS, 1)
      },
      processRunner: runVideoProcess,
      signal: controller.signal,
      progress: async (progress) => {
        await options.onProgress?.({ percentage: progress.percentage, message: progress.message })
      },
      mutate: <T>(operation: (transaction: VideoProcessingTransaction) => Promise<T>) =>
        prisma.$transaction((transaction) => operation(transaction as unknown as VideoProcessingTransaction))
    })
  } finally {
    if (poll) clearInterval(poll)
  }
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
