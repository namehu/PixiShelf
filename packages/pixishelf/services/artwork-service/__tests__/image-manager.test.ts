import { beforeEach, describe, expect, it, vi } from 'vitest'

const { imageFindUniqueMock, imageDeleteMock, transactionMock, getScanPathMock, unlinkMock, syncMediaDerivedTagMock } =
  vi.hoisted(() => ({
    imageFindUniqueMock: vi.fn(),
    imageDeleteMock: vi.fn(),
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

import { deleteImage } from '../image-manager'

const normalizePath = (value: string) => value.replace(/\\/g, '/')
const expectUnlinkWithPathEnding = (pathEnding: string) => {
  expect(unlinkMock.mock.calls.some(([filePath]) => normalizePath(String(filePath)).endsWith(pathEnding))).toBe(true)
}

describe('deleteImage', () => {
  beforeEach(() => {
    imageFindUniqueMock.mockReset()
    imageDeleteMock.mockReset()
    transactionMock.mockReset()
    getScanPathMock.mockReset()
    unlinkMock.mockReset()
    syncMediaDerivedTagMock.mockReset()

    getScanPathMock.mockResolvedValue('D:/scan-root')
    unlinkMock.mockResolvedValue(undefined)
    imageDeleteMock.mockResolvedValue({ id: 1 })
    syncMediaDerivedTagMock.mockResolvedValue(undefined)
    transactionMock.mockImplementation(async (callback) =>
      callback({
        image: {
          delete: imageDeleteMock
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
