import { ACTIVE_JOB_STATUSES, type JobStatus } from '@pixishelf/job-contracts'

export interface SourceAuditApplyHistoryItem {
  auditDifferenceKind: string | null
  applyOutcome: string | null
  applyReasonCode: string | null
  applyRetryable: boolean | null
  resultArtworkId?: number | null
  finishedAt: Date | null
  scanRun: { id: string; systemJob: { status: string } | null }
}

export type SourceAuditApplyAction = 'IMPORT' | 'SYNC'

export function decideSourceAuditItemApply(
  action: SourceAuditApplyAction | null,
  history: readonly SourceAuditApplyHistoryItem[]
) {
  const latestResult = history.find((item) => item.applyOutcome !== null) ?? null
  if (!action) return { state: 'NOT_APPLICABLE' as const, action: null, latestResult }
  if (history.length === 0) return { state: 'ELIGIBLE' as const, action, latestResult }
  const expectedDifferenceKind = action === 'IMPORT' ? 'NEW' : 'CHANGED'
  const malformed = history.some(
    (item) =>
      item.auditDifferenceKind !== expectedDifferenceKind ||
      item.scanRun.systemJob === null ||
      ![null, 'APPLIED', 'SKIPPED', 'CONFLICT', 'FAILED'].includes(item.applyOutcome)
  )
  if (malformed) return { state: 'REQUIRES_NEW_AUDIT' as const, action: null, latestResult }
  if (
    history.some(
      (item) => item.scanRun.systemJob !== null && ACTIVE_JOB_STATUSES.has(item.scanRun.systemJob.status as JobStatus)
    )
  ) {
    return { state: 'IN_PROGRESS' as const, action: null, latestResult }
  }
  if (
    history.some(
      (item) =>
        item.applyOutcome === 'APPLIED' ||
        (item.applyOutcome === 'SKIPPED' && item.applyReasonCode !== 'STALE_SOURCE_INPUT')
    )
  ) {
    return { state: 'ALREADY_APPLIED' as const, action: null, latestResult }
  }
  if (
    history.some(
      (item) =>
        item.applyOutcome === 'CONFLICT' ||
        item.applyOutcome === 'SKIPPED' ||
        (item.applyOutcome === 'FAILED' && item.applyRetryable !== true)
    )
  ) {
    return { state: 'REQUIRES_NEW_AUDIT' as const, action: null, latestResult }
  }
  const retryableFailuresOnly = history.every((item) => item.applyOutcome === 'FAILED' && item.applyRetryable === true)
  return retryableFailuresOnly
    ? { state: 'ELIGIBLE' as const, action, latestResult }
    : { state: 'REQUIRES_NEW_AUDIT' as const, action: null, latestResult }
}

const SAFE_APPLY_RESULT_CODES = new Set([
  'ALREADY_APPLIED',
  'STALE_SOURCE_INPUT',
  'SOURCE_IDENTITY_CHANGED',
  'INVENTORY_CHANGED',
  'MEDIA_NOT_FOUND',
  'MEDIA_VALIDATION_FAILED',
  'METADATA_INVALID',
  'OPERATION_CANCELLED',
  'OPERATION_FAILED'
])

export function safeApplyResultCode(value: string | null) {
  if (!value) return null
  return SAFE_APPLY_RESULT_CODES.has(value) ? value : 'APPLY_ITEM_FAILED'
}

export function safeApplyResultSummary(code: string) {
  switch (code) {
    case 'ALREADY_APPLIED':
      return '该来源内容已经同步，无需重复处理。'
    case 'STALE_SOURCE_INPUT':
      return '来源文件在核对后发生变化，请重新运行来源核对。'
    case 'SOURCE_IDENTITY_CHANGED':
    case 'INVENTORY_CHANGED':
      return '图库身份或来源记录已经变化，请检查后重新核对。'
    case 'MEDIA_NOT_FOUND':
    case 'MEDIA_VALIDATION_FAILED':
      return '来源媒体未通过安全校验，本项未执行同步。'
    case 'METADATA_INVALID':
      return '来源元数据未通过校验，本项未执行同步。'
    case 'OPERATION_CANCELLED':
      return '任务取消前未处理本项。'
    default:
      return '本项执行失败，未完成来源同步。'
  }
}

export function sourceAuditLatestApplyResult(
  action: SourceAuditApplyAction | null,
  latest: SourceAuditApplyHistoryItem | null
) {
  if (!action || !latest?.applyOutcome) return null
  const code = safeApplyResultCode(latest.applyReasonCode)
  const result =
    latest.applyOutcome === 'SKIPPED' && code === 'STALE_SOURCE_INPUT'
      ? 'STALE'
      : ['APPLIED', 'SKIPPED', 'CONFLICT', 'FAILED'].includes(latest.applyOutcome)
        ? latest.applyOutcome
        : 'FAILED'
  return {
    operationId: latest.scanRun.id,
    action,
    result,
    code,
    summary: code ? safeApplyResultSummary(code) : null,
    retryable: latest.applyRetryable === true,
    finishedAt: latest.finishedAt?.toISOString() ?? null
  }
}
