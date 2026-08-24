import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueueJob: vi.fn(),
  enqueueSingleton: vi.fn(),
  lockSingleton: vi.fn(),
  transaction: {
    systemJob: { findFirst: vi.fn() },
    tag: { findFirst: vi.fn() }
  },
  prisma: {
    $transaction: vi.fn(),
    tag: { count: vi.fn() },
    tagExternalMetadata: { groupBy: vi.fn() },
    systemJob: { findFirst: vi.fn(), groupBy: vi.fn() }
  }
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/services/background-task', () => ({
  enqueueJob: mocks.enqueueJob,
  enqueueSingletonManualJobWithResult: mocks.enqueueSingleton,
  lockSingletonJobType: mocks.lockSingleton
}))

import {
  getPixivTagEnrichmentSummary,
  retryPixivTagEnrichment,
  startPixivTagEnrichment
} from '../pixiv-tag-enrichment-service'

describe('Pixiv tag enrichment control service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.$transaction.mockImplementation((operation) => operation(mocks.transaction))
    mocks.transaction.systemJob.findFirst.mockResolvedValue(null)
    mocks.transaction.tag.findFirst.mockResolvedValue({ id: 7, name: 'original' })
    mocks.enqueueJob.mockResolvedValue({ id: 'job-1' })
  })

  it('starts one non-force discovery job through the manual singleton boundary', async () => {
    mocks.enqueueSingleton.mockResolvedValue({ job: { id: 'root-1' }, reused: false })

    await expect(startPixivTagEnrichment('user-1')).resolves.toEqual({
      job: { id: 'root-1' },
      reused: false
    })
    expect(mocks.enqueueSingleton).toHaveBeenCalledWith({
      type: 'PIXIV_TAG_ENRICHMENT',
      triggerSource: 'MANUAL',
      requestedByUserId: 'user-1',
      priority: 80,
      maxAttempts: 3,
      payload: { mode: 'DISCOVER', force: false }
    })
  })

  it('serializes explicit retries and freezes the current tag name', async () => {
    await retryPixivTagEnrichment(7, 'user-1')

    expect(mocks.lockSingleton).toHaveBeenCalledWith(mocks.transaction, 'PIXIV_TAG_ENRICHMENT')
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PIXIV_TAG_ENRICHMENT',
        triggerSource: 'MANUAL',
        requestedByUserId: 'user-1',
        priority: 70,
        payload: { mode: 'TAG', tagId: 7, expectedName: 'original', force: true },
        idempotencyKey: expect.stringMatching(/^pixiv-tag:manual:7:/)
      }),
      expect.objectContaining({ $transaction: expect.any(Function) })
    )
  })

  it('refuses a per-tag retry while any enrichment job is active', async () => {
    mocks.transaction.systemJob.findFirst.mockResolvedValue({ id: 'active-1' })

    await expect(retryPixivTagEnrichment(7, 'user-1')).rejects.toThrow('已有 Pixiv 标签补全任务正在运行')
    expect(mocks.enqueueJob).not.toHaveBeenCalled()
  })

  it('summarizes provider and child terminal states for the management dialog', async () => {
    mocks.prisma.tag.count.mockResolvedValue(5)
    mocks.prisma.tagExternalMetadata.groupBy.mockResolvedValue([
      { status: 'SUCCESS', _count: { _all: 3 } },
      { status: 'FAILED', _count: { _all: 1 } }
    ])
    mocks.prisma.systemJob.findFirst
      .mockResolvedValueOnce({ id: 'child-active', status: 'RUNNING', progress: 50 })
      .mockResolvedValueOnce({ id: 'root-1', status: 'COMPLETED' })
    mocks.prisma.systemJob.groupBy.mockResolvedValue([
      { status: 'COMPLETED', _count: { _all: 2 } },
      { status: 'RUNNING', _count: { _all: 1 } }
    ])

    await expect(getPixivTagEnrichmentSummary()).resolves.toMatchObject({
      candidateCount: 5,
      providerCounts: { SUCCESS: 3, PARTIAL: 0, NO_DATA: 0, FAILED: 1 },
      children: { total: 3, completed: 2, byStatus: { COMPLETED: 2, RUNNING: 1 } }
    })
  })
})
