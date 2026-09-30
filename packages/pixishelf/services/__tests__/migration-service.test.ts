import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  precheck: vi.fn(),
  buildWhere: vi.fn(),
  artworkFindUnique: vi.fn(),
  artworkUpdate: vi.fn(),
  artworkUpdateMany: vi.fn(),
  imageUpdateMany: vi.fn(),
  artistFindUniqueOrThrow: vi.fn(),
  mappingFindUnique: vi.fn(),
  mappingCreate: vi.fn(),
  pathOwnershipQuery: vi.fn(),
  lockCreatorCatalog: vi.fn(),
  lockArtworkForReading: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: (() => {
    const transactionClient = {
      artwork: {
        findUnique: mocks.artworkFindUnique,
        update: mocks.artworkUpdate,
        updateMany: mocks.artworkUpdateMany
      },
      image: { updateMany: mocks.imageUpdateMany },
      artist: { findUniqueOrThrow: mocks.artistFindUniqueOrThrow },
      localImportArtistMapping: {
        findUnique: mocks.mappingFindUnique,
        create: mocks.mappingCreate
      },
      $queryRaw: mocks.pathOwnershipQuery
    }
    return {
      artwork: {
        aggregate: mocks.aggregate,
        update: mocks.artworkUpdate
      },
      $queryRaw: vi.fn(),
      $transaction: vi.fn((callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient))
    }
  })()
}))

