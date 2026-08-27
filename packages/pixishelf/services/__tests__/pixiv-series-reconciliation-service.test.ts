import { beforeEach, describe, expect, it, vi } from 'vitest'

const capability = {
  jobType: 'PIXIV_SERIES_RECONCILIATION',
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
  getPixivSeriesReconciliationSummary,
  retryPixivSeriesReconciliation,
  startPixivSeriesReconciliation
} from '../pixiv-series-reconciliation-service'

describe('Pixiv series reconciliation control service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.$transaction.mockImplementation((operation) => operation(mocks.transaction))
    mocks.prisma.workerInstance.findMany.mockResolvedValue([{ capabilities: [capability] }])
    mocks.transaction.workerInstance.findMany.mockResolvedValue([{ capabilities: [capability] }])
    mocks.transaction.systemJob.findFirst.mockResolvedValue(null)
    mocks.transaction.artworkExternalRef.findMany.mockResolvedValue([{ id: 'ref-7', artworkId: 7, externalId: '123' }])
    mocks.enqueueJob.mockResolvedValue({ id: 'job-1' })
    mocks.enqueueSingleton.mockResolvedValue({ job: { id: 'root-1' }, reused: false })
  })

  it('starts continuous discovery and caps explicit selections at 200 artworks', async () => {
    await startPixivSeriesReconciliation('admin-1', [7, 3, 7], true)
    expect(mocks.enqueueSingleton).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PIXIV_SERIES_RECONCILIATION',
        payload: { mode: 'DISCOVER', artworkIds: [3, 7], refreshExisting: true }
      })
    )
    await expect(
      startPixivSeriesReconciliation(
        'admin-1',
        Array.from({ length: 201 }, (_, index) => index + 1)
      )
    ).rejects.toThrow('一次最多选择 200 个作品')
  })

  it('requires the new READY Worker capability', async () => {
    mocks.prisma.workerInstance.findMany.mockResolvedValue([])
    await expect(startPixivSeriesReconciliation('admin-1')).rejects.toThrow('新版本 READY Worker')
    expect(mocks.enqueueSingleton).not.toHaveBeenCalled()
  })

  it('freezes the unique Pixiv artwork identity for an item retry', async () => {
    await retryPixivSeriesReconciliation(7, 'admin-1')
    expect(mocks.lockSingleton).toHaveBeenCalledWith(mocks.transaction, 'PIXIV_SERIES_RECONCILIATION')
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PIXIV_SERIES_RECONCILIATION',
        payload: {
          mode: 'ARTWORK',
          artworkId: 7,
          expectedExternalRefId: 'ref-7',
          expectedPixivArtworkId: '123',
          refreshExisting: true
        }
      }),
      expect.anything()
    )
  })

  it('summarizes artwork-level series checks and batch progress', async () => {
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

    await expect(getPixivSeriesReconciliationSummary()).resolves.toMatchObject({
      candidateCount: 5,
      eligibleCount: 9,
      capabilityAvailable: true,
      providerCounts: { SUCCESS: 3, PARTIAL: 0, NO_DATA: 1, FAILED: 0 },
      children: { total: 4_000, completed: 3_750 }
    })
  })
})
