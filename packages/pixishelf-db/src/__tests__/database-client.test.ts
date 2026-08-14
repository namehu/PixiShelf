import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import { assertBackgroundQueueSchema } from '../index'

function createQueryClient(results: unknown[]): PrismaClient {
  return {
    $queryRaw: vi.fn().mockImplementation(() => Promise.resolve(results.shift()))
  } as unknown as PrismaClient
}

describe('database package', () => {
  it('accepts the complete background queue schema contract', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }],
      [
        { tableName: 'derived_media_gc_entries' },
        { tableName: 'job_resource_leases' },
        { tableName: 'system_job_events' },
        { tableName: 'worker_instances' }
      ],
      [{ migrationName: '20260814100000_add_worker_instances' }]
    ])

    await expect(assertBackgroundQueueSchema(client)).resolves.toBeUndefined()
  })

  it('reports missing required objects without exposing connection details', async () => {
    const client = createQueryClient([[], [], []])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Background queue schema is not ready: missing system_jobs.definitionVersion, derived_media_gc_entries, job_resource_leases, system_job_events, worker_instances, migration:20260814100000_add_worker_instances'
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
