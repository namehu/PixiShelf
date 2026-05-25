import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDashboardArtists } from './artist-service'

const { artistFindManyMock, artworkFindManyMock } = vi.hoisted(() => ({
  artistFindManyMock: vi.fn(),
  artworkFindManyMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artist: {
      findMany: artistFindManyMock
    },
    artwork: {
      findMany: artworkFindManyMock
    }
  }
}))

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

describe('getDashboardArtists', () => {
  beforeEach(() => {
    artistFindManyMock.mockReset()
    artworkFindManyMock.mockReset()
  })

  it('should keep dashboard coverUrl as original relative media path', async () => {
    artistFindManyMock.mockResolvedValue([
      {
        id: 1,
        name: 'artist',
        username: 'artist',
        userId: '1000',
        bio: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        avatar: null,
        backgroundImg: null,
        isStarred: false,
        _count: {
          artworks: 3
        }
      }
    ])
    artworkFindManyMock.mockResolvedValue([
      {
        id: 11,
        title: 'cover',
        images: [{ path: '1000/11_p0.jpg' }]
      }
    ])

    const result = await getDashboardArtists({
      pageSize: 1,
      candidateMultiplier: 1,
      previewArtworkSize: 1
    })

    expect(result[0]?.recentArtworks[0]?.coverUrl).toBe('1000/11_p0.jpg')
  })
})
