import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  statuses: vi.fn(),
  remove: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  job: vi.fn()
}))
vi.mock('@/lib/prisma', () => ({ prisma: { systemJob: { findUnique: mocks.job } } }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: () => true } }))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }))
vi.mock('@/services/video-playback-service', () => ({
  submitVideoPlayback: mocks.generate,
  videoPlaybackStatuses: mocks.statuses,
  removeVideoPlayback: mocks.remove
}))
vi.mock('@/services/background-task', () => ({ retryJobCommand: mocks.retry, cancelJobCommand: mocks.cancel }))
import { videoPlaybackRouter } from '../video-playback'
const authorized = { session: { id: 'test' }, user: { id: 'admin' }, userId: 'admin', headers: new Headers() } as never
const anonymous = { session: null, user: null, headers: new Headers() } as never
beforeEach(() => {
  vi.clearAllMocks()
  mocks.job.mockResolvedValue({ type: 'VIDEO_PLAYBACK_GENERATION' })
})
describe('playback management authorization', () => {
  it.each(['generate', 'statuses', 'remove', 'cancel', 'retry'] as const)(
    'rejects anonymous %s without IO',
    async (method) => {
      const caller = videoPlaybackRouter.createCaller(anonymous)
      const input =
        method === 'generate' || method === 'statuses'
          ? { imageIds: [1] }
          : method === 'remove'
            ? { imageId: 1 }
            : { jobId: 'test' }
      await expect(caller[method](input as never)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled()
    }
  )
  it('uses the session owner for generation and retry', async () => {
    const caller = videoPlaybackRouter.createCaller(authorized)
    await caller.generate({ imageIds: [1, 2] })
    await caller.retry({ jobId: 'failed' })
    expect(mocks.generate).toHaveBeenCalledWith([1, 2], 'admin')
    expect(mocks.retry).toHaveBeenCalledWith({ jobId: 'failed', requestedByUserId: 'admin' })
  })
  it.each(['cancel', 'retry'] as const)('rejects %s of another task type', async (method) => {
    mocks.job.mockResolvedValue({ type: 'VIDEO_STREAMING_OPTIMIZATION' })
    await expect(videoPlaybackRouter.createCaller(authorized)[method]({ jobId: 'other' })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
    expect(mocks[method]).not.toHaveBeenCalled()
  })
})
