import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  query: vi.fn(),
  jobFindFirst: vi.fn(),
  imageFindUnique: vi.fn(),
  enqueueJob: vi.fn(),
  enqueueSingletonManualJobWithResult: vi.fn(),
  cancelJobCommand: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    image: { findUnique: mocks.imageFindUnique }
  }
}))

vi.mock('@/services/background-task', () => ({
  enqueueJob: mocks.enqueueJob,
  enqueueSingletonManualJobWithResult: mocks.enqueueSingletonManualJobWithResult,
  cancelJobCommand: mocks.cancelJobCommand
}))

import {
  cancelCentralVideoMediaProbe,
  enqueueCentralDerivedMediaGc,
  enqueueCentralVideoMediaProbe,
  enqueueCentralVideoMediaReprobe,
  enqueueCentralVideoPoster
} from '../video-media-central-service'

describe('central video media enqueue helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation((operation) =>
      operation({ $queryRawUnsafe: mocks.query, systemJob: { findFirst: mocks.jobFindFirst } })
    )
    mocks.jobFindFirst.mockResolvedValue(null)
    mocks.imageFindUnique.mockResolvedValue({ id: 42, path: '/videos/42.mp4', mediaType: 'VIDEO' })
    mocks.enqueueJob.mockResolvedValue({ id: 'job-new', status: 'PENDING' })
    mocks.enqueueSingletonManualJobWithResult.mockResolvedValue({
      job: { id: 'job-new', status: 'PENDING' },
      reused: false
    })
    mocks.cancelJobCommand.mockResolvedValue({ id: 'job-active', status: 'CANCELLING' })
  })

  it('enqueues an explicit force probe without running media work in the request', async () => {
    await expect(
      enqueueCentralVideoMediaProbe({ force: true, requestedByUserId: 'admin-1' })
    ).resolves.toEqual({ jobId: 'job-new', status: 'PENDING', reused: false })
    expect(mocks.enqueueSingletonManualJobWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'VIDEO_MEDIA_PROBE',
        priority: 40,
        payload: { force: true, enqueueMissingPosters: true }
      })
    )
  })

  it('reports matching work reused by the shared type-level singleton', async () => {
    mocks.enqueueSingletonManualJobWithResult.mockResolvedValue({
      job: { id: 'job-existing', status: 'RUNNING' },
      reused: true
    })
    await expect(
      enqueueCentralVideoMediaProbe({ force: false, requestedByUserId: 'admin-1' })
    ).resolves.toEqual({ jobId: 'job-existing', status: 'RUNNING', reused: true })
  })

  it('validates and enqueues only one target poster payload', async () => {
    await enqueueCentralVideoPoster({ imageId: 42, requestedByUserId: 'admin-1' })
    expect(mocks.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1::integer, $2::integer)::text',
      expect.any(Number),
      42
    )
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'VIDEO_POSTER_GENERATION',
        payload: { imageId: 42, relativePath: 'videos/42.mp4' }
      }),
      expect.objectContaining({ $transaction: expect.any(Function) })
    )
  })

  it('persists a force-scoped single-image reprobe instead of doing media work in the request', async () => {
    await enqueueCentralVideoMediaReprobe({ imageId: 42, requestedByUserId: 'admin-1' })
    expect(mocks.enqueueSingletonManualJobWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'VIDEO_MEDIA_PROBE',
        priority: 20,
        payload: { force: true, enqueueMissingPosters: true, imageId: 42 }
      })
    )
  })

  it('cancels an explicitly selected probe through the unified background-task command', async () => {
    await expect(cancelCentralVideoMediaProbe('job-active')).resolves.toEqual({
      id: 'job-active',
      status: 'CANCELLING'
    })
    expect(mocks.cancelJobCommand).toHaveBeenCalledWith({ jobId: 'job-active' })
  })

  it('deduplicates explicit GC entry ids and only enqueues the job', async () => {
    await enqueueCentralDerivedMediaGc({ entryIds: ['gc-1', 'gc-1'], dryRun: true, requestedByUserId: 'admin-1' })
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DERIVED_MEDIA_GC',
        payload: { entryIds: ['gc-1'], dryRun: true, reconcile: false }
      })
    )
  })

  it('keeps reconciliation explicit and dry-run capable', async () => {
    await enqueueCentralDerivedMediaGc({ dryRun: true, reconcile: true, requestedByUserId: 'admin-1' })
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DERIVED_MEDIA_GC', payload: { dryRun: true, reconcile: true } })
    )
  })
})
