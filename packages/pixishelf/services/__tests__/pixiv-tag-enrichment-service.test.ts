import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'

const mocks = vi.hoisted(() => ({
  enqueueJob: vi.fn(),
  enqueueSingleton: vi.fn(),
  cancelJob: vi.fn(),
  getJobById: vi.fn(),
  lockSingleton: vi.fn(),
  transaction: {
    $queryRaw: vi.fn(),
    systemJob: { findFirst: vi.fn(), updateMany: vi.fn() },
    systemJobEvent: { createMany: vi.fn() },
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
    mocks.transaction.$queryRaw.mockResolvedValue([])
    mocks.transaction.systemJob.updateMany.mockImplementation(({ where }) =>
      Promise.resolve({ count: where.id.in.length })
    )
    mocks.transaction.systemJobEvent.createMany.mockResolvedValue({ count: 0 })
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

  it('rejects a selected batch larger than the bounded enrichment batch', async () => {
    await expect(
      startPixivTagEnrichment(
        'user-1',
        Array.from({ length: 201 }, (_, index) => index + 1)
      )
    ).rejects.toThrow('一次最多选择 200 个标签')
    expect(mocks.enqueueSingleton).not.toHaveBeenCalled()
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

  it('stops the discovery parent before atomically cancelling queued and running children', async () => {
    mocks.prisma.systemJob.findUnique
      .mockResolvedValueOnce({ id: 'child-1', parentJobId: 'root-1', status: 'RUNNING' })
      .mockResolvedValueOnce({ id: 'root-1', parentJobId: null, status: 'RUNNING' })
    mocks.transaction.$queryRaw.mockResolvedValue([
      { id: 'child-1', status: 'RUNNING', attempt: 1 },
      { id: 'child-2', status: 'PENDING', attempt: 0 }
    ])

    await expect(cancelPixivTagEnrichment('child-1')).resolves.toMatchObject({
      batchId: 'root-1',
      affectedCount: 3,
      job: { id: 'child-1', status: 'CANCELLING' }
    })
    expect(mocks.cancelJob.mock.calls.map(([input]) => input.jobId)).toEqual(['root-1'])
    expect(mocks.cancelJob.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.$transaction.mock.invocationCallOrder[0]!
    )
    expect(mocks.transaction.systemJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['child-2'] }, status: { in: ['PENDING', 'RETRY_WAIT', 'PAUSED'] } },
        data: expect.objectContaining({ status: 'CANCELLED', workerId: null, leaseToken: null })
      })
    )
    expect(mocks.transaction.systemJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['child-1'] }, status: { in: ['RUNNING', 'PAUSING'] } },
        data: expect.objectContaining({ status: 'CANCELLING' })
      })
    )
    expect(mocks.transaction.systemJobEvent.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ jobId: 'child-1', type: 'job.cancel_requested' }),
        expect.objectContaining({ jobId: 'child-2', type: 'job.cancel_requested' }),
        expect.objectContaining({ jobId: 'child-2', type: 'job.cancelled' })
      ])
    })
  })

  it('retries parent cancellation when its state changes concurrently', async () => {
    mocks.prisma.systemJob.findUnique
      .mockResolvedValueOnce({ id: 'root-1', parentJobId: null, status: 'PENDING' })
      .mockResolvedValueOnce({ status: 'RUNNING' })
    mocks.cancelJob
      .mockRejectedValueOnce(new BackgroundTaskError('CONCURRENT_MODIFICATION', 'changed while cancelling'))
      .mockResolvedValueOnce({ status: 'CANCELLING' })

    await expect(cancelPixivTagEnrichment('root-1')).resolves.toMatchObject({
      batchId: 'root-1',
      affectedCount: 1
    })
    expect(mocks.cancelJob).toHaveBeenCalledTimes(2)
  })

  it('cancels 5000 queued children with bounded event inserts instead of per-job commands', async () => {
    mocks.prisma.systemJob.findUnique.mockResolvedValue({
      id: 'root-1',
      parentJobId: null,
      status: 'COMPLETED'
    })
    mocks.transaction.$queryRaw.mockResolvedValue(
      Array.from({ length: 5_000 }, (_, index) => ({ id: `child-${index + 1}`, status: 'PENDING', attempt: 0 }))
    )

    await expect(cancelPixivTagEnrichment('root-1')).resolves.toMatchObject({
      batchId: 'root-1',
      affectedCount: 5_000
    })

    expect(mocks.cancelJob).not.toHaveBeenCalled()
    expect(mocks.transaction.systemJob.updateMany).toHaveBeenCalledTimes(1)
    expect(mocks.transaction.systemJobEvent.createMany).toHaveBeenCalledTimes(20)
    expect(
      mocks.transaction.systemJobEvent.createMany.mock.calls.reduce((total, [input]) => total + input.data.length, 0)
    ).toBe(10_000)
  })

  it('does not rewrite audit events for children that are already cancelling', async () => {
    mocks.prisma.systemJob.findUnique.mockResolvedValue({
      id: 'root-1',
      parentJobId: null,
      status: 'COMPLETED'
    })
    mocks.transaction.$queryRaw.mockResolvedValue([{ id: 'child-1', status: 'CANCELLING', attempt: 1 }])

    await expect(cancelPixivTagEnrichment('root-1')).resolves.toMatchObject({ affectedCount: 0 })
    expect(mocks.transaction.systemJob.updateMany).not.toHaveBeenCalled()
    expect(mocks.transaction.systemJobEvent.createMany).not.toHaveBeenCalled()
  })

  it('aggregates terminal progress across a 5000-plus child batch for the management dialog', async () => {
    mocks.prisma.tag.count.mockResolvedValue(5)
    mocks.prisma.tagExternalMetadata.groupBy.mockResolvedValue([
      { status: 'SUCCESS', _count: { _all: 3 } },
      { status: 'FAILED', _count: { _all: 1 } }
    ])
    mocks.prisma.systemJob.findFirst
      .mockResolvedValueOnce({ id: 'child-active', status: 'RUNNING', progress: 50 })
      .mockResolvedValueOnce({ id: 'root-1', status: 'COMPLETED' })
    mocks.prisma.systemJob.groupBy.mockResolvedValue([
      { status: 'COMPLETED', _count: { _all: 3_500 } },
      { status: 'FAILED', _count: { _all: 250 } },
      { status: 'CANCELLED', _count: { _all: 1_000 } },
      { status: 'PENDING', _count: { _all: 250 } },
      { status: 'RUNNING', _count: { _all: 1 } }
    ])

    await expect(getPixivTagEnrichmentSummary()).resolves.toMatchObject({
      candidateCount: 5,
      providerCounts: { SUCCESS: 3, PARTIAL: 0, NO_DATA: 0, FAILED: 1 },
      children: {
        total: 5_001,
        completed: 4_750,
        byStatus: { COMPLETED: 3_500, FAILED: 250, CANCELLED: 1_000, PENDING: 250, RUNNING: 1 }
      }
    })
  })
})
