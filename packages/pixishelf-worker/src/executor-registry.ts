import {
  JOB_DEFINITION_VERSION,
  jobErrorCodeSchema,
  jobSkipReasonSchema,
  jobTypeSchema,
  parseJobPayload,
  type JobErrorCode,
  type JobSkipReason,
  type JobType,
  type WorkerCapability
} from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext } from '@pixishelf/job-runtime'
import { z } from 'zod'

export type JobExecutionOutcome<TResult = unknown> =
  | { kind: 'completed'; result?: TResult; message?: string }
  | { kind: 'retry'; availableAt: Date; errorCode: JobErrorCode; error: string; message?: string }
  | { kind: 'failed'; errorCode: JobErrorCode; error: string; message?: string }
  | { kind: 'skipped'; reason: JobSkipReason; message?: string }
  | { kind: 'cancelled'; message?: string }
  | { kind: 'paused'; message?: string }
  | { kind: 'released'; message?: string }

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
  z.object({ kind: z.literal('released'), message: z.string().optional() }).strict()
])

export function parseJobExecutionOutcome(value: unknown): JobExecutionOutcome {
  return jobExecutionOutcomeSchema.parse(value) as JobExecutionOutcome
}

export type WorkerJobExecutor<TPayload = unknown, TResult = unknown> = (
  context: ExecutionContext<TPayload, EnqueuedChildJob>
) => Promise<JobExecutionOutcome<TResult>>

export interface ExecutorRegistration<TPayload = unknown, TResult = unknown> {
  jobType: JobType
  definitionVersion: number
  execute: WorkerJobExecutor<TPayload, TResult>
  parsePayload?(payload: unknown): TPayload
}

export interface ResolvedExecutor<TPayload = unknown> {
  jobType: JobType
  definitionVersion: number
  payload: TPayload
  execute: WorkerJobExecutor<TPayload>
}

interface StoredRegistration {
  jobType: JobType
  definitionVersion: number
  execute: WorkerJobExecutor
  parsePayload(payload: unknown): unknown
}

export class ExecutorRegistry {
  private readonly registrations = new Map<string, StoredRegistration>()

  register<TPayload, TResult>(registration: ExecutorRegistration<TPayload, TResult>): this {
    const jobType = jobTypeSchema.parse(registration.jobType)
    assertDefinitionVersion(registration.definitionVersion)
    const key = registryKey(jobType, registration.definitionVersion)
    if (this.registrations.has(key)) {
      throw new Error(`Executor already registered for ${jobType}@${registration.definitionVersion}`)
    }
    if (!registration.parsePayload && registration.definitionVersion !== JOB_DEFINITION_VERSION) {
      throw new Error(`Executor ${jobType}@${registration.definitionVersion} requires an explicit payload parser`)
    }

    const parsePayload = registration.parsePayload ?? ((payload: unknown) => parseJobPayload(jobType, payload))
    this.registrations.set(key, {
      jobType,
      definitionVersion: registration.definitionVersion,
      execute: registration.execute as WorkerJobExecutor,
      parsePayload
    })
    return this
  }

  resolve(job: { type: string; definitionVersion: number; payload: unknown }): ResolvedExecutor | null {
    const parsedType = jobTypeSchema.safeParse(job.type)
    if (!parsedType.success) return null
    const registration = this.registrations.get(registryKey(parsedType.data, job.definitionVersion))
    if (!registration) return null
    return {
      jobType: registration.jobType,
      definitionVersion: registration.definitionVersion,
      payload: registration.parsePayload(job.payload ?? {}),
      execute: registration.execute
    }
  }

  capabilities(): WorkerCapability[] {
    const versionsByType = new Map<JobType, number[]>()
    for (const registration of this.registrations.values()) {
      const versions = versionsByType.get(registration.jobType) ?? []
      versions.push(registration.definitionVersion)
      versionsByType.set(registration.jobType, versions)
    }
    return [...versionsByType]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([jobType, versions]) => ({
        jobType,
        definitionVersions: versions.sort((left, right) => left - right)
      }))
  }

  get size() {
    return this.registrations.size
  }
}

function assertDefinitionVersion(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Executor definitionVersion must be a positive safe integer')
  }
}

function registryKey(jobType: JobType, definitionVersion: number) {
  return `${jobType}:${definitionVersion}`
}
