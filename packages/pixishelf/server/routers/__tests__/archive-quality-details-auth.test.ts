import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ details: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/archive/archive-quality-service', () => ({ getArchiveQualityDetails: mocks.details }))
import { archiveRouter } from '../archive'
const authorized = {
  session: { id: 'session' },
  user: { id: 'admin' },
  userId: 'admin',
  headers: new Headers()
} as never
const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never
describe('archive quality details authorization', () => {
  beforeEach(() => vi.clearAllMocks())
  it('requires authentication before reading saved page evidence', async () => {
    await expect(archiveRouter.createCaller(unauthorized).getQualityDetails({ artworkId: 7 })).rejects.toMatchObject({
      code: 'UNAUTHORIZED'
    })
    expect(mocks.details).not.toHaveBeenCalled()
  })
  it('bounds page requests at the authenticated boundary', async () => {
    mocks.details.mockResolvedValue(null)
    await archiveRouter.createCaller(authorized).getQualityDetails({ artworkId: 7 })
    expect(mocks.details).toHaveBeenCalledWith({ artworkId: 7, offset: 0, limit: 50 })
    await expect(
      archiveRouter.createCaller(authorized).getQualityDetails({ artworkId: 7, limit: 101 })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
