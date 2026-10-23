import type { ArtworkReadingSummary } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRaw, getCards } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  getCards: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $queryRaw: queryRaw
} }))
vi.mock('@/services/artwork-service', () => ({ getArtworkCardsByIds: getCards }))

import { getContinueReading } from '../reading-service'

const at = new Date('2026-10-22T10:00:00.000Z')
function row(artworkId: number, overrides: Partial<ArtworkReadingSummary> = {}) {
  return {
    userId: 'alice', artworkId, viewCount: 1, seenCount: 2, totalCount: 8, stateVersion: 3,
    lastViewedAt: at, lastActiveAt: at, lastMediaId: artworkId * 10, lastMediaIndex: 1,
    createdAt: at, updatedAt: at, ...overrides, mediaRevision: 2
  }
}

describe('home continuation service', () => {
  beforeEach(() => {
    queryRaw.mockReset().mockResolvedValue([])
    getCards.mockReset().mockResolvedValue([])
  })

  it('filters actual visits and unfinished active works in the database before the six-item limit', async () => {
    await getContinueReading('alice')

    expect(queryRaw).toHaveBeenCalledOnce()
    const query = queryRaw.mock.calls[0]![0]
    expect(query.values).toEqual(['alice', 90])
    expect(query.text).toContain('rs."userId" = $1')
    expect(query.text).toContain('rs."viewCount" > 0')
    expect(query.text).toContain('rs."lastViewedAt" IS NOT NULL')
    expect(query.text).toContain('rs."totalCount" > 0')
    expect(query.text).toContain('rs."seenCount"::bigint * 100 < rs."totalCount"::bigint * $2')
    expect(query.text).toContain('a."deletedAt" IS NULL')
    expect(query.text).toContain('a."archiveLifecycleState" = \'ACTIVE\'')
    expect(query.text).toMatch(/WHERE[\s\S]+ORDER BY rs\."lastViewedAt" DESC, rs\."artworkId" DESC\s+LIMIT 6/)
    // Manual/default read rows have no real visit; completion and empty works are SQL exclusions.
    expect(getCards).toHaveBeenCalledExactlyOnceWith([])
  })

  it('preserves stable recent order while hydrating cards and includes a started video with zero seen items', async () => {
    const ids = [12, 11, 10, 9, 8, 7]
    queryRaw.mockResolvedValue(ids.map((id) => row(id, id === 12 ? { seenCount: 0, totalCount: 1 } : {})))
    getCards.mockResolvedValue(ids.toReversed().map((id) => ({ id, title: `Artwork ${id}` })))

    const result = await getContinueReading('alice')

    expect(getCards).toHaveBeenCalledExactlyOnceWith(ids)
    expect(result.items.map((item) => item.artwork.id)).toEqual(ids)
    expect(result.items[0]).toMatchObject({
      artwork: { id: 12 },
      reading: {
        artworkId: 12, status: 'IN_PROGRESS', viewCount: 1, seenCount: 0, totalCount: 1,
        mediaRevision: 2, stateVersion: 3, lastViewedAt: at.toISOString(), lastMediaId: 120
      }
    })
  })

  it('omits a work that disappeared between selection and active card hydration', async () => {
    queryRaw.mockResolvedValue([row(9), row(8)])
    getCards.mockResolvedValue([{ id: 8, title: 'Still active' }])
    expect((await getContinueReading('alice')).items.map((item) => item.artwork.id)).toEqual([8])
  })
})
