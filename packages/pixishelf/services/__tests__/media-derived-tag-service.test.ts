import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MEDIA_DERIVED_TAGS,
  syncMediaDerivedTagForArtwork,
  syncMediaDerivedTagsForArtworks
} from '../media-derived-tag-service'

vi.mock('@/lib/prisma', () => ({
  prisma: {}
}))

const tagFindFirstMock = vi.fn()
const tagCreateMock = vi.fn()
const tagUpdateMock = vi.fn()
const imageFindManyMock = vi.fn()
const artworkTagCreateManyMock = vi.fn()
const artworkTagDeleteManyMock = vi.fn()

const tagIds = {
  webp: 9,
  video: 10,
  image: 11
}

function createTx() {
  return {
    tag: {
      findFirst: tagFindFirstMock,
      create: tagCreateMock,
      update: tagUpdateMock
    },
    image: {
      findMany: imageFindManyMock
    },
    artworkTag: {
      createMany: artworkTagCreateManyMock,
      deleteMany: artworkTagDeleteManyMock
    }
  } as any
}

describe('media-derived-tag-service', () => {
  beforeEach(() => {
    tagFindFirstMock.mockReset()
    tagUpdateMock.mockReset()
    tagCreateMock.mockReset()
    imageFindManyMock.mockReset().mockResolvedValue([])
    artworkTagCreateManyMock.mockReset()
    artworkTagDeleteManyMock.mockReset()

    let index = 0
    tagFindFirstMock.mockImplementation(async () => ({ id: Object.values(tagIds)[index++] }))
    tagUpdateMock.mockImplementation(async ({ where }) => ({ id: where.id }))
  })

  it('adds webp and image tags when artwork has a webp image without video', async () => {
    imageFindManyMock.mockResolvedValue([{ artworkId: 1, path: '/a/cover.WEBP' }])

    await syncMediaDerivedTagForArtwork(createTx(), 1)

    expect(tagFindFirstMock).toHaveBeenCalledWith({
      where: {
        OR: [{ systemKey: MEDIA_DERIVED_TAGS.webp.systemKey }, { name: MEDIA_DERIVED_TAGS.webp.name }]
      },
      select: { id: true }
    })
    expect(artworkTagCreateManyMock).toHaveBeenCalledWith({
      data: [
        { artworkId: 1, tagId: tagIds.webp },
        { artworkId: 1, tagId: tagIds.image }
      ],
      skipDuplicates: true
    })
    expect(artworkTagDeleteManyMock).toHaveBeenCalledWith({
      where: {
        tagId: tagIds.video,
        artworkId: { in: [1] }
      }
    })
  })

  it('adds video tag and removes stale image tag when artwork has video', async () => {
    imageFindManyMock.mockResolvedValue([{ artworkId: 1, path: '/a/movie.MP4' }])

    await syncMediaDerivedTagForArtwork(createTx(), 1)

    expect(artworkTagCreateManyMock).toHaveBeenCalledWith({
      data: [{ artworkId: 1, tagId: tagIds.video }],
      skipDuplicates: true
    })
    expect(artworkTagDeleteManyMock).toHaveBeenCalledWith({
      where: {
        tagId: tagIds.image,
        artworkId: { in: [1] }
      }
    })
  })

  it('syncs mixed batches and ignores duplicate artwork ids', async () => {
    imageFindManyMock.mockResolvedValue([
      { artworkId: 1, path: '/a/1.webp' },
      { artworkId: 2, path: '/b/2.mp4' },
      { artworkId: 3, path: '/c/3.jpg' }
    ])

    await syncMediaDerivedTagsForArtworks(createTx(), [1, 1, 2, 3])

    expect(artworkTagCreateManyMock).toHaveBeenCalledWith({
      data: [
        { artworkId: 1, tagId: tagIds.webp },
        { artworkId: 2, tagId: tagIds.video },
        { artworkId: 1, tagId: tagIds.image },
        { artworkId: 3, tagId: tagIds.image }
      ],
      skipDuplicates: true
    })
  })
})
