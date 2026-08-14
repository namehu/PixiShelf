import type { WorkerCapability } from '@pixishelf/job-contracts'
import type {
  ChildJobRequest,
  ClaimedJob,
  EnqueuedChildJob,
  ExecutionContext,
  ExecutionFence,
  ExecutionProgressUpdate
} from '@pixishelf/job-runtime'
import { JobExecutionFenceError } from '@pixishelf/job-runtime'
import { ExecutorRegistry, parseJobExecutionOutcome, type JobExecutionOutcome } from './executor-registry.js'
import type { WorkerLogger } from './logger.js'

export type ExecutionDirective = 'CONTINUE' | 'CANCEL' | 'PAUSE'

export interface ExecutionControl {
  status: string
  cancelRequestedAt?: Date | null
  pauseRequestedAt?: Date | null
}

export type DispatcherSettlement = JobExecutionOutcome

export interface DispatcherQueuePort {
  claim(workerId: string, supportedCapabilities: WorkerCapability[]): Promise<ClaimedJob | null>
  heartbeat(fence: ExecutionFence): Promise<Date>
  updateProgress(input: ExecutionFence & ExecutionProgressUpdate): Promise<void>
  enqueueChild<TPayload>(fence: ExecutionFence, request: ChildJobRequest<TPayload>): Promise<EnqueuedChildJob>
  readExecutionControl(fence: ExecutionFence): Promise<ExecutionControl | null>
  settle(fence: ExecutionFence, outcome: DispatcherSettlement): Promise<void>
}

export interface DispatcherTiming {
  now(): Date
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>
}

export interface CentralDispatcherOptions {
  enabled: boolean
  workerId: string
  queue: DispatcherQueuePort
  registry: ExecutorRegistry
  logger: WorkerLogger
  pollIntervalMs: number
  heartbeatIntervalMs: number
  drainGraceMs: number
  abortSettleGraceMs?: number
  queueFailureLimit?: number
  queueErrorBackoffMs?: number
  onFatal?(error: Error): void
  timing?: DispatcherTiming
}

type InterruptionReason = 'LEASE_LOST' | 'CANCEL_REQUESTED' | 'PAUSE_REQUESTED' | 'SHUTDOWN'

type ExecutorResult = { kind: 'resolved'; value: JobExecutionOutcome } | { kind: 'rejected'; error: unknown }

class DispatcherInterruption extends Error {
  constructor(readonly reason: InterruptionReason) {
    super(`Dispatcher execution interrupted: ${reason}`)
    this.name = 'DispatcherInterruption'
  }
}

const systemTiming: DispatcherTiming = {
  now: () => new Date(),
  sleep: (milliseconds, signal) => abortableDelay(milliseconds, signal)
}

export class CentralDispatcher {
  private readonly timing: DispatcherTiming
  private readonly capabilities: WorkerCapability[]
  private loopPromise: Promise<void> | null = null
  private currentExecution: Promise<void> | null = null
  private currentController: AbortController | null = null
  private pollController: AbortController | null = null
  private stopping = false
  private stopPromise: Promise<void> | null = null
  private fatalError: Error | null = null
  private prepared = false

  constructor(private readonly options: CentralDispatcherOptions) {
    assertBoundedInteger('pollIntervalMs', options.pollIntervalMs, 100, 60_000)
    assertBoundedInteger('heartbeatIntervalMs', options.heartbeatIntervalMs, 1_000, 300_000)
    assertBoundedInteger('drainGraceMs', options.drainGraceMs, 1_000, 300_000)
    if (options.abortSettleGraceMs !== undefined) {
      assertBoundedInteger('abortSettleGraceMs', options.abortSettleGraceMs, 100, 30_000)
    }
    if (options.queueFailureLimit !== undefined) {
      assertBoundedInteger('queueFailureLimit', options.queueFailureLimit, 1, 10)
    }
    if (options.queueErrorBackoffMs !== undefined) {
      assertBoundedInteger('queueErrorBackoffMs', options.queueErrorBackoffMs, 100, 60_000)
    }
    this.capabilities = options.registry.capabilities()
    if (options.enabled && this.capabilities.length === 0) {
      throw new Error('Worker dispatch cannot be enabled with an empty executor registry')
    }
    this.timing = options.timing ?? systemTiming
  }

