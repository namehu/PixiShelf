import logger from '@/lib/logger'
import {
  acknowledgeVideoKeyframePaused,
  claimNextVideoKeyframeJob,
  cleanupOrphanedVideoKeyframeStorage,
  completeVideoKeyframeJob,
  finalizeVideoKeyframeDiscoveryFailure,
  finalizeVideoKeyframeCancelled,
  finalizeVideoKeyframeFailure,
  getVideoKeyframeFfmpegThreads,
  getVideoKeyframeJobControl,
  parseVideoKeyframeDiscoveryRequest,
  processVideoKeyframeDiscoveryJob,
  recoverStaleVideoKeyframeJobs,
  requeueVideoKeyframeDiscoveryOnShutdown,
  requeueVideoKeyframeOnShutdown,
  requireVideoKeyframeScanPath,
  touchVideoKeyframeLease,
  updateVideoKeyframeProgress,
  VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE
} from '@/services/video-keyframe-queue'
import {
  generateVideoKeyframes,
  VideoKeyframeControlError,
  VideoKeyframePermanentError
} from '@/services/video-keyframe-service'

const POLL_INTERVAL_MS = 5_000
const CONTROL_POLL_INTERVAL_MS = 1_000
const HEARTBEAT_INTERVAL_MS = 30_000
const STALE_THRESHOLD_MS = 10 * 60 * 1000
const STALE_RECOVERY_INTERVAL_MS = 60_000
const ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export async function runVideoKeyframeWorkerLoop(options: { signal?: AbortSignal } = {}) {
  let lastStaleRecoveryAt = 0
  let lastOrphanCleanupAt = 0

  while (!options.signal?.aborted) {
    const now = Date.now()
    if (now - lastStaleRecoveryAt >= STALE_RECOVERY_INTERVAL_MS) {
      await recoverStaleVideoKeyframeJobs(new Date(now - STALE_THRESHOLD_MS))
      lastStaleRecoveryAt = now
    }
    if (now - lastOrphanCleanupAt >= ORPHAN_CLEANUP_INTERVAL_MS) {
      await cleanupOrphanedVideoKeyframeStorage().catch((error) => {
        logger.warn('Video keyframe orphan cleanup failed', { error })
      })
      lastOrphanCleanupAt = now
    }

    const claimed = await claimNextVideoKeyframeJob()
    if (!claimed) {
      await waitForAbortOrTimeout(options.signal, POLL_INTERVAL_MS)
      continue
    }

    if (claimed.type === VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE) {
      await processClaimedVideoKeyframeDiscoveryJob(claimed, options.signal)
    } else {
      await processClaimedVideoKeyframeJob(claimed, options.signal)
    }
  }
}

