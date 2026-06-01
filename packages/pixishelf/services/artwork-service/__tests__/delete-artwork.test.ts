import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  imageFindManyMock,
  imageDeleteManyMock,
  artworkDeleteMock,
  getScanPathMock,
  unlinkMock,
  loggerWarnMock
} = vi.hoisted(() => ({
  imageFindManyMock: vi.fn(),
  imageDeleteManyMock: vi.fn(),
  artworkDeleteMock: vi.fn(),
  getScanPathMock: vi.fn(),
  unlinkMock: vi.fn(),
  loggerWarnMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    image: {
      findMany: imageFindManyMock,
      deleteMany: imageDeleteManyMock
    },
    artwork: {
      delete: artworkDeleteMock
    }
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
    artworkDeleteMock.mockReset()
    getScanPathMock.mockReset()
    unlinkMock.mockReset()
    loggerWarnMock.mockReset()

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
})
