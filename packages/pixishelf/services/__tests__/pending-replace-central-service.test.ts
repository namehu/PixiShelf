import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueueJob: vi.fn(),
  cancelJobCommand: vi.fn(),
  getSystemSettings: vi.fn(),
  transaction: {
    $queryRawUnsafe: vi.fn(),
    systemJob: { findFirst: vi.fn() },
    pendingReplaceOperation: { findFirst: vi.fn(), create: vi.fn() },
    pendingReplaceBatch: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    pendingReplaceItem: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn()
    }
  },
  prisma: {
    $transaction: vi.fn(),
    pendingReplaceOperation: { findFirst: vi.fn() },
    pendingReplaceItem: { findFirst: vi.fn(), count: vi.fn() }
  }
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/services/setting.service', () => ({ getSystemSettings: mocks.getSystemSettings }))
vi.mock('@/services/background-task/job-command-service', () => ({
  enqueueJob: mocks.enqueueJob,
  cancelJobCommand: mocks.cancelJobCommand
}))

import {
  cancelCentralPendingReplaceBatch,
  enqueueCentralPendingReplaceBatch,
  enqueueCentralPendingReplaceCleanup,
  enqueueCentralPendingReplacePreview,
  enqueueCentralPendingReplaceRestore,
  lockCentralPendingReplacePreviewMutation,
  recoverCentralPendingReplaceBatch
} from '../pending-replace-central-service'

