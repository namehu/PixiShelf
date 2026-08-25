import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueueJob: vi.fn(),
  enqueueSingleton: vi.fn(),
  cancelJob: vi.fn(),
  getJobById: vi.fn(),
  lockSingleton: vi.fn(),
  transaction: {
    systemJob: { findFirst: vi.fn() },
    artistExternalRef: { findUnique: vi.fn() }
  },
  prisma: {
    $transaction: vi.fn(),
    artistExternalRef: { count: vi.fn(), groupBy: vi.fn() },
    systemJob: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() }
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
  cancelPixivArtistEnrichment,
  getPixivArtistEnrichmentSummary,
  retryPixivArtistEnrichment,
  startPixivArtistEnrichment
} from '../pixiv-artist-enrichment-service'

describe('Pixiv artist enrichment control service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.$transaction.mockImplementation((operation) => operation(mocks.transaction))
    mocks.transaction.systemJob.findFirst.mockResolvedValue(null)
    mocks.transaction.artistExternalRef.findUnique.mockResolvedValue({ id: 'ref-7', artistId: 7, externalId: '123' })
    mocks.enqueueJob.mockResolvedValue({ id: 'job-1' })
    mocks.cancelJob.mockResolvedValue({ status: 'CANCELLED' })
    mocks.getJobById.mockResolvedValue({ id: 'child-1', status: 'CANCELLING' })
  })

  it('starts a bounded default discovery through the singleton boundary', async () => {
    mocks.enqueueSingleton.mockResolvedValue({ job: { id: 'root-1' }, reused: false })
    await startPixivArtistEnrichment('admin-1')
    expect(mocks.enqueueSingleton).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PIXIV_ARTIST_ENRICHMENT',
        payload: { mode: 'DISCOVER', force: false }
      })
    )
  })

  it('deduplicates selected artists and rejects more than 200', async () => {
    mocks.enqueueSingleton.mockResolvedValue({ job: { id: 'root-1' }, reused: false })
    await startPixivArtistEnrichment('admin-1', [7, 3, 7])
    expect(mocks.enqueueSingleton).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { mode: 'DISCOVER', force: true, artistIds: [3, 7] }
      })
    )
    await expect(
      startPixivArtistEnrichment(
        'admin-1',
        Array.from({ length: 201 }, (_, index) => index + 1)
      )
    ).rejects.toThrow('一次最多选择 200 个艺术家')
  })

  it('persists an explicit refresh policy for selected and bounded discovery batches', async () => {
    mocks.enqueueSingleton.mockResolvedValue({ job: { id: 'root-1' }, reused: false })

    await startPixivArtistEnrichment('admin-1', [7, 3], true)
    expect(mocks.enqueueSingleton).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: { mode: 'DISCOVER', force: true, artistIds: [3, 7], refreshExisting: true }
      })
    )

    await startPixivArtistEnrichment('admin-1', undefined, true)
    expect(mocks.enqueueSingleton).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: { mode: 'DISCOVER', force: false, refreshExisting: true }
      })
    )
  })

  it('freezes the confirmed external identity in a single-item retry', async () => {
    await retryPixivArtistEnrichment(7, 'admin-1')
    expect(mocks.lockSingleton).toHaveBeenCalledWith(mocks.transaction, 'PIXIV_ARTIST_ENRICHMENT')
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PIXIV_ARTIST_ENRICHMENT',
        payload: {
          mode: 'ARTIST',
          artistId: 7,
          expectedExternalRefId: 'ref-7',
          expectedPixivUserId: '123',
          force: true
        }
      }),
      expect.anything()
    )
  })

  it('cancels the root before active children', async () => {
    mocks.prisma.systemJob.findUnique.mockResolvedValue({ id: 'child-1', parentJobId: 'root-1' })
    mocks.prisma.systemJob.findMany.mockResolvedValue([{ id: 'root-1' }, { id: 'child-1' }])
    await expect(cancelPixivArtistEnrichment('child-1')).resolves.toMatchObject({
      batchId: 'root-1',
      affectedCount: 2
    })
    expect(mocks.cancelJob.mock.calls.map(([input]) => input.jobId)).toEqual(['root-1', 'child-1'])
  })

  it('summarizes unchecked identities and provider outcomes', async () => {
    mocks.prisma.artistExternalRef.count.mockResolvedValue(5)
    mocks.prisma.artistExternalRef.groupBy.mockResolvedValue([
      { status: 'SUCCESS', _count: { _all: 3 } },
      { status: 'NO_DATA', _count: { _all: 1 } }
    ])
    mocks.prisma.systemJob.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'root-1', status: 'COMPLETED' })
    mocks.prisma.systemJob.groupBy.mockResolvedValue([{ status: 'COMPLETED', _count: { _all: 4 } }])
    await expect(getPixivArtistEnrichmentSummary()).resolves.toMatchObject({
      candidateCount: 5,
      eligibleCount: 9,
      providerCounts: { SUCCESS: 3, PARTIAL: 0, NO_DATA: 1, FAILED: 0 },
      children: { total: 4, completed: 4 }
    })
    expect(mocks.prisma.systemJob.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { type: 'PIXIV_ARTIST_ENRICHMENT', parentJobId: null } })
    )
  })
})
