import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn()
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { setting: mocks } }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))

import { settingRouter } from '../setting'

const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never
const authorized = {
  session: { id: 'fixture-session' },
  user: { id: 'fixture-admin' },
  userId: 'fixture-admin',
  headers: new Headers()
} as never

describe('EH Cookie settings boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('EH_COOKIE_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'))
    mocks.findUnique.mockResolvedValue(null)
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    () => settingRouter.createCaller(unauthorized).getArchiveEhCookieStatus(),
    () => settingRouter.createCaller(unauthorized).saveArchiveEhCookie({ cookie: 'fixture=secret' }),
    () => settingRouter.createCaller(unauthorized).clearArchiveEhCookie()
  ])('requires an authenticated administrator before accessing stored credentials', async (invoke) => {
    await expect(invoke()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.deleteMany).not.toHaveBeenCalled()
  })

  it('saves only ciphertext and returns only status fields', async () => {
    const caller = settingRouter.createCaller(authorized)
    const response = await caller.saveArchiveEhCookie({ cookie: 'ipb_member_id=fixture; ipb_pass_hash=secret' })
    expect(Object.keys(response).sort()).toEqual(['configured', 'encryptionAvailable', 'readable', 'updatedAt'])
    const written = mocks.upsert.mock.calls[0]![0]
    expect(written.create.type).toBe('encrypted')
    expect(written.create.value).not.toContain('secret')
    expect(written.create.value).not.toContain('fixture')
    expect(JSON.stringify(response)).not.toContain('secret')
  })

  it('fails without a deployment key and rejects invalid input before writing', async () => {
    const caller = settingRouter.createCaller(authorized)
    await expect(caller.saveArchiveEhCookie({ cookie: 'fixture=secret\r\nInjected: value' })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    vi.stubEnv('EH_COOKIE_ENCRYPTION_KEY', '')
    await expect(caller.saveArchiveEhCookie({ cookie: 'fixture=secret' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED'
    })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
