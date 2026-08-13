import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  transactionMock,
  queryRawMock,
  findFirstMock,
  findManyMock,
  imageFindManyMock,
  countMock,
  createMock,
  updateMock,
  findUniqueMock,
  updateManyMock,
  jobUpdateManyMock,
  getScanPathMock,
  setFindManyMock,
  setFindUniqueMock,
  readdirMock,
  rmMock,
  rmdirMock,
  statMock,
  sourceFingerprintFromStatMock,
  resolveExistingPathWithinRootMock
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  queryRawMock: vi.fn(),
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  imageFindManyMock: vi.fn(),
  countMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  findUniqueMock: vi.fn(),
  updateManyMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  getScanPathMock: vi.fn(),
  setFindManyMock: vi.fn(),
  setFindUniqueMock: vi.fn(),
  readdirMock: vi.fn(),
  rmMock: vi.fn(),
  rmdirMock: vi.fn(),
  statMock: vi.fn(),
  sourceFingerprintFromStatMock: vi.fn(),
  resolveExistingPathWithinRootMock: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  readdir: readdirMock,
  rm: rmMock,
  rmdir: rmdirMock,
  stat: statMock
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock,
    systemJob: {
      findFirst: findFirstMock,
      count: countMock,
      create: createMock,
      update: updateMock,
      findUnique: findUniqueMock,
      findMany: findManyMock,
      updateMany: jobUpdateManyMock
    },
    image: { findMany: imageFindManyMock },
    mediaVideoKeyframeSet: { findMany: setFindManyMock }
  }
}))

vi.mock('@/lib/safe-path', () => ({
  resolveExistingPathWithinRoot: resolveExistingPathWithinRootMock
}))

vi.mock('@/services/video-keyframe-service', () => ({
  getPublishedVideoKeyframes: vi.fn(),
  regenerateManualVideoPoster: vi.fn(),
  removeJobStagingSet: vi.fn(),
  sourceFingerprintFromStat: sourceFingerprintFromStatMock
}))

vi.mock('@/services/setting.service', () => ({ getScanPath: getScanPathMock }))

import {
  claimNextVideoKeyframeJob,
  controlVideoKeyframeJob,
  enqueueVideoKeyframeJob,
  VIDEO_KEYFRAME_AUTOMATIC_CAPACITY,
  VIDEO_KEYFRAME_MANUAL_PRIORITY,
  retryFailedVideoKeyframeJobs,
  retryVideoKeyframeJob,
  finalizeVideoKeyframeFailure,
  cleanupOrphanedVideoKeyframeStorage,
  enqueueVideoKeyframeBatch,
  processVideoKeyframeDiscoveryJob,
  parseVideoKeyframeDiscoveryRequest,
  requeueVideoKeyframeOnShutdown,
  recoverStaleVideoKeyframeJobs,
  requireVideoKeyframeScanPath,
  listVideoKeyframeQueue,
  getVideoKeyframeRetryBackoffMs
} from '../video-keyframe-queue'

const tx = {
  $queryRawUnsafe: queryRawMock,
  systemJob: {
    findFirst: findFirstMock,
    count: countMock,
    create: createMock,
    update: updateMock,
    findUnique: findUniqueMock,
    findMany: findManyMock,
    updateMany: jobUpdateManyMock
  },
  mediaVideoKeyframeSet: {
    updateMany: updateManyMock,
    findMany: setFindManyMock,
    findUnique: setFindUniqueMock
  },
  mediaVideoKeyframe: { updateMany: updateManyMock }
}

