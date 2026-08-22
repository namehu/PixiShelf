import type { LocalDirectoryImportPayload } from '@pixishelf/job-contracts'
import {
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type EnqueuedChildJob,
  type ExecutionContext,
  type FencedExecutionTransaction
} from '@pixishelf/job-runtime'
import { describe, expect, it, vi } from 'vitest'
import { ScanExecutorError } from '../errors.js'
import { finalizeScanError, finalizeScanSuccess } from '../lifecycle.js'
import type { ScanTransaction } from '../types.js'

const now = new Date('2026-08-15T01:00:00.000Z')
const startedAt = new Date('2026-08-15T00:59:48.000Z')
const result = { scanRunId: 'run-1', total: 2, succeeded: 2, skipped: 0, failed: 0, newImages: 3 }

describe('scan fenced lifecycle', () => {
  it('performs FULL sweep only in the successful final transaction before queue completion', async () => {
    const order: string[] = []
    const transaction = transactionFixture(order)
    const context = contextFixture(transaction, 'RUNNING', order)

    await expect(
      finalizeScanSuccess({
        context,
        runId: 'run-1',
        result,
        startedAt,
        now,
        fullReconcile: { frozenAt: now, maxSweepReferences: 100 }
      })
    ).resolves.toEqual(TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME)

    const sweepWhere = {
      providerKey: 'pixiv',
      createdAt: { lte: now },
      OR: [{ lastSeenScanRunId: null }, { lastSeenScanRunId: { not: 'run-1' } }]
    }
    expect(transaction.artworkExternalRef.findMany).toHaveBeenCalledWith({
      where: sweepWhere,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 101
    })
    expect(transaction.artworkExternalRef.deleteMany).toHaveBeenCalledWith({
      where: {
        ...sweepWhere,
        id: { in: ['ref-0', 'ref-1', 'ref-2', 'ref-3'] }
      }
    })
    expect(order).toEqual(['sweep', 'run:COMPLETED', 'complete'])
    expect(transaction.scanRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ durationMs: 12_000 }) })
    )
  })

  it.each([
    ['PAUSING', 'PAUSED', 'pause'],
    ['CANCELLING', 'CANCELLED', 'cancel']
  ] as const)('lets locked %s control win and never sweeps', async (executionStatus, runStatus, finalizer) => {
    const transaction = transactionFixture()
    const context = contextFixture(transaction, executionStatus)

    await finalizeScanSuccess({
      context,
      runId: 'run-1',
      result,
      startedAt,
      now,
      fullReconcile: { frozenAt: now, maxSweepReferences: 100 }
    })

    expect(transaction.artworkExternalRef.deleteMany).not.toHaveBeenCalled()
    expect(transaction.scanRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: runStatus }) })
    )
    expect(context.__scope[finalizer]).toHaveBeenCalledOnce()
    expect(context.__scope.complete).not.toHaveBeenCalled()
  })

  it('does not sweep after a FULL processing failure and fails domain + job atomically', async () => {
    const transaction = transactionFixture()
    const context = contextFixture(transaction, 'RUNNING')

    await finalizeScanError({
      context,
      runId: 'run-1',
      error: new ScanExecutorError('METADATA_INVALID', 'A frozen input is invalid'),
      now,
      retryDelayMs: 1_000
    })

    expect(transaction.artworkExternalRef.deleteMany).not.toHaveBeenCalled()
    expect(transaction.scanRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    )
    expect(context.__scope.fail).toHaveBeenCalledOnce()
  })

  it.each(['SOURCE_NOT_READABLE', 'METADATA_INVALID', 'MEDIA_NOT_FOUND'] as const)(
    'reports source input error %s as a precondition failure instead of an internal error',
    async (code) => {
      const transaction = transactionFixture()
      const context = contextFixture(transaction, 'RUNNING')

      await finalizeScanError({
        context,
        runId: 'run-1',
        error: new ScanExecutorError(code, 'A source input needs attention'),
        now,
        retryDelayMs: 1_000
      })

      expect(context.__scope.fail).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: 'PRECONDITION_FAILED', error: 'A source input needs attention' })
      )
    }
  )

  it('pauses for action instead of sweeping an empty FULL snapshot or an abnormal sweep volume', async () => {
    const emptyTransaction = transactionFixture()
    const emptyContext = contextFixture(emptyTransaction, 'RUNNING')
    await finalizeScanError({
      context: emptyContext,
      runId: 'run-1',
      error: new ScanExecutorError('EMPTY_FULL_RECONCILE', 'Full reconcile discovered no metadata inputs'),
      now,
      retryDelayMs: 1_000
    })
    expect(emptyContext.__scope.pause).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'ACTION_REQUIRED', data: { decisionCode: 'EMPTY_FULL_RECONCILE' } })
    )
    expect(emptyTransaction.artworkExternalRef.deleteMany).not.toHaveBeenCalled()

    const largeTransaction = transactionFixture([], 101)
    const largeContext = contextFixture(largeTransaction, 'RUNNING')
    await finalizeScanSuccess({
      context: largeContext,
      runId: 'run-1',
      result,
      startedAt,
      now,
      fullReconcile: { frozenAt: now, maxSweepReferences: 100 }
    })
    expect(largeContext.__scope.pause).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'ACTION_REQUIRED',
        data: { decisionCode: 'FULL_SWEEP_LIMIT_EXCEEDED', sweepCount: 101 }
      })
    )
    expect(largeTransaction.artworkExternalRef.deleteMany).not.toHaveBeenCalled()
  })

  it('atomically releases an interrupted RUNNING run for checkpoint resume', async () => {
    const transaction = transactionFixture()
    const controller = new AbortController()
    controller.abort(new Error('shutdown'))
    const context = contextFixture(transaction, 'RUNNING', [], controller.signal)

    await finalizeScanError({ context, runId: 'run-1', error: controller.signal.reason, now, retryDelayMs: 1_000 })

    expect(transaction.scanRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) })
    )
    expect(context.__scope.release).toHaveBeenCalledOnce()
  })

  it('does no domain write when a stale fence rejects before entering the callback', async () => {
    const transaction = transactionFixture()
    const context = contextFixture(transaction, 'RUNNING')
    context.finalizeInTransaction = vi.fn(async () => {
      throw new Error('LEASE_LOST')
    }) as never

    await expect(finalizeScanSuccess({ context, runId: 'run-1', result, startedAt, now })).rejects.toThrow('LEASE_LOST')
    expect(transaction.scanRun.update).not.toHaveBeenCalled()
    expect(transaction.artworkExternalRef.deleteMany).not.toHaveBeenCalled()
  })
})

