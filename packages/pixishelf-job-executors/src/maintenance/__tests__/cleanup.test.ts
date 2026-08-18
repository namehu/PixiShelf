import { describe, expect, it, vi } from 'vitest'
import {
  ARCHIVE_INTAKE_RETENTION_DELETE_BATCH_SIZE,
  cleanupArchiveIntakeHistory
} from '../archive-intake-retention-cleanup.js'
import { cleanupScanRunHistory, SCAN_RUN_DELETE_BATCH_SIZE } from '../scan-run-cleanup.js'
import { cleanupTriggerLogs, TRIGGER_LOG_DELETE_BATCH_SIZE } from '../trigger-log-cleanup.js'
import type { RunMaintenanceMutation } from '../types.js'

describe('maintenance retention cleanup', () => {
  it('deletes intake history in bounded fenced batches and repeats every safety predicate', async () => {
    const readPages = {
      bulk: [[{ id: 'bulk-1' }], []],
      item: [[{ id: 'item-1' }], []],
      submission: [[{ id: 'submission-1' }], []],
      preview: [[{ id: 'preview-1' }], []]
    }
    const archiveBulkOperationFindMany = vi.fn(async (_input: unknown) => readPages.bulk.shift() ?? [])
    const archiveIntakeItemFindMany = vi.fn(async (_input: unknown) => readPages.item.shift() ?? [])
    const archiveIntakeSubmissionFindMany = vi.fn(async (_input: unknown) => readPages.submission.shift() ?? [])
    const archivePreviewSessionFindMany = vi.fn(async (_input: unknown) => readPages.preview.shift() ?? [])
    const deletionOrder: string[] = []
    const archiveBulkOperationDeleteMany = vi.fn(async () => {
      deletionOrder.push('bulk')
      return { count: 1 }
    })
    const archiveIntakeItemDeleteMany = vi.fn(async () => {
      deletionOrder.push('item')
      return { count: 1 }
    })
    const archiveIntakeSubmissionDeleteMany = vi.fn(async () => {
      deletionOrder.push('submission')
      return { count: 1 }
    })
    const archivePreviewSessionDeleteMany = vi.fn(async () => {
      deletionOrder.push('preview')
      return { count: 1 }
    })
    const mutate = vi.fn<RunMaintenanceMutation>(async (operation) =>
      operation({
        archiveBulkOperation: { deleteMany: archiveBulkOperationDeleteMany },
        archiveIntakeItem: { deleteMany: archiveIntakeItemDeleteMany },
        archiveIntakeSubmission: { deleteMany: archiveIntakeSubmissionDeleteMany },
        archivePreviewSession: { deleteMany: archivePreviewSessionDeleteMany }
      } as never)
    )
    const now = new Date('2026-08-18T00:00:00.000Z')
    const cutoff = new Date('2026-07-19T00:00:00.000Z')

    const result = await cleanupArchiveIntakeHistory({
      database: {
        archiveBulkOperation: { findMany: archiveBulkOperationFindMany },
        archiveIntakeItem: { findMany: archiveIntakeItemFindMany },
        archiveIntakeSubmission: { findMany: archiveIntakeSubmissionFindMany },
        archivePreviewSession: { findMany: archivePreviewSessionFindMany }
      } as never,
      mutate: mutate as never,
      signal: new AbortController().signal,
      progress: vi.fn(),
      now
    })

    expect(result).toEqual({
      deletedBulkOperations: 1,
      deletedIntakeItems: 1,
      deletedSubmissions: 1,
      deletedPreviewSessions: 1,
      retentionDays: 30,
      cutoff: cutoff.toISOString()
    })
    expect(deletionOrder).toEqual(['bulk', 'item', 'submission', 'preview'])
    for (const findMany of [
      archiveBulkOperationFindMany,
      archiveIntakeItemFindMany,
      archiveIntakeSubmissionFindMany,
      archivePreviewSessionFindMany
    ]) {
      expect(findMany.mock.calls[0]![0]).toEqual(
        expect.objectContaining({
          take: ARCHIVE_INTAKE_RETENTION_DELETE_BATCH_SIZE
        })
      )
    }
    expect(archiveBulkOperationDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['bulk-1'] }, completedAt: { lt: cutoff } }
    })
    expect(archiveIntakeItemDeleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['item-1'] },
        status: { in: ['FAILED', 'ENQUEUED', 'CANCELLED', 'DUPLICATE'] },
        finishedAt: { lt: cutoff }
      }
    })
    expect(archiveIntakeSubmissionDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['submission-1'] }, createdAt: { lt: cutoff }, items: { none: {} } }
    })
    expect(archivePreviewSessionDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['preview-1'] }, expiresAt: { lte: now } }
    })
  })

  it('does not enter any intake deletion after the execution fence is stale', async () => {
    const deleteMany = vi.fn()
    const staleFence = new Error('stale fence')

    await expect(
      cleanupArchiveIntakeHistory({
        database: {
          archiveBulkOperation: { findMany: vi.fn().mockResolvedValue([{ id: 'bulk-1' }]) }
        } as never,
        mutate: vi.fn().mockRejectedValue(staleFence) as never,
        signal: new AbortController().signal,
        progress: vi.fn(),
        now: new Date('2026-08-18T00:00:00.000Z')
      })
    ).rejects.toBe(staleFence)

    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('deletes trigger logs in bounded fenced batches and stops on cancellation', async () => {
    const controller = new AbortController()
    const pages = [
      Array.from({ length: TRIGGER_LOG_DELETE_BATCH_SIZE }, (_, id) => ({ id: id + 1 })),
      [{ id: TRIGGER_LOG_DELETE_BATCH_SIZE + 1 }]
    ]
    const findMany = vi.fn(async () => pages.shift() ?? [])
    const deleteMany = vi.fn(async ({ where }: { where: { id: { in: number[] } } }) => ({
      count: where.id.in.length
    }))
    const mutate = vi.fn<RunMaintenanceMutation>(async (operation) =>
      operation({ triggerLog: { deleteMany } } as never)
    )
    const progress = vi.fn(async ({ stage }: { stage: string }) => {
      if (stage === 'DELETING') controller.abort(new Error('cancel requested'))
    })

    await expect(
      cleanupTriggerLogs({
        database: { triggerLog: { count: vi.fn().mockResolvedValue(501), findMany } } as never,
        mutate: mutate as never,
        signal: controller.signal,
        progress,
        now: new Date('2026-08-14T00:00:00.000Z')
      })
    ).rejects.toThrow('cancel requested')

    expect(findMany).toHaveBeenCalledOnce()
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: TRIGGER_LOG_DELETE_BATCH_SIZE }))
    expect(deleteMany).toHaveBeenCalledOnce()
  })

  it('never enters a delete callback after the execution fence is stale', async () => {
    const deleteMany = vi.fn()
    const staleFence = new Error('stale fence')
    await expect(
      cleanupTriggerLogs({
        database: {
          triggerLog: {
            count: vi.fn().mockResolvedValue(1),
            findMany: vi.fn().mockResolvedValue([{ id: 1 }])
          }
        } as never,
        mutate: vi.fn().mockRejectedValue(staleFence) as never,
        signal: new AbortController().signal,
        progress: vi.fn(),
        now: new Date('2026-08-14T00:00:00.000Z')
      })
    ).rejects.toBe(staleFence)
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('bounds both expired and per-type overflow scan-run pages', async () => {
    const expired = [{ id: 'expired-1' }]
    const overflow = [{ id: 'overflow-1' }]
    let expiredRead = false
    const overflowRead = new Set<string>()
    const findMany = vi.fn(
      async ({ where }: { where: { finishedAt?: unknown; type?: string }; take: number; skip?: number }) => {
        if (where.finishedAt) {
          if (expiredRead) return []
          expiredRead = true
          return expired
        }
        if (!where.type || overflowRead.has(where.type)) return []
        overflowRead.add(where.type)
        return where.type === 'PIXIV' ? overflow : []
      }
    )
    const deleteMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({ count: where.id.in.length }))
    const result = await cleanupScanRunHistory({
      database: { scanRun: { findMany } } as never,
      mutate: (async (operation) => operation({ scanRun: { deleteMany } } as never)) satisfies RunMaintenanceMutation,
      signal: new AbortController().signal,
      progress: vi.fn(),
      now: new Date('2026-08-14T00:00:00.000Z'),
      maxRunsPerType: 100
    })

    expect(result).toEqual({ deletedRuns: 2, expiredRuns: 1, overflowRuns: 1 })
    for (const [args] of findMany.mock.calls) {
      expect(args.take).toBe(SCAN_RUN_DELETE_BATCH_SIZE)
    }
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: SCAN_RUN_DELETE_BATCH_SIZE }))
  })
})
