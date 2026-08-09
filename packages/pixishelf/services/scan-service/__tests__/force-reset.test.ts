import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ESource } from '@/enums/ESource'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  artworkTagDeleteMany: vi.fn(),
  imageDeleteMany: vi.fn(),
  artworkDeleteMany: vi.fn(),
  artistDeleteMany: vi.fn(),
  tagDeleteMany: vi.fn(),
  localImportMappingDeleteMany: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction
  }
}))

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn()
  }
}))

import { clearPixivImportedData } from '../force-reset'

const transactionClient = {
  artworkTag: { deleteMany: mocks.artworkTagDeleteMany },
  image: { deleteMany: mocks.imageDeleteMany },
  artwork: { deleteMany: mocks.artworkDeleteMany },
  artist: { deleteMany: mocks.artistDeleteMany },
  tag: { deleteMany: mocks.tagDeleteMany },
  localImportArtistMapping: { deleteMany: mocks.localImportMappingDeleteMany }
}

describe('clearPixivImportedData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.artworkTagDeleteMany.mockResolvedValue({ count: 4 })
    mocks.imageDeleteMany.mockResolvedValue({ count: 3 })
    mocks.artworkDeleteMany.mockResolvedValue({ count: 2 })
    mocks.transaction.mockImplementation(async (callback: (tx: typeof transactionClient) => Promise<number>) =>
      callback(transactionClient)
    )
  })

  it('deletes only Pixiv artwork relations and reports the removed artwork count', async () => {
    await expect(clearPixivImportedData()).resolves.toBe(2)

    const relationFilter = {
      where: {
        artwork: {
          source: ESource.PIXIV_IMPORTED
        }
      }
    }
    expect(mocks.artworkTagDeleteMany).toHaveBeenCalledWith(relationFilter)
    expect(mocks.imageDeleteMany).toHaveBeenCalledWith(relationFilter)
    expect(mocks.artworkDeleteMany).toHaveBeenCalledWith({
      where: { source: ESource.PIXIV_IMPORTED }
    })
    expect(mocks.artworkTagDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.imageDeleteMany.mock.invocationCallOrder[0]!
    )
    expect(mocks.imageDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.artworkDeleteMany.mock.invocationCallOrder[0]!
    )
  })

  it('preserves local-created and local-import fixtures with their shared entities', async () => {
    const state = {
      artworks: [
        { id: 1, source: ESource.PIXIV_IMPORTED },
        { id: 2, source: ESource.LOCAL_CREATED },
        { id: 3, source: ESource.LOCAL_IMPORT }
      ],
      artworkTags: [
        { artworkId: 1, tagId: 10 },
        { artworkId: 2, tagId: 10 },
        { artworkId: 3, tagId: 11 }
      ],
      images: [
        { artworkId: 1, path: 'pixiv.jpg' },
        { artworkId: 2, path: 'created.jpg' },
        { artworkId: 3, path: 'imported.jpg' }
      ],
      artists: [{ id: 20 }, { id: 21 }],
      tags: [
        { id: 10, artworkCount: 2 },
        { id: 11, artworkCount: 1 }
      ],
      mappings: [{ artistDirectory: 'local-imports/artist', artistId: 21 }]
    }
    const pixivArtworkIds = () =>
      new Set(
        state.artworks.filter((artwork) => artwork.source === ESource.PIXIV_IMPORTED).map((artwork) => artwork.id)
      )

    mocks.artworkTagDeleteMany.mockImplementationOnce(async () => {
      const pixivIds = pixivArtworkIds()
      const removedRelations = state.artworkTags.filter((relation) => pixivIds.has(relation.artworkId))
      state.artworkTags = state.artworkTags.filter((relation) => !pixivIds.has(relation.artworkId))
      for (const relation of removedRelations) {
        const tag = state.tags.find((item) => item.id === relation.tagId)
        if (tag) tag.artworkCount -= 1
      }
      return { count: removedRelations.length }
    })
    mocks.imageDeleteMany.mockImplementationOnce(async () => {
      const pixivIds = pixivArtworkIds()
      const previousCount = state.images.length
      state.images = state.images.filter((image) => !pixivIds.has(image.artworkId))
      return { count: previousCount - state.images.length }
    })
    mocks.artworkDeleteMany.mockImplementationOnce(async () => {
      const previousCount = state.artworks.length
      state.artworks = state.artworks.filter((artwork) => artwork.source !== ESource.PIXIV_IMPORTED)
      return { count: previousCount - state.artworks.length }
    })

    await expect(clearPixivImportedData()).resolves.toBe(1)

    expect(state.artworks.map((artwork) => artwork.source)).toEqual([ESource.LOCAL_CREATED, ESource.LOCAL_IMPORT])
    expect(state.images.map((image) => image.path)).toEqual(['created.jpg', 'imported.jpg'])
    expect(state.artworkTags).toEqual([
      { artworkId: 2, tagId: 10 },
      { artworkId: 3, tagId: 11 }
    ])
    expect(state.tags).toEqual([
      { id: 10, artworkCount: 1 },
      { id: 11, artworkCount: 1 }
    ])
    expect(state.artists).toEqual([{ id: 20 }, { id: 21 }])
    expect(state.mappings).toEqual([{ artistDirectory: 'local-imports/artist', artistId: 21 }])

    expect(mocks.artistDeleteMany).not.toHaveBeenCalled()
    expect(mocks.tagDeleteMany).not.toHaveBeenCalled()
    expect(mocks.localImportMappingDeleteMany).not.toHaveBeenCalled()
  })

  it('stops inside the transaction and surfaces a stable cleanup error when deletion fails', async () => {
    mocks.imageDeleteMany.mockRejectedValueOnce(new Error('delete failed'))

    await expect(clearPixivImportedData()).rejects.toThrow('Database cleanup failed: delete failed')
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.artworkDeleteMany).not.toHaveBeenCalled()
  })
})
