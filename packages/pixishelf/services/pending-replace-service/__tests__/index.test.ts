import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PendingReplaceBatchStatus, PendingReplaceItemStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  batch: null as any,
  itemUpdateMany: vi.fn(),
  batchUpdate: vi.fn(),
  runBatch: vi.fn(),
  syncCounters: vi.fn(),
  createJob: vi.fn(),
  touchHeartbeat: vi.fn(),
  finalizeJob: vi.fn(),
  prepareBinding: vi.fn(),
  item: null as any,
  batchLock: vi.fn(),
  duplicateBinding: null as any
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pendingReplaceBatch: { findUnique: async () => mocks.batch },
    pendingReplaceItem: { findUnique: async () => mocks.item },
    $transaction: async (callback: any) =>
      callback({
        pendingReplaceBatch: { updateMany: mocks.batchLock },
        pendingReplaceItem: {
          findFirst: async () => mocks.duplicateBinding,
          updateMany: mocks.itemUpdateMany
        }
      })
  }
}))

vi.mock('@/services/job-service', () => ({
  createPendingReplaceJob: mocks.createJob,
  touchJobHeartbeat: mocks.touchHeartbeat,
  finalizePendingReplaceJob: mocks.finalizeJob,
  hasPendingReplaceJobLease: vi.fn().mockResolvedValue(true),
  getJob: vi.fn().mockResolvedValue(null)
}))

vi.mock('../discovery', () => ({
  preparePendingReplaceBinding: mocks.prepareBinding,
  previewPendingReplacements: vi.fn()
}))

vi.mock('../executor', () => ({
  PendingReplaceCommitOutcomeUnknownError: class extends Error {},
  PendingReplaceLeaseLostError: class extends Error {},
  cleanupPendingReplaceBackups: vi.fn(),
  recoverInterruptedPendingReplaceBatch: vi.fn(),
  restorePendingReplaceItem: vi.fn(),
  runPendingReplaceBatch: mocks.runBatch,
  settleFailedPendingReplaceRestore: vi.fn(),
  syncPendingReplaceBatchCounters: mocks.syncCounters
}))

import { bindPendingReplaceItem, startPendingReplaceBatch, unbindPendingReplaceItem } from '../index'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.batch = {
    id: 'batch-1',
    status: PendingReplaceBatchStatus.CANCELLED,
    items: [
      { id: 'failed-item', status: PendingReplaceItemStatus.FAILED },
      { id: 'unselected-ready-item', status: PendingReplaceItemStatus.READY }
    ]
  }
  mocks.item = null
  mocks.duplicateBinding = null
  mocks.batchLock.mockResolvedValue({ count: 1 })
  mocks.prepareBinding.mockResolvedValue({
    artworkId: 42,
    externalId: 'external-42',
    artworkTitle: 'Target artwork',
    artistName: 'Artist',
    targetDirectory: '/artist/target',
    fingerprint: 'fingerprint',
    sourceManifest: [{ name: 'new.jpg', kind: 'media', targetName: 'external-42_p0.jpg' }],
    oldMediaSnapshot: [{ path: '/artist/target/old.jpg' }],
    newMediaSnapshot: [{ path: '/pending-replaces/source/new.jpg' }],
    targetFileSnapshot: [{ name: 'old.jpg' }],
    warnings: []
  })
  mocks.itemUpdateMany.mockResolvedValue({ count: 1 })
  mocks.batchUpdate.mockResolvedValue(mocks.batch)
  mocks.syncCounters.mockResolvedValue({})
  mocks.touchHeartbeat.mockResolvedValue({ count: 1 })
  mocks.finalizeJob.mockResolvedValue(true)
  mocks.runBatch.mockResolvedValue({
    batchId: 'batch-1',
    total: 1,
    succeeded: 1,
    failed: 0,
    excluded: 1,
    cancelled: false,
    backupBytes: 0,
    processingTime: 1
  })
  mocks.createJob.mockImplementation(async (_targetId, _mode, initialize) => {
    const job = { id: 'job-1', attempt: 1 }
    await initialize(
      {
        pendingReplaceItem: { updateMany: mocks.itemUpdateMany },
        pendingReplaceBatch: { update: mocks.batchUpdate }
      },
      job
    )
    return job
  })
})

describe('startPendingReplaceBatch', () => {
  it('excludes unselected ready items when retrying a cancelled batch subset', async () => {
    await startPendingReplaceBatch({
      scanPath: 'D:/media',
      batchId: 'batch-1',
      itemIds: ['failed-item']
    })

    expect(mocks.itemUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { batchId: 'batch-1', id: { in: ['failed-item'] } },
      data: {
        status: PendingReplaceItemStatus.READY,
        included: true,
        error: null,
        finishedAt: null
      }
    })
    expect(mocks.itemUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        batchId: 'batch-1',
        status: PendingReplaceItemStatus.READY,
        id: { notIn: ['failed-item'] }
      },
      data: { status: PendingReplaceItemStatus.EXCLUDED, included: false }
    })
  })
})

describe('bindPendingReplaceItem', () => {
  it('turns an unbound preview item into a ready replacement item', async () => {
    mocks.item = {
      id: 'item-1',
      batchId: 'batch-1',
      sourceDirectoryName: 'original-folder',
      status: PendingReplaceItemStatus.INVALID,
      batch: { status: PendingReplaceBatchStatus.PREVIEWED }
    }

    await expect(
      bindPendingReplaceItem({ scanPath: 'D:/media', itemId: 'item-1', artworkId: 42 })
    ).resolves.toEqual({ success: true, batchId: 'batch-1', itemId: 'item-1' })

    expect(mocks.prepareBinding).toHaveBeenCalledWith({
      scanPath: 'D:/media',
      sourceDirectoryName: 'original-folder',
      artworkId: 42
    })
    expect(mocks.itemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'item-1', batchId: 'batch-1' }),
        data: expect.objectContaining({
          artworkId: 42,
          externalId: 'external-42',
          status: PendingReplaceItemStatus.READY,
          included: true,
          error: null
        })
      })
    )
  })
})

describe('unbindPendingReplaceItem', () => {
  it('returns a bound preview item to the unbound queue without touching source files', async () => {
    mocks.item = {
      id: 'item-1',
      batchId: 'batch-1',
      artworkId: 42,
      status: PendingReplaceItemStatus.READY,
      batch: { status: PendingReplaceBatchStatus.PREVIEWED }
    }

    await expect(unbindPendingReplaceItem({ itemId: 'item-1' })).resolves.toEqual({
      success: true,
      batchId: 'batch-1',
      itemId: 'item-1'
    })

    expect(mocks.itemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'item-1', batchId: 'batch-1' }),
        data: expect.objectContaining({
          artworkId: null,
          externalId: null,
          targetDirectory: null,
          status: PendingReplaceItemStatus.INVALID,
          included: false
        })
      })
    )
  })
})
