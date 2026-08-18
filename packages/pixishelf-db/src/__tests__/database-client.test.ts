import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { assertBackgroundQueueSchema } from '../index'

const queueKernelDatabaseUrl = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const describePostgres = queueKernelDatabaseUrl ? describe : describe.skip
const postgresClient = queueKernelDatabaseUrl ? new PrismaClient({ datasourceUrl: queueKernelDatabaseUrl }) : null

const expectedIndex = {
  indexName: 'system_jobs_single_executing_per_lane_idx',
  indexPredicate:
    '(status = ANY (ARRAY[\'RUNNING\'::"JobStatus", \'PAUSING\'::"JobStatus", \'CANCELLING\'::"JobStatus"]))',
  indexExpression: '"executionLane"',
  keyCount: 1
}

function createQueryClient(results: unknown[]): PrismaClient {
  return {
    $queryRaw: vi.fn().mockImplementation(() => Promise.resolve(results.shift()))
  } as unknown as PrismaClient
}

describe('database package', () => {
  it('accepts the complete background queue schema contract', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }],
      [
        { tableName: 'archive_intake_items' },
        { tableName: 'archive_provider_request_leases' },
        { tableName: 'archive_provider_throttles' },
        { tableName: 'archive_resolve_queue_control' },
        { tableName: 'derived_media_gc_entries' },
        { tableName: 'job_resource_leases' },
        { tableName: 'system_job_events' },
        { tableName: 'worker_instances' }
      ],
      [{ migrationName: '20260818120000_add_archive_intake_worker_lanes' }],
      [expectedIndex]
    ])

    await expect(assertBackgroundQueueSchema(client)).resolves.toBeUndefined()
  })

  it('reports missing required objects without exposing connection details', async () => {
    const client = createQueryClient([[], [], [], []])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Background queue schema is not ready: missing system_jobs.definitionVersion, system_jobs.executionLane, archive_intake_items, archive_provider_request_leases, archive_provider_throttles, archive_resolve_queue_control, derived_media_gc_entries, job_resource_leases, system_job_events, worker_instances, migration:20260818120000_add_archive_intake_worker_lanes, index:system_jobs_single_executing_per_lane_idx'
    )
  })

  it('rejects a migrated schema when the single-execution index is missing or invalid', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }],
      [
        { tableName: 'archive_intake_items' },
        { tableName: 'archive_provider_request_leases' },
        { tableName: 'archive_provider_throttles' },
        { tableName: 'archive_resolve_queue_control' },
        { tableName: 'derived_media_gc_entries' },
        { tableName: 'job_resource_leases' },
        { tableName: 'system_job_events' },
        { tableName: 'worker_instances' }
      ],
      [{ migrationName: '20260818120000_add_archive_intake_worker_lanes' }],
      []
    ])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Background queue schema is not ready: missing index:system_jobs_single_executing_per_lane_idx'
    )
  })

  it('rejects a same-name unique partial index with the wrong protected statuses', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }],
      [
        { tableName: 'archive_intake_items' },
        { tableName: 'archive_provider_request_leases' },
        { tableName: 'archive_provider_throttles' },
        { tableName: 'archive_resolve_queue_control' },
        { tableName: 'derived_media_gc_entries' },
        { tableName: 'job_resource_leases' },
        { tableName: 'system_job_events' },
        { tableName: 'worker_instances' }
      ],
      [{ migrationName: '20260818120000_add_archive_intake_worker_lanes' }],
      [
        {
          ...expectedIndex,
          indexPredicate: '(status = ANY (ARRAY[\'RUNNING\'::"JobStatus", \'PAUSING\'::"JobStatus"]))'
        }
      ]
    ])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Background queue schema is not ready: missing index:system_jobs_single_executing_per_lane_idx'
    )
  })

  it('rejects a same-name partial index that is not keyed by execution lane', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }],
      [
        { tableName: 'archive_intake_items' },
        { tableName: 'archive_provider_request_leases' },
        { tableName: 'archive_provider_throttles' },
        { tableName: 'archive_resolve_queue_control' },
        { tableName: 'derived_media_gc_entries' },
        { tableName: 'job_resource_leases' },
        { tableName: 'system_job_events' },
        { tableName: 'worker_instances' }
      ],
      [{ migrationName: '20260818120000_add_archive_intake_worker_lanes' }],
      [{ ...expectedIndex, indexExpression: 'id' }]
    ])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Background queue schema is not ready: missing index:system_jobs_single_executing_per_lane_idx'
    )
  })

  it('sanitizes query failures', async () => {
    const client = {
      $queryRaw: vi
        .fn()
        .mockRejectedValue(new Error('postgresql://secret-user:secret-password@database.invalid/pixishelf'))
    } as unknown as PrismaClient

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Unable to verify the background queue database schema'
    )
    await expect(assertBackgroundQueueSchema(client)).rejects.not.toThrow('secret-password')
  })
})

describePostgres('database package PostgreSQL integration', () => {
  afterAll(async () => {
    await postgresClient?.$disconnect()
  })

  it('accepts the migrated single-execution expression index from the PostgreSQL catalog', async () => {
    await expect(assertBackgroundQueueSchema(postgresClient!)).resolves.toBeUndefined()
  })
})
