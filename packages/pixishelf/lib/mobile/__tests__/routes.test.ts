// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  allow: vi.fn(),
  report: vi.fn(),
  rating: vi.fn(),
  feed: vi.fn(),
  media: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  settings: vi.fn()
}))
vi.mock('@/lib/mobile/auth', () => ({
  getMobileSession: mocks.session,
  mobileAuthHeaders: (h: Headers) => h,
  mobileAuth: { api: { signInEmail: mocks.signIn, signOut: mocks.signOut } }
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: mocks.allow } }))
vi.mock('@/services/reading-service', () => ({ reportReading: mocks.report }))
vi.mock('@/services/artwork-rating-service', () => ({ setArtworkRating: mocks.rating }))
vi.mock('@/services/mobile-reader-service', () => ({ mobileFeed: mocks.feed }))
vi.mock('@/services/mobile-media-service', () => ({ openMobileMedia: mocks.media }))
vi.mock('@/services/user-setting-service', () => ({ getUserSettings: mocks.settings }))
import { POST as report } from '@/app/api/mobile/v1/reading/route'
import { PUT as rating } from '@/app/api/mobile/v1/rating/route'
import { GET as feed } from '@/app/api/mobile/v1/feed/route'
import { GET as media } from '@/app/api/mobile/v1/media/[id]/route'
import { POST as login, DELETE as logout, GET as session } from '@/app/api/mobile/v1/session/route'
import { mobileBody, mobileError } from '../http'
import { isMobileApiPath, isMobileLoginRequest } from '../path'
const request = (path: string, method = 'GET', body?: unknown) =>
  new Request(`https://gallery.test/api/mobile/v1/${path}`, {
    method,
    headers: {
      Authorization: 'Bearer signed.token',
      'Content-Type': 'application/json',
      'x-user-session': '{"userId":"forged"}'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
const reading = {
  artworkId: 4,
  expectedUserId: 'owner',
  mediaRevision: 1,
  events: [{ type: 'VIEW', mediaId: 8, observedAt: new Date().toISOString() }]
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner' }, session: { expiresAt: new Date() } })
  mocks.allow.mockReturnValue(true)
  mocks.report.mockResolvedValue({ seenMediaIds: [8] })
  mocks.rating.mockResolvedValue({ level: 2 })
  mocks.feed.mockResolvedValue({ items: [] })
  mocks.settings.mockResolvedValue({})
})
describe('mobile transport', () => {
  it('matches only the mobile path segment and exact login method/path', () => {
    expect(isMobileApiPath('/api/mobile/v10/feed')).toBe(false)
    expect(isMobileApiPath('/api/mobile/v1/feed')).toBe(true)
    expect(isMobileLoginRequest('/api/mobile/v1/session', 'POST')).toBe(true)
    expect(isMobileLoginRequest('/api/mobile/v1/session/child', 'POST')).toBe(false)
    expect(isMobileLoginRequest('/api/mobile/v1/session', 'DELETE')).toBe(false)
  })
  it('fails closed without a session, even with forged identity headers', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await report(request('reading', 'POST', reading))).status).toBe(401)
    expect(mocks.report).not.toHaveBeenCalled()
  })
  it('rejects another expected account before any write', async () => {
    expect((await report(request('reading', 'POST', { ...reading, expectedUserId: 'other' }))).status).toBe(403)
    expect((await rating(request('rating', 'PUT', { artworkId: 4, expectedUserId: 'other', level: 2 }))).status).toBe(
      403
    )
    expect(mocks.report).not.toHaveBeenCalled()
    expect(mocks.rating).not.toHaveBeenCalled()
  })
  it('calls existing reading rules with authenticated identity and version', async () => {
    const response = await report(request('reading', 'POST', reading))
    expect(response.status).toBe(200)
    expect(mocks.report).toHaveBeenCalledWith('owner', reading)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Authorization')
  })
  it('rejects invalid ratings and malformed reading without writes', async () => {
    expect((await rating(request('rating', 'PUT', { artworkId: 4, expectedUserId: 'owner', level: 99 }))).status).toBe(
      400
    )
    expect((await report(request('reading', 'POST', { ...reading, events: [] }))).status).toBe(400)
    expect(mocks.rating).not.toHaveBeenCalled()
    expect(mocks.report).not.toHaveBeenCalled()
  })
  it('sanitizes unexpected service errors', async () => {
    mocks.report.mockRejectedValue(new Error('postgres://password@host/private/path'))
    const response = await report(request('reading', 'POST', reading))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('password')
  })
  it('rejects invalid seed and mismatched media owner before reading files', async () => {
    expect((await feed(request('feed?expectedUserId=owner&seed=-1'))).status).toBe(400)
    expect(
      (await media(request('media/8?expectedUserId=other&revision=1'), { params: Promise.resolve({ id: '8' }) })).status
    ).toBe(403)
    expect(mocks.media).not.toHaveBeenCalled()
  })
  it('rate limits mutations before calling services', async () => {
    mocks.allow.mockReturnValue(false)
    expect((await report(request('reading', 'POST', reading))).status).toBe(429)
    expect(mocks.report).not.toHaveBeenCalled()
  })
  it('bounds a chunked body without trusting Content-Length', async () => {
    const req = new Request('https://gallery.test', { method: 'POST', body: 'x'.repeat(65537) })
    await expect(mobileBody(req)).rejects.toMatchObject({ status: 413 })
  })
  it('rejects login library errors without exposing secrets', async () => {
    mocks.signIn.mockRejectedValue(new Error('token-secret'))
    const response = await login(request('session', 'POST', { username: 'owner', password: 'password123' }))
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain('token-secret')
  })
  it('returns only the signed token, never forwards cookies', async () => {
    mocks.signIn.mockResolvedValue(
      new Response('{}', { headers: { 'set-auth-token': 'signed.token', 'set-cookie': 'browser-secret' } })
    )
    const response = await login(request('session', 'POST', { username: 'owner', password: 'password123' }))
    expect(response.status).toBe(200)
    expect((await response.json()).token).toBe('signed.token')
    expect(response.headers.has('set-cookie')).toBe(false)
  })
  it('revokes the current mobile session on logout', async () => {
    expect((await logout(request('session', 'DELETE'))).status).toBe(200)
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })
  it('returns only gallery appearance for the authenticated account, with H5 defaults', async () => {
    let response = await session(request('session?expectedUserId=other'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ apiVersion: 1, user: { id: 'owner' }, mediaPageSize: 24,
      galleryPreferences: { displayMode: 'card', showReadingStatus: true } })
    expect(mocks.settings).toHaveBeenCalledWith('owner')
    mocks.settings.mockResolvedValue({ artwork_display_mode: 'minimal', preferred_tags: ['private-preference'] })
    response = await session(request('session'))
    const body = await response.json()
    expect(body.galleryPreferences).toEqual({ displayMode: 'minimal', showReadingStatus: true })
    expect(JSON.stringify(body)).not.toContain('private-preference')
  })
  it('never reads account preferences without mobile authentication', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await session(request('session'))).status).toBe(401)
    expect(mocks.settings).not.toHaveBeenCalled()
  })
  it('uses safe error envelopes', async () => {
    expect(await mobileError(new Error('secret')).json()).toEqual({ error: { code: 'INTERNAL_ERROR' } })
  })
})

