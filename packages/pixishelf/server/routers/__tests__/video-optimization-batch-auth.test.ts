import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), submit: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/services/video-optimization-batch-service', () => ({
  listVideoStreamingOptimizationCandidates: mocks.list,
  previewVideoStreamingOptimizationBatch: mocks.preview,
  submitVideoStreamingOptimizationBatch: mocks.submit
}))
import { jobRouter } from '../job'
const anonymous = { session: null, user: null, userId: undefined, headers: new Headers() } as never
const authenticated = {
  session: { id: 'session' },
  user: { id: 'admin' },
  userId: 'admin',
  headers: new Headers()
} as never
const target = { artworkId: 1, imageId: 2, latestJobId: null, status: 'NONE' as const }

describe('MP4 batch authorization and request boundaries', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects every anonymous operation before any service or write', async () => {
    const caller = jobRouter.createCaller(anonymous)
    await expect(caller.listVideoStreamingOptimizationCandidates({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(
      caller.previewVideoStreamingOptimizationBatch({ selection: { mode: 'ALL_MATCHING' } })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(caller.submitVideoStreamingOptimizationBatch({ targets: [target] })).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.preview).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('applies safe defaults and passes the actor with fixed submission targets', async () => {
    const caller = jobRouter.createCaller(authenticated)
    await caller.listVideoStreamingOptimizationCandidates({})
    expect(mocks.list).toHaveBeenCalledWith({
      filters: { tags: [], excludeTags: [], sources: [], statuses: ['NONE', 'FAILED', 'CANCELLED', 'SKIPPED'] },
      page: 1,
      pageSize: 20
    })
    await caller.submitVideoStreamingOptimizationBatch({ targets: [target] })
    expect(mocks.submit).toHaveBeenCalledWith({ targets: [target] }, 'admin')
  })
  it('rejects empty status selections, active targets, oversized submissions and artwork expansion in submit', async () => {
    const caller = jobRouter.createCaller(authenticated)
    await expect(caller.listVideoStreamingOptimizationCandidates({ filters: { statuses: [] } })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    await expect(
      caller.previewVideoStreamingOptimizationBatch({ filters: { statuses: [] }, selection: { mode: 'ALL_MATCHING' } })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      caller.submitVideoStreamingOptimizationBatch({ targets: [{ ...target, status: 'ACTIVE' }] } as never)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      caller.submitVideoStreamingOptimizationBatch({ targets: Array.from({ length: 1001 }, () => target) })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      caller.submitVideoStreamingOptimizationBatch({ targets: [target], artworkIds: [1] } as never)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.preview).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })
})