  prepare(): Promise<void> {
    if (!this.options.enabled) {
      this.options.logger.info('worker.dispatch_disabled')
      return Promise.resolve()
    }
    if (this.stopping) throw new Error('Cannot prepare a stopping dispatcher')
    this.prepared = true
    this.options.logger.info('worker.dispatch_prepared', { capabilities: this.capabilities })
    return Promise.resolve()
  }

  activate(): void {
    if (!this.options.enabled || this.stopping) return
    if (!this.prepared) throw new Error('Dispatcher must be prepared before activation')
    if (!this.loopPromise) {
      this.options.logger.info('worker.dispatch_started', { capabilities: this.capabilities })
      this.loopPromise = this.runLoop().catch((error) => {
        this.raiseFatal(toError(error, 'Dispatcher loop failed'))
      })
    }
  }

  stop(reason = 'shutdown'): Promise<void> {
    if (!this.options.enabled) return Promise.resolve()
    this.stopPromise ??= this.stopInternal(reason)
    return this.stopPromise
  }

  private async stopInternal(reason: string): Promise<void> {
    this.stopping = true
    this.options.logger.info('worker.dispatch_draining', { reason, currentJob: Boolean(this.currentExecution) })
    this.pollController?.abort(new DispatcherInterruption('SHUTDOWN'))

    const current = this.currentExecution
    if (current) {
      const drained = await settlesWithin(current, this.options.drainGraceMs)
      if (!drained) {
        this.options.logger.warn('worker.dispatch_drain_grace_expired', {
          graceMs: this.options.drainGraceMs
        })
        this.currentController?.abort(new DispatcherInterruption('SHUTDOWN'))
        const settledAfterAbort = await settlesWithin(
          current,
          this.options.abortSettleGraceMs ?? Math.min(5_000, this.options.drainGraceMs)
        )
        if (!settledAfterAbort) {
          const error = new Error('Worker executor ignored shutdown abort signal')
          this.options.logger.error('worker.dispatch_executor_ignored_abort', {
            graceMs: this.options.abortSettleGraceMs ?? Math.min(5_000, this.options.drainGraceMs)
          })
          this.raiseFatal(error)
          await current
        }
      }
    }

    if (!this.currentExecution) await this.loopPromise
    this.options.logger.info('worker.dispatch_stopped')
  }

  private async runLoop() {
    let consecutiveClaimFailures = 0
    while (!this.stopping) {
      let job: ClaimedJob | null
      try {
        job = await this.options.queue.claim(this.options.workerId, this.capabilities)
        if (consecutiveClaimFailures > 0) {
          this.options.logger.info('worker.dispatch_queue_recovered', {
            operation: 'claim',
            failures: consecutiveClaimFailures
          })
        }
        consecutiveClaimFailures = 0
      } catch (error) {
        if (!isTransientQueueError(error)) {
          this.raiseFatal(toError(error, 'Non-transient queue claim failure'))
          break
        }
        consecutiveClaimFailures += 1
        this.options.logger.warn('worker.dispatch_claim_failed', {
          attempt: consecutiveClaimFailures,
          error
        })
        if (consecutiveClaimFailures >= (this.options.queueFailureLimit ?? 3)) {
          this.raiseFatal(toError(error, 'Queue claim failed repeatedly'))
          break
        }
        await this.waitForNextPoll(this.options.queueErrorBackoffMs ?? this.options.pollIntervalMs)
        continue
      }
      if (this.stopping) {
        if (job) {
          await this.settleWithRetry(
            toFence(job),
            {
              kind: 'released',
              message: 'Worker started draining before execution began'
            },
            job.leaseExpiresAt
          )
        }
        break
      }
      if (!job) {
        await this.waitForNextPoll(this.options.pollIntervalMs)
        continue
      }

      const execution = this.executeClaimedJob(job)
      this.currentExecution = execution
      await execution
      this.currentExecution = null
    }
  }

