import type { JobEventLevel, JobProgressData } from '@pixishelf/job-contracts'
import type { ClaimedJob, FencedExecutionTransaction, QueueSqlExecutor } from './queue-repository.ts'

export interface ExecutionProgressUpdate {
  progress: number
  stage?: string | null
  message?: string | null
  data?: unknown
  progressData?: JobProgressData | null
  level?: JobEventLevel
  persistenceMode?: 'STANDARD' | 'REALTIME'
  forcePersistence?: boolean
}

export interface ExecutionProgressMutationResult<TResult> {
  // The result is returned only after the repository has committed `update`
  // together with the caller's domain writes and the matching job event.
  // Executors must therefore not publish the same checkpoint again afterward.
  result: TResult
  update: ExecutionProgressUpdate & { progressData: JobProgressData }
}

export interface ChildJobRequest<TPayload = unknown> {
  type: string
  payload: TPayload
  queuePriority?: number
  idempotencyKey?: string
}

export interface ExecutionLogger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, error?: unknown, data?: unknown): void
}

export interface TransactionallyFinalizedExecutionOutcome {
  kind: 'transactionally-finalized'
}

export const TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME: TransactionallyFinalizedExecutionOutcome = Object.freeze({
  kind: 'transactionally-finalized'
})

export type FencedExecutionFinalizer = <TTransaction extends QueueSqlExecutor = QueueSqlExecutor>(
  operation: (scope: FencedExecutionTransaction<TTransaction>) => Promise<void>
) => Promise<TransactionallyFinalizedExecutionOutcome>

export type FencedExecutionMutator = <TTransaction extends QueueSqlExecutor = QueueSqlExecutor, TResult = void>(
  operation: (transaction: TTransaction) => Promise<TResult>
) => Promise<TResult>

export type FencedExecutionProgressMutator = <TTransaction extends QueueSqlExecutor = QueueSqlExecutor, TResult = void>(
  // A checkpoint is the recovery boundary for a domain micro-batch, not a
  // faster variant of progress(). Its update must describe the state produced
  // by the transaction passed to this callback.
  operation: (transaction: TTransaction) => Promise<ExecutionProgressMutationResult<TResult>>
) => Promise<TResult>

export interface ExecutionContext<TPayload = unknown, TChildJob = ClaimedJob> {
  job: ClaimedJob
  payload: TPayload
  signal: AbortSignal
  progress(update: ExecutionProgressUpdate): Promise<void>
  enqueueChild<TChildPayload = unknown>(request: ChildJobRequest<TChildPayload>): Promise<TChildJob>
  mutateInTransaction: FencedExecutionMutator
  /** Atomically commits domain effects, the aggregate job snapshot, and its event. */
  checkpointInTransaction?: FencedExecutionProgressMutator
  finalizeInTransaction: FencedExecutionFinalizer
  logger: ExecutionLogger
}

export type JobExecutor<TPayload = unknown, TResult = unknown> = (
  context: ExecutionContext<TPayload>
) => Promise<TResult>
