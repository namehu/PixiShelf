import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  globalFindMany: vi.fn(),
  groupBy: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    systemJob: {
      findMany: mocks.globalFindMany,
      groupBy: mocks.groupBy
    }
  }
}))

import {
  claimNextVideoStreamingOptimizationJob,
  cancelVideoStreamingOptimizationJob,
  createLocalDirectoryImportJob,
  createMediaDerivedTagSyncJob,
  createMigrationJob,
  createPendingReplaceJob,
  createScanJob,
  createScanRunRetentionCleanupJob,
  createRefillMetaSourceJob,
  createTriggerLogRetentionCleanupJob,
  createVideoChapterPreviewGenerationJob,
  createVideoMediaProbeJob,
  createWebpAnimationScanJob,
  enqueueVideoStreamingOptimizationJob,
  getLatestVideoStreamingOptimizationJobsByImageIds,
  finalizePendingReplaceJob
} from '../job-service'

const tx = {
  $queryRawUnsafe: mocks.queryRaw,
  systemJob: {
    findFirst: mocks.findFirst,
    findUnique: mocks.findUnique,
    findMany: mocks.findMany,
    count: mocks.count,
    create: mocks.create,
    update: mocks.update,
    updateMany: mocks.updateMany
  }
}

describe('job locking and video optimization queue', () => {
  beforeEach(() => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'false')
    vi.clearAllMocks()
    mocks.queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: '' }])
    mocks.findFirst.mockResolvedValue(null)
    mocks.findUnique.mockResolvedValue(null)
    mocks.findMany.mockResolvedValue([])
    mocks.globalFindMany.mockResolvedValue([])
    mocks.groupBy.mockResolvedValue([])
    mocks.count.mockResolvedValue(0)
    mocks.create.mockImplementation(({ data }) => Promise.resolve({ id: 'job-1', ...data }))
    mocks.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.transaction.mockImplementation((callback) => callback(tx))
  })

  it.each([
    ['scan', () => createScanJob()],
    ['local import', () => createLocalDirectoryImportJob()],
    ['pending replace', () => createPendingReplaceJob('batch-1')],
    ['migration', () => createMigrationJob()],
    ['refill metadata', () => createRefillMetaSourceJob()],
    ['derived tag sync', () => createMediaDerivedTagSyncJob()],
    ['animation scan', () => createWebpAnimationScanJob()],
    ['media probe', () => createVideoMediaProbeJob()],
    ['chapter preview', () => createVideoChapterPreviewGenerationJob()],
    ['scan retention', () => createScanRunRetentionCleanupJob()],
    ['trigger retention', () => createTriggerLogRetentionCleanupJob()],
    ['stream optimization', () => enqueueVideoStreamingOptimizationJob({ imageId: 9, path: '/video.mp4' })]
  ])('rejects legacy %s creation before database work after central cutover', async (_name, createLegacyJob) => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')

    await expect(createLegacyJob()).rejects.toThrow('Legacy background execution is disabled')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('creates scan and local import jobs under the same advisory lock', async () => {
    await createScanJob()
    await createLocalDirectoryImportJob()

    expect(mocks.queryRaw).toHaveBeenCalledTimes(2)
    expect(mocks.queryRaw.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock($1)::text')
    expect(mocks.queryRaw.mock.calls[0]?.[1]).toBe(mocks.queryRaw.mock.calls[1]?.[1])
  })

  it('rejects a local import while any media scan job is active', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'scan-job', type: 'SCAN' })

    await expect(createLocalDirectoryImportJob()).rejects.toThrow('Media scan job already in progress')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('uses one mutex for scans, migrations, and pending replacements', async () => {
    await createPendingReplaceJob('batch-1')
    const pendingReplaceLockId = mocks.queryRaw.mock.calls[0]?.[1]
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        type: { in: ['SCAN', 'LOCAL_DIRECTORY_IMPORT', 'MIGRATION', 'PENDING_REPLACE'] },
        status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] }
      }
    })
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'PENDING_REPLACE', targetPath: 'batch-1' })
    })

    mocks.queryRaw.mockClear()
    await createMigrationJob()
    expect(mocks.queryRaw.mock.calls[0]?.[1]).toBe(pendingReplaceLockId)
  })

  it('finalizes a pending replacement only for the owning attempt', async () => {
    const onFinalized = vi.fn()

    await expect(
      finalizePendingReplaceJob('job-1', 3, { status: 'COMPLETED', result: { ok: true } }, onFinalized)
    ).resolves.toBe(true)

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job-1',
        type: 'PENDING_REPLACE',
        attempt: 3,
        status: { in: ['RUNNING', 'CANCELLING'] }
      },
      data: expect.objectContaining({ status: 'COMPLETED', result: { ok: true } })
    })
    expect(onFinalized).toHaveBeenCalledOnce()

    mocks.updateMany.mockResolvedValueOnce({ count: 0 })
    onFinalized.mockClear()
    await expect(
      finalizePendingReplaceJob('job-1', 2, { status: 'FAILED', error: 'stale' }, onFinalized)
    ).resolves.toBe(false)
    expect(onFinalized).not.toHaveBeenCalled()
  })

  it('creates an exclusive trigger log retention cleanup job', async () => {
    await createTriggerLogRetentionCleanupJob()

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        type: { in: ['SCAN_RUN_RETENTION_CLEANUP', 'TRIGGER_LOG_RETENTION_CLEANUP'] },
        status: { in: ['PENDING', 'RUNNING', 'CANCELLING'] }
      }
    })
  })

  it('queues MP4 optimization independently from media metadata maintenance jobs', async () => {
    await createWebpAnimationScanJob()
    await createVideoMediaProbeJob()
    await createVideoChapterPreviewGenerationJob()
    const queued = await enqueueVideoStreamingOptimizationJob({ imageId: 9, path: '/artist/video.mp4' })

    expect(mocks.queryRaw).toHaveBeenCalledTimes(4)
    expect(mocks.queryRaw.mock.calls[0]?.[1]).toBe(mocks.queryRaw.mock.calls[1]?.[1])
    expect(mocks.queryRaw.mock.calls[1]?.[1]).toBe(mocks.queryRaw.mock.calls[2]?.[1])
    expect(mocks.queryRaw.mock.calls[2]?.[1]).not.toBe(mocks.queryRaw.mock.calls[3]?.[1])
    expect(queued).toMatchObject({ reused: false, queuePosition: 1 })
    expect(mocks.create).toHaveBeenLastCalledWith({
      data: {
        type: 'VIDEO_STREAMING_OPTIMIZATION',
        status: 'PENDING',
        message: '等待 MP4 无损播放优化...',
        progress: 0,
        targetImageId: 9,
        targetPath: '/artist/video.mp4',
        mode: 'REMUX_FASTSTART'
      }
    })
  })

  it('returns an existing active job instead of enqueueing the same image twice', async () => {
    const existing = { id: 'job-existing', status: 'PENDING', targetImageId: 9 }
    mocks.findFirst.mockResolvedValueOnce(existing)
    mocks.findMany.mockResolvedValueOnce([{ id: 'job-before' }, { id: 'job-existing' }])

    await expect(enqueueVideoStreamingOptimizationJob({ imageId: 9, path: '/artist/video.mp4' })).resolves.toEqual({
      job: existing,
      reused: true,
      queuePosition: 2
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects a new item when the persistent queue reaches its active capacity', async () => {
    mocks.count.mockResolvedValueOnce(100)

    await expect(enqueueVideoStreamingOptimizationJob({ imageId: 9, path: '/artist/video.mp4' })).rejects.toThrow(
      'Video optimization queue is full (100)'
    )
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('cancels a pending item immediately without waiting for the processor', async () => {
    mocks.findUnique.mockResolvedValueOnce({
      id: 'pending-job',
      type: 'VIDEO_STREAMING_OPTIMIZATION',
      status: 'PENDING'
    })

    await expect(cancelVideoStreamingOptimizationJob('pending-job')).resolves.toMatchObject({
      changed: true,
      job: { id: 'pending-job', status: 'CANCELLED' }
    })
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'pending-job' },
      data: expect.objectContaining({ status: 'CANCELLED', message: '排队任务已取消' })
    })
  })

  it('claims only the oldest pending optimization when no task is running', async () => {
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'oldest', status: 'PENDING', targetImageId: 9 })

    await claimNextVideoStreamingOptimizationJob()

    expect(mocks.findFirst).toHaveBeenNthCalledWith(2, {
      where: { type: 'VIDEO_STREAMING_OPTIMIZATION', status: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'oldest' },
      data: expect.objectContaining({
        status: 'RUNNING',
        progress: 1,
        attempt: { increment: 1 }
      })
    })
  })

  it('rejects chapter preview generation while another media maintenance job is active', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'probe-job', type: 'VIDEO_MEDIA_PROBE' })

    await expect(createVideoChapterPreviewGenerationJob()).rejects.toThrow('Media maintenance job already in progress')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('only treats running keyframe work as a media maintenance conflict', async () => {
    await createVideoMediaProbeJob()

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            type: { in: ['WEBP_ANIMATION_SCAN', 'VIDEO_MEDIA_PROBE', 'VIDEO_CHAPTER_PREVIEW_GENERATION'] },
            status: { in: ['PENDING', 'RUNNING', 'CANCELLING'] }
          },
          {
            type: { in: ['VIDEO_KEYFRAME_GENERATION'] },
            status: { in: ['RUNNING', 'PAUSING', 'CANCELLING'] }
          }
        ]
      }
    })
  })

  it('uses a separate shared advisory lock for audit maintenance jobs', async () => {
    await createTriggerLogRetentionCleanupJob()
    await createScanRunRetentionCleanupJob()
    const auditLockId = mocks.queryRaw.mock.calls[0]?.[1]

    expect(mocks.queryRaw.mock.calls[1]?.[1]).toBe(auditLockId)

    mocks.queryRaw.mockClear()
    await createVideoChapterPreviewGenerationJob()
    expect(mocks.queryRaw.mock.calls[0]?.[1]).not.toBe(auditLockId)
  })

  it('fetches only the newest optimization key for each requested media row', async () => {
    const createdAt = new Date('2026-08-11T00:00:00Z')
    mocks.groupBy.mockResolvedValue([
      { targetImageId: 9, _max: { createdAt } },
      { targetImageId: 10, _max: { createdAt } }
    ])
    mocks.globalFindMany
      .mockResolvedValueOnce([
        { id: 'new-9', targetImageId: 9, createdAt },
        { id: 'new-10', targetImageId: 10, createdAt }
      ])
      .mockResolvedValueOnce([])

    await expect(getLatestVideoStreamingOptimizationJobsByImageIds([9, 10])).resolves.toEqual([
      { id: 'new-9', targetImageId: 9, createdAt, queuePosition: null },
      { id: 'new-10', targetImageId: 10, createdAt, queuePosition: null }
    ])
    expect(mocks.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['targetImageId'],
        where: expect.objectContaining({ targetImageId: { in: [9, 10] } })
      })
    )
  })
})
