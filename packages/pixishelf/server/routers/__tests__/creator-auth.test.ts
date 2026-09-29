import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  history: vi.fn(),
  mappings: vi.fn(),
  mapping: vi.fn()
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/creator-maintenance-service', () => ({
  prepareCreatorMaintenance: mocks.prepare,
  startCreatorMaintenance: mocks.start,
  getCreatorMaintenance: mocks.status,
  listCreatorMaintenance: mocks.history,
  listCreatorMappings: mocks.mappings,
  getCreatorMapping: mocks.mapping
}))
import { creatorRouter } from '../creator'
const authorized = {
  session: { id: 'session' },
  user: { id: 'owner' },
  userId: 'owner',
  headers: new Headers()
} as never
const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never
describe('creator management authorization', () => {
  beforeEach(() => vi.clearAllMocks())
  it('requires a session for every management read and write', async () => {
    const caller = creatorRouter.createCaller(unauthorized)
    for (const invoke of [
      () => caller.prepare({ command: 'BACKFILL' }),
      () => caller.start({ planId: 'plan', fingerprint: 'a'.repeat(64) }),
      () => caller.status({ planId: 'plan' }),
      () => caller.history(),
      () => caller.mappings({}),
      () => caller.mapping({ id: 'mapping' })
    ])
      {await expect(invoke()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })}
    for (const service of Object.values(mocks)) expect(service).not.toHaveBeenCalled()
  })
  it('takes the actor from the authenticated context and rejects fabricated source evidence', async () => {
    const caller = creatorRouter.createCaller(authorized)
    await caller.prepare({ command: 'ADD', artworkIds: [1], creatorIds: [2] })
    expect(mocks.prepare).toHaveBeenCalledWith('owner', { command: 'ADD', artworkIds: [1], creatorIds: [2] })
    mocks.prepare.mockClear()
    await expect(caller.prepare({ command: 'BACKFILL', sourceTags: ['artist:fake'] } as never)).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
})
