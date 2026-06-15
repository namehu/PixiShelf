import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  artistFindUnique: vi.fn(),
  mappingFindMany: vi.fn(),
  mappingUpsert: vi.fn(),
  artworkFindUnique: vi.fn(),
  transaction: vi.fn(),
  discover: vi.fn(),
  scan: vi.fn(),
  updateImages: vi.fn(),
  generateExternalId: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artist: { findUnique: mocks.artistFindUnique },
    localImportArtistMapping: {
      findMany: mocks.mappingFindMany,
      upsert: mocks.mappingUpsert
    },
    artwork: { findUnique: mocks.artworkFindUnique },
    $transaction: mocks.transaction
  }
}))
vi.mock('./discovery', () => ({ discoverLocalImports: mocks.discover }))
vi.mock('@/services/artwork-service/local-media-scanner', () => ({
  scanLocalArtworkMediaDirectory: mocks.scan
}))
vi.mock('@/services/artwork-service/image-manager', () => ({
  updateArtworkImagesWithTransactionClient: mocks.updateImages
}))
vi.mock('@/services/artwork-service/utils', () => ({
  generateLocalExternalId: mocks.generateExternalId
}))

import { runLocalImport, saveLocalImportArtistMapping } from './index'

const discovery = {
  importRoot: 'D:/scan/local-imports',
  importRootDisplay: 'scanPath/local-imports',
  artists: [
    {
      artistDirectory: 'Artist',
      mapping: { artistId: 3, artistName: 'Artist Name' },
      works: [
        {
          workDirectory: 'Work',
          title: 'Work',
          storagePath: 'local-imports/Artist/Work',
          status: 'new',
          mediaFiles: ['1.jpg'],
          mediaCount: 1
        }
      ]
    }
  ],
  counts: { artists: 1, works: 1, new: 1, existing: 0, invalid: 0, media: 1 }
} as const

describe('local import service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.artistFindUnique.mockResolvedValue({ id: 3 })
    mocks.mappingUpsert.mockResolvedValue({ artistDirectory: 'Artist', artistId: 3 })
    mocks.mappingFindMany.mockResolvedValue([
      { artistDirectory: 'Artist', artistId: 3, artist: { id: 3, name: 'Artist Name' } }
    ])
    mocks.artworkFindUnique.mockResolvedValue(null)
    mocks.discover.mockResolvedValue(discovery)
    mocks.scan.mockResolvedValue({
      filesMeta: [{ fileName: '1.jpg', order: 1, width: 10, height: 20, size: 30, path: '/x/1.jpg' }],
      chaptersMeta: [],
      warnings: [],
      earliestMediaMtime: new Date('2024-01-02T03:04:05.000Z')
    })
    mocks.generateExternalId.mockReturnValue('e_10_1234567')
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        artwork: {
          create: vi.fn().mockResolvedValue({ id: 10 }),
          update: vi.fn().mockResolvedValue({ id: 10 })
        }
      })
    )
  })

  it('validates the artist and upserts a directory mapping', async () => {
    await saveLocalImportArtistMapping({ artistDirectory: 'Artist', artistId: 3 })

    expect(mocks.artistFindUnique).toHaveBeenCalledWith({ where: { id: 3 }, select: { id: true } })
    expect(mocks.mappingUpsert).toHaveBeenCalledWith({
      where: { artistDirectory: 'Artist' },
      create: { artistDirectory: 'Artist', artistId: 3 },
      update: { artistId: 3 },
      include: { artist: true }
    })
  })

  it('scans outside a short transaction and imports artwork plus images', async () => {
    const result = await runLocalImport({
      scanPath: 'D:/scan',
      defaultTagIds: [4, 7]
    })

    expect(mocks.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        scanPath: 'D:/scan',
        targetDirectoryRelativePath: 'local-imports/Artist/Work'
      })
    )
    expect(mocks.transaction.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.scan.mock.invocationCallOrder[0]!)
    expect(mocks.updateImages).toHaveBeenCalledWith(
      expect.anything(),
      10,
      expect.any(Array),
      [],
      { appendTagIds: [4, 7] }
    )
    expect(result).toMatchObject({
      total: 1,
      candidates: 1,
      imported: 1,
      skipped: 0,
      failed: 0,
      newImages: 1,
      errors: []
    })
  })

  it('throws cancellation and treats a storagePath unique race as skipped', async () => {
    const checkCancelled = vi.fn().mockResolvedValue(false)
    mocks.transaction.mockRejectedValueOnce({ code: 'P2002', meta: { target: ['storagePath'] } })

    await expect(runLocalImport({ scanPath: 'D:/scan', checkCancelled })).resolves.toMatchObject({
      imported: 0,
      skipped: 1,
      failed: 0
    })

    checkCancelled.mockResolvedValue(true)
    await expect(runLocalImport({ scanPath: 'D:/scan', checkCancelled })).rejects.toThrow('Task cancelled')
  })
})
