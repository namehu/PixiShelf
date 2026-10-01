import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  membershipFindUnique: vi.fn(),
  membershipUpdate: vi.fn(),
  membershipDelete: vi.fn()
}))

vi.mock('@/lib/prisma', () => {
  const transactionClient = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7 }]),
    seriesArtwork: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: mocks.membershipFindUnique,
      update: mocks.membershipUpdate,
      delete: mocks.membershipDelete
    }
  }
  return {
    prisma: {
      series: { findUnique: mocks.findUnique },
      $transaction: vi.fn((callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient))
    }
  }
})

vi.mock('@/services/artwork-service/utils', () => ({
  transformSingleArtwork: vi.fn((artwork: { id: number; images: unknown[] }) => ({
    id: artwork.id,
    images: artwork.images
  }))
}))

import { getSeriesDetail, removeArtworkFromSeries } from '../series-service'

describe('series membership ordering and exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads every active member in stored order and excludes deleted or excluded memberships', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 7,
      title: 'ordered series',
      coverImageUrl: null,
      seriesArtworks: [
        {
          sortOrder: 1,
          provenance: 'SOURCE',
          sourceOrder: 4,
          orderOverridden: false,
          artwork: { id: 20, images: [] }
        },
        {
          sortOrder: 2,
          provenance: 'MANUAL',
          sourceOrder: null,
          orderOverridden: true,
          artwork: { id: 10, images: [] }
        }
      ]
    })

    const result = await getSeriesDetail(7)

    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        include: expect.objectContaining({
          seriesArtworks: expect.objectContaining({
            where: { excludedAt: null, artwork: { deletedAt: null } },
            orderBy: { sortOrder: 'asc' }
          })
        })
      })
    )
    expect(result?.artworks).toEqual([
      expect.objectContaining({ id: 20, seriesOrder: 1 }),
      expect.objectContaining({ id: 10, seriesOrder: 2 })
    ])
  })

  it('records a source exclusion instead of deleting the imported membership', async () => {
    mocks.membershipFindUnique.mockResolvedValue({ provenance: 'SOURCE' })

    await removeArtworkFromSeries(7, 20)

    expect(mocks.membershipUpdate).toHaveBeenCalledWith({
      where: { seriesId_artworkId: { seriesId: 7, artworkId: 20 } },
      data: { excludedAt: expect.any(Date) }
    })
    expect(mocks.membershipDelete).not.toHaveBeenCalled()
  })

  it('deletes a manual membership when it is removed', async () => {
    mocks.membershipFindUnique.mockResolvedValue({ provenance: 'MANUAL' })

    await removeArtworkFromSeries(7, 10)

    expect(mocks.membershipDelete).toHaveBeenCalledWith({
      where: { seriesId_artworkId: { seriesId: 7, artworkId: 10 } }
    })
    expect(mocks.membershipUpdate).not.toHaveBeenCalled()
  })
})
