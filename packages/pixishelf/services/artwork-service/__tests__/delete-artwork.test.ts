import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  imageFindManyMock,
  imageDeleteManyMock,
  artworkFindUniqueMock,
  artworkFindUniqueOrThrowMock,
  artworkDeleteMock,
  getScanPathMock,
  unlinkMock,
  loggerWarnMock,
  requireArchiveStorageRootMock,
  trashPublishedArchiveMock
} = vi.hoisted(() => ({
  imageFindManyMock: vi.fn(),
  imageDeleteManyMock: vi.fn(),
  artworkFindUniqueMock: vi.fn(),
  artworkFindUniqueOrThrowMock: vi.fn(),
  artworkDeleteMock: vi.fn(),
  getScanPathMock: vi.fn(),
  unlinkMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  requireArchiveStorageRootMock: vi.fn(),
  trashPublishedArchiveMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    image: {
      findMany: imageFindManyMock,
      deleteMany: imageDeleteManyMock
    },
    artwork: {
      findUnique: artworkFindUniqueMock,
      findUniqueOrThrow: artworkFindUniqueOrThrowMock,
      delete: artworkDeleteMock
    }
  }
}))
vi.mock('@/services/setting.service', () => ({
  getScanPath: getScanPathMock
}))
vi.mock('@/services/archive/config', () => ({
  requireArchiveStorageRoot: requireArchiveStorageRootMock
}))
vi.mock('@/services/archive/publisher', () => ({
  trashPublishedArchive: trashPublishedArchiveMock
}))
vi.mock('fs/promises', () => ({
  default: {
    unlink: unlinkMock
  }
}))
vi.mock('@/lib/logger', () => ({
  default: {
    warn: loggerWarnMock
  }
}))
vi.mock('@/services/like-service', () => ({
  getUserArtworkLikeStatus: vi.fn()
}))

import { deleteArtwork } from '..'

const normalizePath = (value: string) => value.replace(/\\/g, '/')
const expectUnlinkWithPathEnding = (pathEnding: string) => {
  expect(unlinkMock.mock.calls.some(([filePath]) => normalizePath(String(filePath)).endsWith(pathEnding))).toBe(true)
}

describe('deleteArtwork', () => {
  beforeEach(() => {
    imageFindManyMock.mockReset()
    imageDeleteManyMock.mockReset()
    artworkFindUniqueMock.mockReset().mockResolvedValue({ id: 1, createdVia: 'LOCAL_DIRECTORY' })
    artworkFindUniqueOrThrowMock.mockReset()
    artworkDeleteMock.mockReset()
    getScanPathMock.mockReset()
    unlinkMock.mockReset()
    loggerWarnMock.mockReset()
    requireArchiveStorageRootMock.mockReset().mockResolvedValue('D:/archive-root')
    trashPublishedArchiveMock.mockReset().mockResolvedValue({ artworkId: 1 })

    imageDeleteManyMock.mockResolvedValue({ count: 2 })
    artworkDeleteMock.mockResolvedValue({ id: 1 })
    getScanPathMock.mockResolvedValue('D:/scan-root')
    unlinkMock.mockResolvedValue(undefined)
  })

  it('should delete both media file and chapter file for an artwork', async () => {
    imageFindManyMock.mockResolvedValue([
      {
        id: 1,
        artworkId: 1,
        path: '/artist/artwork/video.mp4',
        chaptersPath: '/artist/artwork/video.chapters.json'
      }
    ])

    await deleteArtwork(1)

    expectUnlinkWithPathEnding('/artist/artwork/video.mp4')
    expectUnlinkWithPathEnding('/artist/artwork/video.chapters.json')
    expect(imageDeleteManyMock).toHaveBeenCalledWith({ where: { artworkId: 1 } })
    expect(artworkDeleteMock).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it('should ignore invalid chapter file paths and only delete media file', async () => {
    imageFindManyMock.mockResolvedValue([
      {
        id: 1,
        artworkId: 1,
        path: '/artist/artwork/video.mp4',
        chaptersPath: '/artist/artwork/cover.jpg'
      }
    ])

    await deleteArtwork(1)

    expect(unlinkMock).toHaveBeenCalledTimes(1)
    expectUnlinkWithPathEnding('/artist/artwork/video.mp4')
  })

  it('soft-deletes URL archives through the archive lifecycle instead of unlinking media', async () => {
    const restored = { id: 1, createdVia: 'URL_ARCHIVE', deletedAt: new Date() }
    artworkFindUniqueMock.mockResolvedValue({ id: 1, createdVia: 'URL_ARCHIVE' })
    artworkFindUniqueOrThrowMock.mockResolvedValue(restored)

    await expect(deleteArtwork(1)).resolves.toBe(restored)

    expect(trashPublishedArchiveMock).toHaveBeenCalledWith(1)
    expect(imageFindManyMock).not.toHaveBeenCalled()
    expect(unlinkMock).not.toHaveBeenCalled()
    expect(artworkDeleteMock).not.toHaveBeenCalled()
  })
})
