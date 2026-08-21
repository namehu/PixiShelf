import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScanRunItemStatus, ScanRunMode, ScanRunStatus, ScanRunType } from '@prisma/client'

const {
  scanRunCreateMock,
  scanRunUpdateMock,
  scanRunDeleteManyMock,
  scanRunFindManyMock,
  scanRunFindFirstMock,
  scanRunItemCreateManyMock,
  scanRunItemGroupByMock,
  scanRunItemAggregateMock,
  scanRunItemUpdateManyMock,
  prismaTransactionMock,
  queryRawMock
} = vi.hoisted(() => ({
  scanRunCreateMock: vi.fn(),
  scanRunUpdateMock: vi.fn(),
  scanRunDeleteManyMock: vi.fn(),
  scanRunFindManyMock: vi.fn(),
  scanRunFindFirstMock: vi.fn(),
  scanRunItemCreateManyMock: vi.fn(),
  scanRunItemGroupByMock: vi.fn(),
  scanRunItemAggregateMock: vi.fn(),
  scanRunItemUpdateManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  queryRawMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: prismaTransactionMock,
    scanRun: {
      create: scanRunCreateMock,
      update: scanRunUpdateMock,
      deleteMany: scanRunDeleteManyMock,
      findMany: scanRunFindManyMock,
      findFirst: scanRunFindFirstMock
    },
    scanRunItem: {
      createMany: scanRunItemCreateManyMock,
      groupBy: scanRunItemGroupByMock,
      aggregate: scanRunItemAggregateMock,
      updateMany: scanRunItemUpdateManyMock
    }
  }
}))

import {
  appendScanRunItems,
  cleanupScanRunHistory,
  completeScanRun,
  completeScanRunSummary,
  getLatestScanRun,
  getScanRunTypeForArtworkSource,
  listScanRuns,
  startScanRun,
  updateScanRunItemMedia
} from '../scan-run-service'
import { ESource } from '@/enums/e-source'

