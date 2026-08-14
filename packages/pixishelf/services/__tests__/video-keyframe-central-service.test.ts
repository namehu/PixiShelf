import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  imageFindUnique,
  imageFindMany,
  jobFindFirst,
  jobFindMany,
  transaction,
  queryRaw,
  enqueueJob,
  getJobById,
  pauseJob,
  resumeJob,
  cancelJob,
  retryJob
} = vi.hoisted(() => ({
  imageFindUnique: vi.fn(),
  imageFindMany: vi.fn(),
  jobFindFirst: vi.fn(),
  jobFindMany: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  enqueueJob: vi.fn(),
  getJobById: vi.fn(),
  pauseJob: vi.fn(),
  resumeJob: vi.fn(),
  cancelJob: vi.fn(),
  retryJob: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transaction,
    image: { findUnique: imageFindUnique, findMany: imageFindMany },
    systemJob: { findFirst: jobFindFirst, findMany: jobFindMany }
  }
}))

vi.mock('@/services/background-task', () => ({
  enqueueJob,
  getJobById,
  pauseJobCommand: pauseJob,
  resumeJobCommand: resumeJob,
  cancelJobCommand: cancelJob,
  retryJobCommand: retryJob
}))

import {
  controlCentralVideoKeyframeJob,
  enqueueCentralVideoKeyframeDiscovery,
  enqueueCentralVideoKeyframeGeneration,
  retryCentralVideoKeyframeJob,
  retryFailedCentralVideoKeyframes
} from '../video-keyframe-central-service'

describe('central video keyframe commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    imageFindUnique.mockResolvedValue({ id: 42, path: 'videos/42.mp4', mediaType: 'VIDEO' })
    imageFindMany.mockResolvedValue([])
    jobFindFirst.mockResolvedValue(null)
    jobFindMany.mockResolvedValue([])
    queryRaw.mockResolvedValue([])
    transaction.mockImplementation((operation) =>
      operation({
        $queryRawUnsafe: queryRaw,
        systemJob: { findFirst: jobFindFirst }
      })
    )
    enqueueJob.mockResolvedValue({ id: 'job-new', status: 'PENDING' })
    getJobById.mockResolvedValue({
      id: 'job-1',
      type: 'VIDEO_KEYFRAME_GENERATION',
      definitionVersion: 1,
      status: 'RUNNING'
    })
    pauseJob.mockResolvedValue({ id: 'job-1', status: 'PAUSING' })
    resumeJob.mockResolvedValue({ id: 'job-1', status: 'PENDING' })
    cancelJob.mockResolvedValue({ id: 'job-1', status: 'CANCELLING' })
    retryJob.mockResolvedValue({ id: 'job-retry', status: 'PENDING' })
  })

  it('enqueues a manual generation through the unified command with a contracts payload', async () => {
    await expect(
      enqueueCentralVideoKeyframeGeneration({ imageId: 42, force: true, requestedByUserId: 'admin-1' })
    ).resolves.toEqual({ jobId: 'job-new', status: 'PENDING', reused: false })
    expect(enqueueJob).toHaveBeenCalledWith(
      {
        type: 'VIDEO_KEYFRAME_GENERATION',
        triggerSource: 'MANUAL',
        requestedByUserId: 'admin-1',
        priority: 10,
        maxAttempts: 3,
        payload: { imageId: 42, relativePath: 'videos/42.mp4', mode: 'MANUAL_FORCE' }
      },
      expect.objectContaining({ $transaction: expect.any(Function) })
    )
  })

  it('reuses active central work instead of creating another generation', async () => {
    jobFindFirst.mockResolvedValue({ id: 'job-existing', status: 'RETRY_WAIT' })
    await expect(
      enqueueCentralVideoKeyframeGeneration({ imageId: 42, force: false, requestedByUserId: 'admin-1' })
    ).resolves.toEqual({ jobId: 'job-existing', status: 'RETRY_WAIT', reused: true })
    expect(enqueueJob).not.toHaveBeenCalled()
  })

  it('enqueues discovery without scanning or creating generation work in the request', async () => {
    await enqueueCentralVideoKeyframeDiscovery({
      force: false,
      previewOnly: false,
      imageIds: [42, 42],
      filter: { statuses: ['MISSING'] },
      requestedByUserId: 'admin-1'
    })
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'VIDEO_KEYFRAME_DISCOVERY',
        requestedByUserId: 'admin-1',
        payload: expect.objectContaining({ imageIds: [42], previewOnly: false, filter: expect.any(Object) })
      })
    )
    expect(imageFindMany).not.toHaveBeenCalled()
  })

  it('uses generic commands for pause and retry while rejecting unrelated job types', async () => {
    await expect(controlCentralVideoKeyframeJob('job-1', 'pause')).resolves.toEqual({
      id: 'job-1',
      status: 'PAUSING'
    })
    await expect(retryCentralVideoKeyframeJob('job-1', 'admin-1')).resolves.toEqual({
      id: 'job-retry',
      status: 'PENDING'
    })
    expect(pauseJob).toHaveBeenCalledWith({ jobId: 'job-1' })
    expect(retryJob).toHaveBeenCalledWith({ jobId: 'job-1', requestedByUserId: 'admin-1' })

    getJobById.mockResolvedValue({ id: 'job-other', type: 'ARCHIVE_IMPORT', definitionVersion: 1 })
    await expect(controlCentralVideoKeyframeJob('job-other', 'cancel')).resolves.toBeNull()
    expect(cancelJob).not.toHaveBeenCalled()
  })

  it('does not bulk retry a failure superseded by a newer successful job', async () => {
    jobFindMany.mockResolvedValue([
      {
        id: 'job-completed',
        status: 'COMPLETED',
        payload: { imageId: 42, relativePath: 'videos/42.mp4', mode: 'MANUAL_INCREMENTAL' }
      },
      {
        id: 'job-failed',
        status: 'FAILED',
        payload: { imageId: 42, relativePath: 'videos/42.mp4', mode: 'MANUAL_INCREMENTAL' }
      }
    ])
    await expect(retryFailedCentralVideoKeyframes({ requestedByUserId: 'admin-1' })).resolves.toEqual({
      retried: 0,
      filtered: 0,
      capacityLimited: 0
    })
    expect(retryJob).not.toHaveBeenCalled()
  })

  it('scans failed generation history in bounded cursor pages', async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      id: `job-${String(index).padStart(3, '0')}`,
      status: 'COMPLETED',
      payload: { imageId: index + 1, relativePath: `videos/${index + 1}.mp4`, mode: 'MANUAL_INCREMENTAL' }
    }))
    jobFindMany.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([])

    await retryFailedCentralVideoKeyframes({ requestedByUserId: 'admin-1' })

    expect(jobFindMany).toHaveBeenCalledTimes(2)
    expect(jobFindMany.mock.calls[0]?.[0]).toMatchObject({ take: 200 })
    expect(jobFindMany.mock.calls[1]?.[0]).toMatchObject({
      take: 200,
      cursor: { id: 'job-199' },
      skip: 1
    })
  })
})
