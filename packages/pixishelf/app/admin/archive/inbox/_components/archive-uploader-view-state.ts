const ACTIVE_RUN_STATUSES = new Set(['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'])

export function isActiveArchiveUploaderRunStatus(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && ACTIVE_RUN_STATUSES.has(status)
}

export function archiveUploaderDetailPollingInterval(
  detail:
    | {
        source?: { catalogCounts?: { processing: number } }
        runs: ReadonlyArray<{ status: string }>
      }
    | null
    | undefined
): number | false {
  return detail?.runs.some(({ status }) => isActiveArchiveUploaderRunStatus(status)) ||
    (detail?.source?.catalogCounts?.processing ?? 0) > 0
    ? 3_000
    : false
}

export function latestCoverageLabel(value: 'NOT_SCANNED' | 'HAS_MORE' | 'CURRENT') {
  return {
    NOT_SCANNED: '尚未扫描',
    HAS_MORE: '还有未完成批次',
    CURRENT: '已追到上次水位'
  }[value]
}

export function historyCoverageLabel(value: 'NOT_SCANNED' | 'HAS_MORE' | 'EXHAUSTED') {
  return {
    NOT_SCANNED: '尚未扫描',
    HAS_MORE: '仍有更早内容',
    EXHAUSTED: '已扫描到最早记录'
  }[value]
}

export function scanStopReasonLabel(reason: 'LIMIT_REACHED' | 'WATERMARK_REACHED' | 'REMOTE_END') {
  return {
    LIMIT_REACHED: '本批达到 100 条，仍可继续',
    WATERMARK_REACHED: '已追到上次水位',
    REMOTE_END: '已到远端末尾'
  }[reason]
}

export function scanIdentityLabel(kind: 'NAME' | 'UID' | null, value: string | null) {
  if (!kind || !value) return '按标题关键词'
  return kind === 'UID' ? `按 UID ${value}` : `按名称 ${value}`
}

export function scanRunStatusLabel(
  status: 'PENDING' | 'RUNNING' | 'RETRY_WAIT' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
) {
  return {
    PENDING: '等待中',
    RUNNING: '扫描中',
    RETRY_WAIT: '等待重试',
    PAUSED: '已暂停',
    COMPLETED: '已完成',
    FAILED: '失败',
    CANCELLED: '已取消'
  }[status]
}

export function formatArchiveUploaderTimestamp(value: Date | string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

export function archiveUploaderCatalogViewCount(
  counts: { actionable: number; processing: number; archived: number; attention: number; total: number },
  view: 'ACTIONABLE' | 'PROCESSING' | 'ARCHIVED' | 'ATTENTION' | 'ALL'
) {
  return {
    ACTIONABLE: counts.actionable,
    PROCESSING: counts.processing,
    ARCHIVED: counts.archived,
    ATTENTION: counts.attention,
    ALL: counts.total
  }[view]
}
