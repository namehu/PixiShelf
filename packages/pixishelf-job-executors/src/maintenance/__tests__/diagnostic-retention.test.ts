import { describe, expect, it, vi } from 'vitest'
import { cleanupJobEvents } from '../job-event-retention-cleanup.ts'
import type { RunMaintenanceMutation } from '../types.ts'

function fixture(size: number) {
  const now = new Date('2026-09-16T00:00:00Z')
  const rows = Array.from({ length: size }, (_, i) => ({ id: BigInt(i + 1) }))
  let expired = false
  const report = {
    count: vi.fn().mockResolvedValue(1),
    findMany: vi.fn(async () => (expired ? [] : [{ id: 'report' }])),
    findFirst: vi.fn().mockResolvedValue({ id: 'report' }),
    updateMany: vi.fn(async () => {
      expired = true
      return { count: 1 }
    })
  }
  const item = {
    count: vi.fn().mockResolvedValue(size),
    findMany: vi.fn(async ({ take }: { take: number }) => rows.slice(0, take)),
    deleteMany: vi.fn(async ({ where }: { where: { id: { in: bigint[] } } }) => {
      rows.splice(0, where.id.in.length)
      return { count: where.id.in.length }
    })
  }
  const database = {
    systemJobEvent: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    systemJobDiagnosticReport: report,
    systemJobDiagnosticItem: item
  }
  const mutate = vi.fn(async (operation) => operation(database)) as unknown as RunMaintenanceMutation
  return {
    input: { database: database as never, mutate, signal: new AbortController().signal, progress: vi.fn(), now },
    report,
    item,
    rows
  }
}

describe('diagnostic retention', () => {
  it('counts only closed expired reports during dry run without changing evidence', async () => {
    const test = fixture(6001)
    const result = await cleanupJobEvents({ ...test.input, dryRun: true })
    expect(result).toMatchObject({
      diagnosticReportCandidates: 1,
      diagnosticItemCandidates: 6001,
      deletedDiagnosticItems: 0,
      expiredDiagnosticReports: 0
    })
    expect(test.report.count).toHaveBeenCalledWith({
      where: { status: 'CLOSED', expiresAt: { lte: test.input.now }, expiredAt: null }
    })
    expect(test.input.mutate).not.toHaveBeenCalled()
    expect(test.rows).toHaveLength(6001)
  })

  it('deletes a large report in bounded transactions and only then marks its header expired', async () => {
    const test = fixture(10001)
    const result = await cleanupJobEvents({ ...test.input, dryRun: false })
    expect(result).toMatchObject({ deletedDiagnosticItems: 10001, expiredDiagnosticReports: 1 })
    expect(test.item.deleteMany.mock.calls.map((call) => call[0].where.id.in.length)).toEqual([5000, 5000, 1])
    expect(test.report.updateMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ data: { expiredAt: test.input.now } })
    )
    expect(test.report.updateMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      test.item.deleteMany.mock.invocationCallOrder.at(-1)!
    )
  })

  it('checks cancellation between batches and leaves an interrupted header unexpired', async () => {
    const test = fixture(6001)
    const controller = new AbortController()
    test.input.progress.mockImplementation(async () => {
      controller.abort(new Error('cancel cleanup'))
    })
    await expect(cleanupJobEvents({ ...test.input, signal: controller.signal, dryRun: false })).rejects.toThrow(
      'cancel cleanup'
    )
    expect(test.rows).toHaveLength(1001)
    expect(test.report.updateMany).not.toHaveBeenCalled()
  })
})
