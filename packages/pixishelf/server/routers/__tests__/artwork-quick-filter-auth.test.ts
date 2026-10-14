import { beforeEach, describe, expect, it, vi } from 'vitest'
const service = vi.hoisted(() => ({
  listQuickFilters: vi.fn(),
  createQuickFilter: vi.fn(),
  updateQuickFilter: vi.fn(),
  deleteQuickFilter: vi.fn(),
  setQuickFilterNavigation: vi.fn()
}))
vi.mock('@/services/artwork-quick-filter-service', () => service)
import { artworkQuickFilterRouter } from '../artwork-quick-filter'
import { artworkQuerySnapshotSchema } from '@/schemas/artwork-quick-filter.dto'
const context = { headers: new Headers(), user: { id: 'owner' }, session: { id: 'session' }, userId: 'owner' }
const id = '00000000-0000-4000-8000-000000000000'
async function calls(ctx: typeof context, expectedUserId: string, code: string) {
  const caller = artworkQuickFilterRouter.createCaller(ctx as never)
  const query = artworkQuerySnapshotSchema.parse({})
  await expect(caller.list({ expectedUserId })).rejects.toMatchObject({ code })
  await expect(caller.create({ expectedUserId, name: 'test', query, pin: true })).rejects.toMatchObject({ code })
  await expect(caller.update({ expectedUserId, id, revision: 1, name: 'test', query })).rejects.toMatchObject({ code })
  await expect(caller.delete({ expectedUserId, id, revision: 1 })).rejects.toMatchObject({ code })
  await expect(caller.setNavigation({ expectedUserId, navigation: { revision: 0, ids: [] } })).rejects.toMatchObject({
    code
  })
}
describe('quick filter ownership', () => {
  beforeEach(() => Object.values(service).forEach((mock) => mock.mockReset()))
  it('rejects unauthenticated reads and writes without touching data', async () => {
    await calls({ ...context, user: null, session: null } as never, 'owner', 'UNAUTHORIZED')
    expect(Object.values(service).every((mock) => !mock.mock.calls.length)).toBe(true)
  })
  it('rejects account switches before invoking a service', async () => {
    await calls(context, 'other', 'FORBIDDEN')
    expect(Object.values(service).every((mock) => !mock.mock.calls.length)).toBe(true)
  })
  it('takes identity from the authenticated session', async () => {
    await artworkQuickFilterRouter.createCaller(context as never).list({ expectedUserId: 'owner' })
    expect(service.listQuickFilters).toHaveBeenCalledWith('owner')
  })
})
