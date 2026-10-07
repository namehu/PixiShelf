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
    $queryRaw: mocks.queryRaw,
    systemJob: {
      findFirst: mocks.findFirst,
      findMany: mocks.globalFindMany,
      groupBy: mocks.groupBy
    }
  }
}))

import {
  getActiveJobByType,
  getActiveJobsByTypes,
  getActiveLocalDirectoryImportJob,
  getActiveMigrationJob,
  getActiveScanJob,
  getLatestLocalDirectoryImportJob,
  getLatestVideoStreamingOptimizationJobsByImageIds,
  listVideoStreamingOptimizationQueue
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

  it('uses the contract active statuses for all central control lookups', async () => {
    const expected = ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING']

    await getActiveMigrationJob()
    await getActiveScanJob()
    await getActiveLocalDirectoryImportJob()
    await getActiveJobByType('PENDING_REPLACE')
    await getActiveJobsByTypes(['SCAN', 'LOCAL_DIRECTORY_IMPORT'])

    for (const call of mocks.findFirst.mock.calls.slice(-4)) {
      expect(call[0].where.status.in).toEqual(expected)
    }
    expect(mocks.globalFindMany).toHaveBeenLastCalledWith({
      where: {
        type: { in: ['SCAN', 'LOCAL_DIRECTORY_IMPORT'] },
        status: { in: expected }
      },
      orderBy: { createdAt: 'desc' }
    })
  })

  it('loads scan run summary with the latest local import job status', async () => {
    const expected = {
      id: 'job-local-import',
      type: 'LOCAL_DIRECTORY_IMPORT',
      scanRun: {
        id: 'run-local-import',
        totalArtworks: 3,
        succeededArtworks: 2,
        skippedArtworks: 1,
        failedArtworks: 0,
        newImages: 5,
        durationMs: 2400,
        errorMessage: null
      }
    }
    mocks.findFirst.mockResolvedValueOnce(expected)

    await expect(getLatestLocalDirectoryImportJob()).resolves.toMatchObject(expected)

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { type: 'LOCAL_DIRECTORY_IMPORT' },
      orderBy: { createdAt: 'desc' },
      include: {
        scanRun: {
          select: {
            id: true,
            totalArtworks: true,
            succeededArtworks: true,
            skippedArtworks: true,
            failedArtworks: true,
            newImages: true,
            durationMs: true,
            errorMessage: true
          }
        }
      }
    })
  })

  it('counts only current unacknowledged video optimization failures as needing attention', async () => {
    mocks.globalFindMany
      .mockResolvedValueOnce([
        {
          id: 'job-active',
          status: 'RUNNING',
          targetImageId: 3,
          definitionVersion: 1,
          type: 'VIDEO_STREAMING_OPTIMIZATION',
          payload: { imageId: 3, relativePath: 'video.mp4', mode: 'REMUX_FASTSTART' }
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'job-success-1',
          status: 'COMPLETED',
          targetImageId: 1,
          definitionVersion: 1,
          type: 'VIDEO_STREAMING_OPTIMIZATION',
          payload: { imageId: 1, relativePath: 'video.mp4', mode: 'REMUX_FASTSTART' },
          failureAcknowledgement: null
        },
        {
          id: 'job-old-failure-1',
          status: 'FAILED',
          targetImageId: 1,
          definitionVersion: 1,
          type: 'VIDEO_STREAMING_OPTIMIZATION',
          payload: { imageId: 1, relativePath: 'video.mp4', mode: 'REMUX_FASTSTART' },
          failureAcknowledgement: null
        },
        {
          id: 'job-acknowledged-failure-2',
          status: 'FAILED',
          targetImageId: 2,
          definitionVersion: 1,
          type: 'VIDEO_STREAMING_OPTIMIZATION',
          payload: { imageId: 2, relativePath: 'video.mp4', mode: 'REMUX_FASTSTART' },
          failureAcknowledgement: { jobId: 'job-acknowledged-failure-2' }
        },
        {
          id: 'job-retrying-failure-3',
          status: 'FAILED',
          targetImageId: 3,
          definitionVersion: 1,
          type: 'VIDEO_STREAMING_OPTIMIZATION',
          payload: { imageId: 3, relativePath: 'video.mp4', mode: 'REMUX_FASTSTART' },
          failureAcknowledgement: null
        },
        {
          id: 'job-current-failure-4',
          status: 'FAILED',
          targetImageId: 4,
          definitionVersion: 1,
          type: 'VIDEO_STREAMING_OPTIMIZATION',
          payload: { imageId: 4, relativePath: 'video.mp4', mode: 'REMUX_FASTSTART' },
          failureAcknowledgement: null
        },
        {
          id: 'job-old-failure-4',
          status: 'FAILED',
          targetImageId: 4,
          definitionVersion: 1,
          type: 'VIDEO_STREAMING_OPTIMIZATION',
          payload: { imageId: 4, relativePath: 'video.mp4', mode: 'REMUX_FASTSTART' },
          failureAcknowledgement: null
        }
      ])

    const queue = await listVideoStreamingOptimizationQueue()

    expect(queue.failureAttentionCount).toBe(1)
    expect(queue.recent).toEqual([
      expect.objectContaining({ id: 'job-success-1', failureNeedsAttention: false, retryAllowed: false }),
      expect.objectContaining({ id: 'job-old-failure-1', failureNeedsAttention: false, retryAllowed: false }),
      expect.objectContaining({ id: 'job-acknowledged-failure-2', failureNeedsAttention: false, retryAllowed: false }),
      expect.objectContaining({ id: 'job-retrying-failure-3', failureNeedsAttention: false, retryAllowed: false }),
      expect.objectContaining({ id: 'job-current-failure-4', failureNeedsAttention: true, retryAllowed: true }),
      expect.objectContaining({ id: 'job-old-failure-4', failureNeedsAttention: false, retryAllowed: false })
    ])
    expect(mocks.globalFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        include: { failureAcknowledgement: { select: { jobId: true } } }
      })
    )
  })

  it('loads only the task ids selected by the indexed payload query', async () => {
    mocks.queryRaw.mockResolvedValue([{ id: 'new-9' }])
    mocks.globalFindMany.mockImplementation(({ select }) =>
      Promise.resolve(
        select
          ? []
          : [
              {
                id: 'new-9',
                type: 'VIDEO_STREAMING_OPTIMIZATION',
                definitionVersion: 1,
                payload: { imageId: 9, relativePath: 'video.mp4', mode: 'REMUX_FASTSTART' },
                targetImageId: 999
              }
            ]
      )
    )
    const result = await getLatestVideoStreamingOptimizationJobsByImageIds([9])
    expect(result).toEqual([expect.objectContaining({ id: 'new-9', targetImageId: 9, queuePosition: null })])
    expect(mocks.globalFindMany).toHaveBeenCalledWith({ where: { id: { in: ['new-9'] } } })
    expect(mocks.groupBy).not.toHaveBeenCalled()
  })
})
