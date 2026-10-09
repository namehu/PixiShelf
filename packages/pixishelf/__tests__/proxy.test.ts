import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), headers: vi.fn(), allow: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: mocks.allow } }))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }))

import { proxy } from '../proxy'

const forgedHeaders = { 'x-user-session': '{"userId":"forged-admin"}', 'x-pathname': '/login' }
function request(path: string) {
  return new NextRequest(`http://localhost${path}`, { headers: forgedHeaders })
}

describe('proxy authorization boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getSession.mockResolvedValue(null)
    mocks.headers.mockResolvedValue(new Headers(forgedHeaders))
    mocks.allow.mockReturnValue(true)
  })

  it.each(['/', '/login', '/login/help', '/api/webhooks/scan', '/api/webhooks/scan/child', '/api/internal/scheduler/tick', '/api/internal/scheduler/tick/child'])(
    'allows public path %s with the existing slash-delimited child rule', async (path) => {
      const response = await proxy(request(path))
      expect(response.headers.get('x-middleware-next')).toBe('1')
    }
  )

  it.each(['/api/webhooks/scanner', '/api/internal/scheduler/ticking', '/api/artwork/upload-chunk', '/api/trpc/artwork.delete'])(
    'rejects unauthenticated API %s despite forged context headers', async (path) => {
      const response = await proxy(request(path))
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ code: 401, message: 'Unauthorized' })
      expect(response.headers.has('x-middleware-next')).toBe(false)
    }
  )

  it.each(['/login-extra', '/dashboard', '/artworks/42', '/artworks/42?entry=direct&page=2'])(
    'redirects unauthenticated page %s to login', async (path) => {
      const response = await proxy(request(path))
      expect(response.status).toBe(307)
      const location = new URL(response.headers.get('location')!)
      expect(location.pathname).toBe('/login')
      expect(location.searchParams.get('redirect')).toBe(path)
    }
  )

  it.each(['/api/scan/rescan', '/admin/tasks'])('fails closed on session lookup failure for %s', async (path) => {
    mocks.getSession.mockRejectedValue(new Error('postgres://secret-password@private-host'))
    const response = await proxy(request(path))
    expect(response.status).toBe(path.startsWith('/api/') ? 401 : 307)
    expect(await response.text()).not.toContain('secret-password')
    expect(response.headers.has('x-middleware-next')).toBe(false)
  })

  it('keeps login accessible during session lookup failure', async () => {
    mocks.getSession.mockRejectedValue(new Error('auth unavailable'))
    expect((await proxy(request('/login'))).headers.get('x-middleware-next')).toBe('1')
  })

  it('replaces client context headers with the authenticated identity and actual path', async () => {
    const user = { id: 'real-admin', name: 'Owner', email: 'owner@example.test', image: null }
    mocks.getSession.mockResolvedValue({ user })
    const response = await proxy(request('/admin/tasks'))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-middleware-request-x-pathname')).toBe('/admin/tasks')
    expect(JSON.parse(response.headers.get('x-middleware-request-x-user-session')!)).toEqual({
      userId: user.id, username: user.name, name: user.name, email: user.email, image: null
    })
  })

  it('redirects an authenticated login visit to the dashboard', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    const response = await proxy(request('/login'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/dashboard')
  })

  it('preserves an explicit entry mode through an authenticated login redirect', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    const response = await proxy(request('/login?entry=privacy'))
    expect(response.headers.get('location')).toBe('http://localhost/dashboard?entry=privacy')
  })

  it('does not use entry parameters to bypass API authentication', async () => {
    expect((await proxy(request('/api/artworks?entry=direct'))).status).toBe(401)
  })

  it.each(['/login', '/api/scan/rescan'])('rate limits %s before authentication or forwarding', async (path) => {
    mocks.allow.mockReturnValue(false)
    const response = await proxy(request(path))
    expect(response.status).toBe(429)
    expect(response.headers.has('x-middleware-next')).toBe(false)
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
})
