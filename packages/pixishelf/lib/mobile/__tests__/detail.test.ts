// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ initial: vi.fn(), links: vi.fn(), url: vi.fn(), neighbors: vi.fn(), versions: vi.fn(), summaries: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { artwork: { findMany: mocks.versions } } }))
vi.mock('@/lib/mobile/auth', () => ({ getMobileSession: vi.fn() }))
vi.mock('@/services/artwork-service/reader', () => ({ getArtworkReaderInitial: mocks.initial }))
vi.mock('@/services/artwork/source-links', () => ({ getArtworkSourceLinks: mocks.links, getArtworkSourceUrl: mocks.url }))
vi.mock('@/services/artwork-service/related', () => ({ getNeighboringArtworks: mocks.neighbors }))
vi.mock('@/services/reading-service', () => ({ getReadingSummaries: mocks.summaries }))
import { mobileArtworkDetail, mobileArtworkNeighbors, mobileDescription } from '@/services/mobile-detail-service'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.initial.mockResolvedValue({ total: 35, artwork: {
    id: 4, title: 'A work', description: '<p>First &amp; second<br>Next</p><script>hidden()</script><img src="https://remote.test/track">',
    createdAt: '2026-10-28T00:00:00.000Z', sourceDate: null, totalMediaSize: 123,
    creators: [{ id: 9, name: 'Artist', kind: 'PERSON', pixivUserId: '123', avatar: '/private/avatar' }],
    tags: [{ id: 7, name: 'tag', name_zh: '标签' }],
    series: [{ id: 1, title: 'Series', order: 2, prev: { id: 3, title: 'Before' }, next: { id: 5, title: 'Unavailable' } }],
    pixivArtworkId: '456', images: [{ id: 8, path: '/private/media/file' }], storagePath: '/private/root',
    pixivSync: { onlineSnapshotPath: '/private/snapshot', lastError: 'sensitive-error' }
  } })
  mocks.links.mockResolvedValue([{ id: 'valid-source', label: 'E-Hentai #33', href: '/cookie-only-path' }, { id: 'gone', label: 'Gone' }])
  mocks.url.mockImplementation((_id, source) => source === 'valid-source' ? 'https://e-hentai.org/g/33/abc123/' : null)
  mocks.versions.mockResolvedValue([{ id: 3 }])
})
it('projects metadata from the bounded H5 detail without paths, scripts, private diagnostics or HTML', async () => {
  const result = await mobileArtworkDetail(4)
  expect(mocks.initial).toHaveBeenCalledWith(4)
  expect(result.description).toBe('First & second\nNext')
  expect(result.mediaCount).toBe(35)
  expect(result.creators).toEqual([{ id: 9, name: 'Artist', kind: 'PERSON', pixivUserId: '123' }])
  expect(result.tags).toEqual([{ id: 7, name: 'tag', nameZh: '标签' }])
  expect(result.series[0]).toMatchObject({ prev: { id: 3, title: 'Before' }, next: null })
  expect(result.sources).toEqual([{ id: 'valid-source', label: 'E-Hentai #33', url: 'https://e-hentai.org/g/33/abc123/' },
    { id: 'pixiv', label: 'Pixiv #456', url: 'https://www.pixiv.net/artworks/456' }])
  const json = JSON.stringify(result)
  for (const privateValue of ['/private/', 'cookie-only-path', 'hidden()', 'remote.test', 'sensitive-error']) expect(json).not.toContain(privateValue)
})
it('rejects an unavailable artwork before resolving sources', async () => {
  mocks.initial.mockResolvedValue(null)
  await expect(mobileArtworkDetail(4)).rejects.toMatchObject({ status: 404 })
  expect(mocks.links).not.toHaveBeenCalled()
})
it('preserves plain text and drops embedded style/object content and unsafe markup', () => {
  expect(mobileDescription('plain\ntext <3 & stuff')).toBe('plain\ntext <3 & stuff')
  expect(mobileDescription('<style>private</style><div onclick="bad()">safe &lt;script&gt;</div>')).toBe('safe <script>')
  expect(mobileDescription(null)).toBeNull()
})
it('adapts creator timeline ordering to protected covers under the current account', async () => {
  mocks.neighbors.mockResolvedValue([{ id: 4, title: 'A', creators: [{ name: 'Artist' }], mediaCount: 2, imageCount: 2,
    images: [{ path: '/private/media', mediaType: 'image' }] }, { id: 5, title: 'Removed' }])
  mocks.versions.mockResolvedValue([{ id: 4, mediaRevision: 3, images: [{ id: 8 }] }])
  mocks.summaries.mockResolvedValue({ summaries: [{ artworkId: 4, status: 'COMPLETED' }] })
  const result = await mobileArtworkNeighbors('owner', 4, { expectedUserId: 'owner', artistId: 9, limit: 6, direction: 'older', dateMode: 'created' })
  expect(mocks.neighbors).toHaveBeenCalledWith({ artworkId: 4, artistId: 9, limit: 6, direction: 'older', dateMode: 'created' })
  expect(result.items).toEqual([{ id: 4, title: 'A', author: 'Artist', imageCount: 2, mediaType: 'image', mediaRevision: 3,
    coverUrl: '/api/mobile/v1/media/8?expectedUserId=owner&variant=thumbnail', readingStatus: 'COMPLETED' }])
  expect(mocks.summaries).toHaveBeenCalledWith('owner', [4, 5])
})
