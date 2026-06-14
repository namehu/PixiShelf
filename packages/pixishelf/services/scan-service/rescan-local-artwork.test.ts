import { beforeEach, describe, expect, it, vi } from 'vitest'

const { scanLocalArtworkMediaDirectoryMock, updateArtworkImagesTransactionMock } = vi.hoisted(() => ({
  scanLocalArtworkMediaDirectoryMock: vi.fn(),
  updateArtworkImagesTransactionMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))
vi.mock('@/services/artwork-service/local-media-scanner', () => ({
  scanLocalArtworkMediaDirectory: scanLocalArtworkMediaDirectoryMock
}))
vi.mock('@/services/artwork-service/image-manager', () => ({
  updateArtworkImagesTransaction: updateArtworkImagesTransactionMock
}))

import { rescanLocalArtwork } from './index'

describe('rescanLocalArtwork', () => {
  beforeEach(() => {
    scanLocalArtworkMediaDirectoryMock.mockReset().mockResolvedValue({
      filesMeta: [
        {
          fileName: 'video.mp4',
          order: 1,
          width: 0,
          height: 0,
          size: 5,
          path: '/local/video.mp4'
        }
      ],
      chaptersMeta: [],
      warnings: [],
      earliestMediaMtime: new Date()
    })
    updateArtworkImagesTransactionMock.mockReset().mockResolvedValue(undefined)
  })

  it('forwards the cancellation callback to the local media scanner', async () => {
    const checkCancelled = vi.fn().mockResolvedValue(false)

    await rescanLocalArtwork(
      {
        scanPath: 'D:/scan',
        checkCancelled
      },
      10,
      '/local'
    )

    expect(scanLocalArtworkMediaDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        checkCancelled
      })
    )
  })
})