  private async executeClaimedJob(job: ClaimedJob) {
    const fence = toFence(job)
    const leaseState = { expiresAt: job.leaseExpiresAt }
    let registration: ReturnType<ExecutorRegistry['resolve']>
    try {
      registration = this.options.registry.resolve(job)
    } catch (error) {
      this.options.logger.error('worker.dispatch_invalid_job_payload', {
        jobId: job.id,
        jobType: job.type,
        definitionVersion: job.definitionVersion,
        error
      })
      await this.settleWithRetry(
        fence,
        {
          kind: 'failed',
          errorCode: 'INVALID_PAYLOAD',
          error: error instanceof Error ? error.message : 'Job payload validation failed'
        },
        leaseState.expiresAt
      )
      return
    }
    if (!registration) {
      this.options.logger.error('worker.dispatch_unsupported_claim', {
        jobId: job.id,
        jobType: job.type,
        definitionVersion: job.definitionVersion
      })
      await this.settleWithRetry(
        fence,
        {
          kind: 'failed',
          errorCode: 'UNSUPPORTED_DEFINITION_VERSION',
          error: `No executor registered for ${job.type}@${job.definitionVersion}`
        },
        leaseState.expiresAt
      )
      return
    }

    const controller = new AbortController()
    this.currentController = controller
    const monitor = this.monitorExecution(fence, controller, leaseState)
    const logger = createExecutionLogger(this.options.logger, job)
    const progress = createProgressReporter(this.options.queue, fence, this.timing)
    let outcome: JobExecutionOutcome
    this.options.logger.info('worker.job_started', {
      jobId: job.id,
      jobType: job.type,
      definitionVersion: job.definitionVersion,
      attempt: job.attempt
    })

    const context: ExecutionContext<unknown, EnqueuedChildJob> = {
      job,
      payload: registration.payload,
      signal: controller.signal,
      progress,
      enqueueChild: (request) => this.options.queue.enqueueChild(fence, request),
      logger
    }
    const executorPromise = Promise.resolve()
      .then(() => registration.execute(context))
      .then((value) => parseJobExecutionOutcome(value))
      .then<ExecutorResult, ExecutorResult>(
        (value) => ({ kind: 'resolved', value }),
        (error: unknown) => ({ kind: 'rejected', error })
      )

    try {
      const first = await Promise.race([executorPromise, waitForAbort(controller.signal)])
      let executorResult: ExecutorResult
      if (first.kind === 'aborted') {
        const graceMs = this.options.abortSettleGraceMs ?? Math.min(5_000, this.options.drainGraceMs)
        const settled = await valueWithin(executorPromise, graceMs)
        if (!settled) {
          const error = new Error(`Worker executor ignored ${interruptionName(controller.signal.reason)} abort signal`)
          this.options.logger.error('worker.dispatch_executor_ignored_abort', {
            jobId: job.id,
            reason: interruptionName(controller.signal.reason),
            graceMs
          })
          this.raiseFatal(error)
          executorResult = await executorPromise
        } else {
          executorResult = settled
        }
        outcome = outcomeForInterruption(controller.signal.reason)
      } else {
        executorResult = first
        outcome =
          executorResult.kind === 'resolved'
            ? executorResult.value
            : {
                kind: 'failed',
                errorCode: 'INTERNAL_ERROR',
                error: executorResult.error instanceof Error ? executorResult.error.message : 'Unknown executor failure'
              }
        if (controller.signal.aborted) outcome = outcomeForInterruption(controller.signal.reason)
      }
    } finally {
      controller.abort()
      await monitor
      this.currentController = null
    }

    outcome = normalizeRetryOutcome(job, outcome)

    let settled = false
    if (!isLeaseLost(controller.signal.reason)) {
      const controlledOutcome = await this.applyFinalControl(fence, outcome, leaseState.expiresAt)
      if (controlledOutcome) {
        settled = await this.settleWithRetry(fence, controlledOutcome, leaseState.expiresAt)
        outcome = controlledOutcome
      }
    }
    if (settled) {
      this.options.logger.info('worker.job_settled', {
        jobId: job.id,
        jobType: job.type,
        attempt: job.attempt,
        outcome: outcome.kind
      })
    }
  }

