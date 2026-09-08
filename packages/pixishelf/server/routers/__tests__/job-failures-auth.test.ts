import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), bulk: vi.fn(), detail: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/services/background-task', async (original) => ({
  ...(await original<typeof import('@/services/background-task')>()),
  acknowledgeJobFailuresCommand: mocks.bulk,
  getBackgroundJobDetail: mocks.detail
}))
vi.mock('@/services/background-task/job-history-service', async (original) => ({
  ...(await original<typeof import('@/services/background-task/job-history-service')>()),
  listBackgroundFailures: mocks.list
}))
import { jobRouter } from '../job'

const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never
const authorized = {
  session: { id: 'session' },
  user: { id: 'admin' },
  userId: 'admin',
  headers: new Headers()
} as never

describe('failure notification API authorization', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects anonymous queries and mutations before any service call', async () => {
    const caller = jobRouter.createCaller(unauthorized)
    await expect(caller.backgroundFailures({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(caller.backgroundDetail({ jobId: 'old' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(caller.acknowledgeBackgroundJobFailures({ scope: 'all' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.bulk).not.toHaveBeenCalled()
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it('uses the authenticated actor and rejects malformed selection', async () => {
    const caller = jobRouter.createCaller(authorized)
    mocks.bulk.mockResolvedValue({ acknowledgedCount: 1, skippedCount: 0 })
    await caller.acknowledgeBackgroundJobFailures({ scope: 'selected', jobIds: ['one', 'one'] })
    expect(mocks.bulk).toHaveBeenCalledWith({ scope: 'selected', jobIds: ['one'] }, 'admin')
    await expect(caller.acknowledgeBackgroundJobFailures({ scope: 'selected', jobIds: [] })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    expect(mocks.bulk).toHaveBeenCalledOnce()
  })
})