describe('central pending replacement commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.$transaction.mockImplementation((operation) => operation(mocks.transaction))
    mocks.transaction.systemJob.findFirst.mockResolvedValue(null)
    mocks.transaction.pendingReplaceOperation.findFirst.mockResolvedValue(null)
    mocks.transaction.pendingReplaceOperation.create.mockResolvedValue({})
    mocks.transaction.pendingReplaceBatch.update.mockResolvedValue({})
    mocks.transaction.pendingReplaceItem.updateMany.mockResolvedValue({ count: 1 })
    mocks.enqueueJob.mockResolvedValue({ id: 'job-1', status: 'PENDING' })
    mocks.getSystemSettings.mockResolvedValue({ replace_default_tag_ids: [9, 3, 9] })
  })

  it('atomically creates DISCOVER job, queued event command, batch, and operation', async () => {
    mocks.transaction.pendingReplaceBatch.create.mockResolvedValue({ id: 'batch-1' })
    const result = await enqueueCentralPendingReplacePreview('admin-1')
    expect(result).toMatchObject({ batchId: 'batch-1', jobId: 'job-1', reused: false })
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PENDING_REPLACE',
        requestedByUserId: 'admin-1',
        payload: { mode: 'DISCOVER', batchId: 'batch-1', sourceRoot: 'pending-replaces' }
      }),
      expect.objectContaining({ $transaction: expect.any(Function) })
    )
    expect(mocks.transaction.pendingReplaceOperation.create).toHaveBeenCalledWith({
      data: { systemJobId: 'job-1', batchId: 'batch-1', itemId: null, mode: 'DISCOVER' }
    })
  })

  it('freezes the exact canonical BATCH selection and append tags in its operation transaction', async () => {
    mocks.transaction.pendingReplaceBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      status: 'PREVIEWED',
      items: [
        { id: 'item-b', status: 'READY', createdAt: new Date(2) },
        { id: 'item-a', status: 'READY', createdAt: new Date(1) }
      ]
    })
    const result = await enqueueCentralPendingReplaceBatch({
      batchId: 'batch-1',
      itemIds: ['item-b', 'item-a'],
      requestedByUserId: 'admin-1'
    })
    expect(result.reused).toBe(false)
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { mode: 'BATCH', batchId: 'batch-1', itemIds: ['item-a', 'item-b'], appendTagIds: [3, 9] }
      }),
      expect.anything()
    )
    expect(mocks.transaction.pendingReplaceOperation.create).toHaveBeenCalledWith({
      data: { systemJobId: 'job-1', batchId: 'batch-1', itemId: null, mode: 'BATCH' }
    })
  })

  it('binds RESTORE to the composite batch/item ownership and CLEANUP to the batch', async () => {
    mocks.transaction.pendingReplaceItem.findUnique.mockResolvedValue({
      id: 'item-1',
      batchId: 'batch-1',
      status: 'SUCCESS',
      backupDirectory: '/replace-backups/batch-1/item-1'
    })
    await enqueueCentralPendingReplaceRestore({ itemId: 'item-1', requestedByUserId: 'admin-1' })
    expect(mocks.transaction.pendingReplaceOperation.create).toHaveBeenLastCalledWith({
      data: { systemJobId: 'job-1', batchId: 'batch-1', itemId: 'item-1', mode: 'RESTORE' }
    })

    vi.clearAllMocks()
    mocks.prisma.$transaction.mockImplementation((operation) => operation(mocks.transaction))
    mocks.transaction.pendingReplaceBatch.findUnique.mockResolvedValue({ id: 'batch-1' })
    mocks.transaction.pendingReplaceItem.count.mockResolvedValue(1)
    mocks.transaction.systemJob.findFirst.mockResolvedValue(null)
    mocks.transaction.pendingReplaceOperation.findFirst.mockResolvedValue(null)
    mocks.enqueueJob.mockResolvedValue({ id: 'job-2', status: 'PENDING' })
    await enqueueCentralPendingReplaceCleanup({ batchId: 'batch-1', requestedByUserId: 'admin-1' })
    expect(mocks.transaction.pendingReplaceOperation.create).toHaveBeenLastCalledWith({
      data: { systemJobId: 'job-2', batchId: 'batch-1', itemId: null, mode: 'CLEANUP' }
    })
  })

  it('does not steal a live recovery lease and uses the unified cancel command', async () => {
    mocks.prisma.pendingReplaceOperation.findFirst.mockResolvedValueOnce({
      systemJob: { id: 'job-live', status: 'RUNNING' }
    })
    await expect(
      recoverCentralPendingReplaceBatch({ batchId: 'batch-1', requestedByUserId: 'admin-1' })
    ).resolves.toEqual(expect.objectContaining({ jobId: 'job-live', reused: true, recovery: 'LEASE_MANAGED' }))
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()

    mocks.prisma.pendingReplaceOperation.findFirst.mockResolvedValueOnce({ systemJob: { id: 'job-live' } })
    mocks.cancelJobCommand.mockResolvedValue({ id: 'job-live', status: 'CANCELLING' })
    await expect(cancelCentralPendingReplaceBatch('batch-1')).resolves.toEqual({
      success: true,
      jobId: 'job-live',
      status: 'CANCELLING'
    })
    expect(mocks.cancelJobCommand).toHaveBeenCalledWith({ jobId: 'job-live' })
  })

  it('rolls back every domain row when operation creation fails', async () => {
    mocks.transaction.pendingReplaceBatch.create.mockResolvedValue({ id: 'batch-rollback' })
    mocks.transaction.pendingReplaceOperation.create.mockRejectedValue(new Error('operation constraint'))
    await expect(enqueueCentralPendingReplacePreview('admin-1')).rejects.toThrow('operation constraint')
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mocks.transaction.pendingReplaceBatch.update).not.toHaveBeenCalled()
  })

  it('serializes preview mutations with enqueue and rejects edits after an operation is active', async () => {
    mocks.transaction.pendingReplaceOperation.findFirst.mockResolvedValue({ systemJobId: 'job-active' })
    await expect(lockCentralPendingReplacePreviewMutation(mocks.transaction as never, 'batch-1')).rejects.toThrow(
      'already in progress'
    )
    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1)::text',
      expect.any(Number)
    )
    expect(mocks.transaction.pendingReplaceOperation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ batchId: 'batch-1' }) })
    )
  })
})
