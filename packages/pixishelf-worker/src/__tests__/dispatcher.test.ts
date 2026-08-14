import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { JOB_DEFINITION_VERSION, type WorkerCapability } from '@pixishelf/job-contracts'
import {
  JobExecutionFenceError,
  type ClaimedJob,
  type ExecutionFence,
  type FencedExecutionTransaction,
  type QueueSqlExecutor
} from '@pixishelf/job-runtime'
import {
  CentralDispatcher,
  type DispatcherQueuePort,
  type DispatcherSettlement,
  type DispatcherTiming,
  type ExecutionControl
} from '../dispatcher.js'
import { ExecutorRegistry } from '../executor-registry.js'
import type { WorkerLogger } from '../logger.js'

describe('CentralDispatcher', () => {
  it('rejects enabled dispatch with an empty registry and never claims while disabled', async () => {
    const queue = createQueue([])
    expect(() => createDispatcher(queue, new ExecutorRegistry())).toThrow('empty executor registry')

    const disabled = createDispatcher(queue, new ExecutorRegistry(), { enabled: false })
    await disabled.prepare()
    disabled.activate()
    await disabled.stop()
    expect(queue.claim).not.toHaveBeenCalled()
  })

  it('does not claim during prepare and starts claiming only after activation', async () => {
    const queue = createQueue([claimedJob('job-activate')])
    const dispatcher = createDispatcher(queue, completedRegistry())

    await dispatcher.prepare()
    await Promise.resolve()
    expect(queue.claim).not.toHaveBeenCalled()
    dispatcher.activate()
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(1))
    await dispatcher.stop()
  })

  it('passes registry capabilities to claim and executes jobs strictly serially', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    const entered: string[] = []
    let active = 0
    let maximumActive = 0
    const queue = createQueue([claimedJob('job-1'), claimedJob('job-2')])
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute: async ({ job }) => {
        entered.push(job.id)
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await (job.id === 'job-1' ? first.promise : second.promise)
        active -= 1
        return { kind: 'completed' }
      }
    })
    const dispatcher = createDispatcher(queue, registry)

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(entered).toEqual(['job-1']))
    expect(queue.claim).toHaveBeenCalledTimes(1)
    first.resolve()
    await vi.waitFor(() => expect(entered).toEqual(['job-1', 'job-2']))
    second.resolve()
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(2))
    await dispatcher.stop()

    expect(maximumActive).toBe(1)
    expect(queue.claim.mock.calls[0]?.[1]).toEqual([{ jobType: 'SCAN', definitionVersions: [JOB_DEFINITION_VERSION] }])
  })

  it('provides progress, child enqueue, abort signal, and a scoped logger to executors', async () => {
    const queue = createQueue([claimedJob('job-context')])
    const logger = createLogger()
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute: async (context) => {
        expect(context.signal.aborted).toBe(false)
        await context.progress({ progress: 42, stage: 'INDEXING', message: 'Working' })
        await context.enqueueChild({ type: 'SCAN', payload: {}, idempotencyKey: 'child-1' })
        context.logger.info('domain-step', { count: 3 })
        return { kind: 'completed', result: { indexed: 3 } }
      }
    })
    const dispatcher = createDispatcher(queue, registry, { logger })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(1))
    await dispatcher.stop()

    expect(queue.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-context', progress: 42, stage: 'INDEXING' })
    )
    expect(queue.enqueueChild).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-context' }),
      expect.objectContaining({ type: 'SCAN', idempotencyKey: 'child-1' })
    )
    expect(logger.info).toHaveBeenCalledWith(
      'worker.job_info',
      expect.objectContaining({ jobId: 'job-context', message: 'domain-step', data: { count: 3 } })
    )
  })

  it('does not settle twice after the executor atomically finalizes its domain transaction', async () => {
    const queue = createQueue([claimedJob('job-domain-finalized')])
    let duplicateFinalizationError: unknown
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute: async (context) => {
        const finalized = await context.finalizeInTransaction(async ({ complete }) => {
          await complete({ result: { published: true } })
        })
        try {
          await context.finalizeInTransaction(async ({ complete }) => complete())
        } catch (error) {
          duplicateFinalizationError = error
        }
        // The dispatcher tracks the successful context call and does not trust a
        // later, accidentally inconsistent executor return value.
        return finalized.kind === 'transactionally-finalized' ? ({ kind: 'completed' } as const) : finalized
      }
    })
    const dispatcher = createDispatcher(queue, registry)

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.claim.mock.calls.length).toBeGreaterThanOrEqual(2))
    await dispatcher.stop()

    expect(queue.withFencedExecutionTransaction).toHaveBeenCalledOnce()
    expect(duplicateFinalizationError).toEqual(expect.objectContaining({ message: expect.stringContaining('already') }))
    expect(queue.settle).not.toHaveBeenCalled()
    expect(queue.settlements).toEqual([])
  })

  it('never falls back to generic settlement after a fenced domain finalization loses ownership', async () => {
    const queue = createQueue([claimedJob('job-domain-fence-lost')])
    vi.mocked(queue.withFencedExecutionTransaction).mockRejectedValueOnce(
      new JobExecutionFenceError('job-domain-fence-lost')
    )
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute: async (context) => {
        try {
          await context.finalizeInTransaction(async ({ complete }) => complete())
        } catch {
          // A swallowed fence error still must not trigger a second settlement.
        }
        return { kind: 'failed', errorCode: 'INTERNAL_ERROR', error: 'must not settle generically' }
      }
    })
    const dispatcher = createDispatcher(queue, registry)

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.claim.mock.calls.length).toBeGreaterThanOrEqual(2))
    await dispatcher.stop()

    expect(queue.settle).not.toHaveBeenCalled()
    expect(queue.settlements).toEqual([])
  })

  it('treats a non-fencing domain finalization failure as fatal without generic settlement', async () => {
    const queue = createQueue([claimedJob('job-domain-finalization-failed')])
    vi.mocked(queue.withFencedExecutionTransaction).mockRejectedValueOnce(new Error('domain transaction unavailable'))
    const onFatal = vi.fn()
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute: async (context) => {
        await context.finalizeInTransaction(async ({ complete }) => complete())
        return { kind: 'completed' }
      }
    })
    const dispatcher = createDispatcher(queue, registry, { onFatal })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(onFatal).toHaveBeenCalledOnce())
    await dispatcher.stop()

    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ message: 'domain transaction unavailable' }))
    expect(queue.settle).not.toHaveBeenCalled()
    expect(queue.settlements).toEqual([])
  })

  it('settles an executor precondition skip with its canonical reason', async () => {
    const queue = createQueue([claimedJob('job-skip')])
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute: async () => ({ kind: 'skipped', reason: 'PRECONDITION_NOT_MET' })
    })
    const dispatcher = createDispatcher(queue, registry)

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(1))
    await dispatcher.stop()

    expect(queue.settlements[0]?.outcome).toEqual({
      kind: 'skipped',
      reason: 'PRECONDITION_NOT_MET'
    })
  })

  it('fails an invalid payload without killing the loop', async () => {
    const invalid = claimedJob('job-invalid')
    invalid.payload = { unexpected: true }
    const queue = createQueue([invalid, claimedJob('job-valid')])
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute: async () => ({ kind: 'completed' })
    })
    const dispatcher = createDispatcher(queue, registry)

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(2))
    await dispatcher.stop()

    expect(queue.settlements.map(({ outcome }) => outcome)).toEqual([
      expect.objectContaining({ kind: 'failed', errorCode: 'INVALID_PAYLOAD' }),
      expect.objectContaining({ kind: 'completed' })
    ])
  })

  it.each([undefined, { kind: 'mystery' }])(
    'fails an invalid executor outcome without killing the loop: %j',
    async (invalidOutcome) => {
      const queue = createQueue([claimedJob('job-invalid-outcome'), claimedJob('job-after-invalid-outcome')])
      const registry = new ExecutorRegistry().register({
        jobType: 'SCAN',
        definitionVersion: JOB_DEFINITION_VERSION,
        execute: async ({ job }) =>
          job.id === 'job-invalid-outcome' ? (invalidOutcome as never) : { kind: 'completed' }
      })
      const dispatcher = createDispatcher(queue, registry)

      await startDispatcher(dispatcher)
      await vi.waitFor(() => expect(queue.settlements).toHaveLength(2))
      await dispatcher.stop()

      expect(queue.settlements.map(({ outcome }) => outcome)).toEqual([
        expect.objectContaining({ kind: 'failed', errorCode: 'INTERNAL_ERROR' }),
        expect.objectContaining({ kind: 'completed' })
      ])
    }
  )

  it('turns retry into a terminal failure when the claimed attempt exhausted its budget', async () => {
    const exhausted = claimedJob('job-retry-exhausted')
    exhausted.attempt = exhausted.maxAttempts
    const queue = createQueue([exhausted])
    const onFatal = vi.fn()
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute: async () => ({
        kind: 'retry',
        availableAt: new Date('2099-08-14T00:01:00.000Z'),
        errorCode: 'DATABASE_UNAVAILABLE',
        error: 'temporary database failure'
      })
    })
    const dispatcher = createDispatcher(queue, registry, { onFatal })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(1))
    await dispatcher.stop()

    expect(queue.settlements[0]?.outcome).toMatchObject({
      kind: 'failed',
      errorCode: 'DATABASE_UNAVAILABLE',
      error: 'temporary database failure'
    })
    expect(onFatal).not.toHaveBeenCalled()
  })

  it('retries a transient claim failure and reports recovery', async () => {
    const queue = createQueue([claimedJob('job-after-claim-error')])
    queue.claim.mockRejectedValueOnce(new Error('database unavailable'))
    const logger = createLogger()
    const dispatcher = createDispatcher(queue, completedRegistry(), {
      logger,
      queueErrorBackoffMs: 200,
      timing: recoveryTiming(200)
    })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(1))
    await dispatcher.stop()

    expect(queue.claim.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(logger.info).toHaveBeenCalledWith(
      'worker.dispatch_queue_recovered',
      expect.objectContaining({ operation: 'claim', failures: 1 })
    )
  })

  it('does not retry a non-transient claim failure', async () => {
    const queue = createQueue([])
    queue.claim.mockRejectedValue(new Error('invalid SQL shape'))
    const onFatal = vi.fn()
    const dispatcher = createDispatcher(queue, completedRegistry(), { onFatal })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(onFatal).toHaveBeenCalledOnce())
    await dispatcher.stop()

    expect(queue.claim).toHaveBeenCalledOnce()
  })

  it('retries a transient settlement failure without losing the dispatcher loop', async () => {
    const queue = createQueue([claimedJob('job-settle-retry')])
    queue.settle.mockRejectedValueOnce(new Error('write conflict'))
    const logger = createLogger()
    const dispatcher = createDispatcher(queue, completedRegistry(), {
      logger,
      queueErrorBackoffMs: 200,
      timing: recoveryTiming(200)
    })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settle).toHaveBeenCalledTimes(2))
    await dispatcher.stop()

    expect(queue.settlements).toHaveLength(1)
    expect(logger.info).toHaveBeenCalledWith(
      'worker.dispatch_queue_recovered',
      expect.objectContaining({ operation: 'settle', failures: 1 })
    )
  })

  it('throttles ordinary progress but always persists stages, warnings, and completion', async () => {
    let now = 0
    const queue = createQueue([claimedJob('job-progress')])
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute: async ({ progress }) => {
        await progress({ progress: 0, stage: 'SCANNING' })
        now += 31_000
        await progress({ progress: 4 })
        await progress({ progress: 5 })
        now += 31_000
        await progress({ progress: 6 })
        await progress({ progress: 6, stage: 'WRITING' })
        await progress({ progress: 7, data: { level: 'WARN', path: 'bad.zip' } })
        await progress({ progress: 100 })
        return { kind: 'completed' }
      }
    })
    const dispatcher = createDispatcher(queue, registry, {
      timing: { now: () => new Date(now), sleep: (_milliseconds, signal) => aborted(signal) }
    })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(1))
    await dispatcher.stop()

    expect(queue.updateProgress.mock.calls.map(([update]) => update.progress)).toEqual([0, 5, 6, 7, 100])
  })

  it('aborts and acknowledges cancellation with the canonical outcome', async () => {
    const queue = createQueue([claimedJob('job-cancel')])
    queue.readExecutionControl.mockResolvedValue({
      status: 'CANCELLING',
      cancelRequestedAt: new Date(),
      pauseRequestedAt: null
    })
    const registry = abortAwareRegistry()
    const dispatcher = createDispatcher(queue, registry, { timing: immediateHeartbeatTiming() })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(1))
    await dispatcher.stop()

    expect(queue.settlements[0]?.outcome).toMatchObject({ kind: 'cancelled' })
  })

  it('rechecks control after the executor returns so a last-moment cancellation wins', async () => {
    const queue = createQueue([claimedJob('job-final-cancel')])
    queue.readExecutionControl.mockResolvedValue({
      status: 'CANCELLING',
      cancelRequestedAt: new Date(),
      pauseRequestedAt: null
    })
    const dispatcher = createDispatcher(queue, completedRegistry())

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(1))
    await dispatcher.stop()

    expect(queue.settlements[0]?.outcome).toMatchObject({ kind: 'cancelled' })
  })

  it('rechecks control after the executor returns so a last-moment pause wins', async () => {
    const queue = createQueue([claimedJob('job-final-pause')])
    queue.readExecutionControl.mockResolvedValue({
      status: 'PAUSING',
      cancelRequestedAt: null,
      pauseRequestedAt: new Date()
    })
    const dispatcher = createDispatcher(queue, completedRegistry())

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(1))
    await dispatcher.stop()

    expect(queue.settlements[0]?.outcome).toMatchObject({ kind: 'paused' })
  })

  it('reconciles a cancellation CAS race instead of treating it as a fatal DB failure', async () => {
    const queue = createQueue([claimedJob('job-cancel-race')])
    queue.readExecutionControl
      .mockResolvedValueOnce({ status: 'RUNNING', cancelRequestedAt: null, pauseRequestedAt: null })
      .mockResolvedValue({ status: 'CANCELLING', cancelRequestedAt: new Date(), pauseRequestedAt: null })
    queue.settle.mockRejectedValueOnce(new JobExecutionFenceError('job-cancel-race'))
    const onFatal = vi.fn()
    const dispatcher = createDispatcher(queue, completedRegistry(), { onFatal })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settle).toHaveBeenCalledTimes(2))
    await dispatcher.stop()

    expect(queue.settle.mock.calls.map(([, outcome]) => outcome.kind)).toEqual(['completed', 'cancelled'])
    expect(onFatal).not.toHaveBeenCalled()
  })

  it('stops settlement without fatal escalation when the execution fence has expired', async () => {
    const queue = createQueue([claimedJob('job-expired')])
    queue.readExecutionControl
      .mockResolvedValueOnce({ status: 'RUNNING', cancelRequestedAt: null, pauseRequestedAt: null })
      .mockRejectedValueOnce(new JobExecutionFenceError('job-expired'))
    queue.settle.mockRejectedValueOnce(new JobExecutionFenceError('job-expired'))
    const onFatal = vi.fn()
    const dispatcher = createDispatcher(queue, completedRegistry(), { onFatal })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.claim.mock.calls.length).toBeGreaterThanOrEqual(2))
    await dispatcher.stop()

    expect(queue.settle).toHaveBeenCalledOnce()
    expect(queue.settlements).toEqual([])
    expect(onFatal).not.toHaveBeenCalled()
  })

  it('aborts and acknowledges pause with the canonical outcome', async () => {
    const queue = createQueue([claimedJob('job-pause')])
    queue.readExecutionControl.mockResolvedValue({
      status: 'PAUSING',
      cancelRequestedAt: null,
      pauseRequestedAt: new Date()
    })
    const dispatcher = createDispatcher(queue, abortAwareRegistry(), {
      timing: immediateHeartbeatTiming()
    })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(1))
    await dispatcher.stop()

    expect(queue.settlements[0]?.outcome).toMatchObject({ kind: 'paused' })
  })

  it('does not settle after a heartbeat reports that the execution lease was lost', async () => {
    const queue = createQueue([claimedJob('job-fenced')])
    queue.heartbeat.mockRejectedValue(new JobExecutionFenceError('job-fenced'))
    const dispatcher = createDispatcher(queue, abortAwareRegistry(), {
      timing: immediateHeartbeatTiming()
    })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.heartbeat).toHaveBeenCalled())
    await vi.waitFor(() => expect(queue.claim).toHaveBeenCalledTimes(2))
    await dispatcher.stop()

    expect(queue.settlements).toEqual([])
  })

  it('retries transient heartbeat and control reads while the lease remains valid', async () => {
    const queue = createQueue([claimedJob('job-monitor-retry')])
    queue.heartbeat
      .mockRejectedValueOnce(Object.assign(new Error('database unavailable'), { code: 'P1001' }))
      .mockResolvedValue(new Date('2099-08-14T00:02:00.000Z'))
    queue.readExecutionControl
      .mockRejectedValueOnce(Object.assign(new Error('write conflict'), { code: 'P2034' }))
      .mockResolvedValue({ status: 'CANCELLING', cancelRequestedAt: new Date(), pauseRequestedAt: null })
    const onFatal = vi.fn()
    const dispatcher = createDispatcher(queue, abortAwareRegistry(), {
      onFatal,
      timing: monitorRetryTiming()
    })

    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.settlements).toHaveLength(1))
    await dispatcher.stop()

    expect(queue.heartbeat).toHaveBeenCalledTimes(2)
    expect(queue.readExecutionControl.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(queue.settlements[0]?.outcome.kind).toBe('cancelled')
    expect(onFatal).not.toHaveBeenCalled()
  })

  it('stops claiming immediately but lets the active executor drain before returning', async () => {
    const gate = deferred<void>()
    const queue = createQueue([claimedJob('job-drain'), claimedJob('must-not-claim')])
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute: async () => {
        await gate.promise
        return { kind: 'completed' }
      }
    })
    const dispatcher = createDispatcher(queue, registry)
    await startDispatcher(dispatcher)
    await vi.waitFor(() => expect(queue.claim).toHaveBeenCalledTimes(1))

    const stopping = dispatcher.stop('SIGTERM')
    await Promise.resolve()
    expect(queue.claim).toHaveBeenCalledTimes(1)
    gate.resolve()
    await stopping

    expect(queue.settlements).toHaveLength(1)
    expect(queue.settlements[0]?.outcome.kind).toBe('completed')
  })

  it('does not report stopped or disconnect-safe when an executor ignores abort', async () => {
    vi.useFakeTimers()
    try {
      const gate = deferred<void>()
      const entered = deferred<void>()
      const onFatal = vi.fn()
      const queue = createQueue([claimedJob('job-ignore-abort')])
      const registry = new ExecutorRegistry().register({
        jobType: 'SCAN',
        definitionVersion: JOB_DEFINITION_VERSION,
        execute: async () => {
          entered.resolve()
          await gate.promise
          return { kind: 'completed' }
        }
      })
      const dispatcher = createDispatcher(queue, registry, {
        drainGraceMs: 1_000,
        abortSettleGraceMs: 100,
        onFatal
      })
      await startDispatcher(dispatcher)
      await entered.promise

      let stopped = false
      const stopping = dispatcher.stop('SIGTERM').then(() => {
        stopped = true
      })
      await vi.advanceTimersByTimeAsync(1_100)

      expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('ignored') }))
      expect(stopped).toBe(false)
      gate.resolve()
      await stopping
      expect(queue.settlements[0]?.outcome).toMatchObject({ kind: 'released' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies abort grace to cancellation and keeps the slot until an ignoring executor exits', async () => {
    vi.useFakeTimers()
    try {
      const gate = deferred<void>()
      const entered = deferred<void>()
      const onFatal = vi.fn()
      const queue = createQueue([claimedJob('job-ignore-cancel')])
      queue.readExecutionControl.mockResolvedValue({
        status: 'CANCELLING',
        cancelRequestedAt: new Date(),
        pauseRequestedAt: null
      })
      const registry = new ExecutorRegistry().register({
        jobType: 'SCAN',
        definitionVersion: JOB_DEFINITION_VERSION,
        execute: async () => {
          entered.resolve()
          await gate.promise
          return { kind: 'completed' }
        }
      })
      const dispatcher = createDispatcher(queue, registry, {
        abortSettleGraceMs: 100,
        onFatal,
        timing: immediateHeartbeatTiming()
      })
      await startDispatcher(dispatcher)
      await entered.promise
      await vi.advanceTimersByTimeAsync(100)

      expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('ignored') }))
      expect(queue.claim).toHaveBeenCalledOnce()
      expect(queue.settlements).toEqual([])
      gate.resolve()
      await dispatcher.stop()
      expect(queue.settlements[0]?.outcome.kind).toBe('cancelled')
    } finally {
      vi.useRealTimers()
    }
  })
})

