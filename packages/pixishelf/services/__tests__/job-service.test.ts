import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRawMock, findFirstMock, findManyMock, createMock, transactionMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  createMock: vi.fn(),
  transactionMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock,
    systemJob: { findMany: findManyMock }
  }
}))

import {
  createLocalDirectoryImportJob,
  createScanJob,
  createScanRunRetentionCleanupJob,
  createTriggerLogRetentionCleanupJob,
  createVideoChapterPreviewGenerationJob,
  createVideoMediaProbeJob,
  createVideoStreamingOptimizationJob,
  getLatestVideoStreamingOptimizationJobsByImageIds,
  createWebpAnimationScanJob
} from '../job-service'

const tx = {
  $queryRawUnsafe: queryRawMock,
  systemJob: {
    findFirst: findFirstMock,
    create: createMock
  }
}

describe('media scan job locking', () => {
  beforeEach(() => {
    queryRawMock.mockReset().mockResolvedValue([{ pg_advisory_xact_lock: '' }])
    findFirstMock.mockReset().mockResolvedValue(null)
    findManyMock.mockReset().mockResolvedValue([])
    createMock.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: 'job-1', ...data }))
    transactionMock.mockReset().mockImplementation((callback) => callback(tx))
  })

  it('creates scan and local import jobs under the same advisory lock', async () => {
    await createScanJob()
    await createLocalDirectoryImportJob()

    expect(queryRawMock).toHaveBeenCalledTimes(2)
    expect(queryRawMock.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock($1)::text')
    expect(queryRawMock.mock.calls[0]?.[1]).toBe(queryRawMock.mock.calls[1]?.[1])
  })

  it('rejects a local import while any media scan job is active', async () => {
    findFirstMock.mockResolvedValue({ id: 'scan-job', type: 'SCAN' })

    await expect(createLocalDirectoryImportJob()).rejects.toThrow('Media scan job already in progress')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('creates an exclusive trigger log retention cleanup job', async () => {
    await createTriggerLogRetentionCleanupJob()

    expect(queryRawMock).toHaveBeenCalledOnce()
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        type: { in: ['SCAN_RUN_RETENTION_CLEANUP', 'TRIGGER_LOG_RETENTION_CLEANUP'] },
        status: { in: ['PENDING', 'RUNNING', 'CANCELLING'] }
      }
    })
    expect(createMock).toHaveBeenCalledWith({
      data: {
        type: 'TRIGGER_LOG_RETENTION_CLEANUP',
        status: 'RUNNING',
        message: '正在清理触发器日志...',
        progress: 0
      }
    })
  })

  it('keeps MP4 optimization independent from media metadata maintenance jobs', async () => {
    await createWebpAnimationScanJob()
    await createVideoMediaProbeJob()
    await createVideoChapterPreviewGenerationJob()
    await createVideoStreamingOptimizationJob({ imageId: 9, path: '/artist/video.mp4' })

    expect(queryRawMock).toHaveBeenCalledTimes(4)
    expect(queryRawMock.mock.calls[0]?.[1]).toBe(queryRawMock.mock.calls[1]?.[1])
    expect(queryRawMock.mock.calls[1]?.[1]).toBe(queryRawMock.mock.calls[2]?.[1])
    expect(queryRawMock.mock.calls[2]?.[1]).not.toBe(queryRawMock.mock.calls[3]?.[1])
    expect(findFirstMock).toHaveBeenNthCalledWith(3, {
      where: {
        type: { in: ['WEBP_ANIMATION_SCAN', 'VIDEO_MEDIA_PROBE', 'VIDEO_CHAPTER_PREVIEW_GENERATION'] },
        status: { in: ['PENDING', 'RUNNING', 'CANCELLING'] }
      }
    })
    expect(findFirstMock).toHaveBeenNthCalledWith(4, {
      where: {
        type: { in: ['VIDEO_STREAMING_OPTIMIZATION'] },
        status: { in: ['PENDING', 'RUNNING', 'CANCELLING'] }
      }
    })
    expect(createMock).toHaveBeenLastCalledWith({
      data: {
        type: 'VIDEO_STREAMING_OPTIMIZATION',
        status: 'RUNNING',
        message: '正在准备 MP4 无损播放优化...',
        progress: 0,
        targetImageId: 9,
        targetPath: '/artist/video.mp4',
        mode: 'REMUX_FASTSTART'
      }
    })
    expect(queryRawMock.mock.invocationCallOrder[0]).toBeLessThan(findFirstMock.mock.invocationCallOrder[0]!)
  })

  it('rejects chapter preview generation while another media maintenance job is active', async () => {
    findFirstMock.mockResolvedValue({ id: 'probe-job', type: 'VIDEO_MEDIA_PROBE' })

    await expect(createVideoChapterPreviewGenerationJob()).rejects.toThrow('Media maintenance job already in progress')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('uses a separate shared advisory lock for audit maintenance jobs', async () => {
    await createTriggerLogRetentionCleanupJob()
    await createScanRunRetentionCleanupJob()
    const auditLockId = queryRawMock.mock.calls[0]?.[1]

    expect(queryRawMock.mock.calls[1]?.[1]).toBe(auditLockId)

    queryRawMock.mockClear()
    await createVideoChapterPreviewGenerationJob()
    expect(queryRawMock.mock.calls[0]?.[1]).not.toBe(auditLockId)
  })

  it('returns only the newest optimization job for each requested media row', async () => {
    findManyMock.mockResolvedValue([
      { id: 'new-9', targetImageId: 9 },
      { id: 'new-10', targetImageId: 10 },
      { id: 'old-9', targetImageId: 9 }
    ])

    await expect(getLatestVideoStreamingOptimizationJobsByImageIds([9, 10])).resolves.toEqual([
      { id: 'new-9', targetImageId: 9 },
      { id: 'new-10', targetImageId: 10 }
    ])
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        type: 'VIDEO_STREAMING_OPTIMIZATION',
        targetImageId: { in: [9, 10] }
      },
      orderBy: { createdAt: 'desc' }
    })
  })
})
