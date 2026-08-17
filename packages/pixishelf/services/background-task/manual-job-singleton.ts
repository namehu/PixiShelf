import { prisma } from '@/lib/prisma'
import {
  ACTIVE_JOB_STATUSES,
  JOB_DEFINITION_VERSION,
  parseJobPayload,
  type JobDto,
  type JsonValue
} from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import { z } from 'zod'
import { BackgroundTaskError } from './background-task-error'
import { enqueueJob, manualEnqueueJobRequestSchema } from './job-command-service'
import { systemJobWireSelect, toJobDto, type SystemJobWireRecord } from './job-serialization'

const singletonManualJobInputSchema = manualEnqueueJobRequestSchema.extend({
  requestedByUserId: z.string().min(1)
})
const singletonSystemJobInputSchema = manualEnqueueJobRequestSchema.extend({
  triggerSource: z.literal('SYSTEM'),
  priority: z.number().int().min(100).max(999)
})

const SINGLETON_MANUAL_JOB_LOCK_NAMESPACE = 80_432_028

interface SingletonCommandDatabaseClient {
  $transaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>
}

export interface EnqueueSingletonManualJobOptions {
  client?: SingletonCommandDatabaseClient
  afterEnqueue?: (input: { transaction: Prisma.TransactionClient; job: JobDto; reused: boolean }) => Promise<void>
}

export interface EnqueueSingletonManualJobResult {
  job: JobDto
  reused: boolean
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(',')}}`
}

function optionalDateMatches(actual: Date | null, expected: Date | undefined): boolean {
  return actual?.toISOString() === expected?.toISOString() || (actual === null && expected === undefined)
}

type SingletonJobInput = z.output<typeof singletonManualJobInputSchema> | z.output<typeof singletonSystemJobInputSchema>

function hasSameSingletonSemantics(
  existing: SystemJobWireRecord,
  input: SingletonJobInput,
  payload: JsonValue
): boolean {
  return (
    existing.definitionVersion === JOB_DEFINITION_VERSION &&
    existing.triggerSource === input.triggerSource &&
    existing.idempotencyKey === (input.idempotencyKey ?? null) &&
    existing.parentJobId === (input.parentJobId ?? null) &&
    existing.queuePriority === input.priority &&
    existing.maxAttempts === input.maxAttempts &&
    (input.availableAt === undefined || optionalDateMatches(existing.availableAt, input.availableAt)) &&
    optionalDateMatches(existing.deadlineAt, input.deadlineAt) &&
    canonicalJson(existing.payload) === canonicalJson(payload)
  )
}

/**
 * Serializes manual enqueue by job type and reuses only an exactly equivalent active request.
 * A different payload (for example force=true vs force=false) is an explicit conflict rather
 * than being silently swallowed by the already-active job.
 */
export async function enqueueSingletonManualJob(
  input: z.input<typeof singletonManualJobInputSchema>,
  options: EnqueueSingletonManualJobOptions = {}
): Promise<JobDto> {
  return (await enqueueSingletonManualJobWithResult(input, options)).job
}

export async function enqueueSingletonManualJobWithResult(
  input: z.input<typeof singletonManualJobInputSchema>,
  options: EnqueueSingletonManualJobOptions = {}
): Promise<EnqueueSingletonManualJobResult> {
  const parsed = singletonManualJobInputSchema.parse(input)
  return enqueueSingletonJobWithResult(parsed, options)
}

export async function enqueueSingletonSystemJobWithResult(
  input: z.input<typeof singletonSystemJobInputSchema>,
  options: EnqueueSingletonManualJobOptions = {}
): Promise<EnqueueSingletonManualJobResult> {
  const parsed = singletonSystemJobInputSchema.parse(input)
  return enqueueSingletonJobWithResult(parsed, options)
}

async function enqueueSingletonJobWithResult(
  parsed: SingletonJobInput,
  options: EnqueueSingletonManualJobOptions
): Promise<EnqueueSingletonManualJobResult> {
  const payload = parseJobPayload(parsed.type, parsed.payload ?? {}) as JsonValue
  const database = options.client ?? (prisma as unknown as SingletonCommandDatabaseClient)

  return database.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${SINGLETON_MANUAL_JOB_LOCK_NAMESPACE}::integer, hashtext(${parsed.type}::text))::text AS "lock"`
    )
    const existing = await transaction.systemJob.findFirst({
      where: { type: parsed.type, status: { in: [...ACTIVE_JOB_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: systemJobWireSelect
    })

    if (existing) {
      if (!hasSameSingletonSemantics(existing, parsed, payload)) {
        throw new BackgroundTaskError(
          'ACTIVE_JOB_CONFLICT',
          `Active background job ${existing.id} has different request semantics`
        )
      }
      const job = toJobDto(existing)
      await options.afterEnqueue?.({ transaction, job, reused: true })
      return { job, reused: true }
    }

    const job = await enqueueJob({ ...parsed, payload }, { $transaction: async (operation) => operation(transaction) })
    await options.afterEnqueue?.({ transaction, job, reused: false })
    return { job, reused: false }
  })
}
