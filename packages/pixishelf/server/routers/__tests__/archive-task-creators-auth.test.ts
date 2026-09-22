import { beforeEach, describe, expect, it, vi } from 'vitest'
const writes = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/archive/archive-task-creators', async (original) => ({
  ...(await original<typeof import('@/services/archive/archive-task-creators')>()),
  editArchiveTaskCreators: writes
}))
import { archiveRouter } from '../archive'
const input = {
  taskId: 'task',
  action: 'ADD' as const,
  artistIds: [2, 1, 2],
  requestId: '00000000-0000-4000-8000-000000000001'
}
const authorized = {
  session: { id: 'session' },
  user: { id: 'admin' },
  userId: 'admin',
  headers: new Headers()
} as never
beforeEach(() => writes.mockReset())
describe('archive task creator boundary', () => {
  it('rejects unauthenticated writes without invoking the service', async () => {
    const caller = archiveRouter.createCaller({ session: null, user: null, headers: new Headers() } as never)
    await expect(caller.editTaskCreators(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(writes).not.toHaveBeenCalled()
  })
  it('resolves the actor from the session and canonicalizes artists', async () => {
    writes.mockResolvedValue(null)
    await archiveRouter.createCaller(authorized).editTaskCreators(input)
    expect(writes).toHaveBeenCalledWith({ ...input, artistIds: [1, 2] }, 'admin')
  })
  it.each([
    { artistIds: [] },
    { artistIds: Array(201).fill(1) },
    { artistIds: [-1] },
    { providerKey: 'spoofed' },
    { requestedByUserId: 'other' }
  ])('rejects invalid or client-controlled identity input %j', async (patch) => {
    await expect(archiveRouter.createCaller(authorized).editTaskCreators({ ...input, ...patch })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' }
    )
    expect(writes).not.toHaveBeenCalled()
  })
})
