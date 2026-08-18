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
})

describe('getJobDashboard', () => {
  it('summarizes status counts and normalizes pre-lane worker capabilities', async () => {
    const systemJob = {
      groupBy: vi.fn().mockResolvedValue([
        { status: 'PENDING', _count: { _all: 3 } },
        { status: 'RUNNING', _count: { _all: 1 } }
      ]),
      findFirst: vi.fn().mockResolvedValue(jobRecord({ status: 'RUNNING' })),
      findMany: vi.fn().mockResolvedValue([jobRecord()])
    }
    const workerInstance = { findMany: vi.fn().mockResolvedValue([workerRecord()]) }
    const result = await getJobDashboard({ systemJob, workerInstance } as never)

    expect(result).toMatchObject({ queuedCount: 3, activeCount: 1 })
    expect(result.counts.SKIPPED).toBe(0)
    expect(result.runningJob?.status).toBe('RUNNING')
    expect(result.workers[0]).toMatchObject({
      workerId: 'worker-1',
      capabilities: [{ jobType: 'SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }]
    })
  })
})
