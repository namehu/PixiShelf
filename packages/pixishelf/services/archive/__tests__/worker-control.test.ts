import { describe, expect, it } from 'vitest'
import { ArchiveError } from '../errors'
import { selectPrimaryWorkerError } from '../worker-control'

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
})
