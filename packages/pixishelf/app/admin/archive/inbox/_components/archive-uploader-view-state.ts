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