it('rejects unauthenticated and cross-account gallery/thumbnail requests before service access', async () => {
  mocks.session.mockResolvedValue(null)
  expect((await feed(request('feed?expectedUserId=owner'))).status).toBe(401)
  expect((await media(request('media/8?expectedUserId=owner&revision=1&variant=thumbnail'), { params: Promise.resolve({ id: '8' }) })).status).toBe(401)
  mocks.session.mockResolvedValue({ user: { id: 'owner' } })
  expect((await feed(request('feed?expectedUserId=other&likedOnly=true'))).status).toBe(403)
  expect(mocks.feed).not.toHaveBeenCalled()
  expect(mocks.media).not.toHaveBeenCalled()
})
it('validates gallery filters and accepts the protected thumbnail variant', async () => {
  expect((await feed(request('feed?expectedUserId=owner&mediaType=invalid'))).status).toBe(400)
  expect(mocks.feed).not.toHaveBeenCalled()
  mocks.media.mockResolvedValue(new Response('thumbnail'))
  expect((await media(request('media/8?expectedUserId=owner&revision=1&variant=thumbnail'), { params: Promise.resolve({ id: '8' }) })).status).toBe(200)
  expect(mocks.media).toHaveBeenCalledWith(8, 1, 'thumbnail', null)
})
