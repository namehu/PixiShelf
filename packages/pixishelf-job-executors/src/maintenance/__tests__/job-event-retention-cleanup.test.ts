import { describe, expect, it, vi } from 'vitest'
import {
  cleanupJobEvents,
  JOB_EVENT_RETENTION_BATCH_SIZE,
  JOB_LIFECYCLE_EVENT_RETENTION_DAYS,
  JOB_PROGRESS_EVENT_RETENTION_DAYS
} from '../job-event-retention-cleanup.js'
import type { RunMaintenanceMutation } from '../types.js'

describe('job event retention cleanup', () => {
  it('reports candidates without deleting during the required dry run', async () => {
    const deleteMany = vi.fn()
    const mutate = vi.fn() as unknown as RunMaintenanceMutation
    const result = await cleanupJobEvents({
      database: {
        systemJobEvent: { count: vi.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(3) }
      } as never,
      mutate,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dryRun: true,
      now: new Date('2026-09-04T00:00:00.000Z')
    })

    expect(result).toEqual({
      dryRun: true,
      progressCandidates: 12,
      lifecycleCandidates: 3,
      deletedProgressEvents: 0,
      deletedLifecycleEvents: 0
    })
    expect(mutate).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('uses separate cutoffs and bounded fenced deletion batches', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1n }, { id: 2n }])
      .mockResolvedValueOnce([{ id: 3n }])
    const deleteMany = vi.fn(async ({ where }: { where: { id: { in: bigint[] } } }) => ({
      count: where.id.in.length
    }))
    const now = new Date('2026-09-04T00:00:00.000Z')
    const result = await cleanupJobEvents({
      database: {
        systemJobEvent: { count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1), findMany }
      } as never,
      mutate: (async (operation) =>
        operation({ systemJobEvent: { deleteMany } } as never)) satisfies RunMaintenanceMutation,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dryRun: false,
      now
    })

    expect(result).toMatchObject({ deletedProgressEvents: 2, deletedLifecycleEvents: 1 })
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          type: 'job.progress',
          level: 'INFO',
          createdAt: { lt: new Date(now.getTime() - JOB_PROGRESS_EVENT_RETENTION_DAYS * 86_400_000) }
        },
        take: JOB_EVENT_RETENTION_BATCH_SIZE
      })
    )
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          OR: [{ type: { not: 'job.progress' } }, { level: { in: ['WARN', 'ERROR'] } }],
          createdAt: { lt: new Date(now.getTime() - JOB_LIFECYCLE_EVENT_RETENTION_DAYS * 86_400_000) }
        },
        take: JOB_EVENT_RETENTION_BATCH_SIZE
      })
    )
  })
})
