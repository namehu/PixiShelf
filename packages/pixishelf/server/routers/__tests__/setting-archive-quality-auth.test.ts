import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ status: vi.fn(), start: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/archive/archive-quality-service', () => ({
  getArchiveQualityAuditStatus: mocks.status,
  startArchiveQualityAudit: mocks.start
}))
import { settingRouter } from '../setting'

const authorized = {
  session: { id: 'session' },
  user: { id: 'admin' },
  userId: 'admin',
  headers: new Headers()
} as never
const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never

describe('archive quality audit authorization', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects unauthenticated queries and starts before calling the service', async () => {
    await expect(settingRouter.createCaller(unauthorized).getArchiveQualityAuditStatus()).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    })
    await expect(settingRouter.createCaller(unauthorized).startArchiveQualityAudit()).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    })
    expect(mocks.status).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('passes the server authenticated user to the audit request', async () => {
    mocks.start.mockResolvedValue({ jobId: 'audit', reused: false })
    await expect(settingRouter.createCaller(authorized).startArchiveQualityAudit()).resolves.toEqual({
      jobId: 'audit',
      reused: false
    })
    expect(mocks.start).toHaveBeenCalledWith({ requestedByUserId: 'admin' })
  })
})
