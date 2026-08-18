import {
  JOB_DEFINITION_VERSION,
  executionLaneForJobType,
  executionLaneSchema,
  jobTypeSchema,
  parseJobPayload,
  type ExecutionLane,
  type JobType,
  type WorkerCapability
} from '@pixishelf/job-contracts'
import type { ExecutorDefinition, WorkerJobExecutor } from '@pixishelf/job-runtime'

export {
  jobExecutionOutcomeSchema,
  parseJobExecutionOutcome,
  type JobExecutionOutcome,
  type WorkerJobExecutor
} from '@pixishelf/job-runtime'

export type ExecutorRegistration<TPayload = unknown, TResult = unknown> = ExecutorDefinition<TPayload, TResult>

export interface ResolvedExecutor<TPayload = unknown> {
  jobType: JobType
  executionLane: ExecutionLane
  definitionVersion: number
  payload: TPayload
  execute: WorkerJobExecutor<TPayload>
}

interface StoredRegistration {
  jobType: JobType
  executionLane: ExecutionLane
  definitionVersion: number
  execute: WorkerJobExecutor
  parsePayload(payload: unknown): unknown
}

export class ExecutorRegistry {
  private readonly registrations = new Map<string, StoredRegistration>()

  register<TPayload, TResult>(registration: ExecutorRegistration<TPayload, TResult>): this {
    const jobType = jobTypeSchema.parse(registration.jobType)
    const executionLane = executionLaneSchema.parse(registration.executionLane ?? executionLaneForJobType(jobType))
    if (executionLane !== executionLaneForJobType(jobType)) {
      throw new Error(`Executor ${jobType} must register in ${executionLaneForJobType(jobType)}`)
    }
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
      executionLane,
      definitionVersion: registration.definitionVersion,
      execute: registration.execute as WorkerJobExecutor,
      parsePayload
    })
    return this
  }

  resolve(job: {
    type: string
    executionLane?: string
    definitionVersion: number
    payload: unknown
  }): ResolvedExecutor | null {
    const parsedType = jobTypeSchema.safeParse(job.type)
    if (!parsedType.success) return null
    const registration = this.registrations.get(registryKey(parsedType.data, job.definitionVersion))
    if (!registration) return null
    if ((job.executionLane ?? executionLaneForJobType(parsedType.data)) !== registration.executionLane) return null
    return {
      jobType: registration.jobType,
      executionLane: registration.executionLane,
      definitionVersion: registration.definitionVersion,
      payload: registration.parsePayload(job.payload ?? {}),
      execute: registration.execute
    }
  }

  capabilities(executionLane?: ExecutionLane): WorkerCapability[] {
    const versionsByType = new Map<JobType, number[]>()
    for (const registration of this.registrations.values()) {
      if (executionLane && registration.executionLane !== executionLane) continue
      const versions = versionsByType.get(registration.jobType) ?? []
      versions.push(registration.definitionVersion)
      versionsByType.set(registration.jobType, versions)
    }
    return [...versionsByType]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([jobType, versions]) => ({
        jobType,
        executionLane: executionLaneForJobType(jobType),
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
