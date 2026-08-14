import { prisma } from '@/lib/prisma'
import {
  JOB_DEFINITION_VERSION,
  jobTypeSchema,
  jsonValueSchema,
  parseJobPayload,
  type JobDto,
  type JobStatus
} from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import { z } from 'zod'
import { BackgroundTaskError } from './background-task-error'
import { writeJobEvent } from './job-event-service'
import { systemJobWireSelect, toJobDto, type SystemJobWireRecord } from './job-serialization'

const commonEnqueueFields = {
  type: jobTypeSchema,
  definitionVersion: z.number().int().min(1).default(JOB_DEFINITION_VERSION),
  payload: jsonValueSchema.optional(),
  idempotencyKey: z.string().trim().min(1).max(180).optional(),
  parentJobId: z.string().min(1).optional(),
  availableAt: z.coerce.date().optional(),
  deadlineAt: z.coerce.date().optional(),
  maxAttempts: z.number().int().min(1).max(20).default(3)
} as const

export const manualEnqueueJobRequestSchema = z.object({
  ...commonEnqueueFields,
  definitionVersion: z.literal(JOB_DEFINITION_VERSION).default(JOB_DEFINITION_VERSION),
  triggerSource: z.literal('MANUAL'),
  priority: z.number().int().min(0).max(99)
})

export const enqueueJobInputSchema = z.discriminatedUnion('triggerSource', [
  manualEnqueueJobRequestSchema.extend({ requestedByUserId: z.string().min(1) }),
  z.object({
    ...commonEnqueueFields,
    triggerSource: z.literal('SCHEDULE'),
    scheduledTaskId: z.string().min(1),
    scheduledForDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    deadlineAt: z.coerce.date(),
    priority: z.number().int().min(100).max(999)
  }),
  z.object({
    ...commonEnqueueFields,
    triggerSource: z.literal('SYSTEM'),
    priority: z.number().int().min(100).max(999)
  })
])

export const jobIdInputSchema = z.object({ jobId: z.string().min(1) })
export const retryJobInputSchema = jobIdInputSchema.extend({ requestedByUserId: z.string().min(1).optional() })
export const changeJobPriorityInputSchema = jobIdInputSchema.extend({ priority: z.number().int().min(0).max(999) })

interface CommandDatabaseClient {
  $transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>
}

type ParsedEnqueueInput = z.output<typeof enqueueJobInputSchema>

const IDEMPOTENCY_LOCK_NAMESPACE = 80_432_026

function commandDatabase(client?: CommandDatabaseClient) {
  return client ?? (prisma as unknown as CommandDatabaseClient)
}

function requireJob(record: SystemJobWireRecord | null): SystemJobWireRecord {
  if (!record) throw new BackgroundTaskError('JOB_NOT_FOUND', 'Background job was not found')
  return record
}

function assertStatus(job: SystemJobWireRecord, allowed: readonly JobStatus[], action: string) {
  if (!allowed.includes(job.status)) {
    throw new BackgroundTaskError(
      'INVALID_STATE_TRANSITION',
      `Cannot ${action} a ${job.status.toLowerCase()} background job`
    )
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(',')}}`
}

function assertIdempotencySemantics(existing: SystemJobWireRecord, input: ParsedEnqueueInput, payload: unknown) {
  const expectedRequestedByUserId = input.triggerSource === 'MANUAL' ? input.requestedByUserId : null
  const expectedScheduledTaskId = input.triggerSource === 'SCHEDULE' ? input.scheduledTaskId : null
  const expectedScheduledForDate = input.triggerSource === 'SCHEDULE' ? input.scheduledForDate : null
  const semanticMatch =
    existing.type === input.type &&
    existing.definitionVersion === input.definitionVersion &&
    existing.triggerSource === input.triggerSource &&
    existing.requestedByUserId === expectedRequestedByUserId &&
    existing.parentJobId === (input.parentJobId ?? null) &&
    existing.scheduledTaskId === expectedScheduledTaskId &&
    existing.scheduledForDate === expectedScheduledForDate &&
    existing.queuePriority === input.priority &&
    existing.maxAttempts === input.maxAttempts &&
    canonicalJson(existing.payload) === canonicalJson(payload) &&
    existing.deadlineAt?.toISOString() === input.deadlineAt?.toISOString() &&
    (input.availableAt === undefined || existing.availableAt?.toISOString() === input.availableAt.toISOString())

  if (!semanticMatch) {
    throw new BackgroundTaskError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key is already bound to a different background job request'
    )
  }
}

async function lockIdempotencyKey(transaction: Prisma.TransactionClient, idempotencyKey: string) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${IDEMPOTENCY_LOCK_NAMESPACE}::integer, hashtext(${idempotencyKey}::text))::text AS "lock"`
  )
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