describe('video keyframe queue', () => {
  beforeEach(() => {
    transactionMock.mockReset().mockImplementation((callback) => callback(tx))
    queryRawMock.mockReset().mockResolvedValue([])
    findFirstMock.mockReset().mockResolvedValue(null)
    findManyMock.mockReset().mockResolvedValue([])
    imageFindManyMock.mockReset().mockResolvedValue([])
    countMock.mockReset()
    createMock.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: 'job-1', ...data }))
    updateMock.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: 'job-1', ...data }))
    findUniqueMock.mockReset()
    updateManyMock.mockReset().mockResolvedValue({ count: 0 })
    jobUpdateManyMock.mockReset().mockResolvedValue({ count: 1 })
    getScanPathMock.mockReset().mockResolvedValue('/scan')
    setFindManyMock.mockReset().mockResolvedValue([])
    setFindUniqueMock.mockReset().mockResolvedValue(null)
    readdirMock.mockReset().mockResolvedValue([])
    rmMock.mockReset().mockResolvedValue(undefined)
    rmdirMock.mockReset().mockResolvedValue(undefined)
    statMock.mockReset().mockResolvedValue({ isFile: () => true })
    sourceFingerprintFromStatMock.mockReset().mockReturnValue({ size: 100, mtimeMs: 200 })
    resolveExistingPathWithinRootMock.mockReset().mockResolvedValue('/scan/artist/video.mp4')
  })

  it('creates manual work with higher priority', async () => {
    countMock.mockResolvedValueOnce(0)

    const queued = await enqueueVideoKeyframeJob({
      imageId: 9,
      path: '/artist/video.mkv',
      mode: 'MANUAL_INCREMENTAL'
    })

    expect(queued.reused).toBe(false)
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'VIDEO_KEYFRAME_GENERATION',
        targetImageId: 9,
        queuePriority: VIDEO_KEYFRAME_MANUAL_PRIORITY,
        status: 'PENDING'
      })
    })
  })

  it('persists batch discovery for the worker without scanning in the request process', async () => {
    createMock.mockResolvedValueOnce({ id: 'discovery-1', status: 'PENDING' })

    await expect(
      enqueueVideoKeyframeBatch({
        trigger: 'manual',
        previewOnly: true,
        imageIds: [9],
        filter: { minDuration: 600 }
      })
    ).resolves.toEqual({ jobId: 'discovery-1', status: 'PENDING' })

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'VIDEO_KEYFRAME_DISCOVERY',
        status: 'PENDING',
        result: expect.objectContaining({
          request: expect.objectContaining({ trigger: 'manual', previewOnly: true, imageIds: [9] })
        })
      })
    })
    expect(imageFindManyMock).not.toHaveBeenCalled()
  })

  it('rejects manual execution without a preview or explicit selected image ids', async () => {
    await expect(enqueueVideoKeyframeBatch({ trigger: 'manual', previewOnly: false })).rejects.toThrow(
      'requires an explicit preview selection'
    )
    expect(createMock).not.toHaveBeenCalled()
  })

  it('keeps old discovery jobs executable while only manual jobs can request preview mode', () => {
    expect(
      parseVideoKeyframeDiscoveryRequest({
        request: { trigger: 'manual', force: false, previewOnly: true, filter: {} }
      })
    ).toMatchObject({ trigger: 'manual', previewOnly: true })
    expect(
      parseVideoKeyframeDiscoveryRequest({ request: { trigger: 'schedule', force: false, filter: {} } })
    ).toMatchObject({
      trigger: 'schedule',
      previewOnly: false
    })
    expect(
      parseVideoKeyframeDiscoveryRequest({
        request: { trigger: 'schedule', force: false, previewOnly: true, filter: {} }
      })
    ).toMatchObject({ trigger: 'schedule', previewOnly: false })
  })

  it('returns manual preview candidates without creating generation jobs', async () => {
    imageFindManyMock.mockResolvedValueOnce([
      {
        id: 9,
        path: '/artist/video.mp4',
        videoMetadata: { duration: 39.4 },
        keyframeSets: []
      }
    ])

    const result = await processVideoKeyframeDiscoveryJob({
      jobId: 'preview-1',
      attempt: 1,
      request: {
        trigger: 'manual',
        force: false,
        previewOnly: true,
        filter: { minDuration: null, maxDuration: null, includePaths: [], excludePaths: [], statuses: ['MISSING'] }
      }
    })

    expect(result).toMatchObject({
      discovered: 1,
      matched: 1,
      enqueued: 0,
      previewOnly: true,
      candidates: [{ imageId: 9, path: '/artist/video.mp4', status: 'MISSING', duration: 39.4 }]
    })
    expect(createMock).not.toHaveBeenCalled()
    expect(jobUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          result: expect.objectContaining({ previewOnly: true, matched: 1 })
        })
      })
    )
  })

  it('keeps a confirmed discovery pending when queue capacity temporarily prevents full enqueueing', async () => {
    imageFindManyMock.mockResolvedValueOnce([
      {
        id: 9,
        path: '/artist/video.mp4',
        videoMetadata: { duration: 39.4 },
        keyframeSets: []
      }
    ])
    countMock.mockResolvedValueOnce(100)

    const result = await processVideoKeyframeDiscoveryJob({
      jobId: 'confirmed-1',
      attempt: 1,
      request: {
        trigger: 'manual',
        force: false,
        previewOnly: false,
        imageIds: [9],
        filter: { minDuration: null, maxDuration: null, includePaths: [], excludePaths: [], statuses: ['MISSING'] }
      }
    })

    expect(result.capacityLimited).toBe(1)
    expect(jobUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          message: expect.stringContaining('剩余 1 个视频待继续检查并入队'),
          attempt: { decrement: 1 }
        })
      })
    )
    expect(jobUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    )
  })

  it('continues a force batch after the last processed id without rebuilding the first page', async () => {
    const image = (id: number) => ({
      id,
      path: `/artist/video-${id}.mp4`,
      videoMetadata: { duration: 39.4 },
      keyframeSets: []
    })
    imageFindManyMock.mockResolvedValueOnce([image(9), image(10)]).mockResolvedValueOnce([image(10)])
    countMock.mockResolvedValueOnce(0).mockResolvedValueOnce(100).mockResolvedValueOnce(0)

    const first = await processVideoKeyframeDiscoveryJob({
      jobId: 'force-confirmed',
      attempt: 1,
      request: {
        trigger: 'manual',
        force: true,
        previewOnly: false,
        imageIds: [9, 10],
        filter: { minDuration: null, maxDuration: null, includePaths: [], excludePaths: [], statuses: ['MISSING'] }
      }
    })
    expect(first).toMatchObject({ discovered: 2, enqueued: 1, capacityLimited: 1 })
    const persistedResult = jobUpdateManyMock.mock.calls.at(-1)?.[0]?.data?.result
    const continuation = parseVideoKeyframeDiscoveryRequest(persistedResult)
    expect(continuation).toMatchObject({ force: true, afterImageId: 9, accumulated: { discovered: 2, enqueued: 1 } })

    const second = await processVideoKeyframeDiscoveryJob({
      jobId: 'force-confirmed',
      attempt: 1,
      request: continuation
    })

    expect(second).toMatchObject({ discovered: 2, enqueued: 2, capacityLimited: 0 })
    expect(imageFindManyMock.mock.calls[1]?.[0]?.where).toEqual(
      expect.objectContaining({ AND: expect.arrayContaining([{ id: { gt: 9 } }]) })
    )
    const generatedTargets = createMock.mock.calls.map((call) => call[0]?.data?.targetImageId).filter(Boolean)
    expect(generatedTargets).toEqual([9, 10])
  })

  it('lists discovery work separately without consuming generation capacity', async () => {
    findManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'discovery-active', type: 'VIDEO_KEYFRAME_DISCOVERY', status: 'RUNNING' }])
      .mockResolvedValueOnce([{ id: 'discovery-failed', type: 'VIDEO_KEYFRAME_DISCOVERY', status: 'FAILED' }])

    const queue = await listVideoKeyframeQueue()

    expect(queue.active).toEqual([])
    expect(queue.discoveryActive).toEqual([expect.objectContaining({ id: 'discovery-active', queuePosition: null })])
    expect(queue.discoveryRecent).toEqual([expect.objectContaining({ id: 'discovery-failed', queuePosition: null })])
    expect(queue.capacity).toBe(100)
  })

  it('requeues a stale running discovery so restart cannot hold the scheduler mutex forever', async () => {
    findManyMock.mockResolvedValueOnce([
      { id: 'discovery-1', type: 'VIDEO_KEYFRAME_DISCOVERY', status: 'RUNNING', attempt: 1 }
    ])

    await expect(recoverStaleVideoKeyframeJobs(new Date())).resolves.toBe(1)

    expect(jobUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'discovery-1',
        type: 'VIDEO_KEYFRAME_DISCOVERY',
        status: 'RUNNING',
        attempt: 1
      }),
      data: expect.objectContaining({ status: 'PENDING', heartbeatAt: null })
    })
  })

  it('does not recover a generation whose heartbeat became healthy after the stale snapshot', async () => {
    findManyMock.mockResolvedValueOnce([
      { id: 'job-healthy', type: 'VIDEO_KEYFRAME_GENERATION', status: 'RUNNING', attempt: 1 }
    ])
    // The ownership recheck under the queue lock no longer matches the stale predicate.
    findFirstMock.mockResolvedValueOnce(null)

    await expect(recoverStaleVideoKeyframeJobs(new Date())).resolves.toBe(1)

    expect(jobUpdateManyMock).not.toHaveBeenCalled()
    expect(updateManyMock).not.toHaveBeenCalled()
  })

  it('prefers the worker container scan mount over a host path stored in the database', async () => {
    getScanPathMock.mockResolvedValueOnce('D:\\media')
    const previous = process.env.SCAN_PATH
    process.env.SCAN_PATH = '/app/data'
    try {
      await expect(requireVideoKeyframeScanPath()).resolves.toBe('/app/data')
    } finally {
      if (previous === undefined) delete process.env.SCAN_PATH
      else process.env.SCAN_PATH = previous
    }
  })

  it('reserves ten queue positions by limiting automatic work to ninety', async () => {
    countMock.mockResolvedValueOnce(90).mockResolvedValueOnce(VIDEO_KEYFRAME_AUTOMATIC_CAPACITY)

    await expect(
      enqueueVideoKeyframeJob({ imageId: 9, path: '/artist/video.mp4', mode: 'AUTO_INCREMENTAL' })
    ).rejects.toThrow('Video keyframe queue is full (90)')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('uses short retry delays for manual work and conservative delays for automatic work', () => {
    expect(getVideoKeyframeRetryBackoffMs(1, 'MANUAL_INCREMENTAL')).toBe(5_000)
    expect(getVideoKeyframeRetryBackoffMs(2, 'MANUAL_FORCE')).toBe(15_000)
    expect(getVideoKeyframeRetryBackoffMs(1, 'AUTO_INCREMENTAL')).toBe(60_000)
    expect(getVideoKeyframeRetryBackoffMs(2, 'AUTO_INCREMENTAL')).toBe(5 * 60_000)
  })

  it('upgrades a pending automatic job when manually requested', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'job-existing',
      status: 'PENDING',
      queuePriority: 100,
      parentJobId: null,
      availableAt: new Date('2026-08-13T09:00:00.000Z')
    })
    updateMock.mockResolvedValueOnce({ id: 'job-existing', status: 'PENDING', queuePriority: 10 })

    const result = await enqueueVideoKeyframeJob({
      imageId: 9,
      path: '/artist/video.mp4',
      mode: 'MANUAL_FORCE'
    })

    expect(result.reused).toBe(true)
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'job-existing' },
      data: expect.objectContaining({
        queuePriority: 10,
        mode: 'MANUAL_FORCE',
        availableAt: null,
        message: '人工任务已提升优先级，等待生成视频代表帧...',
        error: null
      })
    })
  })

  it('does not resume a running job until the worker acknowledges PAUSED', async () => {
    findUniqueMock
      .mockResolvedValueOnce({ id: 'job-1', type: 'VIDEO_KEYFRAME_GENERATION', status: 'RUNNING' })
      .mockResolvedValueOnce({ id: 'job-1', type: 'VIDEO_KEYFRAME_GENERATION', status: 'PAUSING' })
    updateMock.mockResolvedValueOnce({ id: 'job-1', status: 'PAUSING' })

    await expect(controlVideoKeyframeJob('job-1', 'pause')).resolves.toMatchObject({ status: 'PAUSING' })
    await expect(controlVideoKeyframeJob('job-1', 'resume')).resolves.toMatchObject({ status: 'PAUSING' })
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'PAUSING' })
    })
  })

  it('turns an immediate cancel after pause into CANCELLING for worker acknowledgement', async () => {
    findUniqueMock
      .mockResolvedValueOnce({ id: 'job-1', type: 'VIDEO_KEYFRAME_GENERATION', status: 'RUNNING' })
      .mockResolvedValueOnce({ id: 'job-1', type: 'VIDEO_KEYFRAME_GENERATION', status: 'PAUSING' })
    updateMock
      .mockResolvedValueOnce({ id: 'job-1', status: 'PAUSING' })
      .mockResolvedValueOnce({ id: 'job-1', status: 'CANCELLING' })

    await controlVideoKeyframeJob('job-1', 'pause')
    await expect(controlVideoKeyframeJob('job-1', 'cancel')).resolves.toMatchObject({ status: 'CANCELLING' })
    expect(updateMock).toHaveBeenLastCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'CANCELLING' })
    })
  })

  it('does not create a duplicate active job when retrying an older failure', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'job-failed',
      type: 'VIDEO_KEYFRAME_GENERATION',
      targetImageId: 9,
      status: 'FAILED'
    })
    findFirstMock.mockResolvedValueOnce({ id: 'job-active', targetImageId: 9, status: 'RUNNING' })

    await expect(retryVideoKeyframeJob('job-failed')).resolves.toMatchObject({ id: 'job-active' })
    expect(countMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('does not bulk retry an old failure superseded by a later success', async () => {
    findManyMock.mockResolvedValueOnce([
      { id: 'job-completed', targetImageId: 9, targetPath: '/artist/video.mp4', status: 'COMPLETED' },
      { id: 'job-failed', targetImageId: 9, targetPath: '/artist/video.mp4', status: 'FAILED' }
    ])

    await expect(retryFailedVideoKeyframeJobs()).resolves.toEqual({ retried: 0, filtered: 0, capacityLimited: 0 })
    expect(imageFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: [] } },
      select: { id: true, path: true, mediaType: true, videoMetadata: { select: { duration: true } } }
    })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('claims under both the maintenance and queue advisory locks', async () => {
    findFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'job-next', status: 'PENDING', progress: 0, attempt: 0, startedAt: null })

    await claimNextVideoKeyframeJob()

    expect(queryRawMock).toHaveBeenCalledTimes(2)
    expect(queryRawMock.mock.calls[0]?.[1]).toBe(728342)
    expect(queryRawMock.mock.calls[1]?.[1]).not.toBe(728342)
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'job-next' },
      data: expect.objectContaining({ status: 'RUNNING', attempt: { increment: 1 } })
    })
  })

  it('uses the current image path when filtering failed retries', async () => {
    findManyMock.mockResolvedValueOnce([
      { id: 'job-failed', targetImageId: 9, targetPath: '/included/video.mp4', status: 'FAILED' }
    ])
    imageFindManyMock.mockResolvedValueOnce([
      { id: 9, path: '/excluded/video.mp4', mediaType: 'VIDEO', videoMetadata: { duration: 120 } }
    ])

    await expect(retryFailedVideoKeyframeJobs({ excludePaths: ['/excluded'] })).resolves.toEqual({
      retried: 0,
      filtered: 1,
      capacityLimited: 0
    })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('does not mutate a staging set after losing failure-finalization ownership', async () => {
    jobUpdateManyMock.mockResolvedValueOnce({ count: 0 })

    await finalizeVideoKeyframeFailure({ jobId: 'job-1', attempt: 3, error: 'failed', recoverable: true })

    expect(updateManyMock).not.toHaveBeenCalled()
  })

  it('acknowledges a pause that races with failure finalization', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'job-1',
      type: 'VIDEO_KEYFRAME_GENERATION',
      status: 'PAUSING',
      attempt: 1
    })
    findUniqueMock.mockResolvedValueOnce({ status: 'PAUSED', attempt: 1 })

    await finalizeVideoKeyframeFailure({ jobId: 'job-1', attempt: 1, error: 'failed', recoverable: true })

    expect(jobUpdateManyMock).toHaveBeenCalledTimes(1)
    expect(jobUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'job-1', status: 'PAUSING', attempt: 1 }),
      data: expect.objectContaining({ status: 'PAUSED' })
    })
    expect(updateManyMock).not.toHaveBeenCalled()
  })

  it('acknowledges a pause that races with worker shutdown requeue', async () => {
    findUniqueMock.mockResolvedValueOnce({
      type: 'VIDEO_KEYFRAME_GENERATION',
      status: 'PAUSING',
      attempt: 1
    })

    await requeueVideoKeyframeOnShutdown('job-1', 1)

    expect(jobUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'job-1', status: 'PAUSING', attempt: 1 }),
      data: expect.objectContaining({ status: 'PAUSED' })
    })
  })

  it('removes only unreferenced inactive keyframe directories and defers locked ones', async () => {
    findFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'job-active' })
      .mockResolvedValueOnce(null)
    setFindUniqueMock
      .mockResolvedValueOnce({
        imageId: 1,
        status: 'PUBLISHED',
        frames: [
          { path: '1/set-keep/000.webp', selectedOrder: 0 },
          { path: '1/set-keep/rejected.webp', selectedOrder: null }
        ]
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    readdirMock
      .mockResolvedValueOnce([directory('1'), directory('2'), directory('3')])
      .mockResolvedValueOnce([directory('set-keep'), directory('set-orphan')])
      .mockResolvedValueOnce([file('000.webp'), file('rejected.webp')])
      .mockResolvedValueOnce([directory('set-active')])
      .mockResolvedValueOnce([directory('set-locked')])
    rmMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EPERM' }))

    await expect(cleanupOrphanedVideoKeyframeStorage()).resolves.toEqual({ removed: 2, deferred: 1 })

    expect(transactionMock).toHaveBeenCalledTimes(4)
    expect(transactionMock.mock.calls.every(([, options]) => options?.timeout === 60_000)).toBe(true)
    expect(queryRawMock).toHaveBeenCalledTimes(4)
    expect(rmMock).toHaveBeenCalledTimes(3)
    expect(rmMock.mock.calls.some(([target]) => String(target).includes('000.webp'))).toBe(false)
    expect(rmMock.mock.calls.some(([target]) => String(target).includes('rejected.webp'))).toBe(true)
    expect(rmMock.mock.calls.some(([target]) => /[\\/]2[\\/]/.test(String(target)))).toBe(false)
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { setId: 'set-keep', path: '1/set-keep/rejected.webp', selectedOrder: null },
      data: { path: null }
    })
  })
})

function directory(name: string) {
  return { name, isDirectory: () => true, isFile: () => false }
}

function file(name: string) {
  return { name, isDirectory: () => false, isFile: () => true }
}
