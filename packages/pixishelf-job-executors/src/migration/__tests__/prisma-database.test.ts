import { describe, expect, it, vi } from 'vitest'
import {
  buildMigrationArtworkWhere,
  createPrismaMigrationDatabase,
  createPrismaMigrationSelectionPort
} from '../prisma-database.js'
import { MigrationActionRequiredError } from '../types.js'

describe('Prisma migration database adapter', () => {
  it('builds the same frozen canonical QUERY predicate used by selection and precheck', () => {
    const where = buildMigrationArtworkWhere(
      {
        mode: 'QUERY',
        upperArtworkId: 500,
        filters: {
          search: 'sky',
          artistName: 'artist',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          externalId: '123',
          mediaTypes: ['.jpg', '.mp4'],
          exactMatch: false
        }
      },
      100
    )

    expect(where).toMatchObject({
      deletedAt: null,
      id: { gt: 100, lte: 500 },
      externalRefs: { some: { providerKey: 'pixiv', externalId: '123' } },
      artist: { is: { OR: expect.any(Array) } },
      OR: expect.any(Array),
      images: { some: { OR: expect.any(Array) } },
      sourceDate: { gte: new Date('2026-01-01T00:00:00.000Z'), lt: new Date('2026-02-01T00:00:00.000Z') }
    })
  })

  it('normalizes fractional mtime to BigInt before persistence and round-trips it as an integer', async () => {
    const update = vi.fn().mockResolvedValue({})
    const adapter = createPrismaMigrationDatabase(databaseMock())

    await adapter.checkpointFile({ migrationFileEntry: { update } } as never, {
      fileId: 'file-1',
      status: 'STAGED',
      attempt: 2,
      sourceSize: 10,
      sourceMtimeMs: 1_234.875,
      sourceSha256: 'a'.repeat(64),
      stagedSha256: 'a'.repeat(64)
    })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceSize: 10n, sourceMtimeMs: 1_234n })
      })
    )
  })

  it('bounds artwork images and persisted file checkpoints at the database query', async () => {
    const artworkFindUnique = vi.fn().mockResolvedValue({
      id: 1,
      deletedAt: null,
      createdVia: 'PIXIV_SCAN',
      storageKey: null,
      externalRefs: [{ externalId: '123' }],
      artist: {
        id: 7,
        mergedIntoId: null,
        mergedInto: null,
        externalRefs: [{ externalId: 'artist' }],
        localImportMappings: []
      },
      images: []
    })
    const planFindUnique = vi.fn().mockResolvedValue(null)
    const adapter = createPrismaMigrationDatabase(
      databaseMock({
        artwork: { count: vi.fn(), findMany: vi.fn(), findUnique: artworkFindUnique },
        migrationJobItem: {
          findUnique: planFindUnique,
          count: vi.fn(),
          groupBy: vi.fn(),
          findMany: vi.fn()
        }
      })
    )

    await adapter.loadArtwork({ artwork: { findUnique: artworkFindUnique, updateMany: vi.fn() } } as never, 1, 101)
    await adapter.loadPlan('job-1', 1, 101)

    expect(artworkFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ images: expect.objectContaining({ take: 101 }) }) })
    )
    expect(planFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ include: { files: expect.objectContaining({ take: 101 }) } })
    )
  })

  it('persists a missing local storage key once inside the planning transaction', async () => {
    const before = {
      ...publicationArtwork(),
      id: 1,
      createdVia: 'MANUAL_CREATE' as const,
      storageKey: null,
      images: []
    }
    const after = { ...before, storageKey: 'e_1_1234567' }
    const findUnique = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after)
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const mappingCreate = vi.fn().mockResolvedValue({})
    const adapter = createPrismaMigrationDatabase(databaseMock(), {
      generateStorageKey: () => 'e_1_1234567'
    })

    const result = await adapter.loadArtwork(
      {
        $queryRawUnsafe: vi.fn().mockResolvedValue([]),
        artwork: { findUnique, updateMany },
        localImportArtistMapping: { findUnique: vi.fn().mockResolvedValue(null), create: mappingCreate }
      } as never,
      1,
      101
    )

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 1, deletedAt: null, storageKey: null },
      data: { storageKey: 'e_1_1234567' }
    })
    expect(result).toMatchObject({
      createdVia: 'MANUAL_CREATE',
      artistId: 7,
      storageKey: 'e_1_1234567'
    })
    expect(mappingCreate).toHaveBeenCalledWith({ data: { artistDirectory: 'artist-7', artistId: 7 } })
  })

  it('resolves a merged artist to its active local and Pixiv identity without rebinding mappings', async () => {
    const artwork = {
      ...publicationArtwork(),
      id: 1,
      artist: {
        id: 7,
        mergedIntoId: 8,
        externalRefs: [],
        localImportMappings: [],
        mergedInto: {
          id: 8,
          mergedIntoId: null,
          externalRefs: [{ externalId: 'active-pixiv-artist' }],
          localImportMappings: []
        }
      },
      images: []
    }
    const adapter = createPrismaMigrationDatabase(databaseMock())

    const result = await adapter.loadArtwork(
      { artwork: { findUnique: vi.fn().mockResolvedValue(artwork), updateMany: vi.fn() } } as never,
      1,
      101
    )

    expect(result).toMatchObject({ artistId: 8, artistPixivExternalId: 'active-pixiv-artist' })
  })

  it('treats an already-published target as CAS recovery but rejects a third path', async () => {
    const targetArtwork = publicationArtwork({ imagePath: '/artist/123/page.jpg', storagePath: 'artist/123' })
    const transaction = publicationTransaction(targetArtwork, [persistedFile()])
    const adapter = createPrismaMigrationDatabase(databaseMock())
    const publication = publicationInput()

    await expect(adapter.publishArtwork(transaction as never, publication)).resolves.toBeUndefined()
    expect(transaction.$queryRaw).toHaveBeenCalledOnce()
    expect(transaction.$queryRaw.mock.calls[0]?.[0].sql).toContain('FOR UPDATE')
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(transaction.artwork.findUnique.mock.invocationCallOrder[0]!)
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(transaction.image.updateMany.mock.invocationCallOrder[0]!)
    expect(transaction.migrationFileEntry.updateMany).toHaveBeenCalledOnce()
    expect(transaction.migrationJobItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phase: 'CLEANING_SOURCE' }) })
    )

    transaction.artwork.findUnique.mockResolvedValue(publicationArtwork({ imagePath: '/someone-else/page.jpg' }))
    await expect(adapter.publishArtwork(transaction as never, publication)).rejects.toBeInstanceOf(
      MigrationActionRequiredError
    )
  })

  it('rejects artwork identity or image-membership drift inside the publication transaction', async () => {
    const adapter = createPrismaMigrationDatabase(databaseMock())
    const transaction = publicationTransaction(publicationArtwork({ externalId: 'changed' }), [persistedFile()])
    const publication = publicationInput()

    await expect(adapter.publishArtwork(transaction as never, publication)).rejects.toMatchObject({
      code: 'DATABASE_PATH_CONFLICT'
    })
    expect(transaction.image.updateMany).not.toHaveBeenCalled()

    transaction.artwork.findUnique.mockResolvedValue(publicationArtwork({ artistExternalId: 'changed-artist' }))
    await expect(adapter.publishArtwork(transaction as never, publication)).rejects.toMatchObject({
      code: 'DATABASE_PATH_CONFLICT'
    })

    transaction.artwork.findUnique.mockResolvedValue(publicationArtwork({ extraImage: true }))
    await expect(adapter.publishArtwork(transaction as never, publication)).rejects.toMatchObject({
      code: 'DATABASE_PATH_CONFLICT'
    })
  })

  it('requires the active local artist mapping to remain stable through publication', async () => {
    const adapter = createPrismaMigrationDatabase(databaseMock())
    const localTarget = '/local-imports/artist-7/e_1_1234567/page.jpg'
    const localArtwork = {
      ...publicationArtwork({ imagePath: localTarget, storagePath: 'local-imports/artist-7/e_1_1234567' }),
      createdVia: 'MANUAL_CREATE' as const,
      storageKey: 'e_1_1234567',
      externalRefs: [],
      artist: {
        ...publicationArtwork().artist,
        externalRefs: [],
        localImportMappings: [{ artistDirectory: 'artist-7' }]
      }
    }
    const localFile = persistedFile({ sourceRelativePath: localTarget, targetRelativePath: localTarget })
    const transaction = publicationTransaction(localArtwork, [localFile])
    const input = {
      ...publicationInput([localFile]),
      targetDirectory: 'local-imports/artist-7/e_1_1234567',
      terminalStatus: 'SKIPPED' as const,
      files: [
        {
          fileId: localFile.id,
          imageId: localFile.imageId,
          sourceStoredPath: localFile.sourceRelativePath,
          targetStoredPath: localFile.targetRelativePath,
          sourceSha256: null
        }
      ]
    }

    await expect(adapter.publishArtwork(transaction as never, input)).resolves.toBeUndefined()

    transaction.artwork.findUnique.mockResolvedValue({
      ...localArtwork,
      artist: { ...localArtwork.artist, localImportMappings: [] }
    })
    await expect(adapter.publishArtwork(transaction as never, input)).rejects.toMatchObject({
      code: 'DATABASE_PATH_CONFLICT'
    })
  })

  it('publishes a missing local storage path and accepts an idempotent retry', async () => {
    const adapter = createPrismaMigrationDatabase(databaseMock())
    const targetDirectory = 'local-imports/artist-7/e_1_1234567'
    const sourcePath = '/legacy/page.jpg'
    const targetPath = `/${targetDirectory}/page.jpg`
    const localIdentity = {
      createdVia: 'MANUAL_CREATE' as const,
      storageKey: 'e_1_1234567',
      externalRefs: [],
      artist: {
        ...publicationArtwork().artist,
        externalRefs: [],
        localImportMappings: [{ artistDirectory: 'artist-7' }]
      }
    }
    const sourceArtwork = {
      ...publicationArtwork({ imagePath: sourcePath, storagePath: null }),
      ...localIdentity
    }
    const targetArtwork = {
      ...publicationArtwork({ imagePath: targetPath, storagePath: targetDirectory }),
      ...localIdentity
    }
    const file = persistedFile({ sourceRelativePath: sourcePath, targetRelativePath: targetPath })
    const transaction = publicationTransaction(sourceArtwork, [file])
    transaction.artwork.findUnique
      .mockResolvedValueOnce(sourceArtwork)
      .mockResolvedValueOnce(targetArtwork)
      .mockResolvedValueOnce(targetArtwork)
      .mockResolvedValueOnce(targetArtwork)
    const input = { ...publicationInput([file]), targetDirectory }

    await expect(adapter.publishArtwork(transaction as never, input)).resolves.toBeUndefined()
    await expect(adapter.publishArtwork(transaction as never, input)).resolves.toBeUndefined()

    expect(transaction.artwork.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ storagePath: null }),
        data: expect.objectContaining({ storagePath: targetDirectory })
      })
    )
    expect(transaction.artwork.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ storagePath: targetDirectory }),
        data: expect.objectContaining({ storagePath: targetDirectory })
      })
    )
  })

  it('CAS-updates chaptersPath, metaSource, and storagePath and rechecks their final values', async () => {
    const adapter = createPrismaMigrationDatabase(databaseMock())
    const sourceArtwork = publicationArtwork({
      imagePath: '/source/page.jpg',
      chaptersPath: '/source/page.chapters.json',
      metaSource: 'source/123_meta.json',
      storagePath: 'source'
    })
    const targetArtwork = publicationArtwork({
      imagePath: '/artist/123/page.jpg',
      chaptersPath: '/artist/123/page.chapters.json',
      metaSource: 'artist/123/123_meta.json',
      storagePath: 'artist/123'
    })
    const files = [
      persistedFile({ sourceRelativePath: '/source/page.jpg' }),
      persistedFile({
        id: 'chapters-1',
        imageId: null,
        sourceRelativePath: '/source/page.chapters.json',
        targetRelativePath: '/artist/123/page.chapters.json'
      }),
      persistedFile({
        id: 'meta-1',
        imageId: null,
        sourceRelativePath: 'source/123_meta.json',
        targetRelativePath: '/artist/123/123_meta.json'
      })
    ]
    const transaction = publicationTransaction(sourceArtwork, files)
    transaction.artwork.findUnique.mockResolvedValueOnce(sourceArtwork).mockResolvedValueOnce(targetArtwork)

    await adapter.publishArtwork(transaction as never, publicationInput(files))

    expect(transaction.image.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ chaptersPath: '/source/page.chapters.json' }),
        data: {
          path: '/artist/123/page.jpg',
          chaptersPath: '/artist/123/page.chapters.json'
        }
      })
    )
    expect(transaction.artwork.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ metaSource: 'source/123_meta.json', storagePath: 'source' }),
        data: { metaSource: 'artist/123/123_meta.json', storagePath: 'artist/123' }
      })
    )
  })

  it('rejects a concurrent Image path drift before any migration checkpoint becomes terminal', async () => {
    const adapter = createPrismaMigrationDatabase(databaseMock())
    const transaction = publicationTransaction(publicationArtwork({ imagePath: '/old/page.jpg' }), [persistedFile()])
    transaction.image.updateMany.mockResolvedValue({ count: 0 })

    await expect(adapter.publishArtwork(transaction as never, publicationInput())).rejects.toMatchObject({
      code: 'DATABASE_PATH_CONFLICT'
    })

    expect(transaction.migrationFileEntry.updateMany).not.toHaveBeenCalled()
    expect(transaction.migrationJobItem.updateMany).not.toHaveBeenCalled()
  })

  it('rechecks the complete artwork immediately before writing terminal file or item states', async () => {
    const adapter = createPrismaMigrationDatabase(databaseMock())
    const source = publicationArtwork({ imagePath: '/old/page.jpg' })
    const driftedFinal = publicationArtwork({ imagePath: '/other/page.jpg' })
    const transaction = publicationTransaction(source, [persistedFile()])
    transaction.artwork.findUnique.mockResolvedValueOnce(source).mockResolvedValueOnce(driftedFinal)

    await expect(adapter.publishArtwork(transaction as never, publicationInput())).rejects.toMatchObject({
      code: 'DATABASE_PATH_CONFLICT'
    })

    expect(transaction.migrationFileEntry.updateMany).not.toHaveBeenCalled()
    expect(transaction.migrationJobItem.updateMany).not.toHaveBeenCalled()
  })

  it('rejects uncovered scan-root references and incomplete persisted plan collections', async () => {
    const adapter = createPrismaMigrationDatabase(databaseMock())
    const uncovered = publicationTransaction(publicationArtwork({ metaSource: '/unrelated/metadata.json' }), [
      persistedFile()
    ])
    await expect(adapter.publishArtwork(uncovered as never, publicationInput())).rejects.toMatchObject({
      code: 'DATABASE_PATH_CONFLICT'
    })
    expect(uncovered.image.updateMany).not.toHaveBeenCalled()

    const incomplete = publicationTransaction(publicationArtwork(), [])
    await expect(adapter.publishArtwork(incomplete as never, publicationInput())).rejects.toMatchObject({
      code: 'DATABASE_PATH_CONFLICT'
    })
    expect(incomplete.image.updateMany).not.toHaveBeenCalled()
  })

  it('validates an all-canonical artwork and its complete file set before atomically marking it skipped', async () => {
    const adapter = createPrismaMigrationDatabase(databaseMock())
    const canonical = publicationArtwork({ imagePath: '/artist/123/page.jpg', storagePath: 'artist/123' })
    const canonicalFile = persistedFile({
      sourceRelativePath: '/artist/123/page.jpg',
      targetRelativePath: '/artist/123/page.jpg'
    })
    const transaction = publicationTransaction(canonical, [canonicalFile])

    await adapter.publishArtwork(transaction as never, {
      ...publicationInput(),
      terminalStatus: 'SKIPPED',
      files: [
        {
          fileId: canonicalFile.id,
          imageId: canonicalFile.imageId,
          sourceStoredPath: canonicalFile.sourceRelativePath,
          targetStoredPath: canonicalFile.targetRelativePath,
          sourceSha256: null
        }
      ]
    })

    expect(transaction.artwork.findUnique).toHaveBeenCalledTimes(2)
    expect(transaction.migrationFileEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', cleanedAt: expect.any(Date) }) })
    )
    expect(transaction.migrationJobItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED', phase: 'FINALIZING' }) })
    )
  })

  it('atomically closes every unfinished file with a terminal item', async () => {
    const fileUpdateMany = vi.fn().mockResolvedValue({ count: 2 })
    const itemUpdate = vi.fn().mockResolvedValue({})
    const adapter = createPrismaMigrationDatabase(databaseMock())

    await adapter.closeItemAndFiles(
      { migrationFileEntry: { updateMany: fileUpdateMany }, migrationJobItem: { update: itemUpdate } } as never,
      {
        itemId: 'item-1',
        status: 'CANCELLED',
        phase: 'CLEANING_SOURCE',
        attempt: 2,
        errorCode: 'CANCELLED',
        errorSummary: 'C:\\secret\\token=abc'
      }
    )

    expect(fileUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: 'item-1', status: { not: 'COMPLETED' } },
        data: expect.objectContaining({ status: 'FAILED', errorCode: 'CANCELLED' })
      })
    )
    const persisted = itemUpdate.mock.calls[0]![0].data
    expect(persisted.errorSummary).not.toContain('secret')
    expect(Buffer.byteLength(persisted.errorSummary, 'utf8')).toBeLessThanOrEqual(512)
  })

  it('uses formal source identities for canonical precheck counts', async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
    const port = createPrismaMigrationSelectionPort(databaseMock({ artwork: { count, findMany: vi.fn() } }))
    const result = await port.precheck({ mode: 'ARTWORK_IDS', artworkIds: [1, 2] })

    expect(result).toEqual({ total: 10, eligible: 6, missingArtist: 2, missingExternalId: 1, missingImages: 1 })
    expect(count.mock.calls[1]![0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({ createdVia: 'PIXIV_SCAN', externalRefs: { some: { providerKey: 'pixiv' } } })
              ])
            })
          ])
        })
      })
    )
  })
})

