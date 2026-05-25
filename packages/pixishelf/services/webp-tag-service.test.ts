import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncWebpTagForArtwork, syncWebpTagsForArtworks, WEBP_TAG_NAME } from './webp-tag-service'

vi.mock('@/lib/prisma', () => ({
  prisma: {}
}))

const tagUpsertMock = vi.fn()
const imageFindManyMock = vi.fn()
const artworkTagCreateManyMock = vi.fn()
const artworkTagDeleteManyMock = vi.fn()

function createTx() {
  return {
    tag: {
      upsert: tagUpsertMock
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

describe('webp-tag-service', () => {
  beforeEach(() => {
    tagUpsertMock.mockReset().mockResolvedValue({ id: 9 })
    imageFindManyMock.mockReset().mockResolvedValue([])
    artworkTagCreateManyMock.mockReset()
    artworkTagDeleteManyMock.mockReset()
  })

  it('adds webp tag when artwork has a webp image', async () => {
    imageFindManyMock.mockResolvedValue([{ artworkId: 1 }])

    await syncWebpTagForArtwork(createTx(), 1)

    expect(tagUpsertMock).toHaveBeenCalledWith({
      where: { name: WEBP_TAG_NAME },
      update: {},
      create: { name: WEBP_TAG_NAME },
      select: { id: true }
    })
    expect(imageFindManyMock).toHaveBeenCalledWith({
      where: {
        artworkId: { in: [1] },
        path: { endsWith: '.webp', mode: 'insensitive' }
      },
      select: { artworkId: true },
      distinct: ['artworkId']
    })
    expect(artworkTagCreateManyMock).toHaveBeenCalledWith({
      data: [{ artworkId: 1, tagId: 9 }],
      skipDuplicates: true
    })
    expect(artworkTagDeleteManyMock).not.toHaveBeenCalled()
  })

  it('removes webp tag when artwork no longer has webp images', async () => {
    await syncWebpTagForArtwork(createTx(), 1)

    expect(artworkTagCreateManyMock).not.toHaveBeenCalled()
    expect(artworkTagDeleteManyMock).toHaveBeenCalledWith({
      where: {
        tagId: 9,
        artworkId: { in: [1] }
      }
    })
  })

  it('syncs mixed batches and ignores duplicate artwork ids', async () => {
    imageFindManyMock.mockResolvedValue([{ artworkId: 1 }, { artworkId: 3 }])

    await syncWebpTagsForArtworks(createTx(), [1, 1, 2, 3])

    expect(artworkTagCreateManyMock).toHaveBeenCalledWith({
      data: [
        { artworkId: 1, tagId: 9 },
        { artworkId: 3, tagId: 9 }
      ],
      skipDuplicates: true
    })
    expect(artworkTagDeleteManyMock).toHaveBeenCalledWith({
      where: {
        tagId: 9,
        artworkId: { in: [2] }
      }
    })
  })
})
