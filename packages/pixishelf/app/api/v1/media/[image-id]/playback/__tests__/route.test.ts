// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ session: vi.fn(), open: vi.fn(), source: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@/services/video-playback-service', () => ({
  openVideoPlayback: mocks.open,
  getVideoPlaybackSource: mocks.source,
  videoPlaybackHeaders: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }
}))
import { GET as getPlayback } from '../route'
import { GET as source } from '../source/route'
import { VideoPlaybackUnavailable } from '@pixishelf/job-executors/media-content'
const context = { params: Promise.resolve({ 'image-id': '1' }) }
const url = 'http://localhost/api/v1/media/1/playback?generation=11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'account' } })
  mocks.open.mockResolvedValue(new Response('ok'))
})
describe('protected playback routes', () => {
  it('rejects unauthenticated stream and source requests before accessing media', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await getPlayback(new Request(url), context)).status).toBe(401)
    expect((await source(new Request(url), context)).status).toBe(401)
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.source).not.toHaveBeenCalled()
  })
  it('forwards only a validated fixed generation and Range', async () => {
    const request = new Request(url, { headers: { Range: 'bytes=4-9' } })
    await getPlayback(request, context)
    expect(mocks.open).toHaveBeenCalledWith(
      1,
      { generation: '11111111-1111-4111-8111-111111111111' },
      'bytes=4-9',
      request.signal
    )
  })
  it.each([
    '?generation=../../secret',
    '?original=abc',
    '?generation=11111111-1111-4111-8111-111111111111&path=/private'
  ])('rejects invalid paths/variants %s', async (query) => {
    expect((await getPlayback(new Request('http://localhost/api/v1/media/1/playback' + query), context)).status).toBe(
      400
    )
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('rejects a stale generation without redirecting or serving original bytes', async () => {
    mocks.open.mockRejectedValue(new VideoPlaybackUnavailable('CHANGED'))
    const response = await getPlayback(new Request(url), context)
    expect(response.status).toBe(409)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('does not expose filesystem failures', async () => {
    mocks.open.mockRejectedValue(new Error('/private/media/secret.mp4'))
    const response = await getPlayback(new Request(url), context)
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('secret')
  })
})
