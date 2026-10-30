import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PostgresQueueRepository,
  type ExecutionFence,
  type FencedMutationTransactionTiming,
  type QueueDatabase,
  type QueueSqlExecutor
} from '../queue-repository.ts'

const fence: ExecutionFence = {
  jobId: 'job', workerId: 'worker', attempt: 1,
  executionToken: '00000000-0000-4000-8000-000000000001'
}

function fixture(options: { rejectPostFence?: boolean; rejectCommit?: boolean } = {}) {
  let elapsed = 0
  let reads = 0
  let committed = false
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
  const transaction: QueueSqlExecutor = {
    $queryRawUnsafe: vi.fn(async (query: string) => {
      reads++
      elapsed += query.includes('job_resource_leases') ? 2 : 3
      if (options.rejectPostFence && reads === 3) return []
      return query.includes('job_resource_leases') ? [{ resourceKey: 'lane/background-writer' }]
        : [{ id: 'job', status: 'RUNNING', stage: null, progress: 0 }]
    }) as QueueSqlExecutor['$queryRawUnsafe'],
    $executeRawUnsafe: vi.fn(async () => 1)
  }
  const database = {
    ...transaction,
    $transaction: vi.fn(async (operation: (tx: QueueSqlExecutor) => Promise<unknown>) => {
      elapsed += 5
      const result = await operation(transaction)
      elapsed += 11
      if (options.rejectCommit) throw new Error('commit rejected')
      committed = true
      return result
    })
  } as QueueDatabase
  return {
    repository: new PostgresQueueRepository(database), transaction, database,
    committed: () => committed, advance: (milliseconds: number) => { elapsed += milliseconds }
  }
}

afterEach(() => vi.restoreAllMocks())

describe('fenced mutation transaction timing', () => {
  it('observes acquisition, both fences, body and commit only after a successful commit', async () => {
    const f = fixture()
    const observations: FencedMutationTransactionTiming[] = []
    const value = await f.repository.withFencedMutationTransaction(fence, async tx => {
      expect(tx).toBe(f.transaction)
      expect(observations).toEqual([])
      f.advance(7)
      return 'saved'
    }, timing => {
      expect(f.committed()).toBe(true)
      observations.push(timing)
    })
    expect(value).toBe('saved')
    expect(observations).toEqual([{
      acquisitionMs: 5, preFenceMs: 5, bodyMs: 7, postFenceMs: 5,
      commitFinalizationMs: 11, wallMs: 33, fenceReadCalls: 4
    }])
    expect(f.transaction.$queryRawUnsafe).toHaveBeenCalledTimes(4)
    expect(f.transaction.$executeRawUnsafe).not.toHaveBeenCalled()
    expect(f.database.$transaction).toHaveBeenCalledTimes(1)
  })

  it.each(['body', 'post-fence', 'commit'] as const)('does not publish committed timing after %s rollback', async phase => {
    const f = fixture({ rejectPostFence: phase === 'post-fence', rejectCommit: phase === 'commit' })
    const observeTiming = vi.fn()
    await expect(f.repository.withFencedMutationTransaction(fence, async () => {
      if (phase === 'body') throw new Error('body rejected')
    }, observeTiming)).rejects.toThrow()
    expect(f.committed()).toBe(false)
    expect(observeTiming).not.toHaveBeenCalled()
  })

  it('keeps observation opt-in and never changes the fenced query sequence', async () => {
    const f = fixture()
    await expect(f.repository.withFencedMutationTransaction(fence, async () => 42)).resolves.toBe(42)
    expect(performance.now).not.toHaveBeenCalled()
    expect(f.transaction.$queryRawUnsafe).toHaveBeenCalledTimes(4)
  })

  it('does not report a committed mutation as failed when telemetry throws', async () => {
    const f = fixture()
    await expect(f.repository.withFencedMutationTransaction(fence, async () => 'saved', () => {
      throw new Error('observer rejected')
    })).resolves.toBe('saved')
    expect(f.committed()).toBe(true)
    expect(f.database.$transaction).toHaveBeenCalledTimes(1)
  })
})
