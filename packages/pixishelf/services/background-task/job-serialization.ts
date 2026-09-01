import {
  executionLaneForJobType,
  jobTypeSchema,
  jobDtoSchema,
  jobEventDtoSchema,
  jsonValueSchema,
  workerHealthDtoSchema,
  type JobDto,
  type JobEventDto,
  type JobLiveSummary,
  type JsonValue,
  type WorkerHealthDto
} from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import { redactArchiveText } from '@/services/archive/archive-redaction'
import { redactSensitiveText, sanitizeJsonValue, type WireTextRedactor } from './job-redaction'

export { redactSensitiveText, sanitizeJsonValue } from './job-redaction'

export const systemJobWireSelect = {
  id: true,
  type: true,
  executionLane: true,
  definitionVersion: true,
  status: true,
  triggerSource: true,
  requestedByUserId: true,
  scheduledTaskId: true,
  scheduledForDate: true,
  idempotencyKey: true,
  payload: true,
  progress: true,
  stage: true,
  message: true,
  result: true,
  errorCode: true,
  error: true,
  skipReason: true,
  attempt: true,
  maxAttempts: true,
  parentJobId: true,
  queuePriority: true,
  effectivePriority: true,
  availableAt: true,
  deadlineAt: true,
  workerId: true,
  leaseToken: true,
  leaseExpiresAt: true,
  heartbeatAt: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.SystemJobSelect

export const systemJobEventWireSelect = {
  id: true,
  jobId: true,
  type: true,
  level: true,
  attempt: true,
  workerId: true,
  stage: true,
  progress: true,
  message: true,
  data: true,
  createdAt: true,
  job: { select: { type: true } }
} satisfies Prisma.SystemJobEventSelect

export const systemJobLiveSummarySelect = {
  id: true,
  type: true,
  executionLane: true,
  status: true,
  progress: true,
  stage: true,
  message: true,
  errorCode: true,
  attempt: true,
  parentJobId: true,
  heartbeatAt: true,
  startedAt: true,
  finishedAt: true,
  updatedAt: true
} satisfies Prisma.SystemJobSelect

export const workerInstanceWireSelect = {
  workerId: true,
  status: true,
  serviceVersion: true,
  hostname: true,
  processId: true,
  capabilities: true,
  startedAt: true,
  heartbeatAt: true,
  lastError: true,
  updatedAt: true
} satisfies Prisma.WorkerInstanceSelect

export type SystemJobWireRecord = Prisma.SystemJobGetPayload<{ select: typeof systemJobWireSelect }>
export type SystemJobEventWireRecord = Prisma.SystemJobEventGetPayload<{ select: typeof systemJobEventWireSelect }>
export type SystemJobLiveSummaryRecord = Prisma.SystemJobGetPayload<{ select: typeof systemJobLiveSummarySelect }>
export type WorkerInstanceWireRecord = Prisma.WorkerInstanceGetPayload<{ select: typeof workerInstanceWireSelect }>

function iso(value: Date | null) {
  return value?.toISOString() ?? null
}

export function toJobDto(record: SystemJobWireRecord): JobDto {
  const redactText = wireTextRedactor(record.type)
  return jobDtoSchema.parse({
    ...record,
    idempotencyKey: redactSensitiveText(record.idempotencyKey),
    payload: sanitizeJsonValue(record.payload, redactText),
    result: sanitizeJsonValue(record.result, redactText),
    message: redactText(record.message),
    error: redactText(record.error),
    availableAt: iso(record.availableAt),
    deadlineAt: iso(record.deadlineAt),
    leaseToken: null,
    leaseExpiresAt: iso(record.leaseExpiresAt),
    heartbeatAt: iso(record.heartbeatAt),
    startedAt: iso(record.startedAt),
    finishedAt: iso(record.finishedAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  })
}

export function toJobEventDto(record: SystemJobEventWireRecord): JobEventDto {
  const { job, ...event } = record
  const redactText = wireTextRedactor(job.type)
  return jobEventDtoSchema.parse({
    ...event,
    id: record.id.toString(10),
    message: redactText(record.message),
    data: sanitizeJsonValue(record.data, redactText),
    createdAt: record.createdAt.toISOString()
  })
}

export function toJobLiveSummary(record: SystemJobLiveSummaryRecord): JobLiveSummary {
  return {
    ...record,
    type: jobTypeSchema.parse(record.type),
    message: wireTextRedactor(record.type)(record.message),
    heartbeatAt: iso(record.heartbeatAt),
    startedAt: iso(record.startedAt),
    finishedAt: iso(record.finishedAt),
    updatedAt: record.updatedAt.toISOString()
  }
}

function wireTextRedactor(jobType: string): WireTextRedactor {
  return jobType.startsWith('ARCHIVE_') ? redactArchiveText : redactSensitiveText
}

export function toWorkerHealthDto(record: WorkerInstanceWireRecord): WorkerHealthDto {
  return workerHealthDtoSchema.parse({
    ...record,
    capabilities: normalizeWorkerCapabilities(record.capabilities),
    lastError: redactSensitiveText(record.lastError, 2_048),
    startedAt: record.startedAt.toISOString(),
    heartbeatAt: record.heartbeatAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  })
}

function normalizeWorkerCapabilities(value: unknown): JsonValue {
  const capabilities = jsonValueSchema.parse(value ?? [])
  if (!Array.isArray(capabilities)) return capabilities

  return capabilities.map((capability) => {
    if (
      typeof capability !== 'object' ||
      capability === null ||
      Array.isArray(capability) ||
      'executionLane' in capability
    ) {
      return capability
    }
    const jobType = jobTypeSchema.safeParse(capability.jobType)
    return jobType.success ? { ...capability, executionLane: executionLaneForJobType(jobType.data) } : capability
  })
}
