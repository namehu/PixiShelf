import { describe, expect, it, vi } from 'vitest'
import { getJobDashboard, listJobs } from '../job-query-service'
import { jobRecord, workerRecord } from './test-fixtures'

describe('listJobs', () => {
  it('returns cursor pagination and redacted wire DTOs', async () => {
    const first = jobRecord({
      id: 'job-2',
      payload: {
        token: 'private',
        nested: { databaseUrl: 'postgresql://url-user:url-secret@postgres/pixishelf' }
      },
      error: 'Bearer abc.def; dsn=postgresql://url-user:url-secret@postgres/pixishelf'
    })
    const second = jobRecord({ id: 'job-1' })
    const findMany = vi.fn().mockResolvedValue([first, second])
    const result = await listJobs({ limit: 1, statuses: ['PENDING'] }, {
      systemJob: { findMany },
      workerInstance: {}
    } as never)

    expect(result.nextCursor).toBe('job-2')
    expect(result.items[0]).toMatchObject({
      id: 'job-2',
      executionLane: 'BACKGROUND_WRITER',
      payload: { token: '[REDACTED]', nested: { databaseUrl: '[REDACTED]' } },
      createdAt: '2026-08-14T10:00:00.000Z'
    })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ definitionVersion: { gte: 1 } }), take: 2 })
    )
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('url-user')
    expect(serialized).not.toContain('url-secret')
    expect(serialized).not.toContain('abc.def')
  })

  it('removes archive URL path tokens from job payload, result, message, and error fields', async () => {
    const privateUrl = 'https://e-hentai.org/g/123/private-token/'
    const findMany = vi.fn().mockResolvedValue([
      jobRecord({
        type: 'ARCHIVE_IMPORT',
        payload: { source: privateUrl },
        result: { nested: [privateUrl] },
        message: `resolved ${privateUrl}`,
        error: `failed ${privateUrl}`
      })
    ])
    const result = await listJobs({ limit: 20 }, {
      systemJob: { findMany },
      workerInstance: {}
    } as never)

    const serialized = JSON.stringify(result)
    expect(serialized).toContain('https://e-hentai.org/g/…')
    expect(serialized).not.toContain('private-token')
  })
})

describe('getJobDashboard', () => {
  it('uses fresh READY and STOPPING presence and normalizes pre-lane worker capabilities', async () => {
    const systemJob = {
      groupBy: vi.fn().mockResolvedValue([{ status: 'PENDING', _count: { _all: 3 } }]),
      findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([jobRecord()])
    }
    const workerInstance = {
      findMany: vi.fn().mockResolvedValue([
        workerRecord(),
        workerRecord({
          workerId: 'worker-draining',
          status: 'STOPPING',
          capabilities: [{ jobType: 'ARCHIVE_RESOLVE_ITEM', executionLane: 'ARCHIVE_RESOLVE', definitionVersions: [1] }]
        })
      ])
    }
    const result = await getJobDashboard(
      { systemJob, workerInstance } as never,
      () => new Date('2026-08-14T10:01:30.000Z')
    )

    expect(result).toMatchObject({ queuedCount: 3, activeCount: 0 })
    expect(result.counts.SKIPPED).toBe(0)
    expect(result.runningJob).toBeNull()
    expect(result.workers[0]).toMatchObject({
      workerId: 'worker-1',
      capabilities: [{ jobType: 'SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }]
    })
    expect(result.lanes).toEqual([
      { executionLane: 'ARCHIVE_RESOLVE', status: 'DRAINING', runningJob: null },
      { executionLane: 'BACKGROUND_WRITER', status: 'READY', runningJob: null }
    ])
  })

  it('ignores stale READY and STOPPING worker presence', async () => {
    const systemJob = {
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([])
    }
    const workerInstance = {
      findMany: vi.fn().mockResolvedValue([
        workerRecord(),
        workerRecord({
          workerId: 'worker-draining',
          status: 'STOPPING',
          capabilities: [{ jobType: 'ARCHIVE_RESOLVE_ITEM', executionLane: 'ARCHIVE_RESOLVE', definitionVersions: [1] }]
        })
      ])
    }
    const result = await getJobDashboard(
      { systemJob, workerInstance } as never,
      () => new Date('2026-08-14T10:01:30.001Z')
    )

    expect(result.lanes).toEqual([
      { executionLane: 'ARCHIVE_RESOLVE', status: 'ERROR', runningJob: null },
      { executionLane: 'BACKGROUND_WRITER', status: 'ERROR', runningJob: null }
    ])
  })

  it('keeps a persisted running job ahead of stale worker presence', async () => {
    const runningJob = jobRecord({ status: 'RUNNING' })
    const systemJob = {
      groupBy: vi.fn().mockResolvedValue([{ status: 'RUNNING', _count: { _all: 1 } }]),
      findMany: vi.fn().mockResolvedValueOnce([runningJob]).mockResolvedValueOnce([runningJob])
    }
    const workerInstance = { findMany: vi.fn().mockResolvedValue([workerRecord()]) }
    const result = await getJobDashboard(
      { systemJob, workerInstance } as never,
      () => new Date('2026-08-14T10:01:30.001Z')
    )

    expect(result.lanes).toEqual([
      { executionLane: 'ARCHIVE_RESOLVE', status: 'ERROR', runningJob: null },
      {
        executionLane: 'BACKGROUND_WRITER',
        status: 'RUNNING',
        runningJob: expect.objectContaining({ id: runningJob.id })
      }
    ])
  })
})