function abortAwareRegistry() {
  return new ExecutorRegistry().register({
    jobType: 'SCAN',
    definitionVersion: JOB_DEFINITION_VERSION,
    execute: ({ signal }) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ kind: 'completed' }), { once: true })
      })
  })
}

function completedRegistry() {
  return new ExecutorRegistry().register({
    jobType: 'SCAN',
    definitionVersion: JOB_DEFINITION_VERSION,
    execute: async () => ({ kind: 'completed' })
  })
}

async function startDispatcher(dispatcher: CentralDispatcher) {
  await dispatcher.prepare()
  dispatcher.activate()
}

function createDispatcher(
  queue: ReturnType<typeof createQueue>,
  registry: ExecutorRegistry,
  overrides: {
    enabled?: boolean
    logger?: WorkerLogger
    timing?: DispatcherTiming
    queueErrorBackoffMs?: number
    drainGraceMs?: number
    abortSettleGraceMs?: number
    onFatal?(error: Error): void
  } = {}
) {
  return new CentralDispatcher({
    enabled: overrides.enabled ?? true,
    workerId: 'worker-test',
    queue,
    registry,
    logger: overrides.logger ?? createLogger(),
    pollIntervalMs: 100,
    heartbeatIntervalMs: 1_000,
    drainGraceMs: overrides.drainGraceMs ?? 1_000,
    ...(overrides.abortSettleGraceMs === undefined ? {} : { abortSettleGraceMs: overrides.abortSettleGraceMs }),
    ...(overrides.queueErrorBackoffMs === undefined ? {} : { queueErrorBackoffMs: overrides.queueErrorBackoffMs }),
    ...(overrides.onFatal ? { onFatal: overrides.onFatal } : {}),
    timing: overrides.timing ?? blockingTiming()
  })
}

