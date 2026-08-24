import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'

const mocks = vi.hoisted(() => ({
  enqueueJob: vi.fn(),
  enqueueSingleton: vi.fn(),
  cancelJob: vi.fn(),
  getJobById: vi.fn(),
  lockSingleton: vi.fn(),
  transaction: {
    systemJob: { findFirst: vi.fn() },
    tag: { findFirst: vi.fn() }
  },
  prisma: {
    $transaction: vi.fn(),
    tag: { count: vi.fn() },
    tagExternalMetadata: { groupBy: vi.fn() },
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
  cancelPixivTagEnrichment,
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
    mocks.cancelJob.mockResolvedValue({ status: 'CANCELLED' })
    mocks.getJobById.mockResolvedValue({ id: 'child-1', status: 'CANCELLING' })
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

  it('starts one forced discovery batch for the deduplicated selected tags', async () => {
    mocks.enqueueSingleton.mockResolvedValue({ job: { id: 'root-1' }, reused: false })

    await startPixivTagEnrichment('user-1', [7, 3, 7])

    expect(mocks.enqueueSingleton).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PIXIV_TAG_ENRICHMENT',
        payload: { mode: 'DISCOVER', force: true, tagIds: [3, 7] }
      })
    )
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

  it('cancels the discovery parent before every active child in the selected batch', async () => {
    mocks.prisma.systemJob.findUnique.mockResolvedValue({
      id: 'child-1',
      parentJobId: 'root-1',
      status: 'RUNNING'
    })
    mocks.prisma.systemJob.findMany.mockResolvedValue([{ id: 'root-1' }, { id: 'child-1' }, { id: 'child-2' }])

    await expect(cancelPixivTagEnrichment('child-1')).resolves.toMatchObject({
      batchId: 'root-1',
      affectedCount: 3,
      job: { id: 'child-1', status: 'CANCELLING' }
    })
    expect(mocks.cancelJob.mock.calls.map(([input]) => input.jobId)).toEqual(['root-1', 'child-1', 'child-2'])
  })

  it('retries cancellation when a queued child is claimed concurrently', async () => {
    mocks.prisma.systemJob.findUnique
      .mockResolvedValueOnce({ id: 'child-1', parentJobId: 'root-1', status: 'PENDING' })
      .mockResolvedValueOnce({ status: 'RUNNING' })
    mocks.prisma.systemJob.findMany.mockResolvedValue([{ id: 'child-1' }])
    mocks.cancelJob
      .mockRejectedValueOnce(new BackgroundTaskError('CONCURRENT_MODIFICATION', 'changed while cancelling'))
      .mockResolvedValueOnce({ status: 'CANCELLING' })

    await expect(cancelPixivTagEnrichment('child-1')).resolves.toMatchObject({
      batchId: 'root-1',
      affectedCount: 1
    })
    expect(mocks.cancelJob).toHaveBeenCalledTimes(2)
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