  private async monitorExecution(fence: ExecutionFence, controller: AbortController, leaseState: { expiresAt: Date }) {
    while (!controller.signal.aborted) {
      try {
        await this.timing.sleep(this.options.heartbeatIntervalMs, controller.signal)
        if (controller.signal.aborted) return
        const heartbeat = await this.retryLeaseOperation(
          'heartbeat',
          fence,
          leaseState.expiresAt,
          controller.signal,
          () => this.options.queue.heartbeat(fence)
        )
        if (heartbeat.kind !== 'value') {
          if (heartbeat.kind === 'fence-lost') {
            controller.abort(new DispatcherInterruption('LEASE_LOST'))
          }
          return
        }
        leaseState.expiresAt = heartbeat.value
        const controlResult = await this.retryLeaseOperation(
          'control',
          fence,
          leaseState.expiresAt,
          controller.signal,
          () => this.options.queue.readExecutionControl(fence)
        )
        if (controlResult.kind !== 'value') {
          if (controlResult.kind === 'fence-lost') {
            controller.abort(new DispatcherInterruption('LEASE_LOST'))
          }
          return
        }
        const control = controlResult.value
        const directive = executionDirective(control)
        if (directive === 'CANCEL') controller.abort(new DispatcherInterruption('CANCEL_REQUESTED'))
        if (directive === 'PAUSE') controller.abort(new DispatcherInterruption('PAUSE_REQUESTED'))
      } catch (error) {
        if (controller.signal.aborted) return
        this.raiseFatal(toError(error, `Execution monitor failed for job ${fence.jobId}`))
        controller.abort(new DispatcherInterruption('LEASE_LOST'))
      }
    }
  }

  private async applyFinalControl(
    fence: ExecutionFence,
    outcome: DispatcherSettlement,
    leaseExpiresAt: Date
  ): Promise<DispatcherSettlement | null> {
    const controller = new AbortController()
    const result = await this.retryLeaseOperation('final-control', fence, leaseExpiresAt, controller.signal, () =>
      this.options.queue.readExecutionControl(fence)
    )
    if (result.kind !== 'value') return null
    return controlledOutcome(result.value, outcome)
  }

  private async settleWithRetry(fence: ExecutionFence, initialOutcome: DispatcherSettlement, leaseExpiresAt?: Date) {
    const failureLimit = this.options.queueFailureLimit ?? 3
    let outcome = initialOutcome
    let transientFailures = 0
    for (let attempt = 1; attempt <= failureLimit; attempt += 1) {
      try {
        await this.options.queue.settle(fence, outcome)
        if (transientFailures > 0) {
          this.options.logger.info('worker.dispatch_queue_recovered', {
            operation: 'settle',
            failures: transientFailures,
            jobId: fence.jobId
          })
        }
        return true
      } catch (error) {
        if (error instanceof JobExecutionFenceError) {
          if (!leaseExpiresAt) return false
          const control = await this.retryLeaseOperation(
            'settle-control',
            fence,
            leaseExpiresAt,
            new AbortController().signal,
            () => this.options.queue.readExecutionControl(fence)
          )
          if (control.kind !== 'value') return false
          const replacement = controlledOutcome(control.value, outcome)
          if (
            replacement.kind !== outcome.kind &&
            (replacement.kind === 'cancelled' || replacement.kind === 'paused')
          ) {
            outcome = replacement
            attempt -= 1
            continue
          }
          this.raiseFatal(new Error(`Fenced settlement was rejected while job ${fence.jobId} remained RUNNING`))
          return false
        }
        this.options.logger.warn('worker.dispatch_settle_failed', {
          jobId: fence.jobId,
          outcome: outcome.kind,
          attempt,
          error
        })
        if (!isTransientQueueError(error)) {
          this.raiseFatal(toError(error, `Non-transient queue settlement failure for job ${fence.jobId}`))
          return false
        }
        transientFailures += 1
        if (
          attempt === failureLimit ||
          (leaseExpiresAt &&
            this.timing.now().getTime() + (this.options.queueErrorBackoffMs ?? this.options.pollIntervalMs) >=
              leaseExpiresAt.getTime())
        ) {
          if (leaseExpiresAt) {
            this.options.logger.warn('worker.job_lease_lost', { jobId: fence.jobId, operation: 'settle' })
            return false
          }
          this.raiseFatal(toError(error, `Queue settlement failed repeatedly for job ${fence.jobId}`))
          return false
        }
        await this.waitForQueueRecovery()
      }
    }
    return false
  }

