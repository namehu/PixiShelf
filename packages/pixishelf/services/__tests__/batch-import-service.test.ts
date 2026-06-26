import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getScanPath: vi.fn(),
  mkdir: vi.fn(),
  transaction: vi.fn(),
  artworkFindMany: vi.fn(),
  syncMediaDerivedTagsForArtworks: vi.fn(),
  generateLocalExternalId: vi.fn(),
  startScanRun: vi.fn(),
  appendScanRunItems: vi.fn(),
  completeScanRunSummary: vi.fn(),
  failScanRun: vi.fn(),
  updateScanRunItemMedia: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    artwork: {
      findMany: mocks.artworkFindMany
    }
  }
}))

vi.mock('@/services/setting.service', () => ({
  getScanPath: mocks.getScanPath
}))

vi.mock('fs/promises', () => ({
  default: {
    mkdir: mocks.mkdir
  },
  mkdir: mocks.mkdir
}))

vi.mock('../artwork-service/utils', () => ({
  generateLocalExternalId: mocks.generateLocalExternalId
}))

vi.mock('../media-derived-tag-service', () => ({
  syncMediaDerivedTagsForArtworks: mocks.syncMediaDerivedTagsForArtworks
}))

vi.mock('../scan-run-service', () => ({
  startScanRun: mocks.startScanRun,
  appendScanRunItems: mocks.appendScanRunItems,
  completeScanRunSummary: mocks.completeScanRunSummary,
  failScanRun: mocks.failScanRun,
  updateScanRunItemMedia: mocks.updateScanRunItemMedia
}))

import { batchCreateArtworksService, batchRegisterImagesService } from '../batch-import-service'

describe('batch-import-service audit integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getScanPath.mockResolvedValue('D:/scan')
    mocks.mkdir.mockResolvedValue(undefined)
    mocks.generateLocalExternalId.mockReturnValue('local_10')
    mocks.startScanRun.mockResolvedValue({ id: 'run-1' })
    mocks.appendScanRunItems.mockResolvedValue({ count: 1 })
    mocks.completeScanRunSummary.mockResolvedValue({ id: 'run-1' })
    mocks.updateScanRunItemMedia.mockResolvedValue({ count: 1 })
    mocks.syncMediaDerivedTagsForArtworks.mockResolvedValue(undefined)
  })

  it('returns a scanRunId and records created batch import items', async () => {
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        artwork: {
          create: vi.fn().mockResolvedValue({ id: 10, title: 'Work' }),
          update: vi.fn().mockResolvedValue({ id: 10 })
        },
        artworkTag: {
          createMany: vi.fn().mockResolvedValue({ count: 1 })
        }
      })
    )

    const result = await batchCreateArtworksService({
      artworks: [
        {
          tempId: 'tmp-1',
          title: 'Work',
          artistId: 1,
          artistUserId: 'artist',
          tagIds: [2],
          sourceDate: '2024-01-02'
        }
      ]
    })

    expect(result.scanRunId).toBe('run-1')
    expect(result.artworks).toHaveLength(1)
    expect(mocks.appendScanRunItems).toHaveBeenCalledWith([
      expect.objectContaining({
        scanRunId: 'run-1',
        externalId: 'local_10',
        title: 'Work',
        status: 'SUCCESS',
        action: 'CREATE',
        mediaCount: 0
      })
    ])
    expect(mocks.completeScanRunSummary).toHaveBeenCalledWith('run-1', {
      totalArtworks: 1,
      durationMs: undefined,
      newImages: 0
    })
  })

  it('updates batch import items with registered image counts and completes the run', async () => {
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        artwork: {
          findUnique: vi.fn().mockResolvedValue({ id: 10 })
        },
        image: {
          createMany: vi.fn().mockResolvedValue({ count: 2 })
        }
      })
    )
    mocks.artworkFindMany.mockResolvedValue([{ id: 10, externalId: 'local_10' }])

    await expect(
      batchRegisterImagesService({
        scanRunId: 'run-1',
        items: [
          {
            artworkId: 10,
            images: [
              { path: 'artist/local_10/local_10_p0.jpg', size: 100 },
              { path: 'artist/local_10/local_10_p1.jpg', size: 200 }
            ]
          }
        ]
      })
    ).resolves.toEqual({ success: true })

    expect(mocks.updateScanRunItemMedia).toHaveBeenCalledWith({
      scanRunId: 'run-1',
      externalId: 'local_10',
      mediaCount: 2,
      newImageCount: 2
    })
    expect(mocks.completeScanRunSummary).toHaveBeenCalledWith('run-1', {
      totalArtworks: 1,
      durationMs: undefined,
      newImages: 2
    })
  })

  it('fails the scan run and rejects when image registration fails', async () => {
    mocks.transaction.mockRejectedValue(new Error('disk write failed'))
    mocks.artworkFindMany.mockResolvedValue([
      { id: 10, externalId: 'local_10', title: 'Work', storagePath: 'artist/local_10' }
    ])

    await expect(
      batchRegisterImagesService({
        scanRunId: 'run-1',
        items: [
          {
            artworkId: 10,
            images: [{ path: 'artist/local_10/local_10_p0.jpg', size: 100 }]
          }
        ]
      })
    ).rejects.toThrow('disk write failed')

    expect(mocks.appendScanRunItems).toHaveBeenCalledWith([
      expect.objectContaining({
        scanRunId: 'run-1',
        externalId: 'local_10',
        status: 'FAILED',
        action: 'FAILED_WRITE',
        errorMessage: 'disk write failed'
      })
    ])
    expect(mocks.failScanRun).toHaveBeenCalledWith('run-1', 'disk write failed')
  })
})
