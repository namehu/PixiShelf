import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialDiscoveryBatchCheckpoint, type DiscoveryBatchCheckpoint } from '@pixishelf/job-contracts'
import { executeDiscoveryBatch } from '../discovery-batch-executor.js'
import { enqueueDiscoveryScan } from '../discovery-scan-enqueue.js'

vi.mock('../discovery-scan-enqueue.js', () => ({
  enqueueDiscoveryScan: vi.fn(async () => ({ systemJobId: 'new-child' })),
  lockDiscoverySource: vi.fn(),
  DiscoveryScanConflict: class extends Error {}
}))

beforeEach(() => vi.clearAllMocks())

function fixture(
  options: {
    state?: Partial<DiscoveryBatchCheckpoint>
    child?: { status: string; result?: unknown; error?: string } | null
    source?: { status: string; incrementalCursor: string | null; historyCursor: string | null } | null
    occupied?: boolean
  } = {}
) {
  const state = { ...initialDiscoveryBatchCheckpoint(), ...options.state }
  const source =
    options.source === undefined ? { status: 'ACTIVE', incrementalCursor: null, historyCursor: null } : options.source
  const tx = {
    systemJob: {
      findUniqueOrThrow: vi.fn(async () => ({ id: 'batch', requestedByUserId: 'admin', result: state })),
      findUnique: vi.fn(async () => options.child ?? null),
      update: vi.fn()
    },
    archiveUploaderSource: { findUnique: vi.fn(async () => source && { id: 'a', ...source }) },
    archiveUploaderScanRun: { findFirst: vi.fn(async () => (options.occupied ? { id: 'other' } : null)) }
  }
  const scope = {
    transaction: tx,
    executionStatus: 'RUNNING',
    complete: vi.fn(),
    retry: vi.fn(),
    pause: vi.fn(),
    cancel: vi.fn(),
    release: vi.fn()
  }
  const context = {
    job: { id: 'batch' },
    payload: {
      sources: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' }
      ]
    },
    signal: new AbortController().signal,
    finalizeInTransaction: async (callback: (scope: unknown) => Promise<void>) => {
      await callback(scope)
      return { kind: 'transactionally-finalized' }
    }
  }
  return { context: context as never, scope, tx }
}

describe('discovery batch round orchestration', () => {
  it('creates one latest child and saves its identity before yielding without consuming an attempt', async () => {
    const f = fixture()
    await executeDiscoveryBatch(f.context)
    expect(enqueueDiscoveryScan).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({
        sourceId: 'a',
        mode: 'LATEST',
        parentJobId: 'batch',
        idempotencyKey: 'discovery-batch:batch:0:0'
      })
    )
    expect(f.tx.systemJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: expect.objectContaining({ childJobId: 'new-child', round: 1 }) })
      })
    )
    expect(f.scope.retry).toHaveBeenCalledWith(expect.objectContaining({ preserveAttempt: true, schedulingYield: true }))
  })
  it.each(['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'])(
    'does not duplicate a %s child after restart',
    async (status) => {
      const f = fixture({ state: { childJobId: 'old-child', round: 1 }, child: { status } })
      await executeDiscoveryBatch(f.context)
      expect(enqueueDiscoveryScan).not.toHaveBeenCalled()
      expect(f.scope.retry).toHaveBeenCalled()
    }
  )
  it.each([
    ['LATEST', 'increment', 'history', 'LATEST'],
    ['LATEST', null, 'history', 'HISTORY'],
    ['HISTORY', null, 'older-history', 'HISTORY']
  ] as const)('continues %s using durable cursors', async (phase, incrementalCursor, historyCursor, expected) => {
    const f = fixture({
      state: { phase, childJobId: 'old-child', round: 2 },
      child: { status: 'COMPLETED' },
      source: { status: 'ACTIVE', incrementalCursor, historyCursor }
    })
    await executeDiscoveryBatch(f.context)
    expect(enqueueDiscoveryScan).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({ mode: expected, idempotencyKey: 'discovery-batch:batch:0:2' })
    )
  })
  it('starts UID coverage again after name binding cleared both cursors', async () => {
    const f = fixture({
      state: { childJobId: 'old-child' },
      child: { status: 'COMPLETED', result: { uidDiscovery: { outcome: 'BOUND' } } }
    })
    await executeDiscoveryBatch(f.context)
    expect(enqueueDiscoveryScan).toHaveBeenCalledWith(f.tx, expect.objectContaining({ mode: 'LATEST' }))
  })
  it('moves to the next source once both cursors are exhausted, without chasing latest again', async () => {
    const f = fixture({ state: { phase: 'HISTORY', childJobId: 'old-child' }, child: { status: 'COMPLETED' } })
    await executeDiscoveryBatch(f.context)
    expect(enqueueDiscoveryScan).not.toHaveBeenCalled()
    expect(f.tx.systemJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: expect.objectContaining({
            index: 1,
            phase: 'LATEST',
            childJobId: null,
            results: [expect.objectContaining({ status: 'COMPLETED' })]
          })
        })
      })
    )
  })
  it('records final failure and continues to the next source', async () => {
    const f = fixture({
      state: { childJobId: 'failed-child' },
      child: { status: 'FAILED', error: 'remote unavailable' }
    })
    await executeDiscoveryBatch(f.context)
    expect(f.tx.systemJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: expect.objectContaining({ index: 1, results: [expect.objectContaining({ status: 'FAILED' })] })
        })
      })
    )
  })
  it.each([
    { source: null },
    { source: { status: 'ARCHIVED', incrementalCursor: null, historyCursor: null } },
    { occupied: true }
  ])('skips missing, disabled, or occupied sources', async (options) => {
    const f = fixture(options)
    await executeDiscoveryBatch(f.context)
    expect(enqueueDiscoveryScan).not.toHaveBeenCalled()
    expect(f.tx.systemJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: expect.objectContaining({ index: 1, results: [expect.objectContaining({ status: 'SKIPPED' })] })
        })
      })
    )
  })
  it('does not dispatch a child while paused', async () => {
    const f = fixture({ state: { control: 'PAUSE' } })
    await executeDiscoveryBatch(f.context)
    expect(f.scope.pause).toHaveBeenCalled()
    expect(enqueueDiscoveryScan).not.toHaveBeenCalled()
  })
  it('waits for cancelling child to finish before terminating the batch', async () => {
    const pending = fixture({ state: { control: 'CANCEL', childJobId: 'child' }, child: { status: 'CANCELLING' } })
    await executeDiscoveryBatch(pending.context)
    expect(pending.scope.cancel).not.toHaveBeenCalled()
    const done = fixture({ state: { control: 'CANCEL', childJobId: 'child' }, child: { status: 'CANCELLED' } })
    await executeDiscoveryBatch(done.context)
    expect(done.scope.cancel).toHaveBeenCalled()
    expect(enqueueDiscoveryScan).not.toHaveBeenCalled()
  })
})