function createQueue(jobs: ClaimedJob[]) {
  const pending = [...jobs]
  const settlements: Array<{ fence: ExecutionFence; outcome: DispatcherSettlement }> = []
  return {
    claim: vi.fn(async (_workerId: string, _capabilities: WorkerCapability[]) => pending.shift() ?? null),
    heartbeat: vi.fn(async () => new Date('2099-08-14T00:01:00.000Z')),
    updateProgress: vi.fn<DispatcherQueuePort['updateProgress']>(async () => undefined),
    enqueueChild: vi.fn<DispatcherQueuePort['enqueueChild']>(async () => ({
      id: 'child-job',
      created: true
    })),
    readExecutionControl: vi.fn<DispatcherQueuePort['readExecutionControl']>(
      async (): Promise<ExecutionControl | null> => null
    ),
    withFencedMutationTransaction: vi.fn(
      async (_fence: ExecutionFence, operation: (transaction: QueueSqlExecutor) => Promise<unknown>) =>
        operation({} as never)
    ) as unknown as DispatcherQueuePort['withFencedMutationTransaction'],
    withFencedExecutionTransaction: vi.fn(
      async (_fence: ExecutionFence, operation: (scope: FencedExecutionTransaction) => Promise<void>) =>
        operation({
          transaction: {} as never,
          executionStatus: 'RUNNING',
          controlStatus: 'CONTINUE',
          complete: async () => undefined,
          fail: async () => undefined,
          retry: async () => undefined,
          skip: async () => undefined,
          cancel: async () => undefined,
          pause: async () => undefined,
          release: async () => undefined
        })
    ) as unknown as DispatcherQueuePort['withFencedExecutionTransaction'],
    settle: vi.fn<DispatcherQueuePort['settle']>(async (fence, outcome) => {
      settlements.push({ fence, outcome })
    }),
    settlements
  } satisfies DispatcherQueuePort & { settlements: typeof settlements }
}

