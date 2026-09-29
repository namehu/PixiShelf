import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtistMergePayload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext } from '@pixishelf/job-runtime'
const apply = vi.hoisted(() => vi.fn())
vi.mock('@pixishelf/db', () => ({ applyArtistMerge: apply }))
import { executeArtistMerge } from '../artist-merge'

describe('artist merge executor', () => {
  beforeEach(() => vi.clearAllMocks())
  async function execute(status: string, aborted = false) {
    const controller = new AbortController()
    if (aborted) controller.abort()
    const scope = {
      transaction: {},
      executionStatus: status,
      complete: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      release: vi.fn()
    }
    await executeArtistMerge({
      job: { id: 'job' },
      payload: { mergeId: 'merge' },
      signal: controller.signal,
      finalizeInTransaction: async (run: (value: typeof scope) => Promise<void>) => run(scope)
    } as unknown as ExecutionContext<ArtistMergePayload, EnqueuedChildJob>)
    return scope
  }
  it('publishes its result inside the same fenced transaction', async () => {
    apply.mockResolvedValue({ mergedCount: 3 })
    const scope = await execute('RUNNING')
    expect(apply).toHaveBeenCalledWith(scope.transaction, 'merge', 'job')
    expect(scope.complete).toHaveBeenCalledWith(
      expect.objectContaining({ result: { mergeId: 'merge', summary: { mergedCount: 3 } } })
    )
  })
  it.each(['CANCELLING', 'PAUSING'])('does not mutate artists when %s', async (status) => {
    const scope = await execute(status)
    expect(apply).not.toHaveBeenCalled()
    expect(status === 'CANCELLING' ? scope.cancel : scope.pause).toHaveBeenCalledOnce()
    expect(scope.complete).not.toHaveBeenCalled()
  })
  it('releases interrupted work before mutation', async () => {
    const scope = await execute('RUNNING', true)
    expect(scope.release).toHaveBeenCalledOnce()
    expect(apply).not.toHaveBeenCalled()
  })
  it('propagates failure to roll back the finalization transaction', async () => {
    apply.mockRejectedValue(new Error('stale preview'))
    await expect(execute('RUNNING')).rejects.toThrow('stale preview')
  })
})
