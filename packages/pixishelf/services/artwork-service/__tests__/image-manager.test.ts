import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  artworkFindUniqueMock,
  imageFindManyMock,
  imageFindUniqueMock,
  imageDeleteMock,
  imageUpdateMock,
  transactionMock,
  getScanPathMock,
  unlinkMock,
  syncMediaDerivedTagMock
} =
  vi.hoisted(() => ({
    artworkFindUniqueMock: vi.fn(),
    imageFindManyMock: vi.fn(),
    imageFindUniqueMock: vi.fn(),
    imageDeleteMock: vi.fn(),
    imageUpdateMock: vi.fn(),
    transactionMock: vi.fn(),
    getScanPathMock: vi.fn(),
    unlinkMock: vi.fn(),
    syncMediaDerivedTagMock: vi.fn()
  }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    image: {
      findUnique: imageFindUniqueMock
    },
    $transaction: transactionMock
  }
}))

vi.mock('@/services/setting.service', () => ({
  getScanPath: getScanPathMock
}))

vi.mock('fs/promises', () => ({
  default: {
    unlink: unlinkMock
  }
}))

vi.mock('@/services/media-derived-tag-service', () => ({
  syncMediaDerivedTagForArtwork: syncMediaDerivedTagMock
}))

import {
  ArtworkImageOrderError,
  deleteImage,
  preserveExistingMediaPathOrder,
  reorderArtworkImages
} from '../image-manager'

const normalizePath = (value: string) => value.replace(/\\/g, '/')
const expectUnlinkWithPathEnding = (pathEnding: string) => {
  expect(unlinkMock.mock.calls.some(([filePath]) => normalizePath(String(filePath)).endsWith(pathEnding))).toBe(true)
}

describe('deleteImage', () => {
  beforeEach(() => {
    imageFindUniqueMock.mockReset()
    imageFindManyMock.mockReset()
    imageDeleteMock.mockReset()
    imageUpdateMock.mockReset()
    artworkFindUniqueMock.mockReset()
    transactionMock.mockReset()
    getScanPathMock.mockReset()
    unlinkMock.mockReset()
    syncMediaDerivedTagMock.mockReset()

    getScanPathMock.mockResolvedValue('D:/scan-root')
    unlinkMock.mockResolvedValue(undefined)
    imageDeleteMock.mockResolvedValue({ id: 1 })
    imageUpdateMock.mockResolvedValue({ id: 1 })
    artworkFindUniqueMock.mockResolvedValue({ id: 2 })
    syncMediaDerivedTagMock.mockResolvedValue(undefined)
    transactionMock.mockImplementation(async (callback) =>
      callback({
        artwork: {
          findUnique: artworkFindUniqueMock
        },
        image: {
          delete: imageDeleteMock,
          findMany: imageFindManyMock,
          update: imageUpdateMock
        }
      })
    )
  })

  it('deletes both media file and chapter file when deleting physical video media', async () => {
    imageFindUniqueMock.mockResolvedValue({
      id: 1,
      artworkId: 2,
      path: '/artist/artwork/video.mp4',
      chaptersPath: '/artist/artwork/video.chapters.json'
    })

    await deleteImage(1, true)

    expectUnlinkWithPathEnding('/artist/artwork/video.mp4')
    expectUnlinkWithPathEnding('/artist/artwork/video.chapters.json')
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: 1 } })
    expect(syncMediaDerivedTagMock).toHaveBeenCalledWith(expect.anything(), 2)
  })

  it('does not delete an invalid chapter path basename', async () => {
    imageFindUniqueMock.mockResolvedValue({
      id: 1,
      artworkId: 2,
      path: '/artist/artwork/video.mp4',
      chaptersPath: '/artist/artwork/cover.jpg'
    })

    await deleteImage(1, true)

    expect(unlinkMock).toHaveBeenCalledTimes(1)
    expectUnlinkWithPathEnding('/artist/artwork/video.mp4')
  })
})

describe('media ordering', () => {
  beforeEach(() => {
    artworkFindUniqueMock.mockReset().mockResolvedValue({ id: 2 })
    imageFindManyMock.mockReset()
    imageUpdateMock.mockReset().mockResolvedValue({ id: 1 })
    transactionMock.mockReset().mockImplementation(async (callback) =>
      callback({
        artwork: { findUnique: artworkFindUniqueMock },
        image: { findMany: imageFindManyMock, update: imageUpdateMock }
      })
    )
    imageFindManyMock.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }])
  })

  it('updates every media item to a continuous sort order in one transaction', async () => {
    await reorderArtworkImages({
      artworkId: 2,
      expectedImageIds: [1, 2, 3],
      imageIds: [3, 1, 2]
    })

    expect(imageUpdateMock.mock.calls).toEqual([
      [{ where: { id: 3 }, data: { sortOrder: 0 } }],
      [{ where: { id: 1 }, data: { sortOrder: 1 } }],
      [{ where: { id: 2 }, data: { sortOrder: 2 } }]
    ])
  })

  it('rejects a stale baseline before writing any sort order', async () => {
    await expect(
      reorderArtworkImages({
        artworkId: 2,
        expectedImageIds: [2, 1, 3],
        imageIds: [3, 2, 1]
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' } satisfies Partial<ArtworkImageOrderError>)

    expect(imageUpdateMock).not.toHaveBeenCalled()
  })

  it.each([
    [1, 1, 3],
    [1, 2, 99],
    [1, 2]
  ])('rejects an invalid complete order: %s', async (...imageIds) => {
    await expect(
      reorderArtworkImages({
        artworkId: 2,
        expectedImageIds: [1, 2, 3],
        imageIds
      })
    ).rejects.toMatchObject({ code: 'INVALID_ORDER' } satisfies Partial<ArtworkImageOrderError>)

    expect(imageUpdateMock).not.toHaveBeenCalled()
  })

  it('preserves surviving paths and appends newly scanned media', () => {
    const result = preserveExistingMediaPathOrder(
      [{ path: '/work/a.jpg' }, { path: '/work/b.jpg' }, { path: '/work/new.jpg' }],
      [{ path: '\\work\\b.jpg' }, { path: '/work/deleted.jpg' }, { path: '/WORK/A.JPG' }]
    )

    expect(result.map((item) => item.path)).toEqual(['/work/b.jpg', '/work/a.jpg', '/work/new.jpg'])
  })
})
