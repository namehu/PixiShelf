import type { WorkerCapability } from '@pixishelf/job-contracts'
import { describe, expect, it, vi } from 'vitest'
import { PostgresQueueRepository, type QueueDatabase, type QueueSqlExecutor } from '../queue-repository.js'

const archiveImportCapability: WorkerCapability[] = [
  { jobType: 'ARCHIVE_IMPORT', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
]

describe('PostgresQueueRepository claim contract', () => {
  it('excludes only archive import candidates with a pending cleanup intent', async () => {
    let candidateQuery = ''
    const transaction: QueueSqlExecutor = {
      $queryRawUnsafe: vi.fn(async (query: string) => {
        if (query.includes('SELECT job."id", job."status"')) candidateQuery = query
        return []
      }) as QueueSqlExecutor['$queryRawUnsafe'],
      $executeRawUnsafe: vi.fn().mockResolvedValue(0)
    }
    const database = {
      ...transaction,
      $transaction: (operation: (client: QueueSqlExecutor) => Promise<unknown>) => operation(transaction)
    } as QueueDatabase

    await expect(
      new PostgresQueueRepository(database).claim('queue-contract-worker', archiveImportCapability)
    ).resolves.toBeNull()

    expect(candidateQuery).toContain(`job."type" <> 'ARCHIVE_IMPORT'`)
    expect(candidateQuery).toContain('FROM "archive_imports" AS archive_import')
    expect(candidateQuery).toContain('archive_import."systemJobId" = job."id"')
    expect(candidateQuery).toContain('archive_import."cleanupRequestedAt" IS NOT NULL')
  })
})
