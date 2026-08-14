import 'server-only'

import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { resolveCreatablePathWithinRoot, resolveExistingPathWithinRoot } from '@/lib/safe-path'
import { assertLegacyBackgroundExecutionAllowed } from '@/services/background-task/dispatcher-cutover'
import {
  prepareVideoStreamingOptimization,
  recoverVideoStreamingOptimizationArtifacts,
  runVideoProcess,
  type VideoProcessingDatabase,
  type VideoProcessingTransaction,
  type VideoStreamingOptimizationResult
} from '@pixishelf/job-executors'

export interface VideoStreamingOptimizationTarget {
  id: number
  path: string
  sourcePath: string
}

export type { VideoStreamingOptimizationResult }
export interface VideoStreamingOptimizationProgress {
  percentage: number
  message: string
}

/**
 * Request-time validation shared by legacy callers. FFmpeg execution deliberately
 * does not live in Next anymore; the central executor repeats these checks under a
 * fenced worker lease before touching the source file.
 */
export async function resolveVideoStreamingOptimizationTarget(
  imageId: number,
  scanPath: string
): Promise<VideoStreamingOptimizationTarget> {
  const image = await prisma.image.findUnique({
    where: { id: imageId },
    select: { id: true, path: true, mediaType: true }
  })
  if (!image) throw new Error('Image not found')
  if (String(image.mediaType).toUpperCase() !== 'VIDEO' && !isVideoPath(image.path)) {
    throw new Error('Image is not a video')
  }
  if (path.extname(image.path).toLowerCase() !== '.mp4') throw new Error('Only MP4 videos can be optimized')
  const sourcePath = await resolveExistingPathWithinRoot(scanPath, image.path.replace(/^[/\\]+/, ''))
  return { id: image.id, path: image.path, sourcePath }
}

export async function optimizeVideoForStreaming(options: {
  imageId: number
  scanPath: string
  operationId?: string
  onProgress?: (progress: VideoStreamingOptimizationProgress) => Promise<void> | void
  checkCancelled?: () => Promise<boolean> | boolean
}): Promise<VideoStreamingOptimizationResult> {
  assertLegacyBackgroundExecutionAllowed('VIDEO_STREAMING_OPTIMIZATION')
  const target = await resolveVideoStreamingOptimizationTarget(options.imageId, options.scanPath)
  const controller = new AbortController()
  const poll = createCancellationPoll(options.checkCancelled, controller)
  let prepared: Awaited<ReturnType<typeof prepareVideoStreamingOptimization>> | undefined
  try {
    if (await options.checkCancelled?.()) controller.abort(new Error('Task cancelled'))
    prepared = await prepareVideoStreamingOptimization({
      jobId: options.operationId ?? `legacy-stream-${Date.now()}`,
      attempt: 1,
      imageId: target.id,
      relativePath: target.path.replace(/^[/\\]+/, ''),
      database: prisma as unknown as VideoProcessingDatabase,
      config: {
        scanRoot: options.scanPath,
        chapterPreviewRoot: options.scanPath,
        ffmpegThreads: 1
      },
      processRunner: runVideoProcess,
      signal: controller.signal,
      progress: async (progress) => {
        await options.onProgress?.({ percentage: progress.percentage, message: progress.message })
      },
      mutate: <T>(operation: (transaction: VideoProcessingTransaction) => Promise<T>) =>
        prisma.$transaction((transaction) => operation(transaction as unknown as VideoProcessingTransaction))
    })
    await prisma.$transaction((transaction) => prepared!.publish(transaction as unknown as VideoProcessingTransaction))
    return prepared.result
  } catch (error) {
    if (prepared) {
      try {
        await prepared.rollback()
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          'Video streaming optimization failed and the original file could not be restored'
        )
      }
    }
    throw error
  } finally {
    if (poll) clearInterval(poll)
  }
}

export async function recoverInterruptedVideoOptimization(options: {
  imageId: number
  scanPath: string
  operationId: string
}) {
  assertLegacyBackgroundExecutionAllowed('VIDEO_STREAMING_OPTIMIZATION_RECOVERY')
  const image = await prisma.image.findUnique({
    where: { id: options.imageId },
    select: { id: true, path: true }
  })
  if (!image) throw new Error('Image not found')
  const sourcePath = await resolveCreatablePathWithinRoot(options.scanPath, image.path.replace(/^[/\\]+/, ''))
  await recoverVideoStreamingOptimizationArtifacts(sourcePath, options.operationId)
  const stat = await import('node:fs/promises').then((fs) => fs.stat(sourcePath))
  await prisma.image.update({ where: { id: image.id }, data: { size: BigInt(stat.size) } })
}

function createCancellationPoll(
  checkCancelled: (() => Promise<boolean> | boolean) | undefined,
  controller: AbortController
) {
  if (!checkCancelled) return undefined
  const timer = setInterval(() => {
    void Promise.resolve(checkCancelled())
      .then((cancelled) => {
        if (cancelled && !controller.signal.aborted) controller.abort(new Error('Task cancelled'))
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          controller.abort(error instanceof Error ? error : new Error('Cancellation check failed'))
        }
      })
  }, 250)
  timer.unref()
  return timer
}

function isVideoPath(relativePath: string) {
  return /\.(?:mp4|webm|mkv|mov|avi|m4v|wmv|flv)$/i.test(relativePath)
}