  private async retryLeaseOperation<T>(
    operation: string,
    fence: ExecutionFence,
    leaseExpiresAt: Date,
    signal: AbortSignal,
    execute: () => Promise<T>
  ): Promise<{ kind: 'value'; value: T } | { kind: 'fence-lost' } | { kind: 'fatal' }> {
    const retryDelayMs = Math.min(1_000, Math.max(100, Math.floor(this.options.heartbeatIntervalMs / 4)))
    let failures = 0
    while (!signal.aborted) {
      try {
        const value = await execute()
        if (failures > 0) {
          this.options.logger.info('worker.dispatch_queue_recovered', {
            operation,
            failures,
            jobId: fence.jobId
          })
        }
        return { kind: 'value', value }
      } catch (error) {
        if (error instanceof JobExecutionFenceError) {
          this.options.logger.warn('worker.job_lease_lost', { jobId: fence.jobId, operation, error })
          return { kind: 'fence-lost' }
        }
        if (!isTransientQueueError(error)) {
          this.raiseFatal(toError(error, `Non-transient ${operation} failure for job ${fence.jobId}`))
          return { kind: 'fatal' }
        }
        failures += 1
        if (this.timing.now().getTime() + retryDelayMs >= leaseExpiresAt.getTime()) {
          this.options.logger.warn('worker.job_lease_lost', {
            jobId: fence.jobId,
            operation,
            failures,
            error
          })
          return { kind: 'fence-lost' }
        }
        this.options.logger.warn('worker.dispatch_queue_operation_failed', {
          jobId: fence.jobId,
          operation,
          failures,
          error
        })
        try {
          await this.timing.sleep(retryDelayMs, signal)
        } catch {
          return { kind: 'fatal' }
        }
      }
    }
    return { kind: 'fatal' }
  }

  private async waitForQueueRecovery() {
    const controller = new AbortController()
    await this.timing.sleep(this.options.queueErrorBackoffMs ?? this.options.pollIntervalMs, controller.signal)
  }

  private async waitForNextPoll(milliseconds: number) {
    this.pollController = new AbortController()
    try {
      await this.timing.sleep(milliseconds, this.pollController.signal)
    } catch (error) {
      if (!this.stopping) throw error
    } finally {
      this.pollController = null
    }
  }

  private raiseFatal(error: Error) {
    if (this.fatalError) return
    this.fatalError = error
    this.stopping = true
    this.pollController?.abort(new DispatcherInterruption('SHUTDOWN'))
    this.options.logger.error('worker.dispatch_fatal', { error })
    this.options.onFatal?.(error)
  }
}

function toFence(job: ClaimedJob): ExecutionFence {
  return {
    jobId: job.id,
    workerId: job.workerId,
    executionToken: job.executionToken,
    attempt: job.attempt
  }
}

function executionDirective(control: ExecutionControl | null): ExecutionDirective {
  if (!control) return 'CONTINUE'
  if (control.status === 'CANCELLING' || control.cancelRequestedAt) return 'CANCEL'
  if (control.status === 'PAUSING' || control.pauseRequestedAt) return 'PAUSE'
  return 'CONTINUE'
}

function controlledOutcome(control: ExecutionControl | null, fallback: DispatcherSettlement): DispatcherSettlement {
  const directive = executionDirective(control)
  if (directive === 'CANCEL') return { kind: 'cancelled', message: 'Cancellation acknowledged' }
  if (directive === 'PAUSE') return { kind: 'paused', message: 'Pause acknowledged' }
  return fallback
}

function normalizeRetryOutcome(job: ClaimedJob, outcome: DispatcherSettlement): DispatcherSettlement {
  if (outcome.kind !== 'retry' || job.attempt < job.maxAttempts) return outcome
  return {
    kind: 'failed',
    errorCode: outcome.errorCode,
    error: outcome.error,
    message: outcome.message ?? `Retry budget exhausted after ${job.attempt} attempts`
  }
}

