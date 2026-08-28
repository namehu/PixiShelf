import { describe, expect, it, vi } from 'vitest'
import { createPrismaArchiveLaneCutoverAuditReader } from '../archive-lane-cutover-audit'
import type { CutoverAuditReader, RawCutoverAuditCheck } from '../cutover-audit'

const retainedDomainCheck: RawCutoverAuditCheck = {
  key: 'artwork-archive-lifecycle-state',
  model: 'Artwork',
  field: 'archiveLifecycleState',
  blockingValues: ['TRASHING', 'RESTORING'],
  count: 0,
  samples: []
}

describe('archive lane cutover audit', () => {
  it('allows supported pending and paused jobs while retaining non-queue domain checks', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('GROUP BY "type"')) {
        return [
          { type: 'SCAN', definitionVersion: 1, status: 'PENDING', count: BigInt(4) },
          { type: 'SCAN', definitionVersion: 2, status: 'RETRY_WAIT', count: BigInt(3) },
          { type: 'SCAN', definitionVersion: 3, status: 'PAUSED', count: BigInt(2) },
          { type: 'ARCHIVE_IMPORT', definitionVersion: 1, status: 'PAUSED', count: BigInt(2) },
          { type: 'ARCHIVE_IMPORT', definitionVersion: 2, status: 'PENDING', count: BigInt(2) }
        ]
      }
      if (sql.includes('COUNT(*)')) return [{ count: BigInt(0) }]
      return []
    })
    const domainReader = reader([
      { ...retainedDomainCheck, key: 'system-job-status', count: 6 },
      { ...retainedDomainCheck, key: 'archive-import-status', count: 2 },
      retainedDomainCheck
    ])
    const checks = await createPrismaArchiveLaneCutoverAuditReader(
      { $queryRawUnsafe: query } as never,
      domainReader
    ).readChecks(20)

    expect(checks.find((check) => check.key === 'unsupported-waiting-job-capability')).toMatchObject({ count: 0 })
    expect(checks.map((check) => check.key)).not.toContain('system-job-status')
    expect(checks.map((check) => check.key)).not.toContain('archive-import-status')
    expect(checks).toContainEqual(retainedDomainCheck)
  })

  it('blocks unsupported versions and unknown waiting job types without exposing lease tokens', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('GROUP BY "type"')) {
        return [
          { type: 'SCAN', definitionVersion: 4, status: 'PAUSED', count: BigInt(2) },
          { type: 'UNKNOWN_JOB', definitionVersion: 1, status: 'PENDING', count: BigInt(1) }
        ]
      }
      if (sql.includes('COUNT(*)') && sql.includes('job_resource_leases')) return [{ count: BigInt(1) }]
      if (sql.includes('FROM "job_resource_leases"')) {
        return [
          {
            resourceKey: 'global/background-worker',
            ownerJobId: 'job-1',
            workerId: 'legacy-worker',
            expiresAt: new Date('2026-08-18T00:01:00.000Z'),
            heartbeatAt: new Date('2026-08-18T00:00:00.000Z')
          }
        ]
      }
      if (sql.includes('COUNT(*)')) return [{ count: BigInt(0) }]
      return []
    })
    const checks = await createPrismaArchiveLaneCutoverAuditReader(
      { $queryRawUnsafe: query } as never,
      reader([])
    ).readChecks(20)

    expect(checks.find((check) => check.key === 'unsupported-waiting-job-capability')).toMatchObject({ count: 3 })
    const lease = checks.find((check) => check.key === 'legacy-global-worker-lease')
    expect(lease).toMatchObject({ count: 1 })
    expect(JSON.stringify(lease)).not.toContain('leaseToken')
  })
})

function reader(checks: readonly RawCutoverAuditCheck[]): CutoverAuditReader {
  return { readChecks: vi.fn().mockResolvedValue(checks) }
}
