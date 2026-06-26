import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScanRunItemStatus, ScanRunMode, ScanRunStatus, ScanRunType } from '@prisma/client'

const {
  scanRunCreateMock,
  scanRunUpdateMock,
  scanRunFindManyMock,
  scanRunFindFirstMock,
  scanRunItemCreateManyMock,
  scanRunItemGroupByMock,
  scanRunItemAggregateMock,
  scanRunItemUpdateManyMock
} = vi.hoisted(() => ({
  scanRunCreateMock: vi.fn(),
  scanRunUpdateMock: vi.fn(),
  scanRunFindManyMock: vi.fn(),
  scanRunFindFirstMock: vi.fn(),
  scanRunItemCreateManyMock: vi.fn(),
  scanRunItemGroupByMock: vi.fn(),
  scanRunItemAggregateMock: vi.fn(),
  scanRunItemUpdateManyMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    scanRun: {
      create: scanRunCreateMock,
      update: scanRunUpdateMock,
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
  completeScanRun,
  completeScanRunSummary,
  getLatestScanRun,
  getScanRunTypeForArtworkSource,
  listScanRuns,
  startScanRun,
  updateScanRunItemMedia
} from '../scan-run-service'
import { ESource } from '@/enums/ESource'

describe('scan-run-service', () => {
  beforeEach(() => {
    scanRunCreateMock.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: 'scan-run-1', ...data }))
    scanRunUpdateMock.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: 'scan-run-1', ...data }))
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
    await listScanRuns({ limit: 10 })

    expect(scanRunFindManyMock).toHaveBeenCalledWith({
      where: {
        mode: {
          not: ScanRunMode.LOCAL_CREATE
        }
      },
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: {
        _count: {
          select: { items: true }
        }
      }
    })
  })

  it('excludes manual local-create audit runs from latest history lookup', async () => {
    await getLatestScanRun()

    expect(scanRunFindFirstMock).toHaveBeenCalledWith({
      where: {
        mode: {
          not: ScanRunMode.LOCAL_CREATE
        }
      },
      orderBy: { startedAt: 'desc' },
      include: {
        _count: {
          select: { items: true }
        }
      }
    })
  })
})
