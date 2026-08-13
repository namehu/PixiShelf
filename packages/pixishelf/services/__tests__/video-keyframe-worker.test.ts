import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  claimMock,
  completeMock,
  cancelMock,
  failureMock,
  controlMock,
  recoverMock,
  cleanupMock,
  acknowledgeMock,
  requeueMock,
  discoveryMock,
  discoveryFailureMock,
  discoveryRequeueMock,
  generateMock
} = vi.hoisted(() => ({
  claimMock: vi.fn(),
  completeMock: vi.fn(),
  cancelMock: vi.fn(),
  failureMock: vi.fn(),
  controlMock: vi.fn(),
  recoverMock: vi.fn(),
  cleanupMock: vi.fn(),
  acknowledgeMock: vi.fn(),
  requeueMock: vi.fn(),
  discoveryMock: vi.fn(),
  discoveryFailureMock: vi.fn(),
  discoveryRequeueMock: vi.fn(),
  generateMock: vi.fn()
}))

vi.mock('@/services/video-keyframe-queue', () => ({
  claimNextVideoKeyframeJob: claimMock,
  cleanupOrphanedVideoKeyframeStorage: cleanupMock,
  acknowledgeVideoKeyframePaused: acknowledgeMock,
  completeVideoKeyframeJob: completeMock,
  finalizeVideoKeyframeCancelled: cancelMock,
  finalizeVideoKeyframeFailure: failureMock,
  finalizeVideoKeyframeDiscoveryFailure: discoveryFailureMock,
  getVideoKeyframeFfmpegThreads: vi.fn(() => 2),
  getVideoKeyframeJobControl: controlMock,
  recoverStaleVideoKeyframeJobs: recoverMock,
  parseVideoKeyframeDiscoveryRequest: vi.fn((result) => result.request),
  processVideoKeyframeDiscoveryJob: discoveryMock,
  requeueVideoKeyframeDiscoveryOnShutdown: discoveryRequeueMock,
  requeueVideoKeyframeOnShutdown: requeueMock,
  requireVideoKeyframeScanPath: vi.fn(() => Promise.resolve('/scan')),
  touchVideoKeyframeLease: vi.fn(() => Promise.resolve(true)),
  updateVideoKeyframeProgress: vi.fn(),
  VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE: 'VIDEO_KEYFRAME_DISCOVERY'
}))

vi.mock('@/services/video-keyframe-service', () => ({
  generateVideoKeyframes: generateMock,
  VideoKeyframeControlError: class VideoKeyframeControlError extends Error {
    constructor(
      public readonly reason: string,
      message: string
    ) {
      super(message)
    }
  },
  VideoKeyframePermanentError: class VideoKeyframePermanentError extends Error {
    constructor(
      public readonly code: string,
      message: string
    ) {
      super(message)
    }
  }
}))

import { VideoKeyframeControlError, VideoKeyframePermanentError } from '../video-keyframe-service'
import { runVideoKeyframeWorkerLoop } from '../video-keyframe-worker'

