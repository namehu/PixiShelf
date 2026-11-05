import { beforeEach, describe, expect, it, vi } from 'vitest'
const { upgrade, read } = vi.hoisted(() => ({ upgrade: vi.fn(), read: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/services/archive/archive-original-upgrade-service', async (original) => ({
  ...(await original<typeof import('@/services/archive/archive-original-upgrade-service')>()),
  upgradeArchiveOriginal: upgrade,
  getArchiveOriginalUpgrade: read
}))
import { archiveRouter } from '../archive'
const input = { artworkId: 7, expectedRevisionId: 'base', idempotencyKey: 'request' }
const authorized = {
  session: { id: 'session' },
  user: { id: 'admin' },
  userId: 'admin',
  headers: new Headers()
} as never
beforeEach(() => {
  upgrade.mockReset()
  read.mockReset()
})
describe('original archive upgrade access boundary', () => {
  it('rejects anonymous mutation and status reads with zero service calls', async () => {
    const caller = archiveRouter.createCaller({ session: null, user: null, headers: new Headers() } as never)
    await expect(caller.upgradeOriginal(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(caller.getOriginalUpgrade({ artworkId: 7 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(upgrade).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })
  it('binds the actor to the authenticated session', async () => {
    upgrade.mockResolvedValue({ intakeItemId: 'intake', archiveImportId: null })
    await archiveRouter.createCaller(authorized).upgradeOriginal(input)
    expect(upgrade).toHaveBeenCalledWith(input, 'admin')
  })
  it.each([
    { quality: 'DISPLAY' },
    { requestedByUserId: 'other' },
    { path: '../file' },
    { sourcePlanDigest: 'client' }
  ])('refuses client-supplied upgrade facts %j', async (patch) => {
    await expect(archiveRouter.createCaller(authorized).upgradeOriginal({ ...input, ...patch })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    expect(upgrade).not.toHaveBeenCalled()
  })
})
