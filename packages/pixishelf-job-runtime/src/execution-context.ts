import type { ClaimedJob } from './queue-repository.js'

export interface ExecutionProgressUpdate {
  progress: number
  stage?: string | null
  message?: string | null
  data?: unknown
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

export interface ExecutionContext<TPayload = unknown, TChildJob = ClaimedJob> {
  job: ClaimedJob
  payload: TPayload
  signal: AbortSignal
  progress(update: ExecutionProgressUpdate): Promise<void>
  enqueueChild<TChildPayload = unknown>(request: ChildJobRequest<TChildPayload>): Promise<TChildJob>
  logger: ExecutionLogger
}

export type JobExecutor<TPayload = unknown, TResult = unknown> = (
  context: ExecutionContext<TPayload>
) => Promise<TResult>
