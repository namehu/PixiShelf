import 'server-only'

import logger from '@/lib/logger'
import * as JobService from '@/services/job-service'
import { getScanPath } from '@/services/setting.service'
import {
  optimizeVideoForStreaming,
  recoverInterruptedVideoOptimization,
  resolveVideoStreamingOptimizationTarget
} from '@/services/video-streaming-optimization-service'

const HEARTBEAT_INTERVAL_MS = 30_000
const STALE_JOB_THRESHOLD_MS = 10 * 60 * 1000
const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000

let processorPromise: Promise<void> | null = null
let rerunRequested = false
let lastMaintenanceAt = 0

export async function enqueueVideoOptimization(imageId: number) {
  const scanPath = await requireScanPath()
  const target = await resolveVideoStreamingOptimizationTarget(imageId, scanPath)
  const queued = await JobService.enqueueVideoStreamingOptimizationJob({ imageId: target.id, path: target.path })
  wakeVideoOptimizationQueue()

  return {
    jobId: queued.job.id,
    imageId: target.id,
    path: target.path,
    status: queued.job.status,
    queuePosition: queued.queuePosition,
    reused: queued.reused
  }
}

export async function cancelVideoOptimization(jobId: string) {
  const result = await JobService.cancelVideoStreamingOptimizationJob(jobId)
  if (result?.changed) wakeVideoOptimizationQueue()
  return result
}

export function wakeVideoOptimizationQueue() {
  if (processorPromise) {
    rerunRequested = true
    return
  }

  processorPromise = drainVideoOptimizationQueue()
    .catch((error) => {
      logger.error('Video optimization queue processor failed', { error })
    })
    .finally(() => {
      processorPromise = null
      if (rerunRequested) {
        rerunRequested = false
        wakeVideoOptimizationQueue()
      }
    })
}

export async function drainVideoOptimizationQueue() {
  const scanPath = await requireScanPath()
  await maintainVideoOptimizationQueue(scanPath)

  while (true) {
    const job = await JobService.claimNextVideoStreamingOptimizationJob()
    if (!job) return
    if (job.targetImageId === null) {
      await JobService.failJob(job.id, 'Video optimization job is missing targetImageId')
      continue
    }

    const heartbeatTimer = setInterval(() => {
      void JobService.touchJobHeartbeat(job.id).catch((error) => {
        logger.warn('Failed to update video optimization heartbeat', { error, jobId: job.id })
      })
    }, HEARTBEAT_INTERVAL_MS)

    try {
      const result = await optimizeVideoForStreaming({
        imageId: job.targetImageId,
        scanPath,
        operationId: job.id,
        checkCancelled: async () => {
          const current = await JobService.getJob(job.id)
          return current?.status === 'CANCELLING'
        },
        onProgress: async (progress) => {
          await JobService.updateProgress(job.id, progress.percentage, progress.message)
        }
      })
      await JobService.completeJob(job.id, result)
    } catch (error) {
      logger.error('Queued video optimization failed', {
        error,
        jobId: job.id,
        imageId: job.targetImageId,
        path: job.targetPath
      })
      const current = await JobService.getJob(job.id)
      if (current?.status === 'CANCELLING' || (error instanceof Error && error.message === 'Task cancelled')) {
        await JobService.markAsCancelled(job.id)
      } else {
        await JobService.failJob(job.id, error instanceof Error ? error.message : 'Unknown error')
      }
    } finally {
      clearInterval(heartbeatTimer)
    }
  }
}

async function maintainVideoOptimizationQueue(scanPath: string) {
  const now = Date.now()
  const staleJobs = await JobService.recoverStaleVideoStreamingOptimizationJobs(new Date(now - STALE_JOB_THRESHOLD_MS))

  for (const job of staleJobs) {
    if (job.targetImageId === null) continue
    try {
      await recoverInterruptedVideoOptimization({
        imageId: job.targetImageId,
        scanPath,
        operationId: job.id
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown recovery error'
      logger.error('Failed to recover interrupted video optimization artifacts', {
        error,
        jobId: job.id,
        imageId: job.targetImageId
      })
      await JobService.failJob(job.id, `Service interruption recovery failed: ${message}`)
    }
  }

  if (now - lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS) {
    await JobService.deleteExpiredVideoStreamingOptimizationJobs(new Date(now - HISTORY_RETENTION_MS))
    lastMaintenanceAt = now
  }
}

async function requireScanPath() {
  const scanPath = await getScanPath()
  if (!scanPath) throw new Error('Scan path is not configured')
  return scanPath
}
