import { describe, expect, it, vi } from 'vitest'
import { PostgresJobEventStreamSource } from '../job-event-stream-service'

describe('PostgresJobEventStreamSource', () => {
  it('returns a versioned, redacted batch with only the safe live job summary', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 43n,
        jobId: 'job-1',
        type: 'job.progress',
        level: 'INFO',
        attempt: 1,
        workerId: 'worker-1',
        stage: null,
        progress: 20,
        message: 'Downloading',
        data: { data: { version: 1, kind: 'archive.transfer' } },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        job: {
          id: 'job-1',
          type: 'ARCHIVE_IMPORT',
          executionLane: 'BACKGROUND_WRITER',
          status: 'RUNNING',
          progress: 20,
          stage: 'DOWNLOADING',
          message: 'Downloading',
          errorCode: null,
          attempt: 1,
          parentJobId: null,
          heartbeatAt: new Date('2026-01-01T00:00:00.000Z'),
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          finishedAt: null,
          updatedAt: new Date('2026-01-01T00:00:00.000Z')
        }
      }
    ])
    const source = new PostgresJobEventStreamSource({
      systemJobEvent: { findMany, findFirst: vi.fn() }
    } as never)

    const batch = await source.readAfter('42', 500)

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { gt: 42n }, job: { definitionVersion: { gte: 1 } } },
        take: 200
      })
    )
    expect(batch).toMatchObject({ version: 1, cursor: '43' })
    expect(batch.items[0]?.job).toMatchObject({ id: 'job-1', type: 'ARCHIVE_IMPORT', status: 'RUNNING' })
    expect(batch.items[0]?.job).not.toHaveProperty('payload')
    expect(batch.items[0]?.job).not.toHaveProperty('result')
    expect(batch.items[0]?.job).not.toHaveProperty('leaseToken')
  })
})