function transactionFixture(order: string[] = [], sweepCount = 4) {
  const candidates = Array.from({ length: sweepCount }, (_, index) => ({ id: `ref-${index}` }))
  return {
    artworkExternalRef: {
      findMany: vi.fn(async () => candidates),
      deleteMany: vi.fn(async () => (order.push('sweep'), { count: candidates.length }))
    },
    scanRun: {
      update: vi.fn(async (input: { data: { status: string } }) => {
        order.push(`run:${input.data.status}`)
        return {}
      })
    }
  } as unknown as ScanTransaction & {
    artworkExternalRef: { findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> }
    scanRun: { update: ReturnType<typeof vi.fn> }
  }
}

function contextFixture(
  transaction: ScanTransaction,
  executionStatus: 'RUNNING' | 'PAUSING' | 'CANCELLING',
  order: string[] = [],
  signal = new AbortController().signal
) {
  const scope = {
    transaction,
    executionStatus,
    controlStatus:
      executionStatus === 'RUNNING'
        ? 'CONTINUE'
        : executionStatus === 'PAUSING'
          ? 'PAUSE_REQUESTED'
          : 'CANCEL_REQUESTED',
    complete: vi.fn(async () => void order.push('complete')),
    fail: vi.fn(async () => void order.push('fail')),
    retry: vi.fn(async () => void order.push('retry')),
    skip: vi.fn(),
    cancel: vi.fn(async () => void order.push('cancel')),
    pause: vi.fn(async () => void order.push('pause')),
    release: vi.fn(async () => void order.push('release'))
  } as unknown as FencedExecutionTransaction<ScanTransaction>
  const context = {
    job: { id: 'job-1', attempt: 1, maxAttempts: 1 },
    payload: { defaultTagIds: [], mappingCount: 0, mappingDigest: 'a'.repeat(64) },
    signal,
    finalizeInTransaction: vi.fn(async (operation: (value: typeof scope) => Promise<void>) => {
      await operation(scope)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    }),
    mutateInTransaction: vi.fn(),
    progress: vi.fn(),
    enqueueChild: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    __scope: scope
  }
  return context as unknown as ExecutionContext<LocalDirectoryImportPayload, EnqueuedChildJob> & {
    __scope: typeof scope
  }
}