function deriveLegacyJobProjection(type: string, definitionVersion: number, payload: unknown) {
  if (
    definitionVersion !== JOB_DEFINITION_VERSION ||
    type !== 'VIDEO_KEYFRAME_GENERATION' ||
    payload === null ||
    typeof payload !== 'object'
  ) {
    return { targetImageId: null, targetPath: null, mode: null }
  }

  const generationPayload = payload as { imageId: number; relativePath: string; mode: string }
  return {
    targetImageId: generationPayload.imageId,
    targetPath: generationPayload.relativePath,
    mode: generationPayload.mode
  }
}

async function loadIdempotentJob(
  transaction: Prisma.TransactionClient,
  idempotencyKey: string,
  input: ParsedEnqueueInput,
  payload: unknown
) {
  const existing = await transaction.systemJob.findUnique({
    where: { idempotencyKey },
    select: systemJobWireSelect
  })
  if (existing) assertIdempotencySemantics(existing, input, payload)
  return existing
}

async function compareAndSetJob(
  transaction: Prisma.TransactionClient,
  job: SystemJobWireRecord,
  data: Prisma.SystemJobUpdateManyMutationInput
) {
  const result = await transaction.systemJob.updateMany({ where: { id: job.id, status: job.status }, data })
  if (result.count !== 1) {
    throw new BackgroundTaskError('CONCURRENT_MODIFICATION', 'Background job changed while applying the command')
  }
  return requireJob(await transaction.systemJob.findUnique({ where: { id: job.id }, select: systemJobWireSelect }))
}

export async function enqueueJob(
  input: z.input<typeof enqueueJobInputSchema>,
  client?: CommandDatabaseClient,
  now: () => Date = () => new Date()
): Promise<JobDto> {
  const parsed = enqueueJobInputSchema.parse(input)
  const payload =
    parsed.definitionVersion === JOB_DEFINITION_VERSION
      ? parseJobPayload(parsed.type, parsed.payload ?? {})
      : jsonValueSchema.parse(parsed.payload ?? {})
  const database = commandDatabase(client)

  try {
    return await database.$transaction(async (transaction) => {
      if (parsed.idempotencyKey) {
        await lockIdempotencyKey(transaction, parsed.idempotencyKey)
        const existing = await loadIdempotentJob(transaction, parsed.idempotencyKey, parsed, payload)
        if (existing) return toJobDto(existing)
      }

      const timestamp = now()
      const legacyProjection = deriveLegacyJobProjection(parsed.type, parsed.definitionVersion, payload)
      const record = await transaction.systemJob.create({
        data: {
          type: parsed.type,
          definitionVersion: parsed.definitionVersion,
          status: 'PENDING',
          triggerSource: parsed.triggerSource,
          payload: payload as Prisma.InputJsonValue,
          queuePriority: parsed.priority,
          effectivePriority: parsed.priority,
          availableAt: parsed.availableAt ?? timestamp,
          deadlineAt: parsed.deadlineAt,
          maxAttempts: parsed.maxAttempts,
          ...legacyProjection,
          idempotencyKey: parsed.idempotencyKey,
          parentJobId: parsed.parentJobId,
          ...(parsed.triggerSource === 'MANUAL' ? { requestedByUserId: parsed.requestedByUserId } : {}),
          ...(parsed.triggerSource === 'SCHEDULE'
            ? { scheduledTaskId: parsed.scheduledTaskId, scheduledForDate: parsed.scheduledForDate }
            : {})
        },
        select: systemJobWireSelect
      })
      await writeJobEvent(transaction, {
        jobId: record.id,
        type: 'job.queued',
        attempt: 0,
        message: 'Background job queued',
        data: { triggerSource: parsed.triggerSource, priority: parsed.priority }
      })
      return toJobDto(record)
    })
  } catch (error) {
    if (!parsed.idempotencyKey || !isUniqueConstraintError(error)) throw error
    return database.$transaction(async (transaction) => {
      await lockIdempotencyKey(transaction, parsed.idempotencyKey!)
      const existing = await loadIdempotentJob(transaction, parsed.idempotencyKey!, parsed, payload)
      if (!existing) throw error
      return toJobDto(existing)
    })
  }
}

