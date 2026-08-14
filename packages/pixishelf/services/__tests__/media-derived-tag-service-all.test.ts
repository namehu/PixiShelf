import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  artworkCount,
  artworkFindMany,
  artworkTagCount,
  artworkTagCreateMany,
  artworkTagDeleteMany,
  artworkTagFindMany,
  imageFindMany,
  tagFindFirst,
  tagUpdate
} = vi.hoisted(() => ({
  artworkCount: vi.fn(),
  artworkFindMany: vi.fn(),
  artworkTagCount: vi.fn(),
  artworkTagCreateMany: vi.fn(),
  artworkTagDeleteMany: vi.fn(),
  artworkTagFindMany: vi.fn(),
  imageFindMany: vi.fn(),
  tagFindFirst: vi.fn(),
  tagUpdate: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: { count: artworkCount, findMany: artworkFindMany },
    artworkTag: {
      count: artworkTagCount,
      createMany: artworkTagCreateMany,
      deleteMany: artworkTagDeleteMany,
      findMany: artworkTagFindMany
    },
    image: { findMany: imageFindMany },
    tag: { findFirst: tagFindFirst, update: tagUpdate, create: vi.fn() }
  }
}))

import { MEDIA_TAG_IMAGE_PAGE_SIZE, syncAllMediaDerivedTags } from '../media-derived-tag-service'

describe('full media derived tag sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    artworkCount.mockResolvedValue(2)
    artworkFindMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValue([])
    imageFindMany.mockResolvedValue([
      { id: 1, artworkId: 1, path: 'cover.webp' },
      { id: 2, artworkId: 2, path: 'movie.m4v' }
    ])
    artworkTagFindMany.mockResolvedValue([])
    artworkTagCount.mockResolvedValue(0)
    artworkTagCreateMany.mockImplementation(async ({ data }) => ({ count: data.length }))
    artworkTagDeleteMany.mockResolvedValue({ count: 0 })
    let tagId = 10
    tagFindFirst.mockImplementation(async () => ({ id: tagId++ }))
    tagUpdate.mockImplementation(async ({ where }) => ({ id: where.id }))
  })

  it('walks artworks in bounded pages without loading the whole library', async () => {
    const result = await syncAllMediaDerivedTags()
    expect(artworkFindMany).toHaveBeenCalledWith({
      where: { id: { gt: 0 } },
      orderBy: { id: 'asc' },
      take: 500,
      select: { id: true }
    })
    expect(result.webp.expectedArtworks).toBe(1)
    expect(result.video.expectedArtworks).toBe(1)
    expect(result.image.expectedArtworks).toBe(1)
  })

  it('secondary-keysets matching images so one artwork cannot make a page unbounded', async () => {
    imageFindMany
      .mockReset()
      .mockResolvedValueOnce(
        Array.from({ length: MEDIA_TAG_IMAGE_PAGE_SIZE }, (_, index) => ({
          id: index + 1,
          artworkId: 1,
          path: `pages/${index + 1}.webp`
        }))
      )
      .mockResolvedValueOnce([{ id: MEDIA_TAG_IMAGE_PAGE_SIZE + 1, artworkId: 2, path: 'movie.m4v' }])

    const result = await syncAllMediaDerivedTags()

    expect(imageFindMany).toHaveBeenCalledTimes(2)
    for (const [query] of imageFindMany.mock.calls) {
      expect(query).toEqual(
        expect.objectContaining({
          orderBy: { id: 'asc' },
          take: MEDIA_TAG_IMAGE_PAGE_SIZE,
          select: { id: true, artworkId: true, path: true }
        })
      )
    }
    expect(imageFindMany.mock.calls[1]![0].where.id).toEqual({ gt: MEDIA_TAG_IMAGE_PAGE_SIZE })
    expect(result.video.expectedArtworks).toBe(1)
  })
})