vi.mock('@/lib/logger', () => ({
  migrationLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('@/services/setting.service', () => ({ getScanPath: vi.fn() }))

vi.mock('@pixishelf/job-executors', () => ({
  createPrismaMigrationSelectionPort: vi.fn(() => ({ precheck: mocks.precheck })),
  buildMigrationArtworkWhere: mocks.buildWhere
}))

vi.mock('@pixishelf/db', () => ({
  lockCreatorCatalog: mocks.lockCreatorCatalog,
  lockArtworkForReading: mocks.lockArtworkForReading
}))

import { migrateArtwork, precheckMigration } from '../migration-service'

describe('migration precheck canonical selection', () => {
  const temporaryDirectories: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.aggregate.mockResolvedValue({ _max: { id: 500 } })
    mocks.precheck.mockResolvedValue({
      total: 2,
      eligible: 1,
      missingArtist: 1,
      missingExternalId: 0,
      missingImages: 0
    })
    mocks.lockArtworkForReading.mockResolvedValue({ id: 10, mediaRevision: 1 })
    mocks.imageUpdateMany.mockResolvedValue({ count: 1 })
    mocks.artworkUpdateMany.mockResolvedValue({ count: 1 })
    mocks.pathOwnershipQuery.mockResolvedValue([{ ownedByOther: false }])
  })

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('uses the active merge target for a local artwork and persists its canonical path', async () => {
    mocks.artworkFindUnique.mockResolvedValue({
      id: 10,
      deletedAt: null,
      artistId: 3,
      createdVia: 'MANUAL_CREATE',
      storageKey: 'e_10_1234567',
      storagePath: 'legacy/artist-3/e_10_1234567',
      images: [{ id: 90, path: '/local-imports/artist-8/e_10_1234567/image.jpg' }],
      externalRefs: [],
      artist: { id: 3, externalRefs: [] }
    })
    mocks.artistFindUniqueOrThrow
      .mockResolvedValueOnce({ mergedIntoId: 8, externalRefs: [] })
      .mockResolvedValueOnce({ mergedIntoId: null, externalRefs: [] })
      .mockResolvedValueOnce({ mergedIntoId: 8, externalRefs: [] })
      .mockResolvedValueOnce({ mergedIntoId: null, externalRefs: [] })
    mocks.mappingFindUnique.mockResolvedValueOnce(null).mockResolvedValue({ artistId: 8 })

    await expect(migrateArtwork(10, 'D:\\scan')).resolves.toEqual({
      artworkId: 10,
      status: 'SKIPPED',
      msg: ['路径已符合规范: /local-imports/artist-8/e_10_1234567/image.jpg']
    })

    expect(mocks.lockCreatorCatalog).toHaveBeenCalledTimes(2)
    expect(mocks.mappingCreate).toHaveBeenCalledWith({
      data: { artistDirectory: 'artist-8', artistId: 8 }
    })
    expect(mocks.artworkUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { metaSource: null, storagePath: 'local-imports/artist-8/e_10_1234567' } })
    )
  })

  it('uses the active merge target Pixiv identity', async () => {
    mocks.artworkFindUnique.mockResolvedValue({
      id: 10,
      deletedAt: null,
      artistId: 3,
      createdVia: 'PIXIV_SCAN',
      storageKey: null,
      storagePath: null,
      metaSource: null,
      images: [{ id: 90, path: '/555/999/image.jpg', chaptersPath: null }],
      externalRefs: [{ externalId: '999' }],
      artist: { id: 3, externalRefs: [] }
    })
    mocks.artistFindUniqueOrThrow
      .mockResolvedValueOnce({ mergedIntoId: 8, externalRefs: [] })
      .mockResolvedValueOnce({ mergedIntoId: null, externalRefs: [{ externalId: '555' }] })
      .mockResolvedValueOnce({ mergedIntoId: 8, externalRefs: [] })
      .mockResolvedValueOnce({ mergedIntoId: null, externalRefs: [{ externalId: '555' }] })

    await expect(migrateArtwork(10, 'D:\\scan')).resolves.toMatchObject({ status: 'SKIPPED' })
    expect(mocks.artworkUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { metaSource: null, storagePath: '555/999' } })
    )
  })

  it('moves only persisted references and updates image, chapter, metadata, and storage paths together', async () => {
    const scanRoot = await mkdtemp(path.join(tmpdir(), 'pixishelf-app-migration-'))
    temporaryDirectories.push(scanRoot)
    const sourceDirectory = path.join(scanRoot, 'old')
    await mkdir(sourceDirectory, { recursive: true })
    await Promise.all([
      writeFile(path.join(sourceDirectory, '123_p0.jpg'), 'image'),
      writeFile(path.join(sourceDirectory, 'chapters.json'), 'chapters'),
      writeFile(path.join(sourceDirectory, 'metadata.txt'), 'metadata'),
      writeFile(path.join(sourceDirectory, '1234_p0.jpg'), 'other artwork')
    ])
    mocks.artworkFindUnique.mockResolvedValue({
      id: 10,
      deletedAt: null,
      artistId: 3,
      createdVia: 'PIXIV_SCAN',
      storageKey: null,
      storagePath: 'old',
      metaSource: '/old/metadata.txt',
      images: [{ id: 90, path: '/old/123_p0.jpg', chaptersPath: '/old/chapters.json' }],
      externalRefs: [{ externalId: '123' }],
      artist: { id: 3, externalRefs: [{ externalId: '456' }] }
    })
    mocks.artistFindUniqueOrThrow.mockResolvedValue({
      mergedIntoId: null,
      externalRefs: [{ externalId: '456' }]
    })

    await expect(migrateArtwork(10, scanRoot)).resolves.toMatchObject({ status: 'SUCCESS' })

    await expect(access(path.join(scanRoot, '456', '123', '123_p0.jpg'))).resolves.toBeUndefined()
    await expect(access(path.join(scanRoot, '456', '123', 'chapters.json'))).resolves.toBeUndefined()
    await expect(access(path.join(scanRoot, '456', '123', 'metadata.txt'))).resolves.toBeUndefined()
    await expect(access(path.join(sourceDirectory, '1234_p0.jpg'))).resolves.toBeUndefined()
    expect(mocks.imageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { path: '/456/123/123_p0.jpg', chaptersPath: '/456/123/chapters.json' }
      })
    )
    expect(mocks.artworkUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { metaSource: '/456/123/metadata.txt', storagePath: '456/123' } })
    )
  })

  it('rejects persisted paths that escape the configured media root', async () => {
    mocks.artworkFindUnique.mockResolvedValue({
      id: 10,
      deletedAt: null,
      artistId: 3,
      createdVia: 'PIXIV_SCAN',
      storageKey: null,
      storagePath: null,
      metaSource: null,
      images: [{ id: 90, path: '../escape.jpg', chaptersPath: null }],
      externalRefs: [{ externalId: '123' }],
      artist: { id: 3, externalRefs: [{ externalId: '456' }] }
    })
    mocks.artistFindUniqueOrThrow.mockResolvedValue({
      mergedIntoId: null,
      externalRefs: [{ externalId: '456' }]
    })

    await expect(migrateArtwork(10, 'D:\\scan')).resolves.toEqual({
      artworkId: 10,
      status: 'FAILED',
      msg: ['持久路径包含不安全的目录段']
    })
    expect(mocks.imageUpdateMany).not.toHaveBeenCalled()
    expect(mocks.artworkUpdateMany).not.toHaveBeenCalled()
  })

  it('rejects a persisted source whose symlink escapes the media root', async () => {
    const scanRoot = await mkdtemp(path.join(tmpdir(), 'pixishelf-app-migration-root-'))
    const outside = await mkdtemp(path.join(tmpdir(), 'pixishelf-app-migration-outside-'))
    temporaryDirectories.push(scanRoot, outside)
    await writeFile(path.join(outside, '123_p0.jpg'), 'outside')
    await symlink(outside, path.join(scanRoot, 'old'), process.platform === 'win32' ? 'junction' : 'dir')
    mocks.artworkFindUnique.mockResolvedValue({
      id: 10,
      deletedAt: null,
      artistId: 3,
      createdVia: 'PIXIV_SCAN',
      storageKey: null,
      storagePath: null,
      metaSource: null,
      images: [{ id: 90, path: '/old/123_p0.jpg', chaptersPath: null }],
      externalRefs: [{ externalId: '123' }],
      artist: { id: 3, externalRefs: [{ externalId: '456' }] }
    })
    mocks.artistFindUniqueOrThrow.mockResolvedValue({
      mergedIntoId: null,
      externalRefs: [{ externalId: '456' }]
    })

    await expect(migrateArtwork(10, scanRoot)).resolves.toMatchObject({ status: 'FAILED' })
    await expect(readFile(path.join(outside, '123_p0.jpg'), 'utf8')).resolves.toBe('outside')
    await expect(access(path.join(scanRoot, '456', '123', '123_p0.jpg'))).rejects.toThrow()
    expect(mocks.imageUpdateMany).not.toHaveBeenCalled()
  })

  it('does not overwrite or claim an existing target with different content', async () => {
    const scanRoot = await mkdtemp(path.join(tmpdir(), 'pixishelf-app-migration-collision-'))
    temporaryDirectories.push(scanRoot)
    await mkdir(path.join(scanRoot, 'old'), { recursive: true })
    await mkdir(path.join(scanRoot, '456', '123'), { recursive: true })
    await writeFile(path.join(scanRoot, 'old', '123_p0.jpg'), 'AAAA')
    await writeFile(path.join(scanRoot, '456', '123', '123_p0.jpg'), 'BBBB')
    mocks.artworkFindUnique.mockResolvedValue({
      id: 10,
      deletedAt: null,
      artistId: 3,
      createdVia: 'PIXIV_SCAN',
      storageKey: null,
      storagePath: null,
      metaSource: null,
      images: [{ id: 90, path: '/old/123_p0.jpg', chaptersPath: null }],
      externalRefs: [{ externalId: '123' }],
      artist: { id: 3, externalRefs: [{ externalId: '456' }] }
    })
    mocks.artistFindUniqueOrThrow.mockResolvedValue({
      mergedIntoId: null,
      externalRefs: [{ externalId: '456' }]
    })

    await expect(migrateArtwork(10, scanRoot, { transferMode: 'copy' })).resolves.toMatchObject({ status: 'FAILED' })
    await expect(readFile(path.join(scanRoot, 'old', '123_p0.jpg'), 'utf8')).resolves.toBe('AAAA')
    await expect(readFile(path.join(scanRoot, '456', '123', '123_p0.jpg'), 'utf8')).resolves.toBe('BBBB')
    expect(mocks.imageUpdateMany).not.toHaveBeenCalled()
  })

  it('does not move a source path that another artwork still references', async () => {
    const scanRoot = await mkdtemp(path.join(tmpdir(), 'pixishelf-app-migration-shared-source-'))
    temporaryDirectories.push(scanRoot)
    await mkdir(path.join(scanRoot, 'old'), { recursive: true })
    await writeFile(path.join(scanRoot, 'old', '123_p0.jpg'), 'shared')
    mocks.artworkFindUnique.mockResolvedValue({
      id: 10,
      deletedAt: null,
      artistId: 3,
      createdVia: 'PIXIV_SCAN',
      storageKey: null,
      storagePath: 'old',
      metaSource: null,
      images: [{ id: 90, path: '/old/123_p0.jpg', chaptersPath: null }],
      externalRefs: [{ externalId: '123' }],
      artist: { id: 3, externalRefs: [{ externalId: '456' }] }
    })
    mocks.artistFindUniqueOrThrow.mockResolvedValue({
      mergedIntoId: null,
      externalRefs: [{ externalId: '456' }]
    })
    mocks.pathOwnershipQuery.mockResolvedValueOnce([{ ownedByOther: true }])

    await expect(migrateArtwork(10, scanRoot)).resolves.toEqual({
      artworkId: 10,
      status: 'FAILED',
      msg: ['源路径已被其他作品引用']
    })

    await expect(readFile(path.join(scanRoot, 'old', '123_p0.jpg'), 'utf8')).resolves.toBe('shared')
    await expect(access(path.join(scanRoot, '456', '123', '123_p0.jpg'))).rejects.toThrow()
  })

  it('does not publish to a target path already owned by another artwork in the database', async () => {
    const scanRoot = await mkdtemp(path.join(tmpdir(), 'pixishelf-app-migration-owned-target-'))
    temporaryDirectories.push(scanRoot)
    await mkdir(path.join(scanRoot, 'old'), { recursive: true })
    await writeFile(path.join(scanRoot, 'old', '123_p0.jpg'), 'source')
    mocks.artworkFindUnique.mockResolvedValue({
      id: 10,
      deletedAt: null,
      artistId: 3,
      createdVia: 'PIXIV_SCAN',
      storageKey: null,
      storagePath: 'old',
      metaSource: null,
      images: [{ id: 90, path: '/old/123_p0.jpg', chaptersPath: null }],
      externalRefs: [{ externalId: '123' }],
      artist: { id: 3, externalRefs: [{ externalId: '456' }] }
    })
    mocks.artistFindUniqueOrThrow.mockResolvedValue({
      mergedIntoId: null,
      externalRefs: [{ externalId: '456' }]
    })
    mocks.pathOwnershipQuery
      .mockResolvedValueOnce([{ ownedByOther: false }])
      .mockResolvedValueOnce([{ ownedByOther: true }])

    await expect(migrateArtwork(10, scanRoot)).resolves.toEqual({
      artworkId: 10,
      status: 'FAILED',
      msg: ['目标路径已被其他作品引用']
    })

    await expect(readFile(path.join(scanRoot, 'old', '123_p0.jpg'), 'utf8')).resolves.toBe('source')
    await expect(access(path.join(scanRoot, '456', '123', '123_p0.jpg'))).rejects.toThrow()
  })

  it('rolls files back when the formal source identity changes before publication', async () => {
    const scanRoot = await mkdtemp(path.join(tmpdir(), 'pixishelf-app-migration-cas-'))
    temporaryDirectories.push(scanRoot)
    await mkdir(path.join(scanRoot, 'old'), { recursive: true })
    await writeFile(path.join(scanRoot, 'old', '123_p0.jpg'), 'image')
    const snapshot = {
      id: 10,
      deletedAt: null,
      artistId: 3,
      createdVia: 'PIXIV_SCAN',
      storageKey: null,
      storagePath: 'old',
      metaSource: null,
      images: [{ id: 90, path: '/old/123_p0.jpg', chaptersPath: null }],
      externalRefs: [{ externalId: '123' }],
      artist: { id: 3, externalRefs: [{ externalId: '456' }] }
    }
    mocks.artworkFindUnique
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, externalRefs: [{ externalId: '124' }] })
    mocks.artistFindUniqueOrThrow.mockResolvedValue({
      mergedIntoId: null,
      externalRefs: [{ externalId: '456' }]
    })

    await expect(migrateArtwork(10, scanRoot)).resolves.toMatchObject({ status: 'FAILED' })

    await expect(readFile(path.join(scanRoot, 'old', '123_p0.jpg'), 'utf8')).resolves.toBe('image')
    await expect(access(path.join(scanRoot, '456', '123', '123_p0.jpg'))).rejects.toThrow()
    expect(mocks.imageUpdateMany).not.toHaveBeenCalled()
    expect(mocks.artworkUpdateMany).not.toHaveBeenCalled()
  })

  it('blocks a multi-hop merge chain instead of silently changing the target directory again', async () => {
    mocks.artworkFindUnique.mockResolvedValue({
      id: 10,
      deletedAt: null,
      artistId: 3,
      createdVia: 'LOCAL_DIRECTORY',
      storageKey: 'e_10_1234567',
      storagePath: null,
      images: [{ id: 90, path: '/old/image.jpg' }],
      externalRefs: [],
      artist: { id: 3, externalRefs: [] }
    })
    mocks.artistFindUniqueOrThrow
      .mockResolvedValueOnce({ mergedIntoId: 8, externalRefs: [] })
      .mockResolvedValueOnce({ mergedIntoId: 12, externalRefs: [] })

    await expect(migrateArtwork(10, 'D:\\scan')).rejects.toThrow('艺术家合并关系异常，请先完成维护再迁移')
    expect(mocks.mappingCreate).not.toHaveBeenCalled()
  })

  it('canonicalizes ARTWORK_IDS and delegates all counts to the executor selection port', async () => {
    await expect(precheckMigration({ targetIds: [9, 2, 9] })).resolves.toEqual({
      total: 2,
      eligible: 1,
      missingArtist: 1,
      missingExternalId: 0,
      missingImages: 0
    })

    expect(mocks.precheck).toHaveBeenCalledWith({ mode: 'ARTWORK_IDS', artworkIds: [2, 9] })
    expect(mocks.aggregate).not.toHaveBeenCalled()
  })

  it('passes FAILED_FROM_JOB through the same canonical adapter', async () => {
    await precheckMigration({ selection: { mode: 'FAILED_FROM_JOB', sourceJobId: 'migration-old' } })

    expect(mocks.precheck).toHaveBeenCalledWith({ mode: 'FAILED_FROM_JOB', sourceJobId: 'migration-old' })
  })

  it('freezes QUERY at the current upper id and includes normalized media filters', async () => {
    await precheckMigration({ filters: { search: 'artist-user-id', mediaTypes: 'jpg,png', exactMatch: false } })

    expect(mocks.precheck).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'QUERY',
        upperArtworkId: 500,
        filters: expect.objectContaining({ search: 'artist-user-id', exactMatch: false })
      })
    )
  })
})
