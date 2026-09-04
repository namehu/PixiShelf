import {
  jobErrorCodeSchema,
  jobSkipReasonSchema,
  type JobErrorCode,
  type ExecutionLane,
  type JobSkipReason,
  type JobType
} from '@pixishelf/job-contracts'
import { z } from 'zod'
import type { EnqueuedChildJob } from './queue-repository.ts'
import type { ExecutionContext, TransactionallyFinalizedExecutionOutcome } from './execution-context.ts'

export type JobExecutionOutcome<TResult = unknown> =
  | { kind: 'completed'; result?: TResult; message?: string }
  | { kind: 'retry'; availableAt: Date; errorCode: JobErrorCode; error: string; message?: string }
  | { kind: 'failed'; errorCode: JobErrorCode; error: string; message?: string }
  | { kind: 'skipped'; reason: JobSkipReason; message?: string }
  | { kind: 'cancelled'; message?: string }
  | { kind: 'paused'; message?: string }
  | { kind: 'released'; message?: string }
  | TransactionallyFinalizedExecutionOutcome

export const jobExecutionOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('completed'), result: z.unknown().optional(), message: z.string().optional() }).strict(),
  z
    .object({
      kind: z.literal('retry'),
      availableAt: z.date().refine((value) => !Number.isNaN(value.getTime()), 'availableAt must be a valid date'),
      errorCode: jobErrorCodeSchema,
      error: z.string(),
      message: z.string().optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('failed'),
      errorCode: jobErrorCodeSchema,
      error: z.string(),
      message: z.string().optional()
    })
    .strict(),
  z.object({ kind: z.literal('skipped'), reason: jobSkipReasonSchema, message: z.string().optional() }).strict(),
  z.object({ kind: z.literal('cancelled'), message: z.string().optional() }).strict(),
  z.object({ kind: z.literal('paused'), message: z.string().optional() }).strict(),
  z.object({ kind: z.literal('released'), message: z.string().optional() }).strict(),
  z.object({ kind: z.literal('transactionally-finalized') }).strict()
])

export function parseJobExecutionOutcome(value: unknown): JobExecutionOutcome {
  return jobExecutionOutcomeSchema.parse(value) as JobExecutionOutcome
}

export type WorkerJobExecutor<TPayload = unknown, TResult = unknown> = (
  context: ExecutionContext<TPayload, EnqueuedChildJob>
) => Promise<JobExecutionOutcome<TResult>>

export type ExecutorProgressPolicy = 'STANDARD' | 'REALTIME'

export interface ExecutorDefinition<TPayload = unknown, TResult = unknown> {
  jobType: JobType
  executionLane?: ExecutionLane
  definitionVersion: number
  /** Production executors declare this explicitly; STANDARD remains the compatibility default for test/custom registries. */
  progressPolicy?: ExecutorProgressPolicy
  execute: WorkerJobExecutor<TPayload, TResult>
  parsePayload?(payload: unknown): TPayload
}