export async function cancelJobCommand(
  input: z.input<typeof jobIdInputSchema>,
  client?: CommandDatabaseClient,
  now: () => Date = () => new Date()
) {
  const { jobId } = jobIdInputSchema.parse(input)
  return commandDatabase(client).$transaction(async (transaction) => {
    const job = requireJob(
      await transaction.systemJob.findUnique({ where: { id: jobId }, select: systemJobWireSelect })
    )
    if (job.status === 'CANCELLING' || job.status === 'CANCELLED') return toJobDto(job)
    assertStatus(job, ['PENDING', 'RETRY_WAIT', 'PAUSED', 'RUNNING', 'PAUSING'], 'cancel')
    const timestamp = now()
    const direct = ['PENDING', 'RETRY_WAIT', 'PAUSED'].includes(job.status)
    const updated = await compareAndSetJob(transaction, job, {
      status: direct ? 'CANCELLED' : 'CANCELLING',
      cancelRequestedAt: timestamp,
      ...(direct
        ? {
            finishedAt: timestamp,
            workerId: null,
            leaseToken: null,
            leaseExpiresAt: null,
            heartbeatAt: null
          }
        : {})
    })
    await writeJobEvent(transaction, {
      jobId,
      type: 'job.cancel_requested',
      attempt: job.attempt,
      message: 'Cancellation requested'
    })
    if (direct) {
      await writeJobEvent(transaction, {
        jobId,
        type: 'job.cancelled',
        attempt: job.attempt,
        message: 'Queued job cancelled before execution'
      })
    }
    return toJobDto(updated)
  })
}

export async function pauseJobCommand(
  input: z.input<typeof jobIdInputSchema>,
  client?: CommandDatabaseClient,
  now: () => Date = () => new Date()
) {
  const { jobId } = jobIdInputSchema.parse(input)
  return commandDatabase(client).$transaction(async (transaction) => {
    const job = requireJob(
      await transaction.systemJob.findUnique({ where: { id: jobId }, select: systemJobWireSelect })
    )
    if (job.status === 'PAUSING' || job.status === 'PAUSED') return toJobDto(job)
    assertStatus(job, ['PENDING', 'RETRY_WAIT', 'RUNNING'], 'pause')
    const direct = job.status !== 'RUNNING'
    const updated = await compareAndSetJob(transaction, job, {
      status: direct ? 'PAUSED' : 'PAUSING',
      pauseRequestedAt: now(),
      ...(direct ? { workerId: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null } : {})
    })
    await writeJobEvent(transaction, {
      jobId,
      type: 'job.pause_requested',
      attempt: job.attempt,
      message: 'Pause requested'
    })
    if (direct) {
      await writeJobEvent(transaction, {
        jobId,
        type: 'job.paused',
        attempt: job.attempt,
        message: 'Queued job paused before execution'
      })
    }
    return toJobDto(updated)
  })
}

