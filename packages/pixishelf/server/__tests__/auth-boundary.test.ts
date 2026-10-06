import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), allow: vi.fn(), read: vi.fn(), write: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: mocks.allow } }))

import { createTRPCContext } from '../context'
import { adminProcedure, authProcedure, router } from '../trpc'

const protectedRouter = router({
  read: authProcedure.query(({ ctx }) => mocks.read(ctx.userId)),
  write: adminProcedure.mutation(({ ctx }) => mocks.write(ctx.userId))
})
const headers = new Headers({ 'x-user-session': '{"userId":"forged-admin"}' })

describe('real tRPC context and authorization middleware', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.allow.mockReturnValue(true)
  })

  it.each([
    { name: 'absent session', identity: null },
    { name: 'absent session record', identity: { user: { id: 'owner' } } },
    { name: 'absent user', identity: { session: { id: 'session' } } }
  ])('rejects $name for reads and admin writes despite a forged header', async ({ identity }) => {
    mocks.getSession.mockResolvedValue(identity)
    const caller = protectedRouter.createCaller(await createTRPCContext({ headers }))
    await expect(caller.read()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(caller.write()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('derives both procedures actor from the real session instead of the header', async () => {
    mocks.getSession.mockResolvedValue({ session: { id: 'session' }, user: { id: 'owner' } })
    mocks.read.mockResolvedValue('read result')
    mocks.write.mockResolvedValue('write result')
    const context = await createTRPCContext({ headers })
    expect(context.userId).toBe('owner')
    const caller = protectedRouter.createCaller(context)
    await expect(caller.read()).resolves.toBe('read result')
    await expect(caller.write()).resolves.toBe('write result')
    expect(mocks.read).toHaveBeenCalledWith('owner')
    expect(mocks.write).toHaveBeenCalledWith('owner')
  })

  it('does not produce an authenticated context when the session provider fails', async () => {
    const error = new Error('session provider unavailable')
    mocks.getSession.mockRejectedValue(error)
    await expect(createTRPCContext({ headers })).rejects.toBe(error)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('blocks authenticated business reads and writes when rate limited', async () => {
    mocks.getSession.mockResolvedValue({ session: { id: 'session' }, user: { id: 'owner' } })
    mocks.allow.mockReturnValue(false)
    const caller = protectedRouter.createCaller(await createTRPCContext({ headers }))
    await expect(caller.read()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
    await expect(caller.write()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })
})
