import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { PendingReplaceBatchStatus, PendingReplaceItemStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  item: null as any,
  batch: null as any,
  scanPendingDirectory: vi.fn(),
  createFingerprint: vi.fn(),
  scanTargetDirectory: vi.fn(),
  updateArtworkImages: vi.fn(),
  itemUpdate: vi.fn(),
  batchUpdate: vi.fn(),
  batchFindUnique: vi.fn(),
  currentImages: [] as any[],
  claimStaleJob: vi.fn(),
  failJob: vi.fn(),
  touchHeartbeat: vi.fn(),
  completeJob: vi.fn(),
  finalizeJob: vi.fn(),
  failTransactionResponseAfterCallback: false
}))

vi.mock('@/services/job-service', () => ({
  claimStalePendingReplaceJob: mocks.claimStaleJob,
  failJob: mocks.failJob,
  touchJobHeartbeat: mocks.touchHeartbeat,
  completeJob: mocks.completeJob,
  finalizePendingReplaceJob: mocks.finalizeJob,
  hasPendingReplaceJobLease: vi.fn().mockResolvedValue(true)
}))

vi.mock('@/services/pending-replace-service/discovery', () => ({
  scanPendingReplaceDirectory: mocks.scanPendingDirectory,
  createManifestFingerprint: mocks.createFingerprint
}))

vi.mock('@/services/artwork-service/local-media-scanner', () => ({
  scanLocalArtworkMediaDirectory: mocks.scanTargetDirectory
}))

vi.mock('@/services/artwork-service/image-manager', () => ({
  updateArtworkImagesWithTransactionClient: mocks.updateArtworkImages
}))

vi.mock('@/lib/prisma', () => {
  const itemUpdate = async ({ data }: any) => {
    Object.assign(mocks.item, data)
    mocks.itemUpdate(data)
    return mocks.item
  }
  const tx = {
    image: { findMany: async () => mocks.currentImages },
    systemJob: { updateMany: async () => ({ count: 1 }) },
    pendingReplaceItem: {
      update: itemUpdate,
      updateMany: async ({ where, data }: any) => {
        if (where?.id?.in && !where.id.in.includes(mocks.item.id)) return { count: 0 }
        Object.assign(mocks.item, data)
        return { count: 1 }
      }
    },
    pendingReplaceBatch: { update: async ({ data }: any) => mocks.batchUpdate(data) }
  }
  return {
    prisma: {
      pendingReplaceItem: {
        findUnique: async () => mocks.item,
        findMany: async () =>
          mocks.item?.status === PendingReplaceItemStatus.SUCCESS && mocks.item.backupDirectory
            ? [
                {
                  id: mocks.item.id,
                  externalId: mocks.item.externalId,
                  backupDirectory: mocks.item.backupDirectory,
                  targetFileSnapshot: mocks.item.targetFileSnapshot
                }
              ]
            : [],
        update: itemUpdate,
        updateMany: async ({ data }: any) => {
          Object.assign(mocks.item, data)
          return { count: 1 }
        },
        groupBy: async () => [{ status: mocks.item.status, _count: { _all: 1 } }]
      },
      pendingReplaceBatch: {
        findUnique: mocks.batchFindUnique,
        findUniqueOrThrow: async () => mocks.batch,
        update: async ({ data }: any) => {
          if (mocks.batch) Object.assign(mocks.batch, data)
          mocks.batchUpdate(data)
          return mocks.batch
        }
      },
      $transaction: async (input: any) => {
        const result = Array.isArray(input) ? await Promise.all(input) : await input(tx)
        if (mocks.failTransactionResponseAfterCallback) {
          mocks.failTransactionResponseAfterCallback = false
          throw new Error('commit response lost')
        }
        return result
      }
    }
  }
})

import {
  cleanupPendingReplaceBackups,
  recoverInterruptedPendingReplaceBatch,
  restorePendingReplaceItem,
  runPendingReplaceItem
} from '../executor'