function persistedFile(
  overrides: Partial<{
    id: string
    imageId: number | null
    sourceRelativePath: string
    targetRelativePath: string
  }> = {}
) {
  return {
    id: 'file-1',
    imageId: 11 as number | null,
    sourceRelativePath: '/old/page.jpg',
    targetRelativePath: '/artist/123/page.jpg',
    ...overrides
  }
}

function publicationInput(files = [persistedFile()]) {
  return {
    itemId: 'item-1',
    artworkId: 1,
    targetDirectory: 'artist/123',
    plannedImageIds: [11],
    attempt: 2,
    files: files.map((file) => ({
      fileId: file.id,
      imageId: file.imageId,
      sourceStoredPath: file.sourceRelativePath,
      targetStoredPath: file.targetRelativePath,
      sourceSha256: 'b'.repeat(64)
    }))
  }
}

function publicationArtwork(
  overrides: Partial<{
    externalId: string
    artistExternalId: string
    imagePath: string
    chaptersPath: string | null
    metaSource: string | null
    storagePath: string | null
    extraImage: boolean
  }> = {}
) {
  const image = {
    id: 11,
    path: overrides.imagePath ?? '/old/page.jpg',
    chaptersPath: overrides.chaptersPath ?? null
  }
  return {
    artistId: 7,
    deletedAt: null,
    createdVia: 'PIXIV_SCAN' as const,
    storageKey: null,
    externalRefs: [{ externalId: overrides.externalId ?? '123' }],
    metaSource: overrides.metaSource ?? null,
    storagePath: overrides.storagePath ?? null,
    artist: {
      id: 7,
      mergedIntoId: null,
      mergedInto: null,
      externalRefs: [{ externalId: overrides.artistExternalId ?? 'artist' }],
      localImportMappings: []
    },
    images: overrides.extraImage ? [image, { id: 12, path: '/old/page-2.jpg', chaptersPath: null }] : [image]
  }
}

function publicationTransaction(
  artwork: object,
  files: ReturnType<typeof persistedFile>[]
) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 1, mediaRevision: 1 }]),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    artwork: {
      findUnique: vi.fn().mockResolvedValue(artwork),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    image: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    migrationFileEntry: {
      findMany: vi.fn().mockResolvedValue(files),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    migrationJobItem: {
      findUnique: vi.fn().mockResolvedValue({ artworkIdSnapshot: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    }
  }
}

function databaseMock(overrides: Record<string, unknown> = {}) {
  return {
    artwork: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    image: {},
    migrationJobItem: { findUnique: vi.fn(), count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    migrationFileEntry: {},
    $queryRaw: vi.fn(),
    ...overrides
  } as never
}
