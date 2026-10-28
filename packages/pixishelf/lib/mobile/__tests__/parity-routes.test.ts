// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TRPCError } from '@trpc/server'

const mocks = vi.hoisted(() => ({ session: vi.fn(), allow: vi.fn(), detail: vi.fn(), neighbors: vi.fn(),
  marks: vi.fn(), setMark: vi.fn(), markRead: vi.fn(), navigation: vi.fn() }))
vi.mock('@/lib/mobile/auth', () => ({ getMobileSession: mocks.session }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: mocks.allow } }))
vi.mock('@/services/mobile-detail-service', () => ({ mobileArtworkDetail: mocks.detail, mobileArtworkNeighbors: mocks.neighbors }))
vi.mock('@/services/media-mark-service', () => ({ getMediaMarks: mocks.marks, setMediaMark: mocks.setMark }))
vi.mock('@/services/reading-service', () => ({ markReadingRead: mocks.markRead }))
vi.mock('@/services/mobile-video-navigation-service', () => ({ mobileVideoNavigation: mocks.navigation }))
import { GET as detail } from '@/app/api/mobile/v1/artworks/[id]/detail/route'
import { GET as neighbors } from '@/app/api/mobile/v1/artworks/[id]/neighbors/route'
import { GET as marks, PUT as setMark } from '@/app/api/mobile/v1/media-marks/route'
import { PUT as markRead } from '@/app/api/mobile/v1/reading/mark-read/route'
import { GET as navigation } from '@/app/api/mobile/v1/media/[id]/navigation/route'

const context = { params: Promise.resolve({ id: '4' }) }
const req = (path: string, body?: unknown) => new Request(`https://gallery.test/api/mobile/v1/${path}`, {
  method: body === undefined ? 'GET' : 'PUT',
  headers: { Authorization: 'Bearer signed.token', 'Content-Type': 'application/json', 'x-user-session': '{"userId":"forged"}' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
})
const mark = { artworkId: 4, mediaId: 8, expectedUserId: 'owner', kind: 'bookmark', value: true }
const read = { artworkId: 4, expectedUserId: 'owner', mediaRevision: 3, target: { kind: 'ALL' } }
const calls = (account: string) => [
  () => detail(req(`artworks/4/detail?expectedUserId=${account}`), context),
  () => neighbors(req(`artworks/4/neighbors?expectedUserId=${account}&artistId=9`), context),
  () => marks(req(`media-marks?expectedUserId=${account}&artworkId=4&mediaIds=8,9`)),
  () => navigation(req(`media/4/navigation?expectedUserId=${account}&revision=3`), context),
  () => setMark(req('media-marks', { ...mark, expectedUserId: account })),
  () => markRead(req('reading/mark-read', { ...read, expectedUserId: account }))
]
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner' } })
  mocks.allow.mockReturnValue(true)
  mocks.detail.mockResolvedValue({ id: 4 })
  mocks.neighbors.mockResolvedValue({ items: [] })
  mocks.marks.mockResolvedValue({ items: [] })
  mocks.setMark.mockResolvedValue({ mediaId: 8, bookmarkedAt: '2026-10-28T00:00:00.000Z' })
  mocks.markRead.mockResolvedValue({ mediaRevision: 3, seenMediaIds: [8], summary: { viewCount: 0 } })
  mocks.navigation.mockResolvedValue({ chapters: [], frames: [] })
})

describe('mobile detail and light organization boundaries', () => {
  it.each([['unauthenticated', 401], ['different account', 403]] as const)('rejects %s before any domain access', async (mode, status) => {
    if (status === 401) mocks.session.mockResolvedValue(null)
    for (const run of calls(mode === 'different account' ? 'other' : 'owner')) expect((await run()).status).toBe(status)
    for (const service of [mocks.detail, mocks.neighbors, mocks.marks, mocks.setMark, mocks.markRead, mocks.navigation]) expect(service).not.toHaveBeenCalled()
  })
  it('rate limits all endpoints before domain access', async () => {
    mocks.allow.mockReturnValue(false)
    for (const run of calls('owner')) expect((await run()).status).toBe(429)
    expect(mocks.markRead).not.toHaveBeenCalled()
    expect(mocks.setMark).not.toHaveBeenCalled()
  })
  it('passes only authenticated identity and validated resource selection', async () => {
    for (const run of calls('owner')) {
      const response = await run()
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('vary')).toBe('Authorization')
    }
    expect(mocks.detail).toHaveBeenCalledWith(4)
    expect(mocks.neighbors).toHaveBeenCalledWith('owner', 4, { expectedUserId: 'owner', artistId: 9, limit: 6, direction: 'both', dateMode: 'source' })
    expect(mocks.marks).toHaveBeenCalledWith('owner', 4, [8, 9])
    expect(mocks.navigation).toHaveBeenCalledWith(4, 3)
    expect(mocks.setMark).toHaveBeenCalledWith('owner', 4, 8, 'bookmark', true)
    expect(mocks.markRead).toHaveBeenCalledWith('owner', read)
  })
  it('rejects invalid, unbounded and missing-account inputs before writes', async () => {
    expect((await detail(req('artworks/4/detail?expectedUserId=owner'), { params: Promise.resolve({ id: '-1' }) })).status).toBe(400)
    expect((await neighbors(req('artworks/4/neighbors?expectedUserId=owner&artistId=9&limit=100'), context)).status).toBe(400)
    expect((await marks(req(`media-marks?expectedUserId=owner&artworkId=4&mediaIds=${Array.from({ length: 201 }, (_, i) => i + 1).join(',')}`))).status).toBe(400)
    expect((await marks(req('media-marks?expectedUserId=owner&artworkId=4&mediaIds=1,invalid'))).status).toBe(400)
    expect((await setMark(req('media-marks', { ...mark, value: 'true' }))).status).toBe(400)
    expect((await setMark(req('media-marks', { ...mark, expectedUserId: undefined }))).status).toBe(400)
    expect((await navigation(req('media/4/navigation?expectedUserId=owner&revision=0'), context)).status).toBe(400)
    expect((await markRead(req('reading/mark-read', { ...read, mediaRevision: undefined }))).status).toBe(400)
    expect((await markRead(req('reading/mark-read', { ...read, target: { kind: 'RESET' } }))).status).toBe(400)
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(mocks.setMark).not.toHaveBeenCalled()
    expect(mocks.markRead).not.toHaveBeenCalled()
  })
  it('uses the same positive-only MEDIA mark and strips client-supplied visit statistics', async () => {
    const response = await markRead(req('reading/mark-read', { ...read, viewCount: 100, target: { kind: 'MEDIA', mediaId: 8 } }))
    expect(response.status).toBe(200)
    expect(mocks.markRead).toHaveBeenCalledWith('owner', { ...read, target: { kind: 'MEDIA', mediaId: 8 } })
    expect((await response.json()).summary.viewCount).toBe(0)
  })
  it('preserves domain resource/version failures and sanitizes unexpected errors', async () => {
    mocks.markRead.mockRejectedValue(new TRPCError({ code: 'CONFLICT', message: 'READING_MEDIA_REVISION_CONFLICT' }))
    expect((await markRead(req('reading/mark-read', read))).status).toBe(409)
    mocks.setMark.mockRejectedValue(new TRPCError({ code: 'NOT_FOUND', message: 'cross-artwork-media' }))
    expect((await setMark(req('media-marks', mark))).status).toBe(404)
    mocks.detail.mockRejectedValue(new Error('postgres://secret@private/path'))
    const response = await detail(req('artworks/4/detail?expectedUserId=owner'), context)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } })
  })
})
