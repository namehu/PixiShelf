import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ append: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/archive-uploader/discovery-creator-service', async (original) => ({
  ...(await original<typeof import('@/services/archive-uploader/discovery-creator-service')>()),
  appendDiscoveryCreators: mocks.append
}))
import { archiveSearchRouter } from '../archive-search'
const input = { sourceId: 'source', artistIds: [7], expectedRulesVersion: 1 }
const authorized = { session: { id: 'session' }, user: { id: 'user' }, userId: 'user', headers: new Headers() } as never

describe('append source creators authorization', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects an unauthenticated mutation before service execution', async () => {
    const caller = archiveSearchRouter.createCaller({ session: null, user: null, headers: new Headers() } as never)
    await expect(caller.appendDefaultCreators(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(mocks.append).not.toHaveBeenCalled()
  })
  it('rejects empty artist sets and extra fields', async () => {
    const caller = archiveSearchRouter.createCaller(authorized)
    await expect(caller.appendDefaultCreators({ ...input, artistIds: [] })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    await expect(caller.appendDefaultCreators({ ...input, userId: 'other' } as never)).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    expect(mocks.append).not.toHaveBeenCalled()
  })
  it('passes a valid authenticated request to the append service', async () => {
    mocks.append.mockResolvedValue({ id: 'source' })
    await expect(archiveSearchRouter.createCaller(authorized).appendDefaultCreators(input)).resolves.toEqual({
      id: 'source'
    })
    expect(mocks.append).toHaveBeenCalledWith(input)
  })
})
