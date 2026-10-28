// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ cards: vi.fn(), versions: vi.fn(), summaries: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { artwork: { findMany: mocks.versions } } }))
vi.mock('@/services/artwork-service', () => ({ getArtworkCardsPage: mocks.cards }))
vi.mock('@/services/reading-service', () => ({ getReaderInitialization: vi.fn(), getReadingSummaries: mocks.summaries }))
vi.mock('@/services/artwork-service/reader', () => ({ getReaderMediaPage: vi.fn() }))
vi.mock('@/services/artwork-rating-service', () => ({ getArtworkRating: vi.fn() }))
vi.mock('@/lib/mobile/auth', () => ({ getMobileSession: vi.fn() }))
import { mobileFeed } from '@/services/mobile-reader-service'
import { MobileFeedQuery } from '@/schemas/mobile.dto'
const input = (values = {}) => MobileFeedQuery.parse({ expectedUserId: 'owner', ...values })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.cards.mockResolvedValue({ items: [{ id: 4, title: 'Title', imageCount: 40, artist: { name: 'Artist' }, images: [{ path: 'private/file.png', mediaType: 'image' }] }], hasNextPage: true, nextRandomCursor: 'random-next' })
  mocks.versions.mockResolvedValue([{ id: 4, mediaRevision: 3, images: [{ id: 8 }] }])
  mocks.summaries.mockResolvedValue({ summaries: [{ artworkId: 4, status: 'IN_PROGRESS' }] })
})
it('reuses H5 filters under the session owner and returns only protected cover IDs', async () => {
  const result = await mobileFeed('owner', input({ sortBy: 'random', mediaType: 'animation', likedOnly: 'true', readingStatus: 'UNREAD', cursor: 'random-before', search: 'summer' }))
  expect(mocks.cards).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'random', mediaType: 'animation', likedOnly: true, readingStatus: 'UNREAD', randomCursor: 'random-before', expectedUserId: 'owner', search: 'summer' }), 'owner')
  expect(mocks.summaries).toHaveBeenCalledWith('owner', [4])
  expect(result.items[0]).toEqual({ id: 4, title: 'Title', author: 'Artist', imageCount: 40, mediaType: 'image', mediaRevision: 3, coverUrl: '/api/mobile/v1/media/8?expectedUserId=owner&variant=thumbnail', readingStatus: 'IN_PROGRESS' })
  expect(JSON.stringify(result)).not.toContain('private/file.png')
  expect(result.nextCursor).toBe('random-next')
})
it('uses the reading keyset cursor for ordered reading and like filters', async () => {
  mocks.cards.mockResolvedValue({ items: [], hasNextPage: true, nextReadingCursor: 'reading-next' })
  const result = await mobileFeed('owner', input({ sortBy: 'created_at_desc', likedOnly: 'true', page: 2, cursor: 'reading-before' }))
  expect(mocks.cards).toHaveBeenCalledWith(expect.objectContaining({ readingCursor: 'reading-before', randomCursor: undefined, cursor: 2 }), 'owner')
  expect(result).toEqual({ items: [], nextPage: 3, nextCursor: 'reading-next' })
  expect(mocks.versions).not.toHaveBeenCalled()
  expect(mocks.summaries).not.toHaveBeenCalled()
})
it('preserves old mode requests and parses false without enabling likes', async () => {
  await mobileFeed('owner', input({ mode: 'latest', likedOnly: 'false' }))
  expect(mocks.cards).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'created_at_desc', likedOnly: false }), 'owner')
  expect(MobileFeedQuery.safeParse({ expectedUserId: 'owner', sortBy: 'unsafe' }).success).toBe(false)
  expect(MobileFeedQuery.safeParse({ expectedUserId: 'owner', mediaType: 'unknown' }).success).toBe(false)
  expect(MobileFeedQuery.safeParse({ expectedUserId: 'owner', likedOnly: 'anything' }).success).toBe(false)
})
it('rejects a cursor for an incompatible query before querying data', async () => {
  await expect(mobileFeed('owner', input({ sortBy: 'title_asc', cursor: 'unrelated' }))).rejects.toMatchObject({ status: 400 })
  expect(mocks.cards).not.toHaveBeenCalled()
})
it('omits concurrently unavailable artworks and handles missing covers', async () => {
  mocks.versions.mockResolvedValue([])
  expect((await mobileFeed('owner', input())).items).toEqual([])
  mocks.versions.mockResolvedValue([{ id: 4, mediaRevision: 4, images: [] }])
  expect((await mobileFeed('owner', input())).items).toEqual([expect.objectContaining({ coverUrl: null })])
})
