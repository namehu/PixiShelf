import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: { userBA: {}, account: {}, session: {}, verificationToken: {} },
  adapter: vi.fn<(database: unknown, config: unknown) => { id: string }>().mockReturnValue({ id: 'fixture-adapter' }),
  betterAuth: vi.fn<(options: unknown) => { api: object }>().mockReturnValue({ api: {} }),
  nextCookies: vi.fn(() => ({ id: 'next-cookies' })),
  bearer: vi.fn<(options: unknown) => { id: string }>().mockReturnValue({ id: 'bearer' })
}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('better-auth', () => ({ betterAuth: mocks.betterAuth }))
vi.mock('better-auth/adapters/prisma', () => ({ prismaAdapter: mocks.adapter }))
vi.mock('better-auth/next-js', () => ({ nextCookies: mocks.nextCookies }))
vi.mock('better-auth/plugins', () => ({ bearer: mocks.bearer }))

import { createAuth } from '../better-auth'

describe('Better Auth database boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes registration transactions directly to the adapter without nesting a transaction or writing cookies', () => {
    const transaction = { userBA: {}, account: {}, session: {}, verificationToken: {} } as Parameters<
      typeof createAuth
    >[0]
    createAuth(transaction, false)
    expect(mocks.adapter).toHaveBeenCalledWith(transaction, { provider: 'postgresql', transaction: false })
    expect(mocks.nextCookies).not.toHaveBeenCalled()
  })

  it('keeps mobile authentication on the shared database with signed bearer support and no Next Cookie plugin', () => {
    createAuth(undefined, false, true)
    expect(mocks.adapter).toHaveBeenCalledWith(mocks.prisma, { provider: 'postgresql', transaction: false })
    expect(mocks.bearer).toHaveBeenCalledWith({ requireSignature: true })
    expect(mocks.nextCookies).not.toHaveBeenCalled()
  })
})
