import { ArchiveError, toArchiveError } from './errors'

export type ArchiveFailureDisposition = 'RETRY_ITEM' | 'FAIL_ITEM' | 'PAUSE_TASK' | 'STOP_TASK'

export async function runConcurrentArchiveRound<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  processItem: (item: TItem) => Promise<TResult>,
  onWorkerError: (error: unknown) => void
): Promise<{ results: TResult[]; rejectedReasons: unknown[] }> {
  let cursor = 0
  const results: TResult[] = []
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    try {
      while (cursor < items.length) {
        const item = items[cursor++]
        if (item === undefined) return
        results.push(await processItem(item))
      }
    } catch (error) {
      onWorkerError(error)
      throw error
    }
  })
  const settled = await Promise.allSettled(workers)
  return {
    results,
    rejectedReasons: settled.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
  }
}

export function classifyArchiveFailure(error: ArchiveError): ArchiveFailureDisposition {
  if (error.pause) return 'PAUSE_TASK'
  if (
    [
      'STORAGE_FULL',
      'CANCELLED',
      'PAUSED',
      'LEASE_LOST',
      'WORKER_STOPPED',
      'STATE_CONFLICT',
      'PARTIAL_FAILURE',
      'INTERNAL'
    ].includes(error.code)
  ) {
    return 'STOP_TASK'
  }
  if (error.code === 'REMOTE_RESPONSE_INVALID' || error.code === 'MEDIA_INVALID') {
    return error.recoverable ? 'RETRY_ITEM' : 'FAIL_ITEM'
  }
  return 'FAIL_ITEM'
}

/**
 * 对端取消是并发媒体故障导致的结果，而非根因。
 * 保留首次记录的控制器原因，并在其他场景优先保留非取消类失败，以免配额/暂停决策被掩盖。
 */
export function selectPrimaryWorkerError(
  rootError: ArchiveError | null,
  rejectedReasons: unknown[]
): ArchiveError | null {
  if (rootError) return rootError
  const classified = rejectedReasons.map(toArchiveError)
  return classified.find((error) => error.code !== 'CANCELLED') ?? classified[0] ?? null
}