function claimedJob(id: string): ClaimedJob {
  const now = new Date('2099-08-14T00:00:00.000Z')
  const executionToken = randomUUID()
  return {
    id,
    type: 'SCAN',
    definitionVersion: JOB_DEFINITION_VERSION,
    status: 'RUNNING',
    triggerSource: 'MANUAL',
    payload: {},
    attempt: 1,
    maxAttempts: 3,
    effectivePriority: 10,
    availableAt: null,
    deadlineAt: null,
    workerId: 'worker-test',
    leaseToken: executionToken,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    heartbeatAt: now,
    startedAt: now,
    createdAt: now,
    updatedAt: now,
    executionToken
  }
}

function createLogger() {
  return {
    info: vi.fn<WorkerLogger['info']>(),
    warn: vi.fn<WorkerLogger['warn']>(),
    error: vi.fn<WorkerLogger['error']>()
  } satisfies WorkerLogger
}

function blockingTiming(): DispatcherTiming {
  return {
    now: () => new Date(),
    sleep: (_milliseconds, signal) => aborted(signal)
  }
}

function immediateHeartbeatTiming(): DispatcherTiming {
  return {
    now: () => new Date(),
    sleep: (milliseconds, signal) => (milliseconds === 1_000 ? Promise.resolve() : aborted(signal))
  }
}

function recoveryTiming(recoveryDelayMs: number): DispatcherTiming {
  return {
    now: () => new Date(),
    sleep: (milliseconds, signal) => (milliseconds === recoveryDelayMs ? Promise.resolve() : aborted(signal))
  }
}

function monitorRetryTiming(): DispatcherTiming {
  return {
    now: () => new Date(),
    sleep: (milliseconds, signal) =>
      milliseconds === 1_000 || milliseconds === 250 ? Promise.resolve() : aborted(signal)
  }
}

function aborted(signal: AbortSignal) {
  return new Promise<void>((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