describe('scan-run-service', () => {
  beforeEach(() => {
    scanRunCreateMock.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: 'scan-run-1', ...data }))
    scanRunUpdateMock.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: 'scan-run-1', ...data }))
    scanRunDeleteManyMock.mockReset().mockResolvedValue({ count: 0 })
    scanRunFindManyMock.mockReset().mockResolvedValue([])
    scanRunFindFirstMock.mockReset().mockResolvedValue(null)
    scanRunItemCreateManyMock.mockReset().mockResolvedValue({ count: 2 })
    scanRunItemUpdateManyMock.mockReset().mockResolvedValue({ count: 1 })
    scanRunItemAggregateMock.mockReset().mockResolvedValue({ _sum: { newImageCount: 9 } })
    scanRunItemGroupByMock.mockReset().mockResolvedValue([
      { status: ScanRunItemStatus.SUCCESS, _count: { _all: 2 } },
      { status: ScanRunItemStatus.SKIPPED, _count: { _all: 1 } },
      { status: ScanRunItemStatus.FAILED, _count: { _all: 1 } }
    ])
    queryRawMock.mockReset().mockResolvedValue([{ lock: '' }])
    prismaTransactionMock.mockReset().mockImplementation((operation) =>
      operation({
        $queryRaw: queryRawMock,
        scanRun: { findMany: scanRunFindManyMock, deleteMany: scanRunDeleteManyMock }
      })
    )
  })

  it('creates a scan run linked to an optional system job', async () => {
    await startScanRun({ systemJobId: 'job-1', type: ScanRunType.PIXIV, mode: ScanRunMode.INCREMENTAL })

    expect(scanRunCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        systemJobId: 'job-1',
        type: ScanRunType.PIXIV,
        mode: ScanRunMode.INCREMENTAL
      })
    })
  })

  it('appends item details with stable defaults', async () => {
    await appendScanRunItems([
      {
        scanRunId: 'scan-run-1',
        externalId: '100',
        status: 'SUCCESS',
        action: 'CREATE',
        mediaCount: 2
      },
      {
        scanRunId: 'scan-run-1',
        externalId: '101',
        status: 'FAILED',
        action: 'FAILED_PARSE',
        errorMessage: 'invalid metadata'
      }
    ])

    expect(scanRunItemCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          scanRunId: 'scan-run-1',
          externalId: '100',
          status: ScanRunItemStatus.SUCCESS,
          mediaCount: 2,
          newImageCount: 0
        }),
        expect.objectContaining({
          scanRunId: 'scan-run-1',
          externalId: '101',
          status: ScanRunItemStatus.FAILED,
          errorMessage: 'invalid metadata'
        })
      ]
    })
  })

  it('completes a run using item counts and scan result totals', async () => {
    await completeScanRun('scan-run-1', {
      totalArtworks: 10,
      newArtists: 1,
      newTags: 3,
      skippedArtworks: 5,
      processingTime: 1234,
      newArtworks: 2,
      newImages: 8,
      removedArtworks: 0,
      errors: []
    })

    expect(scanRunUpdateMock).toHaveBeenCalledWith({
      where: { id: 'scan-run-1' },
      data: expect.objectContaining({
        status: ScanRunStatus.COMPLETED,
        totalArtworks: 10,
        processedArtworks: 4,
        succeededArtworks: 2,
        skippedArtworks: 5,
        failedArtworks: 1,
        newImages: 8
      })
    })
  })

  it('completes a generic import run using item image totals', async () => {
    await completeScanRunSummary('scan-run-1', {
      totalArtworks: 4,
      skippedArtworks: 1
    })

    expect(scanRunUpdateMock).toHaveBeenCalledWith({
      where: { id: 'scan-run-1' },
      data: expect.objectContaining({
        status: ScanRunStatus.COMPLETED,
        totalArtworks: 4,
        processedArtworks: 4,
        skippedArtworks: 1,
        newImages: 9
      })
    })
  })

  it('updates an existing batch import item with registered media counts', async () => {
    await updateScanRunItemMedia({
      scanRunId: 'scan-run-1',
      externalId: 'local_1',
      mediaCount: 3,
      newImageCount: 3
    })

    expect(scanRunItemUpdateManyMock).toHaveBeenCalledWith({
      where: {
        scanRunId: 'scan-run-1',
        externalId: 'local_1'
      },
      data: expect.objectContaining({
        mediaCount: 3,
        newImageCount: 3
      })
    })
  })

  it('maps artwork source to scan run type', () => {
    expect(getScanRunTypeForArtworkSource(ESource.PIXIV_IMPORTED)).toBe(ScanRunType.PIXIV)
    expect(getScanRunTypeForArtworkSource(ESource.LOCAL_IMPORT)).toBe(ScanRunType.LOCAL_IMPORT)
    expect(getScanRunTypeForArtworkSource(ESource.LOCAL_CREATED)).toBe(ScanRunType.LOCAL_CREATE)
  })

  it('excludes manual local-create audit runs from the default history list', async () => {
    scanRunFindManyMock.mockResolvedValueOnce([historyRecord()])
    const result = await listScanRuns({ limit: 10 })

    expect(scanRunFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mode: { not: ScanRunMode.LOCAL_CREATE } },
        orderBy: { startedAt: 'desc' },
        take: 10,
        select: expect.objectContaining({
          operationKind: true,
          sourceAuditRunId: true,
          auditNewInputs: true,
          auditChangedInputs: true
        })
      })
    )
    const select = scanRunFindManyMock.mock.calls[0]?.[0]?.select
    expect(select).not.toHaveProperty('inputDigest')
    expect(select).not.toHaveProperty('inventoryBaselineGeneration')
    expect(select).not.toHaveProperty('checkpointStage')
    expect(select).not.toHaveProperty('logRef')
    expect(result[0]).toMatchObject({
      operationKind: 'CONSISTENCY_AUDIT',
      sourceAuditRunId: null,
      auditNewInputs: 2,
      auditChangedInputs: 3,
      errorMessage: '扫描未完成，请查看后台任务状态。'
    })
    expect(JSON.stringify(result)).not.toContain('/secret')
  })

  it('cleans up terminal scan runs older than the retention cutoff', async () => {
    scanRunFindManyMock
      .mockResolvedValueOnce([{ id: 'old-completed' }, { id: 'old-failed' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    scanRunDeleteManyMock.mockResolvedValueOnce({ count: 2 })

    const result = await cleanupScanRunHistory({
      now: new Date('2026-06-26T00:00:00.000Z'),
      maxAgeDays: 180,
      maxRunsPerType: 100
    })

    expect(scanRunFindManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        status: { in: [ScanRunStatus.COMPLETED, ScanRunStatus.FAILED, ScanRunStatus.CANCELLED] },
        finishedAt: { lt: new Date('2025-12-28T00:00:00.000Z') }
      },
      select: { id: true, operationKind: true, sourceAuditRunId: true }
    })
    expect(scanRunDeleteManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['old-completed', 'old-failed'] }
      }
    })
    expect(result).toEqual({ deletedRuns: 2 })
  })

  it('keeps only the latest configured number of terminal runs per type', async () => {
    scanRunFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'pixiv-overflow' }])
      .mockResolvedValueOnce([{ id: 'local-import-overflow' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'batch-overflow' }])
    scanRunDeleteManyMock.mockResolvedValueOnce({ count: 3 })

    await cleanupScanRunHistory({
      now: new Date('2026-06-26T00:00:00.000Z'),
      maxAgeDays: 180,
      maxRunsPerType: 100
    })

    expect(scanRunFindManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        type: ScanRunType.PIXIV,
        status: { in: [ScanRunStatus.COMPLETED, ScanRunStatus.FAILED, ScanRunStatus.CANCELLED] }
      },
      orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
      skip: 100,
      select: { id: true, operationKind: true, sourceAuditRunId: true }
    })
    expect(scanRunDeleteManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['pixiv-overflow', 'local-import-overflow', 'batch-overflow'] }
      }
    })
  })

  it('deletes an expired source audit together with all newer terminal apply children', async () => {
    scanRunFindManyMock
      .mockResolvedValueOnce([{ id: 'audit-parent', operationKind: 'CONSISTENCY_AUDIT', sourceAuditRunId: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'apply-terminal-newer',
          operationKind: 'AUDIT_APPLY',
          sourceAuditRunId: 'audit-parent',
          status: ScanRunStatus.COMPLETED,
          systemJob: { status: 'COMPLETED' }
        },
        {
          id: 'apply-terminal-latest',
          operationKind: 'AUDIT_APPLY',
          sourceAuditRunId: 'audit-parent',
          status: ScanRunStatus.FAILED,
          systemJob: { status: 'FAILED' }
        }
      ])
    scanRunDeleteManyMock.mockResolvedValueOnce({ count: 3 })

    await expect(
      cleanupScanRunHistory({
        now: new Date('2026-06-26T00:00:00.000Z'),
        maxAgeDays: 180,
        maxRunsPerType: 100
      })
    ).resolves.toEqual({ deletedRuns: 3 })

    expect(queryRawMock).toHaveBeenCalledOnce()
    expect(queryRawMock.mock.invocationCallOrder[0]!).toBeLessThan(scanRunFindManyMock.mock.invocationCallOrder[0]!)
    expect(scanRunFindManyMock).toHaveBeenLastCalledWith({
      where: { operationKind: 'AUDIT_APPLY', sourceAuditRunId: { in: ['audit-parent'] } },
      select: { id: true, sourceAuditRunId: true, status: true, systemJob: { select: { status: true } } }
    })
    expect(scanRunDeleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: ['audit-parent', 'apply-terminal-newer', 'apply-terminal-latest'] } }
    })
  })

  it('keeps an expired source audit when any apply child is non-terminal', async () => {
    scanRunFindManyMock
      .mockResolvedValueOnce([{ id: 'audit-parent', operationKind: 'CONSISTENCY_AUDIT', sourceAuditRunId: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'apply-complete',
          sourceAuditRunId: 'audit-parent',
          status: ScanRunStatus.COMPLETED,
          systemJob: { status: 'COMPLETED' }
        },
        {
          id: 'apply-running',
          sourceAuditRunId: 'audit-parent',
          status: ScanRunStatus.RUNNING,
          systemJob: { status: 'RUNNING' }
        }
      ])

    await expect(
      cleanupScanRunHistory({
        now: new Date('2026-06-26T00:00:00.000Z'),
        maxAgeDays: 180,
        maxRunsPerType: 100
      })
    ).resolves.toEqual({ deletedRuns: 0 })
    expect(scanRunDeleteManyMock).not.toHaveBeenCalled()
  })

  it('deletes an overflow source audit as a terminal family but never deletes an apply child alone', async () => {
    scanRunFindManyMock
      .mockResolvedValueOnce([
        { id: 'apply-only-candidate', operationKind: 'AUDIT_APPLY', sourceAuditRunId: 'retained-parent' }
      ])
      .mockResolvedValueOnce([{ id: 'audit-overflow', operationKind: 'CONSISTENCY_AUDIT', sourceAuditRunId: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'apply-overflow-family',
          sourceAuditRunId: 'audit-overflow',
          status: ScanRunStatus.CANCELLED,
          systemJob: { status: 'CANCELLED' }
        }
      ])
    scanRunDeleteManyMock.mockResolvedValueOnce({ count: 2 })

    await expect(
      cleanupScanRunHistory({
        now: new Date('2026-06-26T00:00:00.000Z'),
        maxAgeDays: 180,
        maxRunsPerType: 100
      })
    ).resolves.toEqual({ deletedRuns: 2 })
    expect(scanRunDeleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: ['audit-overflow', 'apply-overflow-family'] } }
    })
  })

  it('does not delete running scan runs during retention cleanup', async () => {
    scanRunFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await cleanupScanRunHistory({
      now: new Date('2026-06-26T00:00:00.000Z'),
      maxAgeDays: 180,
      maxRunsPerType: 100
    })

    expect(scanRunFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [ScanRunStatus.COMPLETED, ScanRunStatus.FAILED, ScanRunStatus.CANCELLED] }
        })
      })
    )
    expect(scanRunDeleteManyMock).not.toHaveBeenCalled()
    expect(result).toEqual({ deletedRuns: 0 })
  })

  it('excludes manual local-create audit runs from latest history lookup', async () => {
    scanRunFindFirstMock.mockResolvedValueOnce(historyRecord())
    await getLatestScanRun()

    expect(scanRunFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mode: { not: ScanRunMode.LOCAL_CREATE } },
        orderBy: { startedAt: 'desc' },
        select: expect.objectContaining({ operationKind: true, auditIdentityConflictInputs: true })
      })
    )
  })
})

