import { jobTypeSchema, type JobErrorCode, type JobSkipReason, type WorkerCapability } from '@pixishelf/job-contracts'
import type {
  ChildJobRequest,
  ClaimedJob,
  EnqueuedChildJob,
  ExecutionControlState,
  ExecutionFence,
  ExecutionProgressMutationResult,
  ExecutionProgressUpdate,
  FencedExecutionTransaction,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import type { DispatcherQueuePort, DispatcherSettlement } from './dispatcher.js'
import { parseJobExecutionOutcome } from './executor-registry.js'

export interface QueueRepositoryPort {
  claim(workerId: string, supportedCapabilities: readonly WorkerCapability[]): Promise<ClaimedJob | null>
  heartbeat(fence: ExecutionFence): Promise<Date>
  updateProgress(input: ExecutionFence & ExecutionProgressUpdate): Promise<void>
  enqueueChild(
    fence: ExecutionFence,
    input: ChildJobRequest & { type: ReturnType<typeof jobTypeSchema.parse> }
  ): Promise<EnqueuedChildJob>
  readExecutionControl(fence: ExecutionFence): Promise<ExecutionControlState>
  withFencedMutationTransaction<TTransaction extends QueueSqlExecutor = QueueSqlExecutor, TResult = void>(
    fence: ExecutionFence,
    operation: (transaction: TTransaction) => Promise<TResult>
  ): Promise<TResult>
  withFencedProgressTransaction<TTransaction extends QueueSqlExecutor = QueueSqlExecutor, TResult = void>(
    fence: ExecutionFence,
    operation: (transaction: TTransaction) => Promise<ExecutionProgressMutationResult<TResult>>
  ): Promise<ExecutionProgressMutationResult<TResult>>
  withFencedExecutionTransaction<TTransaction extends QueueSqlExecutor = QueueSqlExecutor, TResult = void>(
    fence: ExecutionFence,
    operation: (scope: FencedExecutionTransaction<TTransaction>) => Promise<TResult>
  ): Promise<TResult>
  complete(input: ExecutionFence & { result?: unknown; message?: string | null }): Promise<void>
  retry(
    input: ExecutionFence & {
      availableAt: Date
      errorCode: JobErrorCode
      error: string
      message?: string | null
    }
  ): Promise<void>
  fail(input: ExecutionFence & { errorCode: JobErrorCode; error: string; message?: string | null }): Promise<void>
  skip(input: ExecutionFence & { reason: JobSkipReason; message?: string | null }): Promise<void>
  cancel(input: ExecutionFence & { message?: string | null }): Promise<void>
  pause(input: ExecutionFence & { message?: string | null }): Promise<void>
  release(input: ExecutionFence & { message?: string | null }): Promise<void>
}

export class RuntimeDispatcherQueue implements DispatcherQueuePort {
  constructor(private readonly repository: QueueRepositoryPort) {}

  claim(workerId: string, supportedCapabilities: WorkerCapability[]) {
    return this.repository.claim(workerId, supportedCapabilities)
  }

  heartbeat(fence: ExecutionFence) {
    return this.repository.heartbeat(fence)
  }

  updateProgress(input: ExecutionFence & ExecutionProgressUpdate) {
    return this.repository.updateProgress(input)
  }

  enqueueChild<TPayload>(fence: ExecutionFence, request: ChildJobRequest<TPayload>) {
    return this.repository.enqueueChild(fence, {
      ...request,
      type: jobTypeSchema.parse(request.type)
    })
  }

  readExecutionControl(fence: ExecutionFence) {
    return this.repository.readExecutionControl(fence)
  }

  withFencedMutationTransaction<TTransaction extends QueueSqlExecutor = QueueSqlExecutor, TResult = void>(
    fence: ExecutionFence,
    operation: (transaction: TTransaction) => Promise<TResult>
  ) {
    return this.repository.withFencedMutationTransaction<TTransaction, TResult>(fence, operation)
  }

  withFencedProgressTransaction<TTransaction extends QueueSqlExecutor = QueueSqlExecutor, TResult = void>(
    fence: ExecutionFence,
    operation: (transaction: TTransaction) => Promise<ExecutionProgressMutationResult<TResult>>
  ) {
    return this.repository.withFencedProgressTransaction<TTransaction, TResult>(fence, operation)
  }

  withFencedExecutionTransaction<TTransaction extends QueueSqlExecutor = QueueSqlExecutor>(
    fence: ExecutionFence,
    operation: (scope: FencedExecutionTransaction<TTransaction>) => Promise<void>
  ) {
    return this.repository.withFencedExecutionTransaction<TTransaction, void>(fence, operation)
  }

  settle(fence: ExecutionFence, outcome: DispatcherSettlement): Promise<void> {
    const parsedOutcome = parseJobExecutionOutcome(outcome)
    switch (parsedOutcome.kind) {
      case 'completed':
        return this.repository.complete({ ...fence, ...parsedOutcome })
      case 'retry':
        return this.repository.retry({ ...fence, ...parsedOutcome })
      case 'failed':
        return this.repository.fail({ ...fence, ...parsedOutcome })
      case 'skipped':
        return this.repository.skip({ ...fence, ...parsedOutcome })
      case 'cancelled':
        return this.repository.cancel({ ...fence, ...parsedOutcome })
      case 'paused':
        return this.repository.pause({ ...fence, ...parsedOutcome })
      case 'released':
        return this.repository.release({ ...fence, ...parsedOutcome })
      case 'transactionally-finalized':
        throw new TypeError('A transactionally finalized execution must not be settled a second time')
      default:
        return assertNever(parsedOutcome)
    }
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported dispatcher settlement outcome: ${String(value)}`)
}
