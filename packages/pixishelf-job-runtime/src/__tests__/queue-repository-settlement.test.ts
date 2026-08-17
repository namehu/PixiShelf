import { describe, expect, it, vi } from 'vitest'
import {
  GLOBAL_BACKGROUND_WORKER_RESOURCE,
  PostgresQueueRepository,
  type ExecutionFence,
  type QueueDatabase,
  type QueueSqlExecutor
} from '../queue-repository.js'

const fence: ExecutionFence = {
  jobId: 'job-1',
  workerId: 'worker-1',
  executionToken: '00000000-0000-4000-8000-000000000001',
  attempt: 1
}

describe('PostgresQueueRepository settlement messages', () => {
  it.each([
    ['complete', 7, (repository: PostgresQueueRepository) => repository.complete({ ...fence, result: { ok: true }, message: 'complete password=secret' })],
    ['fail', 8, (repository: PostgresQueueRepository) => repository.fail({ ...fence, errorCode: 'TEST', error: 'failed', message: 'fail password=secret' })],
    ['retry', 9, (repository: PostgresQueueRepository) => repository.retry({ ...fence, availableAt: new Date(Date.now() + 60_000), errorCode: 'TEST', error: 'retry', message: 'retry password=secret' })]
  ] as const)('persists and safely parameterizes the %s message', async (name, messageIndex, settle) => {
    const updates: Array<{ query: string; values: unknown[] }> = []
    const transaction: QueueSqlExecutor = {
      $queryRawUnsafe: vi.fn(async (query: string, ...values: unknown[]) => {
        if (query.includes('FROM "job_resource_leases"')) return [{ resourceKey: GLOBAL_BACKGROUND_WORKER_RESOURCE }]
        if (query.includes('SELECT "id", "status"')) return [{ id: fence.jobId, status: 'RUNNING' }]
        if (query.includes('UPDATE "system_jobs"')) {
          updates.push({ query, values })
          return [{ id: fence.jobId, attempt: fence.attempt }]
        }
        throw new Error(`Unexpected query: ${query}`)
      }) as QueueSqlExecutor['$queryRawUnsafe'],
      $executeRawUnsafe: vi.fn(async (query: string) => (query.includes('DELETE FROM "job_resource_leases"') ? 1 : 1))
    }
    const database = {
      ...transaction,
      $transaction: (operation: (client: QueueSqlExecutor) => Promise<unknown>) => operation(transaction)
    } as QueueDatabase
    const repository = new PostgresQueueRepository(database)

    await settle(repository)

    expect(updates).toHaveLength(1)
    expect(updates[0]!.query).toContain(`"message" = $${messageIndex}`)
    expect(updates[0]!.values).toHaveLength(messageIndex)
    expect(updates[0]!.values.at(-1)).toBe(`${name} password=[REDACTED]`)
  })
})
