import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  imageFindUnique: vi.fn(),
  jobFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  enqueueJob: vi.fn(),
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  retry: vi.fn(),
  getJob: vi.fn()
}))

const transaction = {
  image: { findUnique: mocks.imageFindUnique },
  systemJob: { findFirst: mocks.jobFindFirst },
  $queryRawUnsafe: mocks.queryRaw
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    image: { findUnique: mocks.imageFindUnique },
    systemJob: { findFirst: mocks.jobFindFirst },
    $transaction: (operation: (client: typeof transaction) => unknown) => operation(transaction)
  }
}))
vi.mock('@/services/background-task', () => ({
  enqueueJob: mocks.enqueueJob,
  cancelJobCommand: mocks.cancel,
  pauseJobCommand: mocks.pause,
  resumeJobCommand: mocks.resume,
  retryJobCommand: mocks.retry,
  getJobById: mocks.getJob
}))

import {
  cancelActiveCentralVideoChapterPreview,
  controlCentralVideoProcessingJob,
  enqueueCentralScheduledVideoChapterPreview,
  enqueueCentralVideoChapterPreview,
  enqueueCentralVideoStreamingOptimization,
  retryCentralVideoProcessingJob
} from '../video-processing-central-service'

describe('video processing central enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.jobFindFirst.mockResolvedValue(null)
    mocks.queryRaw.mockResolvedValue([])
    mocks.enqueueJob.mockResolvedValue({ id: 'job-new', status: 'PENDING' })
    mocks.cancel.mockResolvedValue({ id: 'job-existing', status: 'CANCELLING' })
    mocks.retry.mockResolvedValue({ id: 'job-retry', status: 'PENDING' })
  })

  it('reuses an active chapter job under the advisory lock', async () => {
    mocks.jobFindFirst.mockResolvedValue({ id: 'job-existing', status: 'RUNNING', payload: { mode: 'FULL' } })
    await expect(enqueueCentralVideoChapterPreview({ mode: 'FULL', requestedByUserId: 'admin-1' })).resolves.toEqual({
      jobId: 'job-existing',
      status: 'RUNNING',
      reused: true
    })
    expect(mocks.jobFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          definitionVersion: 1,
          payload: { path: ['mode'], equals: 'FULL' }
        })
      })
    )
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
  })

  it('does not let an active INCREMENTAL or malformed job swallow a requested FULL run', async () => {
    mocks.jobFindFirst.mockResolvedValue({
      id: 'incremental-job',
      status: 'RUNNING',
      payload: { mode: 'INCREMENTAL' }
    })

    await expect(enqueueCentralVideoChapterPreview({ mode: 'FULL', requestedByUserId: 'admin-1' })).resolves.toEqual({
      jobId: 'job-new',
      status: 'PENDING',
      reused: false
    })
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { mode: 'FULL' } }),
      expect.anything()
    )
  })

  it('does not reuse streaming work with the wrong mode or path', async () => {
    mocks.imageFindUnique.mockResolvedValue({ id: 7, path: 'folder/video.mp4', mediaType: 'VIDEO' })
    mocks.jobFindFirst
      .mockResolvedValueOnce({
        id: 'wrong-mode-job',
        status: 'RUNNING',
        payload: { imageId: 7, relativePath: 'folder/video.mp4', mode: 'COPY' }
      })
      .mockResolvedValueOnce({
        id: 'wrong-path-job',
        status: 'RUNNING',
        payload: { imageId: 7, relativePath: 'folder/old-video.mp4', mode: 'REMUX_FASTSTART' }
      })

    await expect(
      enqueueCentralVideoStreamingOptimization({ imageId: 7, requestedByUserId: 'admin-1' })
    ).resolves.toMatchObject({ jobId: 'job-new', reused: false })
    await expect(
      enqueueCentralVideoStreamingOptimization({ imageId: 7, requestedByUserId: 'admin-1' })
    ).resolves.toMatchObject({ jobId: 'job-new', reused: false })
    expect(mocks.enqueueJob).toHaveBeenCalledTimes(2)
  })

  it('validates and only creates a PENDING streaming job', async () => {
    mocks.imageFindUnique.mockResolvedValue({ id: 7, path: 'folder/video.mp4', mediaType: 'VIDEO' })
    await expect(
      enqueueCentralVideoStreamingOptimization({ imageId: 7, requestedByUserId: 'admin-1' })
    ).resolves.toMatchObject({ jobId: 'job-new', status: 'PENDING', reused: false })
    expect(mocks.queryRaw).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1::integer, $2::integer)::text',
      expect.any(Number),
      7
    )
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'VIDEO_STREAMING_OPTIMIZATION',
        triggerSource: 'MANUAL',
        payload: { imageId: 7, relativePath: 'folder/video.mp4', mode: 'REMUX_FASTSTART' }
      }),
      expect.anything()
    )
  })

  it('gives scheduled chapter work a stable per-date idempotency key', async () => {
    await enqueueCentralScheduledVideoChapterPreview({
      mode: 'INCREMENTAL',
      scheduledTaskId: 'chapter-nightly',
      scheduledForDate: '2026-08-14',
      deadlineAt: new Date('2026-08-14T00:00:00.000Z')
    })
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: 'SCHEDULE',
        idempotencyKey: 'schedule:chapter-nightly:2026-08-14:video-chapter-preview',
        priority: 120
      })
    )
  })

  it('rejects control and retry for non-v1 or invalid type-specific payloads', async () => {
    mocks.getJob
      .mockResolvedValueOnce({
        id: 'future-job',
        type: 'VIDEO_CHAPTER_PREVIEW_GENERATION',
        definitionVersion: 2,
        payload: { mode: 'FULL' }
      })
      .mockResolvedValueOnce({
        id: 'defaulted-chapter-job',
        type: 'VIDEO_CHAPTER_PREVIEW_GENERATION',
        definitionVersion: 1,
        payload: {}
      })
      .mockResolvedValueOnce({
        id: 'bad-stream-job',
        type: 'VIDEO_STREAMING_OPTIMIZATION',
        definitionVersion: 1,
        payload: { imageId: 7, relativePath: 'video.mp4', mode: 'COPY' }
      })

    await expect(controlCentralVideoProcessingJob('future-job', 'cancel')).resolves.toBeNull()
    await expect(controlCentralVideoProcessingJob('defaulted-chapter-job', 'cancel')).resolves.toBeNull()
    await expect(retryCentralVideoProcessingJob('bad-stream-job', 'admin-1')).resolves.toBeNull()
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.retry).not.toHaveBeenCalled()
  })

  it('controls only a valid v1 job and cancels the active v1 chapter job', async () => {
    mocks.getJob.mockResolvedValueOnce({
      id: 'job-existing',
      type: 'VIDEO_CHAPTER_PREVIEW_GENERATION',
      definitionVersion: 1,
      payload: { mode: 'FULL' }
    })
    await expect(controlCentralVideoProcessingJob('job-existing', 'cancel')).resolves.toEqual({
      id: 'job-existing',
      status: 'CANCELLING'
    })

    mocks.jobFindFirst.mockResolvedValueOnce({ id: 'job-existing', payload: { mode: 'FULL' } })
    await expect(cancelActiveCentralVideoChapterPreview()).resolves.toEqual({
      id: 'job-existing',
      status: 'CANCELLING'
    })
    expect(mocks.cancel).toHaveBeenCalledTimes(2)
  })
})