function outcomeForInterruption(reason: unknown): DispatcherSettlement {
  if (reason instanceof DispatcherInterruption) {
    if (reason.reason === 'CANCEL_REQUESTED') return { kind: 'cancelled', message: 'Cancellation acknowledged' }
    if (reason.reason === 'PAUSE_REQUESTED') return { kind: 'paused', message: 'Pause acknowledged' }
    if (reason.reason === 'SHUTDOWN') return { kind: 'released', message: 'Worker stopped during execution' }
    return { kind: 'released', message: 'Execution lease was lost' }
  }
  return { kind: 'released', message: 'Execution was interrupted' }
}

function isLeaseLost(reason: unknown) {
  return reason instanceof DispatcherInterruption && reason.reason === 'LEASE_LOST'
}

function interruptionName(reason: unknown) {
  return reason instanceof DispatcherInterruption ? reason.reason : 'UNKNOWN'
}

function waitForAbort(signal: AbortSignal): Promise<{ kind: 'aborted' }> {
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' })
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), { once: true })
  })
}

function isTransientQueueError(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : ''
  if (/^(?:P1001|P1002|P1008|P1017|P2024|P2034|40001|40P01|55P03|57P0[123]|08\w{3})$/.test(code)) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /(?:connection|database unavailable|deadlock|serialization|timed? out|timeout|write conflict)/i.test(message)
}

function createExecutionLogger(logger: WorkerLogger, job: ClaimedJob) {
  const fields = { jobId: job.id, jobType: job.type, attempt: job.attempt }
  return {
    debug: (message: string, data?: unknown) => logger.debug?.('worker.job_debug', { ...fields, message, data }),
    info: (message: string, data?: unknown) => logger.info('worker.job_info', { ...fields, message, data }),
    warn: (message: string, data?: unknown) => logger.warn('worker.job_warning', { ...fields, message, data }),
    error: (message: string, error?: unknown, data?: unknown) =>
      logger.error('worker.job_error', { ...fields, message, error, data })
  }
}

function createProgressReporter(queue: DispatcherQueuePort, fence: ExecutionFence, timing: DispatcherTiming) {
  let lastPersisted: { progress: number; stage?: string | null; at: number } | null = null
  return async (update: ExecutionProgressUpdate) => {
    const now = timing.now().getTime()
    const isWarning =
      typeof update.data === 'object' &&
      update.data !== null &&
      'level' in update.data &&
      (update.data as { level?: unknown }).level === 'WARN'
    const stageChanged = update.stage !== undefined && (!lastPersisted || update.stage !== lastPersisted.stage)
    const percentageReady =
      !lastPersisted || (Math.abs(update.progress - lastPersisted.progress) >= 5 && now - lastPersisted.at >= 30_000)
    if (!lastPersisted || update.progress === 100 || stageChanged || isWarning || percentageReady) {
      await queue.updateProgress({ ...fence, ...update })
      lastPersisted = {
        progress: update.progress,
        ...(update.stage === undefined
          ? lastPersisted?.stage === undefined
            ? {}
            : { stage: lastPersisted.stage }
          : { stage: update.stage }),
        at: now
      }
    }
  }
}

function toError(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error : new Error(fallbackMessage, { cause: error })
}

function assertBoundedInteger(name: string, value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds)
    timer.unref()
    signal.addEventListener('abort', abort, { once: true })

    function finish() {
      signal.removeEventListener('abort', abort)
      resolve()
    }

    function abort() {
      clearTimeout(timer)
      reject(signal.reason)
    }
  })
}

async function settlesWithin(promise: Promise<unknown>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), milliseconds)
    timer.unref()
  })
  const settled = promise.then(
    () => true as const,
    () => true as const
  )
  const result = await Promise.race([settled, timeout])
  if (timer) clearTimeout(timer)
  return result
}

async function valueWithin<T>(promise: Promise<T>, milliseconds: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), milliseconds)
    timer.unref()
  })
  const result = await Promise.race([promise, timeout])
  if (timer) clearTimeout(timer)
  return result
}
