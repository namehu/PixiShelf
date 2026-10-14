// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks')
  vi.stubGlobal('AsyncLocalStorage', AsyncLocalStorage)
  return {
    artwork: { count: vi.fn() },
    artist: { count: vi.fn(), findMany: vi.fn() },
    image: { count: vi.fn() },
    tag: { count: vi.fn(), findMany: vi.fn() },
    artworkArtist: { groupBy: vi.fn() },
    $queryRaw: vi.fn(),
    info: vi.fn()
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: mocks }))
vi.mock('@/lib/logger', () => ({ default: { info: mocks.info } }))
import { loadStatisticsSections } from '../statistics-service'
import { toStatisticsCount } from '../statistics-queries'
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external'

type CacheValue = { kind: string; data: { body: string }; revalidate: number }
let now = 0
const cache = new Map<string, { value: CacheValue; at: number }>()
// Exercise Next's actual unstable_cache implementation with an in-memory storage adapter.
const incrementalCache = {
  generateCacheKey: async (key: string) => key,
  get: async (key: string) => {
    const entry = cache.get(key)
    return entry ? { value: entry.value, isStale: now - entry.at >= entry.value.revalidate * 1000 } : null
  },
  set: async (key: string, value: CacheValue) => {
    cache.set(key, { value, at: now })
  }
}
const settle = (sections: ReturnType<typeof loadStatisticsSections>) => Promise.all(Object.values(sections))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('__incrementalCache', incrementalCache)
  vi.stubEnv('STATISTICS_IMAGE_COUNT_MODE', '')
  cache.clear()
  now = 0
  mocks.artwork.count.mockResolvedValue(20)
  mocks.artist.count.mockResolvedValue(4)
  mocks.tag.count.mockResolvedValue(7)
  mocks.image.count.mockResolvedValue(100)
  mocks.artworkArtist.groupBy.mockResolvedValue([{ artistId: 2, _count: { artistId: 8 } }])
  mocks.artist.findMany.mockResolvedValue([{ id: 2, name: 'Artist' }])
  mocks.tag.findMany.mockResolvedValue([{ id: 3, name: 'Tag', artworkCount: 9 }])
  mocks.$queryRaw.mockResolvedValue([{ count: 101n }])
})
afterEach(() => vi.unstubAllEnvs())

describe('statistics independent reads and real Next cache', () => {
  it('resolves other sections while the image count is pending', async () => {
    let resolveImages!: (count: number) => void
    mocks.image.count.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        resolveImages = resolve
      })
    )
    const sections = loadStatisticsSections()
    expect(await sections.basic).toEqual({ ok: true, value: { artworks: 20, artists: 4, tags: 7 } })
    expect(await sections.tags).toEqual({ ok: true, value: [{ id: 3, name: 'Tag', count: 9 }] })
    expect(await sections.artists).toEqual({ ok: true, value: [{ id: 2, name: 'Artist', count: 8 }] })
    expect(mocks.info.mock.calls.some(([event]) => event === 'statistics.page')).toBe(false)
    resolveImages(100)
    expect(await sections.images).toEqual({ ok: true, value: 100 })
    expect(mocks.info).toHaveBeenCalledWith('statistics.page', expect.objectContaining({ failed: 0 }))
  })

  it('does not cache a failed read, exposes no error contents, and retries successfully', async () => {
    mocks.image.count.mockRejectedValueOnce(new Error('private database credentials'))
    const first = loadStatisticsSections()
    await settle(first)
    expect(await first.images).toEqual({ ok: false })
    const second = loadStatisticsSections()
    await settle(second)
    expect(await second.images).toEqual({ ok: true, value: 100 })
    expect(mocks.image.count).toHaveBeenCalledTimes(2)
    expect(mocks.artwork.count).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain('private database credentials')
  })

  it('reuses successful entries for 60 seconds and isolates exact/counter cache keys', async () => {
    await settle(loadStatisticsSections())
    now = 59_000
    await settle(loadStatisticsSections())
    expect(mocks.image.count).toHaveBeenCalledTimes(1)
    vi.stubEnv('STATISTICS_IMAGE_COUNT_MODE', 'counter')
    const counter = loadStatisticsSections()
    await settle(counter)
    expect(await counter.images).toEqual({ ok: true, value: 101 })
    expect(mocks.$queryRaw).toHaveBeenCalledTimes(1)
    vi.stubEnv('STATISTICS_IMAGE_COUNT_MODE', 'exact')
    await settle(loadStatisticsSections())
    expect(mocks.image.count).toHaveBeenCalledTimes(1)
    now = 61_000
    await settle(loadStatisticsSections())
    expect(mocks.image.count).toHaveBeenCalledTimes(2)
  })

  it('preserves a stale successful entry when App Router background revalidation fails', async () => {
    await settle(loadStatisticsSections())
    now = 61_000
    mocks.image.count.mockRejectedValueOnce(new Error('temporary failure'))
    const store = { route: '/admin/statistics', isStaticGeneration: false, pendingRevalidates: {} } as Parameters<
      typeof workAsyncStorage.run
    >[0]
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await workAsyncStorage.run(store, async () => {
        const sections = loadStatisticsSections()
        await settle(sections)
        expect(await sections.images).toEqual({ ok: true, value: 100 })
        await Promise.all(Object.values(store.pendingRevalidates ?? {}))
      })
      expect([...cache.values()].some((entry) => entry.value.data.body === '100')).toBe(true)
      const retry = loadStatisticsSections()
      await settle(retry)
      expect(await retry.images).toEqual({ ok: true, value: 100 })
      expect(mocks.image.count).toHaveBeenCalledTimes(3)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('keeps active creator membership and visibility filters and avoids name queries for an empty ranking', async () => {
    await settle(loadStatisticsSections())
    expect(mocks.artworkArtist.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          artist: { mergedIntoId: null },
          evidence: { some: { present: true, excludedAt: null } },
          artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
        },
        take: 20
      })
    )
    cache.clear()
    mocks.artworkArtist.groupBy.mockResolvedValueOnce([])
    mocks.artist.findMany.mockClear()
    await settle(loadStatisticsSections())
    expect(mocks.artist.findMany).not.toHaveBeenCalled()
  })

  it('rejects invalid counter values instead of caching a misleading number', async () => {
    expect(toStatisticsCount(0n)).toBe(0)
    expect(() => toStatisticsCount(-1n)).toThrow()
    expect(() => toStatisticsCount(9007199254740992n)).toThrow()
    vi.stubEnv('STATISTICS_IMAGE_COUNT_MODE', 'counter')
    mocks.$queryRaw.mockResolvedValueOnce([{ count: -1n }])
    const sections = loadStatisticsSections()
    await settle(sections)
    expect(await sections.images).toEqual({ ok: false })
  })
})
