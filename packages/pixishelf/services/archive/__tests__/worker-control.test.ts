import { describe, expect, it } from 'vitest'
import { ArchiveError } from '../errors'
import { classifyArchiveFailure, runConcurrentArchiveRound, selectPrimaryWorkerError } from '../worker-control'

describe('archive worker error selection', () => {
  it('does not let a peer cancellation hide the pause-worthy root failure', () => {
    const quota = new ArchiveError('REMOTE_QUOTA_EXCEEDED', 'quota', { pause: true, recoverable: true })
    const cancelled = new ArchiveError('CANCELLED', 'peer aborted', { recoverable: true })

    expect(selectPrimaryWorkerError(null, [cancelled, quota])).toBe(quota)
    expect(selectPrimaryWorkerError(quota, [cancelled])).toBe(quota)
  })

  it('preserves an explicit worker shutdown reason', () => {
    const stopped = new ArchiveError('WORKER_STOPPED', 'stopping', { recoverable: true })
    expect(selectPrimaryWorkerError(stopped, [new ArchiveError('CANCELLED', 'aborted')])).toBe(stopped)
  })

  it.each([
    [new ArchiveError('REMOTE_RESPONSE_INVALID', 'timeout', { recoverable: true }), 'RETRY_ITEM'],
    [new ArchiveError('MEDIA_INVALID', 'truncated', { recoverable: true }), 'RETRY_ITEM'],
    [new ArchiveError('REMOTE_NOT_FOUND', 'missing'), 'FAIL_ITEM'],
    [new ArchiveError('DOWNLOAD_TOO_LARGE', 'large'), 'FAIL_ITEM'],
    [new ArchiveError('REMOTE_RATE_LIMITED', 'rate', { pause: true }), 'PAUSE_TASK'],
    [new ArchiveError('REMOTE_QUOTA_EXCEEDED', 'quota', { pause: true }), 'PAUSE_TASK'],
    [new ArchiveError('STORAGE_FULL', 'disk'), 'STOP_TASK'],
    [new ArchiveError('INTERNAL', 'database'), 'STOP_TASK']
  ])('classifies failure scope without turning item failures into task failures', (error, expected) => {
    expect(classifyArchiveFailure(error)).toBe(expected)
  })

  it('finishes the rest of a round before retrying a temporary item failure', async () => {
    const calls: number[] = []
    const firstRound = await runConcurrentArchiveRound(
      [0, 1, 2],
      2,
      async (item) => {
        calls.push(item)
        return item === 0 ? { kind: 'RETRY' as const, item } : { kind: 'COMPLETED' as const }
      },
      () => undefined
    )
    const retryItems = firstRound.results.flatMap((result) => (result.kind === 'RETRY' ? [result.item] : []))

    await runConcurrentArchiveRound(
      retryItems,
      2,
      async (item) => {
        calls.push(item)
        return { kind: 'COMPLETED' as const }
      },
      () => undefined
    )

    expect(firstRound.rejectedReasons).toEqual([])
    expect(calls.slice(0, 3).sort()).toEqual([0, 1, 2])
    expect(calls.at(-1)).toBe(0)
  })

  it('reports a task-level failure and stops claiming new work in that worker', async () => {
    const calls: number[] = []
    const failures: unknown[] = []
    const result = await runConcurrentArchiveRound(
      [0, 1, 2],
      1,
      async (item) => {
        calls.push(item)
        if (item === 0) throw new ArchiveError('STORAGE_FULL', 'disk full')
        return item
      },
      (error) => failures.push(error)
    )

    expect(calls).toEqual([0])
    expect(failures).toHaveLength(1)
    expect(result.rejectedReasons).toEqual([expect.objectContaining({ code: 'STORAGE_FULL' })])
  })
})
