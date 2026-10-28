// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const getSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/better-auth', () => ({ createAuth: vi.fn(() => ({ api: { getSession } })) }))
import { getMobileSession, mobileAuthHeaders } from '../auth'
import { createAuth } from '@/lib/auth/better-auth'
beforeEach(() => getSession.mockReset())
it('uses a separate bearer instance without Next Cookie mutation', () => {
  expect(createAuth).toHaveBeenCalledWith(undefined, false, true)
})
it('refuses Cookie-only, missing and malformed bearer credentials', async () => {
  for (const header of ['', 'Basic abc', 'Bearer abc def']) {
    expect(
      await getMobileSession(new Headers({ cookie: 'better-auth.session_token=valid', authorization: header }))
    ).toBeNull()
  }
  expect(getSession).not.toHaveBeenCalled()
})
it('strips Cookie and spoofed context before session verification', async () => {
  const result = mobileAuthHeaders(
    new Headers({ authorization: 'Bearer signed.token', cookie: 'secret', 'x-user-session': 'forged' })
  )
  expect(result.get('authorization')).toBe('Bearer signed.token')
  expect(result.has('cookie')).toBe(false)
  expect(result.has('x-user-session')).toBe(false)
  await getMobileSession(result)
  expect(getSession).toHaveBeenCalledWith({ headers: result, query: { disableCookieCache: true } })
})
