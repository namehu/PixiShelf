import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findWorkers: vi.fn(),
  enqueueSingleton: vi.fn(),
  listJobs: vi.fn(),
  cancelJob: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { workerInstance: { findMany: mocks.findWorkers } }
}))
vi.mock('@/services/background-task', () => ({
  enqueueSingletonManualJobWithResult: mocks.enqueueSingleton,
  listJobs: mocks.listJobs,
  cancelJobCommand: mocks.cancelJob
}))

import {
  cancelPixivAiDerivedTagSync,
  startPixivAiDerivedTagSync,
  supportsPixivAiDerivedTagSync
} from '../pixiv-ai-derived-tag-service'

const capability = {
  jobType: 'PIXIV_AI_DERIVED_TAG_SYNC',
  executionLane: 'BACKGROUND_WRITER',
  definitionVersions: [1]
}

describe('Pixiv AI derived-tag service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enqueueSingleton.mockResolvedValue({ job: { id: 'job-1' }, reused: false })
    mocks.listJobs.mockResolvedValue({ items: [] })
  })

  it('requires the exact fresh Worker capability before enqueueing', async () => {
    mocks.findWorkers.mockResolvedValue([{ capabilities: [] }])
    await expect(startPixivAiDerivedTagSync('admin-1', { dryRun: true })).rejects.toThrow('READY Worker')
    expect(mocks.enqueueSingleton).not.toHaveBeenCalled()

    mocks.findWorkers.mockResolvedValue([{ capabilities: [capability] }])
    await expect(startPixivAiDerivedTagSync('admin-1', { dryRun: false })).resolves.toMatchObject({
      job: { id: 'job-1' }
    })
    expect(mocks.enqueueSingleton).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PIXIV_AI_DERIVED_TAG_SYNC',
        requestedByUserId: 'admin-1',
        payload: { dryRun: false }
      })
    )
  })

  it('rejects wrong lane or version capabilities', () => {
    expect(supportsPixivAiDerivedTagSync([capability])).toBe(true)
    expect(supportsPixivAiDerivedTagSync([{ ...capability, executionLane: 'ARCHIVE_RESOLVE' }])).toBe(false)
    expect(supportsPixivAiDerivedTagSync([{ ...capability, definitionVersions: [2] }])).toBe(false)
  })

  it('cancels only the active maintenance job returned by the queue', async () => {
    mocks.listJobs.mockResolvedValue({ items: [{ id: 'job-active' }] })
    await expect(cancelPixivAiDerivedTagSync()).resolves.toEqual({ success: true, jobId: 'job-active' })
    expect(mocks.cancelJob).toHaveBeenCalledWith({ jobId: 'job-active' })
  })
})