function historyRecord() {
  return {
    id: 'scan-run-1',
    type: ScanRunType.PIXIV,
    mode: ScanRunMode.INCREMENTAL,
    status: ScanRunStatus.FAILED,
    operationKind: 'CONSISTENCY_AUDIT',
    sourceAuditRunId: null,
    startedAt: new Date('2026-08-20T00:00:00.000Z'),
    finishedAt: new Date('2026-08-20T00:00:01.000Z'),
    durationMs: 1000,
    totalArtworks: 10,
    succeededArtworks: 1,
    skippedArtworks: 2,
    failedArtworks: 3,
    newImages: 0,
    walkedEntries: 20,
    metadataCandidates: 10,
    inventoryUnchanged: 4,
    contentHashed: 5,
    contentChanged: 6,
    parsedInputs: 7,
    publishedInputs: 0,
    missingInputs: 1,
    auditNewInputs: 2,
    auditChangedInputs: 3,
    auditInvalidInputs: 4,
    auditIdentityConflictInputs: 5,
    discoveryDurationMs: 100,
    hashDurationMs: 200,
    publishDurationMs: 0,
    errorMessage: 'INTERNAL_ERROR at /secret/pixiv/root',
    inputDigest: 'do-not-expose',
    inventoryBaselineGeneration: 2,
    checkpointStage: 'FAILED',
    logRef: '/secret/worker.log'
  }
}