async function processClaimedVideoKeyframeDiscoveryJob(
  job: { id: string; attempt: number; result: unknown; mode: string | null },
  shutdownSignal?: AbortSignal
) {
  const controller = new AbortController()
  const onShutdown = () => {
    if (!controller.signal.aborted) {
      controller.abort(new VideoKeyframeControlError('SHUTDOWN', 'Worker is shutting down'))
    }
  }
  if (shutdownSignal?.aborted) onShutdown()
  else shutdownSignal?.addEventListener('abort', onShutdown, { once: true })

  const heartbeat = setInterval(() => {
    void touchVideoKeyframeLease(job.id, job.attempt)
      .then((valid) => {
        if (!valid && !controller.signal.aborted) {
          controller.abort(new VideoKeyframeControlError('LEASE_LOST', 'Video keyframe discovery lease was lost'))
        }
      })
      .catch((error) => {
        logger.warn('Video keyframe discovery heartbeat failed', { error, jobId: job.id })
        if (!controller.signal.aborted) {
          controller.abort(new VideoKeyframeControlError('LEASE_LOST', 'Video keyframe discovery heartbeat failed'))
        }
      })
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()

  try {
    await processVideoKeyframeDiscoveryJob({
      jobId: job.id,
      attempt: job.attempt,
      request: parseVideoKeyframeDiscoveryRequest(job.result),
      signal: controller.signal
    })
  } catch (error) {
    if (error instanceof VideoKeyframeControlError && ['SHUTDOWN', 'LEASE_LOST'].includes(error.reason)) {
      await requeueVideoKeyframeDiscoveryOnShutdown(job.id, job.attempt)
      return
    }
    const message = error instanceof Error ? error.message : 'Unknown video keyframe discovery failure'
    logger.error('Video keyframe discovery failed', { error, jobId: job.id })
    await finalizeVideoKeyframeDiscoveryFailure({
      jobId: job.id,
      attempt: job.attempt,
      error: message,
      recoverable: true,
      mode: job.mode
    })
  } finally {
    clearInterval(heartbeat)
    shutdownSignal?.removeEventListener('abort', onShutdown)
  }
}

async function processClaimedVideoKeyframeJob(
  job: { id: string; targetImageId: number | null; attempt: number; mode: string | null },
  shutdownSignal?: AbortSignal
) {
  if (job.targetImageId === null) {
    await finalizeVideoKeyframeFailure({
      jobId: job.id,
      attempt: job.attempt,
      error: 'Video keyframe job is missing targetImageId',
      recoverable: false,
      mode: job.mode
    })
    return
  }

  const controller = new AbortController()
  const abortWith = (reason: VideoKeyframeControlError) => {
    if (!controller.signal.aborted) controller.abort(reason)
  }
  const onShutdown = () => abortWith(new VideoKeyframeControlError('SHUTDOWN', 'Worker is shutting down'))
  if (shutdownSignal?.aborted) onShutdown()
  else shutdownSignal?.addEventListener('abort', onShutdown, { once: true })

  const heartbeat = setInterval(() => {
    void touchVideoKeyframeLease(job.id, job.attempt)
      .then((valid) => {
        if (!valid) abortWith(new VideoKeyframeControlError('LEASE_LOST', 'Video keyframe lease was lost'))
      })
      .catch((error) => {
        logger.warn('Video keyframe heartbeat failed', { error, jobId: job.id })
        abortWith(new VideoKeyframeControlError('LEASE_LOST', 'Video keyframe heartbeat failed'))
      })
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()

  const controlPoll = setInterval(() => {
    void getVideoKeyframeJobControl(job.id)
      .then((control) => {
        if (!control || control.attempt !== job.attempt) {
          abortWith(new VideoKeyframeControlError('LEASE_LOST', 'Video keyframe lease was lost'))
        } else if (control.status === 'PAUSING') {
          abortWith(new VideoKeyframeControlError('PAUSED', 'Video keyframe job was paused'))
        } else if (control.status === 'PAUSED') {
          return
        } else if (control.status === 'CANCELLING') {
          abortWith(new VideoKeyframeControlError('CANCELLED', 'Video keyframe job was cancelled'))
        } else if (control.status === 'COMPLETED') {
          return
        } else if (control.status !== 'RUNNING') {
          abortWith(new VideoKeyframeControlError('LEASE_LOST', 'Video keyframe job is no longer running'))
        }
      })
      .catch((error) => {
        logger.warn('Video keyframe control poll failed', { error, jobId: job.id })
      })
  }, CONTROL_POLL_INTERVAL_MS)
  controlPoll.unref()

  try {
    const result = await generateVideoKeyframes({
      jobId: job.id,
      attempt: job.attempt,
      imageId: job.targetImageId,
      scanPath: await requireVideoKeyframeScanPath(),
      ffmpegThreads: getVideoKeyframeFfmpegThreads(),
      signal: controller.signal,
      onProgress: ({ percentage, message }) => updateVideoKeyframeProgress(job.id, job.attempt, percentage, message)
    })
    await completeVideoKeyframeJob(job.id, job.attempt, result)
  } catch (error) {
    const control = await getVideoKeyframeJobControl(job.id).catch(() => null)
    if (control?.attempt === job.attempt && control.status === 'PAUSING') {
      const acknowledged = await acknowledgeVideoKeyframePaused(job.id, job.attempt)
      if (acknowledged?.status === 'CANCELLING') await finalizeVideoKeyframeCancelled(job.id, job.attempt)
      return
    }
    if (control?.attempt === job.attempt && control.status === 'PAUSED') return
    if (control?.attempt === job.attempt && control.status === 'CANCELLING') {
      await finalizeVideoKeyframeCancelled(job.id, job.attempt)
      return
    }
    if (error instanceof VideoKeyframeControlError) {
      if (error.reason === 'PAUSED') return
      if (error.reason === 'CANCELLED') {
        await finalizeVideoKeyframeCancelled(job.id, job.attempt)
        return
      }
      if (error.reason === 'LEASE_LOST') {
        await requeueVideoKeyframeOnShutdown(job.id, job.attempt)
        return
      }
      await requeueVideoKeyframeOnShutdown(job.id, job.attempt)
      return
    }

    const message = error instanceof Error ? error.message : 'Unknown video keyframe failure'
    logger.error('Video keyframe generation failed', { error, jobId: job.id, imageId: job.targetImageId })
    await finalizeVideoKeyframeFailure({
      jobId: job.id,
      attempt: job.attempt,
      error: message,
      recoverable: !(error instanceof VideoKeyframePermanentError),
      mode: job.mode
    })
  } finally {
    clearInterval(heartbeat)
    clearInterval(controlPoll)
    shutdownSignal?.removeEventListener('abort', onShutdown)
  }
}

function waitForAbortOrTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  if (signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, timeoutMs)
    timeout.unref()
    signal?.addEventListener('abort', finish, { once: true })

    function finish() {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
  })
}
