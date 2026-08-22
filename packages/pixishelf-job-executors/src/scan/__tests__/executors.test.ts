import { describe, expect, it } from 'vitest'
import { createScanExecutorRegistrations } from '../executors.js'

describe('scan executor registrations', () => {
  it('exports strict SCAN v1/v2/v3 and LOCAL_DIRECTORY_IMPORT v1 definitions', async () => {
    const registrations = createScanExecutorRegistrations({
      database: {} as never,
      config: { scanRoot: 'D:/scan' }
    })
    expect(registrations.map(({ jobType, definitionVersion }) => ({ jobType, definitionVersion }))).toEqual([
      { jobType: 'SCAN', definitionVersion: 1 },
      { jobType: 'SCAN', definitionVersion: 2 },
      { jobType: 'SCAN', definitionVersion: 3 },
      { jobType: 'LOCAL_DIRECTORY_IMPORT', definitionVersion: 1 }
    ])
    expect(registrations[0]!.parsePayload?.({ mode: 'FULL_RECONCILE' })).toEqual({ mode: 'FULL_RECONCILE' })
    expect(
      registrations[0]!.parsePayload?.({
        mode: 'CLIENT_LIST',
        existingPolicy: 'REFRESH',
        inputCount: 1,
        inputDigest: 'a'.repeat(64)
      })
    ).toMatchObject({ mode: 'CLIENT_LIST', existingPolicy: 'REFRESH' })
    expect(() => registrations[0]!.parsePayload?.({ mode: 'CLIENT_LIST', paths: ['secret'] })).toThrow()
    expect(registrations[1]!.parsePayload?.({ mode: 'CONSISTENCY_AUDIT', verification: 'FAST' })).toEqual({
      mode: 'CONSISTENCY_AUDIT',
      verification: 'FAST'
    })
    expect(() => registrations[0]!.parsePayload?.({ mode: 'CONSISTENCY_AUDIT', verification: 'FAST' })).toThrow()
    expect(() => registrations[1]!.parsePayload?.({ mode: 'INCREMENTAL' })).toThrow()
    const reservedV2Apply = registrations[1]!.parsePayload?.({
      mode: 'AUDIT_APPLY',
      auditRunId: 'audit-1',
      inputCount: 1,
      inputDigest: 'c'.repeat(64)
    })
    await expect(registrations[1]!.execute({ payload: reservedV2Apply } as never)).resolves.toMatchObject({
      kind: 'failed',
      errorCode: 'PRECONDITION_FAILED'
    })
    expect(
      registrations[2]!.parsePayload?.({
        mode: 'AUDIT_APPLY',
        auditRunId: 'audit-1',
        inputCount: 1,
        inputDigest: 'c'.repeat(64)
      })
    ).toMatchObject({ mode: 'AUDIT_APPLY', auditRunId: 'audit-1' })
    expect(() => registrations[2]!.parsePayload?.({ mode: 'CONSISTENCY_AUDIT', verification: 'FAST' })).toThrow()
    expect(
      registrations[3]!.parsePayload?.({ defaultTagIds: [1, 2], mappingCount: 0, mappingDigest: 'b'.repeat(64) })
    ).toEqual({ defaultTagIds: [1, 2], mappingCount: 0, mappingDigest: 'b'.repeat(64) })
  })

  it('rejects unbounded runtime limits', () => {
    expect(() =>
      createScanExecutorRegistrations({
        database: {} as never,
        config: { scanRoot: 'D:/scan', limits: { concurrency: 33 } }
      })
    ).toThrow('concurrency')
    expect(() =>
      createScanExecutorRegistrations({
        database: {} as never,
        config: { scanRoot: 'D:/scan', limits: { maxDiscoveryEntries: 100_000_001 } }
      })
    ).toThrow('maxDiscoveryEntries')
    expect(() =>
      createScanExecutorRegistrations({
        database: {} as never,
        config: { scanRoot: 'D:/scan', discoveryExcludedRootDirectories: ['../sources'] }
      })
    ).toThrow('discoveryExcludedRootDirectories')
  })
})
