export type ArchiveItemFilter = 'ALL' | 'COMPLETED' | 'FAILED' | 'PENDING' | 'DOWNLOADING'

export function defaultArchiveItemFilter(status: string, errorCode: string | null): ArchiveItemFilter {
  return status === 'FAILED' && errorCode === 'PARTIAL_FAILURE' ? 'FAILED' : 'ALL'
}

export function archiveItemPollingIntervals(status: string): {
  counts: number | false
  items: number | false
} {
  const active = ['PENDING', 'RUNNING', 'CANCELLING'].includes(status)
  return active ? { counts: 1_500, items: 3_000 } : { counts: false, items: false }
}