describe('video keyframe worker', () => {
  beforeEach(() => {
    claimMock.mockReset()
    completeMock.mockReset()
    cancelMock.mockReset().mockResolvedValue(undefined)
    failureMock.mockReset().mockResolvedValue(undefined)
    controlMock.mockReset()
    recoverMock.mockReset().mockResolvedValue(0)
    cleanupMock.mockReset().mockResolvedValue({ removed: 0, deferred: 0 })
    acknowledgeMock.mockReset().mockResolvedValue({ status: 'PAUSED', attempt: 1 })
    requeueMock.mockReset().mockResolvedValue(undefined)
    discoveryMock.mockReset().mockResolvedValue(undefined)
    discoveryFailureMock.mockReset().mockResolvedValue(undefined)
    discoveryRequeueMock.mockReset().mockResolvedValue(undefined)
    generateMock.mockReset()
  })

  it('honors cancellation when it races with a progress or completion error', async () => {
    const controller = new AbortController()
    claimMock.mockResolvedValueOnce({ id: 'job-1', targetImageId: 9, attempt: 1 }).mockImplementationOnce(() => {
      controller.abort()
      return Promise.resolve(null)
    })
    generateMock.mockRejectedValueOnce(new Error('Video keyframe job lease was lost'))
    controlMock.mockResolvedValueOnce({ status: 'CANCELLING', attempt: 1 })

    await runVideoKeyframeWorkerLoop({ signal: controller.signal })

    expect(cancelMock).toHaveBeenCalledWith('job-1', 1)
    expect(failureMock).not.toHaveBeenCalled()
  })

  it('acknowledges PAUSED only after the processing call exits', async () => {
    const controller = new AbortController()
    claimMock.mockResolvedValueOnce({ id: 'job-1', targetImageId: 9, attempt: 1 }).mockImplementationOnce(() => {
      controller.abort()
      return Promise.resolve(null)
    })
    generateMock.mockRejectedValueOnce(new Error('processing stopped'))
    controlMock.mockResolvedValueOnce({ status: 'PAUSING', attempt: 1 })

    await runVideoKeyframeWorkerLoop({ signal: controller.signal })

    expect(acknowledgeMock).toHaveBeenCalledWith('job-1', 1)
    expect(failureMock).not.toHaveBeenCalled()
  })

  it('settles the current lease when a heartbeat failure stops processing', async () => {
    const controller = new AbortController()
    claimMock.mockResolvedValueOnce({ id: 'job-1', targetImageId: 9, attempt: 1 }).mockImplementationOnce(() => {
      controller.abort()
      return Promise.resolve(null)
    })
    generateMock.mockRejectedValueOnce(new VideoKeyframeControlError('LEASE_LOST', 'heartbeat failed'))
    controlMock.mockResolvedValueOnce({ status: 'RUNNING', attempt: 1 })

    await runVideoKeyframeWorkerLoop({ signal: controller.signal })

    expect(requeueMock).toHaveBeenCalledWith('job-1', 1)
    expect(failureMock).not.toHaveBeenCalled()
  })

  it('fails a deterministic generation error immediately without scheduling another attempt', async () => {
    const controller = new AbortController()
    claimMock
      .mockResolvedValueOnce({
        id: 'job-1',
        targetImageId: 9,
        attempt: 1,
        mode: 'MANUAL_INCREMENTAL'
      })
      .mockImplementationOnce(() => {
        controller.abort()
        return Promise.resolve(null)
      })
    generateMock.mockRejectedValueOnce(
      new VideoKeyframePermanentError('INSUFFICIENT_DISTINCT_FRAMES', 'not enough distinct frames')
    )
    controlMock.mockResolvedValueOnce({ status: 'RUNNING', attempt: 1 })

    await runVideoKeyframeWorkerLoop({ signal: controller.signal })

    expect(failureMock).toHaveBeenCalledWith({
      jobId: 'job-1',
      attempt: 1,
      error: 'not enough distinct frames',
      recoverable: false,
      mode: 'MANUAL_INCREMENTAL'
    })
  })

  it('requeues an interrupted durable discovery after the worker restarts', async () => {
    const controller = new AbortController()
    claimMock
      .mockResolvedValueOnce({
        id: 'discovery-1',
        type: 'VIDEO_KEYFRAME_DISCOVERY',
        attempt: 1,
        result: { request: { trigger: 'schedule', force: false, filter: {} } }
      })
      .mockImplementationOnce(() => {
        controller.abort()
        return Promise.resolve(null)
      })
    discoveryMock.mockRejectedValueOnce(new VideoKeyframeControlError('SHUTDOWN', 'worker stopped'))

    await runVideoKeyframeWorkerLoop({ signal: controller.signal })

    expect(discoveryRequeueMock).toHaveBeenCalledWith('discovery-1', 1)
    expect(discoveryFailureMock).not.toHaveBeenCalled()
  })
})
