import { beforeEach, describe, expect, it, vi } from 'vitest'
const { findMany, cards } = vi.hoisted(() => ({ findMany: vi.fn(), cards: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { artworkReadingProgress: { findMany } } }))
vi.mock('@/services/artwork-service', () => ({ getArtworkCardsByIds: cards }))
import { getContinueReading } from '../reading-service'
const at = new Date('2026-11-04T10:00:00Z')
const row = (artworkId: number) => ({
  userId: 'u',
  artworkId,
  viewCount: 1,
  completed: false,
  furthestMediaId: null,
  furthestMediaIndex: null,
  lastViewedAt: at,
  lastActiveAt: at,
  lastMediaId: artworkId * 10,
  lastMediaIndex: 0,
  stateVersion: 3,
  artwork: { id: artworkId, logicalMediaCount: 1, readingLayoutVersion: 2 }
})
describe('home continuation service', () => {
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([])
    cards.mockReset().mockResolvedValue([])
  })
  it('filters completed, empty and nonvisited records before the six-item limit', async () => {
    await getContinueReading('u')
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'u',
          completed: false,
          viewCount: { gt: 0 },
          lastViewedAt: { not: null },
          artwork: { logicalMediaCount: { gt: 0 }, deletedAt: null, archiveLifecycleState: 'ACTIVE' }
        },
        orderBy: [{ lastViewedAt: 'desc' }, { artworkId: 'desc' }],
        take: 6
      })
    )
  })
  it('preserves query ordering during card hydration and includes started videos with no prefix', async () => {
    findMany.mockResolvedValue([row(12), row(11)])
    cards.mockResolvedValue([{ id: 11 }, { id: 12 }])
    const result = await getContinueReading('u')
    expect(result.items.map((item) => item.artwork.id)).toEqual([12, 11])
    expect(result.items[0]!.reading).toMatchObject({
      progressCount: 0,
      viewCount: 1,
      status: 'IN_PROGRESS',
      readingLayoutVersion: 2
    })
  })
  it('omits works that disappeared during card hydration', async () => {
    findMany.mockResolvedValue([row(12), row(11)])
    cards.mockResolvedValue([{ id: 11 }])
    expect((await getContinueReading('u')).items.map((item) => item.artwork.id)).toEqual([11])
  })
})
