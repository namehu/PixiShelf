import { describe, expect, it, vi } from 'vitest'
import {
  backgroundDiagnosticItemsInputSchema,
  backgroundDiagnosticReportsInputSchema,
  listBackgroundDiagnosticItems,
  listBackgroundDiagnosticReports
} from '../job-diagnostic-service'
import { hasPartialFailure } from '../job-diagnostic-summary'

const now = new Date('2026-09-16T06:18:42Z')
const reportId = 'c4ae2cd5-53b5-4ee6-bb60-ca20e4e0da5f'
const job = {
  id: 'job',
  type: 'ARCHIVE_IMPORT',
  status: 'FAILED',
  attempt: 1,
  error: '失败 13 项',
  errorCode: 'PRECONDITION_FAILED',
  stage: 'DOWNLOADING',
  payload: { archiveImportId: 'archive' },
  result: null,
  createdAt: now,
  finishedAt: now,
  updatedAt: now
}
const report = {
  id: reportId,
  jobId: job.id,
  attempt: 1,
  outcome: 'FAILED',
  itemCount: 13,
  currentCount: 13,
  inheritedCount: 0,
  complete: true,
  createdAt: now,
  closedAt: now,
  expiresAt: new Date('2026-12-15'),
  expiredAt: null
}
const item = (index: number) => ({
  id: BigInt(index),
  reportId,
  scope: 'ITEM',
  origin: 'CURRENT',
  targetType: 'archive-item',
  targetId: String(index),
  targetLabel: `${index}.jpg`,
  stage: 'MEDIA_STREAM',
  code: 'REMOTE_RESPONSE_INVALID',
  reasonKey: 'errno:ECONNRESET',
  message: '连接被重置',
  suggestion: '检查网络后重试',
  evidence: [{ code: 'ECONNRESET' }],
  remoteHost: 'example.com:443',
  httpStatus: null,
  itemAttempt: 3,
  createdAt: now
})
function harness() {
  return {
    systemJob: {
      findUnique: vi.fn().mockResolvedValue(job),
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([])
    },
    systemJobDiagnosticReport: {
      findMany: vi.fn().mockResolvedValue([report]),
      findFirst: vi.fn().mockResolvedValue(report)
    },
    systemJobDiagnosticItem: {
      findMany: vi.fn().mockResolvedValue(Array.from({ length: 13 }, (_, i) => item(i + 1))),
      groupBy: vi.fn().mockResolvedValue([{ reasonKey: 'errno:ECONNRESET', _count: { _all: 13 } }]),
      findFirst: vi.fn().mockResolvedValue(null)
    },
    archiveImport: { findUnique: vi.fn().mockResolvedValue(null) },
    archiveImportItem: { findMany: vi.fn(), groupBy: vi.fn() }
  }
}
describe('background failure diagnostics', () => {
  it('validates limits, report identity and bounded cursors', () => {
    expect(backgroundDiagnosticReportsInputSchema.parse({ jobId: 'job' }).limit).toBe(50)
    for (const patch of [{ limit: 101 }, { reportId: 'bad' }, { cursor: '-1' }, { cursor: '9223372036854775808' }]) {
      expect(backgroundDiagnosticItemsInputSchema.safeParse({ jobId: 'job', reportId, ...patch }).success).toBe(false)
    }
    expect(backgroundDiagnosticReportsInputSchema.safeParse({ jobId: 'job', cursor: 'invalid!' }).success).toBe(false)
  })
  it('returns all thirteen failures with evidence independently of progress events', async () => {
    const h = harness()
    const result = await listBackgroundDiagnosticItems(
      backgroundDiagnosticItemsInputSchema.parse({ jobId: 'job', reportId }),
      h as never
    )
    expect(result.items).toHaveLength(13)
    expect(result.summary.itemCount).toBe(13)
    expect(result.items[0]).toMatchObject({
      id: '1',
      reasonKey: 'errno:ECONNRESET',
      evidence: [{ code: 'ECONNRESET' }]
    })
    expect(result.nextCursor).toBeNull()
    expect(h.archiveImport.findUnique).not.toHaveBeenCalled()
  })
  it('binds reports to the requested job and uses a value cursor plus reason filter', async () => {
    const h = harness()
    await listBackgroundDiagnosticItems(
      backgroundDiagnosticItemsInputSchema.parse({ jobId: 'job', reportId, cursor: '5', reason: 'errno:ECONNRESET' }),
      h as never
    )
    expect(h.systemJobDiagnosticReport.findFirst).toHaveBeenCalledWith({ where: { id: reportId, jobId: 'job' } })
    expect(h.systemJobDiagnosticItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { gt: 5n }, reasonKey: 'errno:ECONNRESET' }) })
    )
    h.systemJobDiagnosticReport.findFirst.mockResolvedValue(null)
    await expect(
      listBackgroundDiagnosticItems(backgroundDiagnosticItemsInputSchema.parse({ jobId: 'job', reportId }), h as never)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('returns expired counters without querying removed evidence or falling back to mutable domain data', async () => {
    const h = harness()
    h.systemJobDiagnosticReport.findFirst.mockResolvedValue({ ...report, expiredAt: now })
    const result = await listBackgroundDiagnosticItems(
      backgroundDiagnosticItemsInputSchema.parse({ jobId: 'job', reportId }),
      h as never
    )
    expect(result.summary).toMatchObject({ expired: true, itemCount: 13 })
    expect(result.items).toEqual([])
    expect(h.systemJobDiagnosticItem.findMany).not.toHaveBeenCalled()
    await expect(
      listBackgroundDiagnosticItems(
        backgroundDiagnosticItemsInputSchema.parse({ jobId: 'job', reportId: 'legacy' }),
        h as never
      )
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
  it('does not manufacture old failures after archive retry breaks the current binding', async () => {
    const h = harness()
    h.systemJobDiagnosticReport.findMany.mockResolvedValue([])
    const result = await listBackgroundDiagnosticReports(
      backgroundDiagnosticReportsInputSchema.parse({ jobId: 'job' }),
      h as never
    )
    expect(result.items[0]?.source).toBe('SUMMARY_ONLY')
    expect(h.archiveImport.findUnique).toHaveBeenCalledWith({
      where: { systemJobId: 'job' },
      select: { id: true, failedItems: true }
    })
    expect(h.archiveImportItem.findMany).not.toHaveBeenCalled()
  })
  it('hides expired evidence before retention cleanup has finished', async () => {
    const h = harness()
    h.systemJobDiagnosticReport.findFirst.mockResolvedValue({ ...report, expiresAt: new Date(0), expiredAt: null })
    const result = await listBackgroundDiagnosticItems(
      backgroundDiagnosticItemsInputSchema.parse({ jobId: 'job', reportId }),
      h as never
    )
    expect(result.summary).toMatchObject({ expired: true, itemCount: 13 })
    expect(h.systemJobDiagnosticItem.findMany).not.toHaveBeenCalled()
    expect(h.systemJobDiagnosticItem.groupBy).not.toHaveBeenCalled()
    expect(h.systemJobDiagnosticItem.findFirst).not.toHaveBeenCalled()
  })
  it('distinguishes known nested legacy totals from unknown sample totals', async () => {
    const h = harness()
    h.systemJobDiagnosticReport.findMany.mockResolvedValue([])
    h.systemJob.findUnique.mockResolvedValue({
      ...job,
      type: 'VIDEO_MEDIA_PROBE',
      result: { probe: { failed: 10 }, poster: { failed: 3 } }
    })
    const known = await listBackgroundDiagnosticReports(
      backgroundDiagnosticReportsInputSchema.parse({ jobId: 'job' }),
      h as never
    )
    expect(known.items[0]).toMatchObject({ totalKnown: true, itemCount: 13, recordedCount: 0 })
    h.systemJob.findUnique.mockResolvedValue({
      ...job,
      type: 'VIDEO_KEYFRAME_GENERATION',
      result: { failedSamples: [{ error: 'failure' }] }
    })
    const unknown = await listBackgroundDiagnosticReports(
      backgroundDiagnosticReportsInputSchema.parse({ jobId: 'job' }),
      h as never
    )
    expect(unknown.items[0]).toMatchObject({ totalKnown: false, recordedCount: 1, source: 'LEGACY_SAMPLES' })
  })
  it('retains legacy samples explicitly as incomplete and sanitizes messages', async () => {
    const h = harness()
    h.systemJob.findUnique.mockResolvedValue({
      ...job,
      type: 'WEBP_ANIMATION_SCAN',
      result: {
        failed: 27,
        failedSamples: [
          { id: 1, path: 'a.webp', errorCode: 'ENOENT', error: 'https://host/private/token?secret=abc missing' }
        ]
      }
    })
    h.systemJobDiagnosticReport.findFirst.mockResolvedValue(null)
    const result = await listBackgroundDiagnosticItems(
      backgroundDiagnosticItemsInputSchema.parse({ jobId: 'job', reportId: 'legacy' }),
      h as never
    )
    expect(result.summary).toMatchObject({ source: 'LEGACY_SAMPLES', complete: false, itemCount: 27 })
    expect(result.items).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('secret=abc')
  })
  it('preserves the actual message and artwork identity of old migration samples', async () => {
    const h = harness()
    h.systemJobDiagnosticReport.findFirst.mockResolvedValue(null)
    h.systemJob.findUnique.mockResolvedValue({
      ...job,
      type: 'MIGRATION',
      result: { failed: 1, failedSamples: [{ artworkId: 42, code: 'SOURCE_NOT_FOUND', message: '迁移源文件已不存在' }] }
    })
    const result = await listBackgroundDiagnosticItems(
      backgroundDiagnosticItemsInputSchema.parse({ jobId: 'job', reportId: 'legacy' }),
      h as never
    )
    expect(result.items[0]).toMatchObject({ targetLabel: '42', message: '迁移源文件已不存在', href: '/artworks/42' })
  })
  it('marks only the latest completed execution with failed items as partial', () => {
    expect(
      hasPartialFailure({
        status: 'COMPLETED',
        currentDiagnosticExecutionId: reportId,
        diagnosticReports: [{ id: reportId, itemCount: 2, outcome: 'COMPLETED' }]
      })
    ).toBe(true)
    expect(
      hasPartialFailure({
        status: 'COMPLETED',
        currentDiagnosticExecutionId: 'new-success',
        diagnosticReports: [{ id: reportId, itemCount: 2, outcome: 'COMPLETED' }]
      })
    ).toBe(false)
  })
})