const temporaryDirectories: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.failTransactionResponseAfterCallback = false
  mocks.createFingerprint.mockReturnValue('source-fingerprint')
  mocks.batchFindUnique.mockImplementation(async () => mocks.batch)
  mocks.claimStaleJob.mockResolvedValue({ id: 'job-1', attempt: 2 })
  mocks.touchHeartbeat.mockResolvedValue({ count: 1 })
  mocks.failJob.mockResolvedValue(undefined)
  mocks.completeJob.mockResolvedValue(undefined)
  mocks.finalizeJob.mockImplementation(async (_jobId, _attempt, _finalization, onFinalized) => {
    if (onFinalized) {
      await onFinalized({
        pendingReplaceBatch: {
          update: async ({ data }: any) => {
            if (mocks.batch) Object.assign(mocks.batch, data)
            return mocks.batch
          }
        }
      })
    }
    return true
  })
  mocks.updateArtworkImages.mockResolvedValue(undefined)
  mocks.scanTargetDirectory.mockResolvedValue({
    filesMeta: [
      { fileName: '123_p0.jpg', path: '/artist/work/123_p0.jpg', order: 0, width: 1, height: 1, size: 3 }
    ],
    chaptersMeta: [],
    warnings: [],
    earliestMediaMtime: new Date()
  })
  mocks.currentImages = [
    {
      path: '/artist/work/old.jpg',
      sortOrder: 0,
      size: BigInt(3),
      width: 1,
      height: 1,
      mediaType: 'IMAGE',
      chaptersPath: null
    }
  ]
})

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('runPendingReplaceItem', () => {
  it('moves new media into place and old media into a batch backup', async () => {
    const fixture = await createFixture()
    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    await expect(fs.readFile(path.join(fixture.targetDirectory, '123_p0.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(path.join(fixture.backupDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    await expect(fs.stat(fixture.pendingDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.SUCCESS)
    expect(mocks.updateArtworkImages).toHaveBeenCalledOnce()
  })

  it('restores source and old media when the database transaction fails', async () => {
    const fixture = await createFixture()
    mocks.updateArtworkImages.mockRejectedValueOnce(new Error('database failed'))

    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    await expect(fs.readFile(path.join(fixture.pendingDirectory, 'new.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(path.join(fixture.targetDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    await expect(fs.stat(path.join(fixture.targetDirectory, '123_p0.jpg'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.FAILED)
    expect(mocks.item.error).toContain('database failed')
  })

  it('keeps the emergency backup reference when an old file is missing during rollback', async () => {
    const fixture = await createFixture()
    mocks.updateArtworkImages.mockImplementationOnce(async () => {
      await fs.rm(path.join(fixture.backupDirectory, 'old.jpg'))
      throw new Error('database failed')
    })

    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    expect(mocks.item.status).toBe(PendingReplaceItemStatus.FAILED)
    expect(mocks.item.backupDirectory).toBe('/replace-backups/batch-1/123')
    expect(mocks.item.error).toContain('必须且只能存在于目标或应急备份之一')
    await expect(fs.stat(fixture.backupDirectory)).resolves.toBeTruthy()
  })

  it('freezes every affected target file, including media absent from the database', async () => {
    const fixture = await createFixture()
    const unmanagedPath = path.join(fixture.targetDirectory, 'unmanaged.png')
    await fs.writeFile(unmanagedPath, 'unmanaged')
    const stats = await fs.stat(unmanagedPath)
    mocks.item.targetFileSnapshot.push({
      name: 'unmanaged.png',
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      sha256: createHash('sha256').update('unmanaged').digest('hex')
    })
    mocks.updateArtworkImages.mockRejectedValueOnce(new Error('database failed'))

    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    await expect(fs.readFile(unmanagedPath, 'utf8')).resolves.toBe('unmanaged')
    await expect(fs.readFile(path.join(fixture.targetDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.FAILED)
  })

  it('rejects target media added after preview before moving the source directory', async () => {
    const fixture = await createFixture()
    await fs.writeFile(path.join(fixture.targetDirectory, 'late.png'), 'late')

    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    await expect(fs.readFile(path.join(fixture.pendingDirectory, 'new.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(path.join(fixture.targetDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.FAILED)
    expect(mocks.item.error).toContain('目标目录在预检后发生变化')
  })

  it('does not mistake an existing canonical target file for staged new media', async () => {
    const fixture = await createFixture()
    await fs.rename(
      path.join(fixture.targetDirectory, 'old.jpg'),
      path.join(fixture.targetDirectory, '123_p0.jpg')
    )
    mocks.item.oldMediaSnapshot[0] = {
      ...mocks.item.oldMediaSnapshot[0],
      sourceName: '123_p0.jpg',
      targetName: '123_p0.jpg',
      path: '/artist/work/123_p0.jpg'
    }
    mocks.itemUpdate
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce((data) => {
        if (data.status === PendingReplaceItemStatus.BACKING_UP) throw new Error('backup transition failed')
      })

    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    await expect(fs.readFile(path.join(fixture.pendingDirectory, 'new.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(path.join(fixture.targetDirectory, '123_p0.jpg'), 'utf8')).resolves.toBe('old')
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.FAILED)
  })

  it('rolls back when artwork media changed after the preview snapshot', async () => {
    const fixture = await createFixture()
    mocks.currentImages = [
      {
        path: '/artist/work/changed.jpg',
        sortOrder: 0,
        size: BigInt(7),
        width: 1,
        height: 1,
        mediaType: 'IMAGE',
        chaptersPath: null
      }
    ]

    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    await expect(fs.readFile(path.join(fixture.pendingDirectory, 'new.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(path.join(fixture.targetDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.FAILED)
    expect(mocks.item.error).toContain('预检后发生变化')
    expect(mocks.updateArtworkImages).not.toHaveBeenCalled()
  })

  it('rejects a same-size physical media change after preview', async () => {
    const fixture = await createFixture()
    const oldPath = path.join(fixture.targetDirectory, 'old.jpg')
    const previewStats = await fs.stat(oldPath)
    mocks.item.oldMediaSnapshot[0].mtimeMs = previewStats.mtimeMs
    await fs.writeFile(oldPath, 'bad')
    const changedAt = new Date(previewStats.mtimeMs + 5_000)
    await fs.utimes(oldPath, changedAt, changedAt)

    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    expect(mocks.item.status).toBe(PendingReplaceItemStatus.FAILED)
    expect(mocks.item.error).toContain('文件在预检后发生变化')
    await expect(fs.readFile(oldPath, 'utf8')).resolves.toBe('bad')
    await expect(fs.readFile(path.join(fixture.pendingDirectory, 'new.jpg'), 'utf8')).resolves.toBe('new')
  })

  it('still rolls files back when persisting the rolling-back state fails', async () => {
    const fixture = await createFixture()
    mocks.updateArtworkImages.mockRejectedValueOnce(new Error('database failed'))
    mocks.itemUpdate.mockImplementation((data) => {
      if (data.status === PendingReplaceItemStatus.ROLLING_BACK) throw new Error('status write failed')
    })

    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    await expect(fs.readFile(path.join(fixture.pendingDirectory, 'new.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(path.join(fixture.targetDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.FAILED)
    expect(mocks.item.error).toContain('记录回滚状态失败')
  })

  it('does not downgrade a committed success when archive-warning persistence fails', async () => {
    const fixture = await createFixture()
    const completedDirectory = path.join(
      fixture.scanPath,
      'completed-replaces',
      'batch-1',
      'work__ext-123--item-1'
    )
    await fs.mkdir(completedDirectory, { recursive: true })
    mocks.itemUpdate.mockImplementation((data) => {
      if (typeof data.error === 'string' && data.error.includes('归档清单失败')) {
        throw new Error('warning write failed')
      }
    })
    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    expect(mocks.item.status).toBe(PendingReplaceItemStatus.SUCCESS)
  })

  it('does not roll files back when the replacement commit response is lost', async () => {
    const fixture = await createFixture()
    mocks.failTransactionResponseAfterCallback = true

    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    expect(mocks.item.status).toBe(PendingReplaceItemStatus.SUCCESS)
    await expect(fs.readFile(path.join(fixture.targetDirectory, '123_p0.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(path.join(fixture.backupDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    await expect(fs.stat(fixture.pendingDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores a successful replacement from its backup', async () => {
    const fixture = await createFixture()
    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })
    mocks.item.batch = { status: PendingReplaceBatchStatus.COMPLETED }
    mocks.currentImages = [
      {
        path: '/artist/work/123_p0.jpg',
        sortOrder: 0,
        size: BigInt(3),
        width: 1,
        height: 1,
        mediaType: 'IMAGE',
        chaptersPath: null
      }
    ]
    mocks.scanTargetDirectory.mockResolvedValueOnce({
      filesMeta: [
        { fileName: 'old.jpg', path: '/artist/work/old.jpg', order: 0, width: 1, height: 1, size: 3 }
      ],
      chaptersMeta: [],
      warnings: [],
      earliestMediaMtime: new Date()
    })

    await restorePendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    await expect(fs.readFile(path.join(fixture.targetDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    await expect(fs.readFile(path.join(fixture.pendingDirectory, 'new.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.stat(path.join(fixture.targetDirectory, '123_p0.jpg'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.RESTORED)
    expect(mocks.updateArtworkImages).toHaveBeenCalledTimes(2)
  })

  it('does not reverse a restore when its commit response is lost', async () => {
    const fixture = await createFixture()
    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })
    mocks.item.batch = { status: PendingReplaceBatchStatus.COMPLETED }
    mocks.currentImages = [
      {
        path: '/artist/work/123_p0.jpg',
        sortOrder: 0,
        size: BigInt(3),
        width: 1,
        height: 1,
        mediaType: 'IMAGE',
        chaptersPath: null
      }
    ]
    mocks.scanTargetDirectory.mockResolvedValueOnce({
      filesMeta: [
        { fileName: 'old.jpg', path: '/artist/work/old.jpg', order: 0, width: 1, height: 1, size: 3 }
      ],
      chaptersMeta: [],
      warnings: [],
      earliestMediaMtime: new Date()
    })
    mocks.failTransactionResponseAfterCallback = true

    await restorePendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })

    expect(mocks.item.status).toBe(PendingReplaceItemStatus.RESTORED)
    await expect(fs.readFile(path.join(fixture.targetDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    await expect(fs.readFile(path.join(fixture.pendingDirectory, 'new.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.stat(fixture.backupDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a restore when the backup content no longer matches its frozen hash', async () => {
    const fixture = await createFixture()
    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })
    await fs.writeFile(path.join(fixture.backupDirectory, 'old.jpg'), 'bad')

    await expect(
      restorePendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })
    ).rejects.toThrow('旧媒体备份内容已发生变化')

    await expect(fs.readFile(path.join(fixture.targetDirectory, '123_p0.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(path.join(fixture.backupDirectory, 'old.jpg'), 'utf8')).resolves.toBe('bad')
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.SUCCESS)
  })

  it('recovers an interrupted swap by returning new media and restoring old media', async () => {
    const fixture = await createFixture()
    const workSource = path.join(fixture.scanPath, '.replace-work', 'batch-1', 'item-1', 'source')
    await fs.mkdir(path.dirname(workSource), { recursive: true })
    await fs.rename(fixture.pendingDirectory, workSource)
    await fs.mkdir(fixture.backupDirectory, { recursive: true })
    await fs.rename(
      path.join(fixture.targetDirectory, 'old.jpg'),
      path.join(fixture.backupDirectory, 'old.jpg')
    )
    await fs.rename(
      path.join(workSource, 'new.jpg'),
      path.join(fixture.targetDirectory, '123_p0.jpg')
    )
    mocks.item.status = PendingReplaceItemStatus.SWAPPING
    mocks.item.backupDirectory = '/replace-backups/batch-1/123'
    mocks.batch = {
      id: 'batch-1',
      status: PendingReplaceBatchStatus.RUNNING,
      backupBytes: BigInt(3),
      items: [mocks.item],
      systemJob: { id: 'job-1', attempt: 2, mode: 'BATCH' }
    }

    const result = await recoverInterruptedPendingReplaceBatch({
      scanPath: fixture.scanPath,
      batchId: 'batch-1',
      staleBefore: new Date(),
      takeoverGraceMs: 0
    })

    expect(result).toEqual({ success: true, recoveredItems: 1 })
    await expect(fs.readFile(path.join(fixture.pendingDirectory, 'new.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(path.join(fixture.targetDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    await expect(fs.stat(path.join(fixture.targetDirectory, '123_p0.jpg'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.FAILED)
    expect(mocks.finalizeJob).toHaveBeenCalledWith(
      'job-1',
      2,
      expect.objectContaining({ status: 'FAILED' }),
      expect.any(Function)
    )
  })

  it('finishes the completion archive after a post-commit process interruption', async () => {
    const fixture = await createFixture()
    const workSource = path.join(fixture.scanPath, '.replace-work', 'batch-1', 'item-1', 'source')
    const completedDirectory = path.join(
      fixture.scanPath,
      'completed-replaces',
      'batch-1',
      'work__ext-123--item-1'
    )
    await fs.mkdir(path.dirname(workSource), { recursive: true })
    await fs.rename(fixture.pendingDirectory, workSource)
    await fs.mkdir(fixture.backupDirectory, { recursive: true })
    await fs.rename(path.join(fixture.targetDirectory, 'old.jpg'), path.join(fixture.backupDirectory, 'old.jpg'))
    await fs.rename(path.join(workSource, 'new.jpg'), path.join(fixture.targetDirectory, '123_p0.jpg'))
    mocks.item.status = PendingReplaceItemStatus.SUCCESS
    mocks.item.backupDirectory = '/replace-backups/batch-1/123'
    mocks.item.completedDirectory = '/completed-replaces/batch-1/work__ext-123--item-1'
    mocks.batch = {
      id: 'batch-1',
      status: PendingReplaceBatchStatus.RUNNING,
      backupBytes: BigInt(3),
      items: [mocks.item],
      systemJob: { id: 'job-1', attempt: 2, mode: 'BATCH' }
    }

    const result = await recoverInterruptedPendingReplaceBatch({
      scanPath: fixture.scanPath,
      batchId: 'batch-1',
      staleBefore: new Date(),
      takeoverGraceMs: 0
    })

    expect(result).toEqual({ success: true, recoveredItems: 0 })
    await expect(fs.readFile(path.join(completedDirectory, 'replace-manifest.json'), 'utf8')).resolves.toContain(
      'item-1'
    )
    expect(mocks.finalizeJob).toHaveBeenCalledWith(
      'job-1',
      2,
      { status: 'COMPLETED', result: { batchId: 'batch-1', recovered: true } },
      expect.any(Function)
    )
  })

  it('rolls an interrupted per-item restore back to the successful replacement state', async () => {
    const fixture = await createFixture()
    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })
    const completedDirectory = path.join(
      fixture.scanPath,
      'completed-replaces',
      'batch-1',
      'work__ext-123--item-1'
    )
    await fs.rename(completedDirectory, fixture.pendingDirectory)
    await fs.rm(path.join(fixture.pendingDirectory, 'replace-manifest.json'))
    await fs.rename(
      path.join(fixture.targetDirectory, '123_p0.jpg'),
      path.join(fixture.pendingDirectory, 'new.jpg')
    )
    await fs.rename(
      path.join(fixture.backupDirectory, 'old.jpg'),
      path.join(fixture.targetDirectory, 'old.jpg')
    )
    mocks.item.status = PendingReplaceItemStatus.RESTORE_SWAPPING
    mocks.batch = {
      id: 'batch-1',
      status: PendingReplaceBatchStatus.RUNNING,
      backupBytes: BigInt(3),
      items: [mocks.item],
      systemJob: { id: 'job-1', attempt: 2, mode: 'RESTORE', targetPath: 'item-1' }
    }

    await recoverInterruptedPendingReplaceBatch({
      scanPath: fixture.scanPath,
      batchId: 'batch-1',
      staleBefore: new Date(),
      takeoverGraceMs: 0
    })

    await expect(fs.readFile(path.join(fixture.targetDirectory, '123_p0.jpg'), 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(path.join(fixture.backupDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    await expect(fs.readFile(path.join(completedDirectory, 'replace-manifest.json'), 'utf8')).resolves.toContain('item-1')
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.SUCCESS)
    expect(mocks.finalizeJob).toHaveBeenCalledWith(
      'job-1',
      2,
      expect.objectContaining({ status: 'FAILED' }),
      expect.any(Function)
    )
  })

  it('re-reads item state after claiming recovery ownership', async () => {
    const fixture = await createFixture()
    const staleItem = { ...mocks.item, status: PendingReplaceItemStatus.RESTORING }
    const staleBatch = {
      id: 'batch-1',
      status: PendingReplaceBatchStatus.RUNNING,
      backupBytes: BigInt(0),
      items: [staleItem],
      systemJob: { id: 'job-1', attempt: 1, mode: 'RESTORE', targetPath: 'item-1' }
    }
    mocks.item.status = PendingReplaceItemStatus.RESTORED
    mocks.batch = {
      ...staleBatch,
      items: [mocks.item],
      systemJob: { id: 'job-1', attempt: 2, mode: 'RESTORE', targetPath: 'item-1' }
    }
    mocks.batchFindUnique.mockResolvedValueOnce(staleBatch).mockResolvedValueOnce(mocks.batch)

    await expect(
      recoverInterruptedPendingReplaceBatch({
        scanPath: fixture.scanPath,
        batchId: 'batch-1',
        staleBefore: new Date(),
        takeoverGraceMs: 0
      })
    ).resolves.toEqual({ success: true, recoveredItems: 0 })

    expect(mocks.item.status).toBe(PendingReplaceItemStatus.RESTORED)
    expect(mocks.finalizeJob).toHaveBeenCalledWith(
      'job-1',
      2,
      { status: 'COMPLETED', result: { batchId: 'batch-1', recovered: true } },
      expect.any(Function)
    )
  })

  it('resumes an interrupted explicit backup cleanup', async () => {
    const fixture = await createFixture()
    await runPendingReplaceItem({ scanPath: fixture.scanPath, itemId: mocks.item.id })
    mocks.batch = {
      id: 'batch-1',
      status: PendingReplaceBatchStatus.RUNNING,
      backupBytes: BigInt(3),
      items: [mocks.item],
      systemJob: { id: 'job-1', attempt: 2, mode: 'CLEANUP' }
    }

    await recoverInterruptedPendingReplaceBatch({
      scanPath: fixture.scanPath,
      batchId: 'batch-1',
      staleBefore: new Date(),
      takeoverGraceMs: 0
    })

    await expect(fs.stat(fixture.backupDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.BACKUP_CLEANED)
    expect(mocks.finalizeJob).toHaveBeenCalledWith(
      'job-1',
      2,
      { status: 'COMPLETED', result: { batchId: 'batch-1', recoveredAction: 'CLEANUP' } },
      expect.any(Function)
    )
  })

  it('does not delete a failed item emergency backup during batch cleanup', async () => {
    const fixture = await createFixture()
    await fs.mkdir(fixture.backupDirectory, { recursive: true })
    await fs.writeFile(path.join(fixture.backupDirectory, 'old.jpg'), 'old')
    mocks.item.status = PendingReplaceItemStatus.FAILED
    mocks.item.backupDirectory = '/replace-backups/batch-1/123'

    await cleanupPendingReplaceBackups({ scanPath: fixture.scanPath, batchId: 'batch-1' })

    await expect(fs.readFile(path.join(fixture.backupDirectory, 'old.jpg'), 'utf8')).resolves.toBe('old')
    expect(mocks.item.status).toBe(PendingReplaceItemStatus.FAILED)
    expect(mocks.item.backupDirectory).toBe('/replace-backups/batch-1/123')
  })
})

async function createFixture() {
  const scanPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pending-executor-'))
  temporaryDirectories.push(scanPath)
  const sourceDirectoryName = 'work__ext-123'
  const pendingDirectory = path.join(scanPath, 'pending-replaces', sourceDirectoryName)
  const targetDirectory = path.join(scanPath, 'artist', 'work')
  const backupDirectory = path.join(scanPath, 'replace-backups', 'batch-1', '123')
  await fs.mkdir(pendingDirectory, { recursive: true })
  await fs.mkdir(targetDirectory, { recursive: true })
  await fs.writeFile(path.join(pendingDirectory, 'new.jpg'), 'new')
  await fs.writeFile(path.join(targetDirectory, 'old.jpg'), 'old')
  const oldStats = await fs.stat(path.join(targetDirectory, 'old.jpg'))
  const oldSha256 = createHash('sha256').update('old').digest('hex')

  const manifest = [
    { name: 'new.jpg', size: 3, mtimeMs: 1, kind: 'media', targetName: '123_p0.jpg' }
  ]
  mocks.scanPendingDirectory.mockResolvedValue({ manifest, media: [], warnings: [] })
  mocks.item = {
    id: 'item-1',
    batchId: 'batch-1',
    artworkId: 1,
    externalId: '123',
    artworkTitle: 'Work',
    sourceDirectory: `/pending-replaces/${sourceDirectoryName}`,
    sourceDirectoryName,
    targetDirectory: '/artist/work',
    status: PendingReplaceItemStatus.READY,
    fingerprint: 'source-fingerprint',
    sourceManifest: manifest,
    oldMediaSnapshot: [
      {
        sourceName: 'old.jpg',
        targetName: 'old.jpg',
        path: '/artist/work/old.jpg',
        size: 3,
        width: 1,
        height: 1,
        order: 0,
        mediaType: 'IMAGE'
      }
    ],
    newMediaSnapshot: [
      {
        sourceName: 'new.jpg',
        targetName: '123_p0.jpg',
        path: `/pending-replaces/${sourceDirectoryName}/new.jpg`,
        size: 3,
        width: 1,
        height: 1,
        order: 0,
        mediaType: 'IMAGE'
      }
    ],
    targetFileSnapshot: [
      {
        name: 'old.jpg',
        size: oldStats.size,
        mtimeMs: oldStats.mtimeMs,
        sha256: oldSha256
      }
    ],
    warnings: [],
    error: null
  }
  mocks.batch = {
    id: 'batch-1',
    status: PendingReplaceBatchStatus.PREVIEWED,
    backupBytes: BigInt(0),
    items: [mocks.item],
    systemJob: null
  }

  return { scanPath, pendingDirectory, targetDirectory, backupDirectory }
}
