const ACTIVE_RUN_STATUSES = new Set(['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'])

export function isActiveArchiveUploaderRunStatus(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && ACTIVE_RUN_STATUSES.has(status)
}

export function archiveUploaderDetailPollingInterval(
  detail: { runs: ReadonlyArray<{ status: string }> } | null | undefined
): number | false {
  return detail?.runs.some(({ status }) => isActiveArchiveUploaderRunStatus(status)) ? 2_000 : false
}
