import {
  jobDtoSchema,
  jobEventDtoSchema,
  jsonValueSchema,
  workerHealthDtoSchema,
  type JobDto,
  type JobEventDto,
  type JsonValue,
  type WorkerHealthDto
} from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'

const sensitiveKey =
  /(?:apiKey|accessToken|authorization|connectionString|cookie|credential|databaseUrl|dsn|password|privateKey|secret|token)/i
const sensitiveTextField =
  '(?:apiKey|accessToken|authorization|connectionString|cookie|credential|databaseUrl|dsn|password|privateKey|secret|token)'
const DEFAULT_WIRE_TEXT_LIMIT = 4_096

export const systemJobWireSelect = {
  id: true,
  type: true,
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
  createdAt: true
} satisfies Prisma.SystemJobEventSelect

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
export type WorkerInstanceWireRecord = Prisma.WorkerInstanceGetPayload<{ select: typeof workerInstanceWireSelect }>

export function redactSensitiveText(value: string | null, maxLength = DEFAULT_WIRE_TEXT_LIMIT): string | null {
  if (value === null) return null
  const redacted = value
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/(bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(
      /([?&](?:access_token|accessToken|api_key|apiKey|authorization|databaseUrl|dsn|password|secret|token)=)[^&#\s]+/gi,
      '$1[REDACTED]'
    )
    .replace(new RegExp(`(${sensitiveTextField}["']?\\s*[:=]\\s*["']?)[^\\s,;}"']+`, 'gi'), '$1[REDACTED]')
  return redacted.slice(0, maxLength)
}

export function sanitizeJsonValue(value: unknown): JsonValue | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return redactSensitiveText(value) ?? ''
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(sanitizeJsonValue)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        sensitiveKey.test(key) ? '[REDACTED]' : sanitizeJsonValue(nested)
      ])
    )
  }
  return String(value)
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null
}

export function toJobDto(record: SystemJobWireRecord): JobDto {
  return jobDtoSchema.parse({
    ...record,
    idempotencyKey: redactSensitiveText(record.idempotencyKey),
    payload: sanitizeJsonValue(record.payload),
    result: sanitizeJsonValue(record.result),
    message: redactSensitiveText(record.message),
    error: redactSensitiveText(record.error),
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
  return jobEventDtoSchema.parse({
    ...record,
    id: record.id.toString(10),
    message: redactSensitiveText(record.message),
    data: sanitizeJsonValue(record.data),
    createdAt: record.createdAt.toISOString()
  })
}

export function toWorkerHealthDto(record: WorkerInstanceWireRecord): WorkerHealthDto {
  return workerHealthDtoSchema.parse({
    ...record,
    capabilities: jsonValueSchema.parse(record.capabilities ?? []),
    lastError: redactSensitiveText(record.lastError, 2_048),
    startedAt: record.startedAt.toISOString(),
    heartbeatAt: record.heartbeatAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  })
}
