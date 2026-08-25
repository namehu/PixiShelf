import { describe, expect, it, vi } from 'vitest'
import {
  auditProductionWorkerCapabilities,
  runCapabilityAudit,
  type CapabilityAuditDatabase
} from '../capability-audit.js'
import { PRODUCTION_WORKER_CAPABILITIES } from '../production-capabilities.js'

describe('production Worker capability audit', () => {
  it('accepts exactly one fresh READY Worker with 22 job types and SCAN v1/v2/v3', async () => {
    const findMany = vi.fn().mockResolvedValue([{ capabilities: [...PRODUCTION_WORKER_CAPABILITIES].reverse() }])
    await expect(
      auditProductionWorkerCapabilities(database(findMany), {
        now: new Date('2026-08-17T01:00:00.000Z'),
        freshnessMs: 60_000
      })
    ).resolves.toEqual({ readyWorkers: 1, capabilities: 22 })
    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'READY', heartbeatAt: { gte: new Date('2026-08-17T00:59:00.000Z') } },
      orderBy: { workerId: 'asc' },
      select: { capabilities: true },
      take: 2
    })
  })

  it('rejects an incomplete inventory when SCAN only advertises v1', async () => {
    const previousInventory = PRODUCTION_WORKER_CAPABILITIES.map((capability) =>
      capability.jobType === 'SCAN' ? { ...capability, definitionVersions: [1] } : capability
    )

    await expect(
      auditProductionWorkerCapabilities(database(vi.fn().mockResolvedValue([{ capabilities: previousInventory }])))
    ).rejects.toThrow('22-job/24-version dual-lane release')
  })

  it('rejects missing, duplicate, or mismatched online inventories', async () => {
    const invalidInventories: Array<Array<{ capabilities: unknown }>> = [
      [],
      [{ capabilities: PRODUCTION_WORKER_CAPABILITIES }, { capabilities: PRODUCTION_WORKER_CAPABILITIES }],
      [{ capabilities: PRODUCTION_WORKER_CAPABILITIES.slice(0, 17) }],
      [
        {
          capabilities: [{ jobType: 'SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [2] }]
        }
      ],
      [
        {
          capabilities: PRODUCTION_WORKER_CAPABILITIES.map((capability, index) =>
            index === 0 ? { ...capability, unexpected: true } : capability
          )
        }
      ]
    ]
    for (const workers of invalidInventories) {
      await expect(auditProductionWorkerCapabilities(database(vi.fn().mockResolvedValue(workers)))).rejects.toThrow()
    }
  })

  it('reports job type count without treating SCAN versions as separate capabilities', async () => {
    const writeOutput = vi.fn()
    const exitCode = await runCapabilityAudit(
      { DATABASE_URL: 'postgresql://worker:top-secret@postgres:5432/pixishelf' },
      {
        createClient: () => ({
          workerInstance: {
            findMany: vi.fn().mockResolvedValue([{ capabilities: PRODUCTION_WORKER_CAPABILITIES }])
          },
          $disconnect: vi.fn().mockResolvedValue(undefined)
        }),
        writeOutput,
        writeError: vi.fn()
      }
    )

    expect(exitCode).toBe(0)
    expect(writeOutput).toHaveBeenCalledWith(
      'Worker capability audit passed: 1 READY Worker, 22 job types / 24 versions (SCAN v1/v2/v3)'
    )
  })

  it('returns non-zero and never exposes database credentials when the query fails', async () => {
    const writeError = vi.fn()
    const disconnect = vi.fn().mockResolvedValue(undefined)
    const exitCode = await runCapabilityAudit(
      { DATABASE_URL: 'postgresql://worker:top-secret@postgres:5432/pixishelf' },
      {
        createClient: () => ({
          workerInstance: { findMany: vi.fn().mockRejectedValue(new Error('top-secret')) },
          $disconnect: disconnect
        }),
        writeOutput: vi.fn(),
        writeError
      }
    )

    expect(exitCode).toBe(1)
    expect(writeError).toHaveBeenCalledWith(
      'Worker capability audit failed: unable to query online Worker capability state'
    )
    expect(JSON.stringify(writeError.mock.calls)).not.toContain('top-secret')
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('returns non-zero and redacts a disconnect failure after a successful audit', async () => {
    const writeError = vi.fn()
    const writeOutput = vi.fn()
    const exitCode = await runCapabilityAudit(
      { DATABASE_URL: 'postgresql://worker:top-secret@postgres:5432/pixishelf' },
      {
        createClient: () => ({
          workerInstance: {
            findMany: vi.fn().mockResolvedValue([{ capabilities: PRODUCTION_WORKER_CAPABILITIES }])
          },
          $disconnect: vi.fn().mockRejectedValue(new Error('top-secret'))
        }),
        writeOutput,
        writeError
      }
    )

    expect(exitCode).toBe(1)
    expect(writeError).toHaveBeenCalledWith('Worker capability audit failed: unable to close the database connection')
    expect(writeOutput).not.toHaveBeenCalled()
    expect(writeError).toHaveBeenCalledOnce()
    expect(JSON.stringify(writeError.mock.calls)).not.toContain('top-secret')
  })
})

function database(findMany: ReturnType<typeof vi.fn>): CapabilityAuditDatabase {
  return {
    workerInstance: {
      findMany: findMany as CapabilityAuditDatabase['workerInstance']['findMany']
    }
  }
}
