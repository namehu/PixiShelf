import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  imageDeleteManyMock,
  imageCreateManyMock,
  tagFindManyMock,
  artworkTagCreateManyMock,
  transactionMock,
  syncMediaDerivedTagMock
} = vi.hoisted(() => ({
  imageDeleteManyMock: vi.fn(),
  imageCreateManyMock: vi.fn(),
  tagFindManyMock: vi.fn(),
  artworkTagCreateManyMock: vi.fn(),
  transactionMock: vi.fn(),
  syncMediaDerivedTagMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock
  }
}))

vi.mock('@/services/media-derived-tag-service', () => ({
  syncMediaDerivedTagForArtwork: syncMediaDerivedTagMock
}))

vi.mock('@/services/setting.service', () => ({
  getScanPath: vi.fn()
}))

import { updateArtworkImagesTransaction, updateArtworkImagesWithTransactionClient } from '../image-manager'

const tx = {
  image: {
    deleteMany: imageDeleteManyMock,
    createMany: imageCreateManyMock
  },
  tag: {
    findMany: tagFindManyMock
  },
  artworkTag: {
    createMany: artworkTagCreateManyMock
  }
}

describe('updateArtworkImagesTransaction', () => {
  beforeEach(() => {
    imageDeleteManyMock.mockReset().mockResolvedValue({})
    imageCreateManyMock.mockReset().mockResolvedValue({ count: 1 })
    tagFindManyMock.mockReset()
    artworkTagCreateManyMock.mockReset().mockResolvedValue({ count: 1 })
    syncMediaDerivedTagMock.mockReset().mockResolvedValue(undefined)
    transactionMock.mockReset().mockImplementation(async (callback) => callback(tx))
  })

  it('keeps current tag behavior when no default tags are configured', async () => {
    await updateArtworkImagesTransaction(10, [
      {
        fileName: 'image.jpg',
        order: 1,
        width: 100,
        height: 120,
        size: 2048,
        path: '/artist/artwork/image.jpg'
      }
    ])

    expect(imageDeleteManyMock).toHaveBeenCalledWith({ where: { artworkId: 10 } })
    expect(imageCreateManyMock).toHaveBeenCalled()
    expect(syncMediaDerivedTagMock).toHaveBeenCalledWith(tx, 10)
    expect(tagFindManyMock).not.toHaveBeenCalled()
    expect(artworkTagCreateManyMock).not.toHaveBeenCalled()
  })

  it('appends existing default tags and skips duplicate or deleted tag ids', async () => {
    tagFindManyMock.mockResolvedValue([{ id: 2 }, { id: 5 }])

    await updateArtworkImagesTransaction(
      10,
      [
        {
          fileName: 'image.jpg',
          order: 1,
          width: 100,
          height: 120,
          size: 2048,
          path: '/artist/artwork/image.jpg'
        }
      ],
      [],
      {
        appendTagIds: [2, 2, 5, 999]
      }
    )

    expect(tagFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: [2, 5, 999] } },
      select: { id: true }
    })
    expect(artworkTagCreateManyMock).toHaveBeenCalledWith({
      data: [
        { artworkId: 10, tagId: 2 },
        { artworkId: 10, tagId: 5 }
      ],
      skipDuplicates: true
    })
  })
})

describe('updateArtworkImagesWithTransactionClient', () => {
  beforeEach(() => {
    imageDeleteManyMock.mockReset().mockResolvedValue({})
    imageCreateManyMock.mockReset().mockResolvedValue({ count: 1 })
    tagFindManyMock.mockReset().mockResolvedValue([{ id: 4 }])
    artworkTagCreateManyMock.mockReset().mockResolvedValue({ count: 1 })
    syncMediaDerivedTagMock.mockReset().mockResolvedValue(undefined)
    transactionMock.mockReset()
  })

  it('replaces images, chapter metadata, derived tags, and append tags without opening a transaction', async () => {
    await updateArtworkImagesWithTransactionClient(
      tx as any,
      10,
      [
        {
          fileName: 'video.mp4',
          order: 2,
          width: 1920,
          height: 1080,
          size: 4096,
          path: '/artist/artwork/video.mp4'
        }
      ],
      [
        {
          videoFileName: 'video.mp4',
          chaptersFileName: 'video.chapters.json',
          chaptersPath: '/artist/artwork/video.chapters.json',
          chaptersCount: 3,
          chaptersDuration: 60,
          chaptersHash: 'chapter-hash'
        }
      ],
      { appendTagIds: [4] }
    )

    expect(transactionMock).not.toHaveBeenCalled()
    expect(imageDeleteManyMock).toHaveBeenCalledWith({ where: { artworkId: 10 } })
    expect(imageCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          artworkId: 10,
          path: '/artist/artwork/video.mp4',
          sortOrder: 2,
          chaptersPath: '/artist/artwork/video.chapters.json',
          chaptersCount: 3,
          chaptersDuration: 60,
          chaptersUpdatedAt: expect.any(Date),
          chaptersHash: 'chapter-hash'
        })
      ]
    })
    expect(syncMediaDerivedTagMock).toHaveBeenCalledWith(tx, 10)
    expect(artworkTagCreateManyMock).toHaveBeenCalledWith({
      data: [{ artworkId: 10, tagId: 4 }],
      skipDuplicates: true
    })
  })
})