export async function resumeJobCommand(
  input: z.input<typeof jobIdInputSchema>,
  client?: CommandDatabaseClient,
  now: () => Date = () => new Date()
) {
  const { jobId } = jobIdInputSchema.parse(input)
  return commandDatabase(client).$transaction(async (transaction) => {
    const job = requireJob(
      await transaction.systemJob.findUnique({ where: { id: jobId }, select: systemJobWireSelect })
    )
    assertStatus(job, ['PAUSED'], 'resume')
    const updated = await compareAndSetJob(transaction, job, {
      status: 'PENDING',
      availableAt: now(),
      pauseRequestedAt: null,
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null
    })
    await writeJobEvent(transaction, {
      jobId,
      type: 'job.queued',
      attempt: job.attempt,
      message: 'Paused job resumed and queued',
      data: { reason: 'RESUME' }
    })
    return toJobDto(updated)
  })
}

export async function retryJobCommand(
  input: z.input<typeof retryJobInputSchema>,
  client?: CommandDatabaseClient,
  now: () => Date = () => new Date()
) {
  const { jobId, requestedByUserId } = retryJobInputSchema.parse(input)
  return commandDatabase(client).$transaction(async (transaction) => {
    const job = requireJob(
      await transaction.systemJob.findUnique({ where: { id: jobId }, select: systemJobWireSelect })
    )
    assertStatus(job, ['FAILED', 'CANCELLED', 'SKIPPED'], 'retry')
    if (job.definitionVersion < 1) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', 'Legacy definition version 0 jobs cannot be retried')
    }
    const priority = Math.min(job.queuePriority, 99)
    const legacyProjection = deriveLegacyJobProjection(job.type, job.definitionVersion, job.payload)
    const retried = await transaction.systemJob.create({
      data: {
        type: job.type,
        definitionVersion: job.definitionVersion,
        status: 'PENDING',
        triggerSource: 'RETRY',
        requestedByUserId: requestedByUserId ?? job.requestedByUserId,
        payload: job.payload === null ? Prisma.JsonNull : (job.payload as Prisma.InputJsonValue),
        parentJobId: job.id,
        queuePriority: priority,
        effectivePriority: priority,
        availableAt: now(),
        maxAttempts: job.maxAttempts,
        ...legacyProjection
      },
      select: systemJobWireSelect
    })
    await writeJobEvent(transaction, {
      jobId: job.id,
      type: 'job.retry_scheduled',
      attempt: job.attempt,
      message: 'Manual retry created a new job instance',
      data: { retryJobId: retried.id }
    })
    await writeJobEvent(transaction, {
      jobId: retried.id,
      type: 'job.queued',
      attempt: 0,
      message: 'Retry job queued',
      data: { retryOfJobId: job.id, priority }
    })
    return toJobDto(retried)
  })
}

export async function changeJobPriorityCommand(
  input: z.input<typeof changeJobPriorityInputSchema>,
  client?: CommandDatabaseClient
) {
  const parsed = changeJobPriorityInputSchema.parse(input)
  return commandDatabase(client).$transaction(async (transaction) => {
    const job = requireJob(
      await transaction.systemJob.findUnique({ where: { id: parsed.jobId }, select: systemJobWireSelect })
    )
    assertStatus(job, ['PENDING', 'RETRY_WAIT', 'PAUSED'], 'change priority for')
    const range = job.triggerSource === 'MANUAL' || job.triggerSource === 'RETRY' ? [0, 99] : [100, 999]
    if (parsed.priority < range[0]! || parsed.priority > range[1]!) {
      throw new BackgroundTaskError(
        'INVALID_STATE_TRANSITION',
        `${job.triggerSource.toLowerCase()} job priority must be between ${range[0]} and ${range[1]}`
      )
    }
    const updated = await compareAndSetJob(transaction, job, {
      queuePriority: parsed.priority,
      effectivePriority: parsed.priority
    })
    await writeJobEvent(transaction, {
      jobId: job.id,
      type: 'job.queued',
      attempt: job.attempt,
      message: 'Queued job priority changed',
      data: { previousPriority: job.queuePriority, priority: parsed.priority }
    })
    return toJobDto(updated)
  })
}
