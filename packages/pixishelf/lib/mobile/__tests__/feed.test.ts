// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ cards: vi.fn(), versions: vi.fn(), summaries: vi.fn(), reader: vi.fn(), artwork: vi.fn(), rating: vi.fn(), settings: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { artwork: { findMany: mocks.versions, findUnique: mocks.artwork } } }))
vi.mock('@/services/artwork-service', () => ({ getArtworkCardsPage: mocks.cards }))
vi.mock('@/services/reading-service', () => ({ getReaderInitialization: mocks.reader, getReadingSummaries: mocks.summaries }))
vi.mock('@/services/artwork-service/reader', () => ({ getReaderMediaPage: vi.fn() }))
vi.mock('@/services/artwork-rating-service', () => ({ getArtworkRating: mocks.rating }))
vi.mock('@/services/user-setting-service', () => ({ getUserSettings: mocks.settings }))
vi.mock('@/lib/mobile/auth', () => ({ getMobileSession: vi.fn() }))
import { mobileFeed, mobileReader } from '@/services/mobile-reader-service'
import { MobileFeedQuery } from '@/schemas/mobile.dto'
const input = (values = {}) => MobileFeedQuery.parse({ expectedUserId: 'owner', ...values })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.cards.mockResolvedValue({ items: [{ id: 4, title: 'Title', imageCount: 40, artist: { name: 'Artist' }, images: [{ path: 'private/file.png', mediaType: 'image' }] }], hasNextPage: true, nextRandomCursor: 'random-next' })
  mocks.versions.mockResolvedValue([{ id: 4, mediaRevision: 3, images: [{ id: 8 }] }])
  mocks.summaries.mockResolvedValue({ summaries: [{ artworkId: 4, status: 'IN_PROGRESS' }] })
  mocks.settings.mockResolvedValue({})
})
it('reuses H5 filters under the session owner and returns only protected cover IDs', async () => {
  const result = await mobileFeed('owner', input({ sortBy: 'random', mediaType: 'animation', likedOnly: 'true', readingStatus: 'UNREAD', cursor: 'random-before', search: 'summer' }))
  expect(mocks.cards).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'random', mediaKinds: ['animation'], likedOnly: true, readingStatuses: ['UNREAD'], randomCursor: 'random-before', expectedUserId: 'owner', search: 'summer' }), 'owner')
  expect(mocks.summaries).toHaveBeenCalledWith('owner', [4])
  expect(result.items[0]).toEqual({ id: 4, title: 'Title', author: 'Artist', imageCount: 40, mediaType: 'image', totalMediaSize: 0, preferredTag: null, mediaRevision: 3, coverUrl: '/api/mobile/v1/media/8?expectedUserId=owner&variant=thumbnail', readingStatus: 'IN_PROGRESS' })
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
it('keeps creator and tag navigation within the shared H5 query rules', async () => {
  await mobileFeed('owner', input({ artistId: '9', tagIds: '7,8,7' }))
  expect(mocks.cards).toHaveBeenCalledWith(expect.objectContaining({ artistId: 9, tagIds: [7, 8] }), 'owner')
  for (const values of [{ artistId: -1 }, { tagIds: '7,evil' }, { tagIds: '0' }]) {
    expect(MobileFeedQuery.safeParse({ expectedUserId: 'owner', ...values }).success).toBe(false)
  }
})
it('derives stack groups from the same complete reader index, preserving non-static boundaries and version evidence', async () => {
  const index = { fingerprint: 'a'.repeat(64), mediaRevision: 3, items: [8, 9, 10, 11].map((mediaId, i) => ({
    mediaId, memberMediaIds: [mediaId], index: i, width: 600, height: 800,
    mediaType: mediaId === 10 ? 'video' : 'image', isAnimated: false, reliableDimensions: true
  })) }
  mocks.reader.mockResolvedValue({ title: 'Title', index, reading: { seenMediaIds: [8] } })
  mocks.artwork.mockResolvedValue({ artist: { name: 'Artist' } })
  mocks.rating.mockResolvedValue({ level: 3 })
  const result = await mobileReader('owner', 4)
  expect(result.stack).toEqual({ ruleVersion: 1, fingerprint: index.fingerprint, groups: [
    { id: 'stack-v1-8-9', mediaIds: [8, 9], representativeMediaId: 8, startIndex: 0, endIndex: 1 },
    { id: 'stack-v1-10-10', mediaIds: [10], representativeMediaId: 10, startIndex: 2, endIndex: 2 },
    { id: 'stack-v1-11-11', mediaIds: [11], representativeMediaId: 11, startIndex: 3, endIndex: 3 }
  ] })
  expect(result.index).toBe(index)
})
it('uses the current account preferred-tag order and the same safe size as the H5 card', async () => {
  mocks.settings.mockResolvedValue({ preferred_tags: ['priority', 'secondary', 'not-matched'] })
  mocks.cards.mockResolvedValue({ items: [{ id: 4, title: 'Video', imageCount: 0, totalMediaSize: 123456789,
    tags: [{ name: 'secondary' }, { name: 'priority' }], images: [{ mediaType: 'video' }] }], hasNextPage: false })
  const result = await mobileFeed('owner', input())
  expect(mocks.settings).toHaveBeenCalledWith('owner')
  expect(result.items[0]).toMatchObject({ totalMediaSize: 123456789, preferredTag: 'priority' })
  expect(result.items[0]).not.toHaveProperty('tags')
  expect(result.items[0]).not.toHaveProperty('preferred_tags')
  mocks.settings.mockResolvedValue({ preferred_tags: ['Priority'] })
  expect((await mobileFeed('owner', input())).items[0]?.preferredTag).toBeNull()
})
it('rejects an unsafe size instead of silently losing integer precision', async () => {
  mocks.cards.mockResolvedValue({ items: [{ id: 4, title: 'Video', imageCount: 0, totalMediaSize: Number.MAX_SAFE_INTEGER + 1,
    images: [{ mediaType: 'video' }] }], hasNextPage: false })
  await expect(mobileFeed('owner', input())).rejects.toThrow('Invalid image size')
})
