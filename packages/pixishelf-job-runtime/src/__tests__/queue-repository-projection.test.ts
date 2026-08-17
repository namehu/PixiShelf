import { describe, expect, it, vi } from 'vitest'
import {
  GLOBAL_BACKGROUND_WORKER_RESOURCE,
  PostgresQueueRepository,
  type ExecutionFence,
  type QueueDatabase,
  type QueueSqlExecutor
} from '../queue-repository.js'

const parentFence: ExecutionFence = {
  jobId: 'parent-job',
  workerId: 'worker-1',
  executionToken: '00000000-0000-4000-8000-000000000001',
  attempt: 1
}

describe('PostgresQueueRepository legacy projections', () => {
  it('projects streaming optimization payload fields into child job columns', async () => {
    let insertValues: unknown[] = []
    const transaction: QueueSqlExecutor = {
      $queryRawUnsafe: vi.fn(async (query: string, ...values: unknown[]) => {
        if (query.includes('FROM "job_resource_leases"')) {
          return [{ resourceKey: GLOBAL_BACKGROUND_WORKER_RESOURCE }]
        }
        if (query.includes('SELECT "id", "status"')) return [{ id: parentFence.jobId, status: 'RUNNING' }]
        if (query.includes('INSERT INTO "system_jobs"')) {
          insertValues = values
          return [{ id: 'streaming-child' }]
        }
        throw new Error(`Unexpected query: ${query}`)
      }) as QueueSqlExecutor['$queryRawUnsafe'],
      $executeRawUnsafe: vi.fn().mockResolvedValue(1)
    }
    const database = {
      ...transaction,
      $transaction: (operation: (client: QueueSqlExecutor) => Promise<unknown>) => operation(transaction)
    } as QueueDatabase
    const repository = new PostgresQueueRepository(database)

    await expect(
      repository.enqueueChild(parentFence, {
        type: 'VIDEO_STREAMING_OPTIMIZATION',
        payload: {
          imageId: 43,
          relativePath: 'videos/streaming.mp4',
          mode: 'REMUX_FASTSTART'
        }
      })
    ).resolves.toEqual({ id: 'streaming-child', created: true })

    expect(insertValues[11]).toBe(43)
    expect(insertValues[12]).toBe('videos/streaming.mp4')
    expect(insertValues[13]).toBe('REMUX_FASTSTART')
  })
})
