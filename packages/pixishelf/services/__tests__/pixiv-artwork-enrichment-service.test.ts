import { beforeEach, describe, expect, it, vi } from 'vitest'

const capability = {
  jobType: 'PIXIV_ARTWORK_ENRICHMENT',
  executionLane: 'BACKGROUND_WRITER',
  definitionVersions: [1]
}

const mocks = vi.hoisted(() => ({
  enqueueJob: vi.fn(),
  enqueueSingleton: vi.fn(),
  cancelJob: vi.fn(),
  getJobById: vi.fn(),
  lockSingleton: vi.fn(),
  transaction: {
    $queryRaw: vi.fn(),
    workerInstance: { findMany: vi.fn() },
    systemJob: { findFirst: vi.fn(), updateMany: vi.fn() },
    systemJobEvent: { createMany: vi.fn() },
    artworkExternalRef: { findMany: vi.fn() }
  },
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    workerInstance: { findMany: vi.fn() },
    systemJob: { findFirst: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn() }
  }
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/services/background-task', () => ({
  enqueueJob: mocks.enqueueJob,
  enqueueSingletonManualJobWithResult: mocks.enqueueSingleton,
  cancelJobCommand: mocks.cancelJob,
  getJobById: mocks.getJobById,
  lockSingletonJobType: mocks.lockSingleton
}))

import {
  cancelPixivArtworkEnrichment,
  getPixivArtworkEnrichmentSummary,
  retryPixivArtworkEnrichment,
  startPixivArtworkEnrichment
} from '../pixiv-artwork-enrichment-service'

describe('Pixiv artwork enrichment control service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.$transaction.mockImplementation((operation) => operation(mocks.transaction))
    mocks.prisma.workerInstance.findMany.mockResolvedValue([{ capabilities: [capability] }])
    mocks.transaction.workerInstance.findMany.mockResolvedValue([{ capabilities: [capability] }])
    mocks.transaction.systemJob.findFirst.mockResolvedValue(null)
    mocks.transaction.artworkExternalRef.findMany.mockResolvedValue([{ id: 'ref-7', artworkId: 7, externalId: '123' }])
    mocks.enqueueJob.mockResolvedValue({ id: 'job-1' })
    mocks.enqueueSingleton.mockResolvedValue({ job: { id: 'root-1' }, reused: false })
    mocks.getJobById.mockResolvedValue({ id: 'root-1', status: 'CANCELLING' })
    mocks.cancelJob.mockResolvedValue({ status: 'CANCELLING' })
    mocks.transaction.$queryRaw.mockResolvedValue([])
    mocks.transaction.systemJob.updateMany.mockResolvedValue({ count: 0 })
    mocks.transaction.systemJobEvent.createMany.mockResolvedValue({ count: 0 })
  })

  it('starts continuous discovery and freezes refresh/adopt policies', async () => {
    await startPixivArtworkEnrichment('admin-1', [7, 3, 7], true, true)
    expect(mocks.enqueueSingleton).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PIXIV_ARTWORK_ENRICHMENT',
        payload: {
          mode: 'DISCOVER',
          artworkIds: [3, 7],
          refreshExisting: true,
          adoptSourceText: true
        }
      })
    )
    await expect(
      startPixivArtworkEnrichment(
        'admin-1',
        Array.from({ length: 201 }, (_, index) => index + 1)
      )
    ).rejects.toThrow('一次最多选择 200 个作品')
  })

  it('blocks enqueue when the new Worker capability is unavailable', async () => {
    mocks.prisma.workerInstance.findMany.mockResolvedValue([])
    await expect(startPixivArtworkEnrichment('admin-1')).rejects.toThrow('新版本 READY Worker')
    expect(mocks.enqueueSingleton).not.toHaveBeenCalled()
  })

  it('freezes the unique external identity in a single-item retry', async () => {
    await retryPixivArtworkEnrichment(7, 'admin-1')
    expect(mocks.lockSingleton).toHaveBeenCalledWith(mocks.transaction, 'PIXIV_ARTWORK_ENRICHMENT')
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PIXIV_ARTWORK_ENRICHMENT',
        payload: {
          mode: 'ARTWORK',
          artworkId: 7,
          expectedExternalRefId: 'ref-7',
          expectedPixivArtworkId: '123',
          adoptSourceText: false
        }
      }),
      expect.anything()
    )
  })

  it('summarizes eligible refs, capability state, provider results and child progress', async () => {
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 5n }])
      .mockResolvedValueOnce([{ count: 9n }])
      .mockResolvedValueOnce([
        { status: 'SUCCESS', count: 3n },
        { status: 'NO_DATA', count: 1n }
      ])
    mocks.prisma.systemJob.findFirst
      .mockResolvedValueOnce({ id: 'child-active', status: 'RUNNING', progress: 50 })
      .mockResolvedValueOnce({ id: 'root-1', status: 'COMPLETED' })
    mocks.prisma.systemJob.groupBy.mockResolvedValue([
      { status: 'COMPLETED', _count: { _all: 3_500 } },
      { status: 'FAILED', _count: { _all: 250 } },
      { status: 'PENDING', _count: { _all: 250 } }
    ])

    await expect(getPixivArtworkEnrichmentSummary()).resolves.toMatchObject({
      candidateCount: 5,
      eligibleCount: 9,
      capabilityAvailable: true,
      providerCounts: { SUCCESS: 3, PARTIAL: 0, NO_DATA: 1, FAILED: 0 },
      children: { total: 4_000, completed: 3_750 }
    })
  })

  it('stops the parent before cancelling active children as one batch', async () => {
    mocks.prisma.systemJob.findUnique.mockResolvedValue({ id: 'root-1', parentJobId: null, status: 'RUNNING' })
    mocks.transaction.$queryRaw.mockResolvedValue([
      { id: 'child-1', status: 'PENDING', attempt: 0 },
      { id: 'child-2', status: 'RUNNING', attempt: 1 }
    ])
    mocks.transaction.systemJob.updateMany.mockImplementation(({ where }) =>
      Promise.resolve({ count: where.id.in.length })
    )

    await expect(cancelPixivArtworkEnrichment('root-1')).resolves.toMatchObject({
      batchId: 'root-1',
      affectedCount: 3
    })
    expect(mocks.cancelJob).toHaveBeenCalledWith({ jobId: 'root-1' }, mocks.prisma)
    expect(mocks.transaction.systemJobEvent.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ jobId: 'child-1', type: 'job.cancelled' }),
        expect.objectContaining({ jobId: 'child-2', type: 'job.cancel_requested' })
      ])
    })
  })

  it('cancels thousands of queued children and writes audit events in bounded chunks', async () => {
    mocks.prisma.systemJob.findUnique.mockResolvedValue({ id: 'root-1', parentJobId: null, status: 'COMPLETED' })
    mocks.transaction.$queryRaw.mockResolvedValue(
      Array.from({ length: 5_001 }, (_, index) => ({ id: `child-${index + 1}`, status: 'PENDING', attempt: 0 }))
    )
    mocks.transaction.systemJob.updateMany.mockResolvedValue({ count: 5_001 })

    await expect(cancelPixivArtworkEnrichment('root-1')).resolves.toMatchObject({
      batchId: 'root-1',
      affectedCount: 5_001
    })

    expect(mocks.transaction.systemJobEvent.createMany).toHaveBeenCalledTimes(21)
    for (const [input] of mocks.transaction.systemJobEvent.createMany.mock.calls) {
      expect(input.data.length).toBeLessThanOrEqual(500)
    }
  })
})
