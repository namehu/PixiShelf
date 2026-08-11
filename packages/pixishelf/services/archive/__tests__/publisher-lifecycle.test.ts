import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildArchiveStoragePaths, pathExists } from '../storage'
import {
  purgeExpiredArchiveTrash,
  reconcileArchiveLifecycle,
  reconcilePendingArchiveCleanups,
  requestExpiredArchiveCleanups,
  trashPublishedArchive
} from '../publisher'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    artwork: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn()
    },
    archiveRevision: { update: vi.fn(), updateMany: vi.fn() },
    archiveImport: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    archiveImportItem: { updateMany: vi.fn() },
    systemJob: { updateMany: vi.fn() },
    $queryRawUnsafe: vi.fn(),
    $transaction: vi.fn()
  }
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const temporaryDirectories: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
  prismaMock.$queryRawUnsafe.mockResolvedValue([])
  prismaMock.archiveImport.findFirst.mockResolvedValue(null)
  prismaMock.archiveRevision.update.mockResolvedValue({})
  prismaMock.archiveRevision.updateMany.mockResolvedValue({ count: 2 })
  prismaMock.artwork.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.archiveImport.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.systemJob.updateMany.mockResolvedValue({ count: 1 })
})

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('archive publication lifecycle', () => {
  it('lets the read-only web path persist intent before the worker moves every immutable revision', async () => {
    const scanRoot = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-archive-trash-'))
    temporaryDirectories.push(scanRoot)
    const revisions = [
      revision('rev-a', 'sources/e-hentai/creator-a/42/revisions/rev-a'),
      revision('rev-b', 'sources/e-hentai/creator-b/42/revisions/rev-b')
    ]
    await Promise.all(revisions.map((item) => mkdir(path.join(scanRoot, item.archivePath), { recursive: true })))
    const deletedAt = new Date('2026-08-11T00:00:00.000Z')
    prismaMock.artwork.findUnique
      .mockResolvedValueOnce({
        id: 7,
        createdVia: 'URL_ARCHIVE',
        archiveLifecycleState: 'ACTIVE',
        deletedAt: null,
        archiveRevisions: revisions
      })
      .mockResolvedValueOnce({
        id: 7,
        createdVia: 'URL_ARCHIVE',
        archiveLifecycleState: 'TRASHING',
        deletedAt,
        archiveRevisions: revisions.map((item) => ({
          ...item,
          trashPath: `.trash/archive/7/${item.id}`
        }))
      })

    await trashPublishedArchive(7)

    expect(prismaMock.archiveRevision.update).toHaveBeenCalledTimes(2)
    expect(prismaMock.artwork.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ archiveLifecycleState: 'TRASHING' })
    }))
    for (const item of revisions) {
      expect(await pathExists(path.join(scanRoot, item.archivePath))).toBe(true)
      expect(await pathExists(path.join(scanRoot, `.trash/archive/7/${item.id}`))).toBe(false)
    }

    await reconcileArchiveLifecycle(7, scanRoot)

    expect(prismaMock.artwork.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: { archiveLifecycleState: 'TRASHED' }
    }))
    for (const item of revisions) {
      expect(await pathExists(path.join(scanRoot, item.archivePath))).toBe(false)
      expect(await pathExists(path.join(scanRoot, `.trash/archive/7/${item.id}`))).toBe(true)
    }
  })

  it('idempotently restores every revision and clears the durable intent', async () => {
    const scanRoot = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-archive-restore-'))
    temporaryDirectories.push(scanRoot)
    const revisions = [
      revision('rev-a', 'sources/e-hentai/creator-a/42/revisions/rev-a', '.trash/archive/7/rev-a'),
      revision('rev-b', 'sources/e-hentai/creator-b/42/revisions/rev-b', '.trash/archive/7/rev-b')
    ]
    await Promise.all(revisions.map((item) => mkdir(path.join(scanRoot, item.trashPath!), { recursive: true })))
    prismaMock.artwork.findUnique.mockResolvedValue({
      id: 7,
      createdVia: 'URL_ARCHIVE',
      archiveLifecycleState: 'RESTORING',
      deletedAt: new Date(),
      archiveRevisions: revisions
    })

    await reconcileArchiveLifecycle(7, scanRoot)

    expect(prismaMock.archiveRevision.updateMany).toHaveBeenCalledWith({
      where: { artworkId: 7 },
      data: { trashPath: null, trashedAt: null, purgeAfter: null }
    })
    expect(prismaMock.artwork.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
    }))
    for (const item of revisions) {
      expect(await pathExists(path.join(scanRoot, item.archivePath))).toBe(true)
      expect(await pathExists(path.join(scanRoot, item.trashPath!))).toBe(false)
    }
  })

  it.each(['', '.', '   '])('refuses to purge a revision path that resolves to the media root: %j', async (archivePath) => {
    const scanRoot = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-archive-root-guard-'))
    temporaryDirectories.push(scanRoot)
    const sentinel = path.join(scanRoot, 'keep.txt')
    await writeFile(sentinel, 'keep')
    prismaMock.artwork.findMany.mockResolvedValue([{ id: 7 }])
    prismaMock.artwork.findFirst.mockResolvedValue({
      id: 7,
      createdVia: 'URL_ARCHIVE',
      archiveLifecycleState: 'TRASHED',
      deletedAt: new Date(),
      archiveRevisions: [{ id: 'rev-a', archivePath, trashPath: null }]
    })

    await expect(purgeExpiredArchiveTrash(scanRoot)).rejects.toMatchObject({ code: 'INTERNAL' })
    expect(await pathExists(scanRoot)).toBe(true)
    expect(await pathExists(sentinel)).toBe(true)
    expect(prismaMock.artwork.deleteMany).not.toHaveBeenCalled()
  })

  it('lets the worker idempotently fulfill a durable staging cleanup intent', async () => {
    const scanRoot = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-archive-cleanup-'))
    temporaryDirectories.push(scanRoot)
    const paths = buildArchiveStoragePaths({
      scanRoot,
      importId: 'import-1',
      providerKey: 'e-hentai',
      creatorBucket: 'creator-a',
      externalId: '42'
    })
    await mkdir(path.join(scanRoot, '.archive-staging/import-1'), { recursive: true })
    await mkdir(paths.finalAbsolutePath, { recursive: true })
    prismaMock.archiveImport.findMany.mockResolvedValue([{ id: 'import-1' }])
    prismaMock.archiveImport.findFirst.mockResolvedValue({
      id: 'import-1',
      systemJobId: 'job-1',
      providerKey: 'e-hentai',
      creatorBucket: 'creator-a',
      externalId: '42',
      stagingPath: '.archive-staging/import-1',
      cleanupRequestedAt: new Date(),
      status: 'FAILED',
      systemJob: { status: 'FAILED' }
    })

    const result = await reconcilePendingArchiveCleanups(scanRoot)

    expect(result).toEqual({ reconciled: 1, failures: [] })
    expect(await pathExists(path.join(scanRoot, '.archive-staging/import-1'))).toBe(false)
    expect(await pathExists(paths.finalAbsolutePath)).toBe(false)
    expect(prismaMock.archiveImportItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { archiveImportId: 'import-1' },
      data: expect.objectContaining({ status: 'PENDING', attempts: 0, stagedPath: null })
    }))
    expect(prismaMock.archiveImport.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { cleanupRequestedAt: null, completedItems: 0, failedItems: 0, retainUntil: null }
    }))
  })

  it('turns expired retention into the same fenced cleanup intent without deleting files', async () => {
    const now = new Date('2026-08-11T00:00:00.000Z')
    prismaMock.archiveImport.findMany.mockResolvedValue([{ id: 'import-1', systemJobId: 'job-1' }])

    const requested = await requestExpiredArchiveCleanups(now)

    expect(requested).toBe(1)
    expect(prismaMock.archiveImport.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'import-1',
        status: { in: ['FAILED', 'CANCELLED'] },
        retainUntil: { lte: now },
        cleanupRequestedAt: null
      },
      data: { cleanupRequestedAt: now }
    })
    expect(prismaMock.archiveImportItem.updateMany).not.toHaveBeenCalled()
  })
})

function revision(id: string, archivePath: string, trashPath: string | null = null) {
  return {
    id,
    archivePath,
    trashPath,
    externalRef: { providerKey: 'e-hentai', externalId: '42' }
  }
}
