// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ browser: vi.fn(), mobile: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.browser } } }))
vi.mock('@/lib/mobile/auth', () => ({ getMobileSession: mocks.mobile }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: () => true } }))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }))
import { proxy } from '@/proxy'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.browser.mockResolvedValue(null)
  mocks.mobile.mockResolvedValue(null)
})
it('exempts only POST session, not child paths or session deletion', async () => {
  expect(
    (await proxy(new NextRequest('https://gallery.test/api/mobile/v1/session', { method: 'POST' }))).headers.get(
      'x-middleware-next'
    )
  ).toBe('1')
  for (const [path, method] of [
    ['session/child', 'POST'],
    ['session', 'DELETE'],
    ['feed', 'GET']
  ]) {
    expect((await proxy(new NextRequest(`https://gallery.test/api/mobile/v1/${path}`, { method }))).status).toBe(401)
  }
})
it('does not accept the mobile token as browser authorization', async () => {
  mocks.mobile.mockResolvedValue({ user: { id: 'owner' } })
  expect(
    (
      await proxy(
        new NextRequest('https://gallery.test/api/trpc/artwork.delete', {
          headers: { authorization: 'Bearer signed.token' }
        })
      )
    ).status
  ).toBe(401)
  expect(mocks.mobile).not.toHaveBeenCalled()
})
it('strips forged context after mobile verification', async () => {
  mocks.mobile.mockResolvedValue({ user: { id: 'owner' } })
  const response = await proxy(
    new NextRequest('https://gallery.test/api/mobile/v1/feed', {
      headers: { 'x-user-session': 'forged', 'x-pathname': '/login' }
    })
  )
  expect(response.headers.get('x-middleware-next')).toBe('1')
  expect(response.headers.has('x-middleware-request-x-user-session')).toBe(false)
})
