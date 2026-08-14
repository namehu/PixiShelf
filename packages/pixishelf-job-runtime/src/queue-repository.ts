import { randomUUID } from 'node:crypto'
import type { JobSkipReason, JobStatus, JobTriggerSource, JobType, WorkerCapability } from '@pixishelf/job-contracts'
import { JOB_DEFINITION_VERSION, jobTypeSchema, jsonValueSchema, parseJobPayload } from '@pixishelf/job-contracts'
import { DispatchWindowPolicy } from './dispatch-window.js'
import { type QueueClock, systemQueueClock } from './queue-clock.js'
import { redactSensitiveText } from './worker-health-state.js'

export const GLOBAL_BACKGROUND_WORKER_RESOURCE = 'global/background-worker'

const EXECUTING_JOB_STATUSES = ['RUNNING', 'PAUSING', 'CANCELLING'] as const
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SENSITIVE_EVENT_KEY =
  /(?:apiKey|accessToken|authorization|connectionString|cookie|credential|databaseUrl|dsn|password|privateKey|secret|token)/i

export interface QueueSqlExecutor {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
}

export interface QueueDatabase extends QueueSqlExecutor {
  $transaction<T>(
    operation: (transaction: QueueSqlExecutor) => Promise<T>,
    options?: {
      isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable'
      maxWait?: number
      timeout?: number
    }
  ): Promise<T>
}

export interface QueueRepositoryOptions {
  clock?: QueueClock
  windowPolicy?: DispatchWindowPolicy
  leaseDurationMs?: number
  transactionMaxWaitMs?: number
  transactionTimeoutMs?: number
}

export interface QueueJobRecord {
  id: string
  type: string
  definitionVersion: number
  status: JobStatus
  triggerSource: JobTriggerSource
  payload: unknown
  attempt: number
  maxAttempts: number
  effectivePriority: number
  availableAt: Date | null
  deadlineAt: Date | null
  workerId: string | null
  leaseToken: string | null
  leaseExpiresAt: Date | null
  heartbeatAt: Date | null
  startedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ClaimedJob extends QueueJobRecord {
  status: 'RUNNING'
  workerId: string
  leaseToken: string
  leaseExpiresAt: Date
  executionToken: string
}

export interface ExecutionFence {
  jobId: string
  workerId: string
  executionToken: string
  attempt: number
}

export interface RecoveredExecution {
  jobId: string
  previousWorkerId: string | null
  attempt: number
  status: 'RETRY_WAIT' | 'FAILED' | 'PAUSED' | 'CANCELLED'
}

export interface CompleteExecutionInput extends ExecutionFence {
  result?: unknown
  message?: string | null
}

export interface FailExecutionInput extends ExecutionFence {
  errorCode: string
  error: string
  message?: string | null
}

export interface RetryExecutionInput extends ExecutionFence {
  availableAt: Date
  errorCode: string
  error: string
  message?: string | null
}

export interface SkipExecutionInput extends ExecutionFence {
  reason: JobSkipReason
  message?: string | null
}

export interface CancelExecutionInput extends ExecutionFence {
  message?: string | null
}

export interface ProgressExecutionInput extends ExecutionFence {
  progress: number
  stage?: string | null
  message?: string | null
  data?: unknown
}

export interface RequestCancellationResult {
  jobId: string
  status: 'CANCELLING' | 'CANCELLED'
}

export interface EnqueueChildInput {
  type: JobType
  definitionVersion?: number
  payload?: unknown
  queuePriority?: number
  effectivePriority?: number
  availableAt?: Date
  deadlineAt?: Date | null
  idempotencyKey?: string
  maxAttempts?: number
}

export interface EnqueuedChildJob {
  id: string
  created: boolean
}

export interface ExecutionControlState {
  status: 'RUNNING' | 'PAUSING' | 'CANCELLING'
  cancelRequestedAt: Date | null
  pauseRequestedAt: Date | null
}

export interface TransactionBoundCompleteInput {
  result?: unknown
  message?: string | null
}

export interface TransactionBoundFailInput {
  errorCode: string
  error: string
  message?: string | null
}

export interface TransactionBoundRetryInput extends TransactionBoundFailInput {
  availableAt: Date
}

export interface TransactionBoundSkipInput {
  reason: JobSkipReason
  message?: string | null
}

export interface FencedExecutionTransaction<TTransaction extends QueueSqlExecutor = QueueSqlExecutor> {
  transaction: TTransaction
  complete(input?: TransactionBoundCompleteInput): Promise<void>
  fail(input: TransactionBoundFailInput): Promise<void>
  retry(input: TransactionBoundRetryInput): Promise<void>
  skip(input: TransactionBoundSkipInput): Promise<void>
  cancel(message?: string | null): Promise<void>
}

interface JobResourceLeaseRow {
  ownerJobId: string
  workerId: string
  leaseToken: string
  expiresAt: Date
}

interface ExecutingJobRow {
  id: string
  status: 'RUNNING' | 'PAUSING' | 'CANCELLING'
  workerId: string | null
  leaseToken: string | null
  leaseExpiresAt: Date | null
  attempt: number
  maxAttempts: number
}

interface OwnedJobTransition {
  status: 'PENDING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'RETRY_WAIT' | 'SKIPPED' | 'CANCELLED'
  eventType: string
  eventLevel: 'INFO' | 'WARN' | 'ERROR'
  message: string
  assignments: string
  values: unknown[]
  extraPredicate?: string
  eventData?: unknown
}

export class JobExecutionFenceError extends Error {
  readonly code = 'JOB_EXECUTION_FENCE_LOST'

  constructor(jobId: string) {
    super(`Execution ownership was lost for job ${jobId}`)
    this.name = 'JobExecutionFenceError'
  }
}

export class PostgresQueueRepository {
  private readonly clock: QueueClock
  private readonly windowPolicy: DispatchWindowPolicy
  private readonly leaseDurationMs: number
  private readonly transactionMaxWaitMs: number
  private readonly transactionTimeoutMs: number

  constructor(
    private readonly database: QueueDatabase,
    options: QueueRepositoryOptions = {}
  ) {
    this.clock = options.clock ?? systemQueueClock
    this.windowPolicy = options.windowPolicy ?? new DispatchWindowPolicy()
    this.leaseDurationMs = options.leaseDurationMs ?? 60_000
    this.transactionMaxWaitMs = options.transactionMaxWaitMs ?? 5_000
    this.transactionTimeoutMs = options.transactionTimeoutMs ?? 10_000

    if (!Number.isSafeInteger(this.leaseDurationMs) || this.leaseDurationMs <= 0) {
      throw new Error('leaseDurationMs must be a positive safe integer')
    }
  }

  async claim(workerId: string, supportedCapabilities: readonly WorkerCapability[]): Promise<ClaimedJob | null> {
    assertWorkerId(workerId)
    if (supportedCapabilities.length === 0) {
      return null
    }
    const now = this.clock.now()

    return this.runTransaction(async (transaction) => {
      await this.acquireDispatcherTransactionLock(transaction)
      await this.recoverExpiredExecutionInTransaction(transaction, now)
      await this.skipExpiredScheduledJobsInTransaction(transaction, now)

      const activeExecutions = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id"
         FROM "system_jobs"
         WHERE "status" IN ('RUNNING', 'PAUSING', 'CANCELLING')
         ORDER BY "startedAt" ASC NULLS FIRST, "createdAt" ASC
         LIMIT 1
         FOR UPDATE`
      )
      if (activeExecutions.length > 0) {
        return null
      }

      const activeLeases = await transaction.$queryRawUnsafe<JobResourceLeaseRow[]>(
        `SELECT
           "ownerJobId",
           "workerId",
           "leaseToken"::text AS "leaseToken",
           "expiresAt"
         FROM "job_resource_leases"
         WHERE "resourceKey" = $1
           AND "expiresAt" > $2
         LIMIT 1
         FOR UPDATE`,
        GLOBAL_BACKGROUND_WORKER_RESOURCE,
        now
      )
      if (activeLeases.length > 0) {
        return null
      }

      await transaction.$executeRawUnsafe(
        `DELETE FROM "job_resource_leases"
         WHERE "resourceKey" = $1
           AND "expiresAt" <= $2`,
        GLOBAL_BACKGROUND_WORKER_RESOURCE,
        now
      )

      const automaticWindowOpen = this.windowPolicy.isAutomaticWindowOpen(now)
      await this.ageEligibleCandidatesInTransaction(transaction, now, automaticWindowOpen, supportedCapabilities)
      const candidates = await transaction.$queryRawUnsafe<Array<{ id: string; status: JobStatus }>>(
        `SELECT "id", "status"
         FROM "system_jobs"
         WHERE "definitionVersion" > 0
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements($3::jsonb) AS capability
             WHERE capability->>'jobType' = "system_jobs"."type"
               AND "system_jobs"."definitionVersion" IN (
                 SELECT jsonb_array_elements_text(capability->'definitionVersions')::integer
               )
           )
           AND "attempt" < "maxAttempts"
           AND "cancelRequestedAt" IS NULL
           AND (
             "status" = 'PENDING'
             OR (
               "status" = 'RETRY_WAIT'
               AND ("availableAt" IS NULL OR "availableAt" <= $1)
             )
           )
           AND ("availableAt" IS NULL OR "availableAt" <= $1)
           AND ("deadlineAt" IS NULL OR "deadlineAt" > $1)
           AND (
             (
               (
                 "triggerSource" = 'MANUAL'
                 OR ("triggerSource" = 'RETRY' AND "deadlineAt" IS NULL)
               )
               AND "effectivePriority" BETWEEN 0 AND 99
             )
             OR (
               "triggerSource" = 'SYSTEM'
               AND "deadlineAt" IS NULL
               AND "effectivePriority" BETWEEN 100 AND 999
             )
             OR (
               $2::boolean
               AND "triggerSource" NOT IN ('MANUAL', 'RETRY', 'LEGACY')
               AND "effectivePriority" BETWEEN 100 AND 999
             )
           )
         ORDER BY "effectivePriority" ASC, "availableAt" ASC NULLS FIRST, "createdAt" ASC, "id" ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        now,
        automaticWindowOpen,
        toJsonParameter(supportedCapabilities)
      )
      const candidate = candidates[0]
      if (!candidate) {
        return null
      }

      const executionToken = randomUUID()
      const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs)
      const claimedRows = await transaction.$queryRawUnsafe<QueueJobRecord[]>(
        `UPDATE "system_jobs"
         SET
           "status" = 'RUNNING',
           "workerId" = $2,
           "leaseToken" = $3::uuid,
           "leaseExpiresAt" = $4,
           "heartbeatAt" = $1,
           "attempt" = "attempt" + 1,
           "startedAt" = COALESCE("startedAt", $1),
           "lastAttemptStartedAt" = $1,
           "finishedAt" = NULL,
           "errorCode" = NULL,
           "error" = NULL,
           "skipReason" = NULL,
           "skippedAt" = NULL,
           "updatedAt" = $1
         WHERE "id" = $5
           AND "status" = $6::"JobStatus"
           AND "definitionVersion" > 0
         RETURNING
           "id", "type", "definitionVersion", "status", "triggerSource", "payload",
           "attempt", "maxAttempts", "effectivePriority", "availableAt", "deadlineAt",
           "workerId", "leaseToken"::text AS "leaseToken", "leaseExpiresAt", "heartbeatAt",
           "startedAt", "createdAt", "updatedAt"`,
        now,
        workerId,
        executionToken,
        leaseExpiresAt,
        candidate.id,
        candidate.status
      )
      const claimed = claimedRows[0]
      if (!claimed) {
        return null
      }

      await transaction.$executeRawUnsafe(
        `INSERT INTO "job_resource_leases" (
           "resourceKey", "ownerJobId", "workerId", "leaseToken",
           "expiresAt", "heartbeatAt", "createdAt", "updatedAt"
         ) VALUES ($1, $2, $3, $4::uuid, $5, $6, $6, $6)`,
        GLOBAL_BACKGROUND_WORKER_RESOURCE,
        claimed.id,
        workerId,
        executionToken,
        leaseExpiresAt,
        now
      )
      await this.insertEvent(transaction, {
        jobId: claimed.id,
        type: 'job.claimed',
        level: 'INFO',
        attempt: claimed.attempt,
        workerId,
        message: 'Job claimed by Central Dispatcher',
        data: { leaseExpiresAt: leaseExpiresAt.toISOString() },
        now
      })

      return {
        ...claimed,
        status: 'RUNNING',
        workerId,
        leaseToken: executionToken,
        leaseExpiresAt,
        executionToken
      }
    })
  }

  async heartbeat(fence: ExecutionFence): Promise<Date> {
    assertFence(fence)
    const now = this.clock.now()
    const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs)

    await this.runTransaction(async (transaction) => {
      const leaseRows = await transaction.$queryRawUnsafe<Array<{ resourceKey: string }>>(
        `UPDATE "job_resource_leases"
         SET "expiresAt" = $5, "heartbeatAt" = $6, "updatedAt" = $6
         WHERE "resourceKey" = $1
           AND "ownerJobId" = $2
           AND "workerId" = $3
           AND "leaseToken" = $4::uuid
           AND "expiresAt" > $6
         RETURNING "resourceKey"`,
        GLOBAL_BACKGROUND_WORKER_RESOURCE,
        fence.jobId,
        fence.workerId,
        fence.executionToken,
        leaseExpiresAt,
        now
      )
      if (leaseRows.length !== 1) {
        throw new JobExecutionFenceError(fence.jobId)
      }

      const jobRows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "system_jobs"
         SET "leaseExpiresAt" = $5, "heartbeatAt" = $6, "updatedAt" = $6
         WHERE "id" = $1
           AND "workerId" = $2
           AND "leaseToken" = $3::uuid
           AND "attempt" = $4
           AND "status" IN ('RUNNING', 'PAUSING', 'CANCELLING')
           AND "leaseExpiresAt" > $6
         RETURNING "id"`,
        fence.jobId,
        fence.workerId,
        fence.executionToken,
        fence.attempt,
        leaseExpiresAt,
        now
      )
      if (jobRows.length !== 1) {
        throw new JobExecutionFenceError(fence.jobId)
      }
    })

    return leaseExpiresAt
  }

  async updateProgress(input: ProgressExecutionInput): Promise<void> {
    assertFence(input)
    if (!Number.isInteger(input.progress) || input.progress < 0 || input.progress > 100) {
      throw new Error('Execution progress must be an integer from 0 through 100')
    }
    if (input.stage !== undefined && input.stage !== null && input.stage.length > 80) {
      throw new Error('Execution stage cannot exceed 80 characters')
    }

    const now = this.clock.now()
    await this.runTransaction(async (transaction) => {
      await this.lockOwnedExecution(transaction, input, now)
      const rows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "system_jobs"
         SET
           "progress" = $6,
           "stage" = CASE WHEN $7::boolean THEN $8 ELSE "stage" END,
           "message" = CASE WHEN $9::boolean THEN $10 ELSE "message" END,
           "updatedAt" = $5
         WHERE "id" = $1
           AND "workerId" = $2
           AND "leaseToken" = $3::uuid
           AND "attempt" = $4
           AND "status" IN ('RUNNING', 'PAUSING', 'CANCELLING')
           AND "leaseExpiresAt" > $5
         RETURNING "id"`,
        input.jobId,
        input.workerId,
        input.executionToken,
        input.attempt,
        now,
        input.progress,
        input.stage !== undefined,
        input.stage ?? null,
        input.message !== undefined,
        input.message ?? null
      )
      if (rows.length !== 1) {
        throw new JobExecutionFenceError(input.jobId)
      }

      await this.insertEvent(transaction, {
        jobId: input.jobId,
        type: input.stage !== undefined ? 'job.stage_changed' : 'job.progress',
        level: 'INFO',
        attempt: input.attempt,
        workerId: input.workerId,
        ...(input.stage === undefined ? {} : { stage: input.stage }),
        progress: input.progress,
        message: input.message ?? null,
        data: {
          progress: input.progress,
          ...(input.stage === undefined ? {} : { stage: input.stage }),
          ...(input.data === undefined ? {} : { data: input.data })
        },
        now
      })
    })
  }

  async enqueueChild(parentFence: ExecutionFence, input: EnqueueChildInput): Promise<EnqueuedChildJob> {
    assertFence(parentFence)
    const type = jobTypeSchema.parse(input.type)
    const definitionVersion = input.definitionVersion ?? JOB_DEFINITION_VERSION
    const queuePriority = input.queuePriority ?? 100
    const effectivePriority = input.effectivePriority ?? queuePriority
    const maxAttempts = input.maxAttempts ?? 3
    if (!Number.isInteger(definitionVersion) || definitionVersion <= 0) {
      throw new Error('Child definitionVersion must be a positive integer')
    }
    if (
      !Number.isInteger(queuePriority) ||
      !Number.isInteger(effectivePriority) ||
      queuePriority < 100 ||
      queuePriority > 999 ||
      effectivePriority < 100 ||
      effectivePriority > 999
    ) {
      throw new Error('SYSTEM child queuePriority and effectivePriority must be in the 100-999 band')
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error('Child maxAttempts must be a positive integer')
    }
    if (input.idempotencyKey && input.idempotencyKey.length > 180) {
      throw new Error('Child idempotencyKey cannot exceed 180 characters')
    }

    const now = this.clock.now()
    const availableAt = input.availableAt ?? now
    if (
      input.deadlineAt &&
      (input.deadlineAt.getTime() <= now.getTime() || input.deadlineAt.getTime() <= availableAt.getTime())
    ) {
      throw new Error('Child deadlineAt must be later than both now and availableAt')
    }
    const normalizedPayload =
      definitionVersion === JOB_DEFINITION_VERSION
        ? parseJobPayload(type, input.payload ?? {})
        : jsonValueSchema.parse(input.payload ?? {})
    const childId = randomUUID()
    return this.runTransaction(async (transaction) => {
      await this.lockOwnedExecution(transaction, parentFence, now)
      const insertedRows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "system_jobs" (
           "id", "type", "definitionVersion", "status", "triggerSource", "idempotencyKey",
           "payload", "parentJobId", "queuePriority", "effectivePriority", "availableAt",
           "deadlineAt", "maxAttempts", "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, 'PENDING', 'SYSTEM', $4,
           $5::jsonb, $6, $7, $8, $9,
           $10, $11, $12, $12
         )
         ON CONFLICT ("idempotencyKey") DO NOTHING
         RETURNING "id"`,
        childId,
        type,
        definitionVersion,
        input.idempotencyKey ?? null,
        toJsonParameter(normalizedPayload),
        parentFence.jobId,
        queuePriority,
        effectivePriority,
        availableAt,
        input.deadlineAt ?? null,
        maxAttempts,
        now
      )
      const inserted = insertedRows[0]
      if (inserted) {
        await this.insertEvent(transaction, {
          jobId: inserted.id,
          type: 'job.queued',
          level: 'INFO',
          attempt: 0,
          workerId: parentFence.workerId,
          message: `Child job queued by ${parentFence.jobId}`,
          data: { parentJobId: parentFence.jobId },
          now
        })
        return { id: inserted.id, created: true }
      }

      if (!input.idempotencyKey) {
        throw new Error('Child insert did not return a row without an idempotency key')
      }
      const existingRows = await transaction.$queryRawUnsafe<
        Array<{
          id: string
          type: string
          definitionVersion: number
          parentJobId: string | null
          payloadMatches: boolean
          deadlineMatches: boolean
          availableMatches: boolean
          queuePriority: number
          effectivePriority: number
          maxAttempts: number
        }>
      >(
        `SELECT
           "id", "type", "definitionVersion", "parentJobId",
           "payload" IS NOT DISTINCT FROM $2::jsonb AS "payloadMatches",
           "deadlineAt" IS NOT DISTINCT FROM $3 AS "deadlineMatches",
           (NOT $4::boolean OR "availableAt" IS NOT DISTINCT FROM $5) AS "availableMatches",
           "queuePriority", "effectivePriority", "maxAttempts"
         FROM "system_jobs"
         WHERE "idempotencyKey" = $1
         LIMIT 1`,
        input.idempotencyKey,
        toJsonParameter(normalizedPayload),
        input.deadlineAt ?? null,
        input.availableAt !== undefined,
        input.availableAt ?? null
      )
      const existing = existingRows[0]
      if (!existing) {
        throw new Error('Unable to resolve idempotent child job')
      }
      if (
        existing.type !== type ||
        existing.definitionVersion !== definitionVersion ||
        existing.parentJobId !== parentFence.jobId ||
        !existing.payloadMatches ||
        !existing.deadlineMatches ||
        !existing.availableMatches ||
        existing.queuePriority !== queuePriority ||
        existing.effectivePriority !== effectivePriority ||
        existing.maxAttempts !== maxAttempts
      ) {
        throw new Error(
          `Child idempotency key ${input.idempotencyKey} conflicts with different job definition, payload, schedule, attempts, or parent semantics`
        )
      }
      return { id: existing.id, created: false }
    })
  }

  async readExecutionControl(fence: ExecutionFence): Promise<ExecutionControlState> {
    assertFence(fence)
    const now = this.clock.now()
    return this.runTransaction(async (transaction) => {
      await this.lockOwnedExecution(transaction, fence, now)
      const rows = await transaction.$queryRawUnsafe<ExecutionControlState[]>(
        `SELECT "status", "cancelRequestedAt", "pauseRequestedAt"
         FROM "system_jobs"
         WHERE "id" = $1
           AND "workerId" = $2
           AND "leaseToken" = $3::uuid
           AND "attempt" = $4
         LIMIT 1`,
        fence.jobId,
        fence.workerId,
        fence.executionToken,
        fence.attempt
      )
      const row = rows[0]
      if (!row) {
        throw new JobExecutionFenceError(fence.jobId)
      }
      return row
    })
  }

  async complete(input: CompleteExecutionInput): Promise<void> {
    await this.transitionOwnedJob(input, {
      status: 'COMPLETED',
      eventType: 'job.completed',
      eventLevel: 'INFO',
      message: input.message ?? 'Job completed',
      assignments: `"progress" = 100,
                    "result" = $6::jsonb,
                    "errorCode" = NULL,
                    "error" = NULL`,
      values: [toJsonParameter(input.result)],
      extraPredicate: `AND "status" = 'RUNNING'`
    })
  }

  async fail(input: FailExecutionInput): Promise<void> {
    await this.transitionOwnedJob(input, {
      status: 'FAILED',
      eventType: 'job.failed',
      eventLevel: 'ERROR',
      message: input.message ?? 'Job failed',
      assignments: `"errorCode" = $6,
                    "error" = $7`,
      values: [truncate(input.errorCode, 80), sanitizeError(input.error)],
      extraPredicate: `AND "status" = 'RUNNING'`
    })
  }

  async retry(input: RetryExecutionInput): Promise<void> {
    const now = this.clock.now()
    if (input.availableAt.getTime() < now.getTime()) {
      throw new Error('Retry availableAt cannot be earlier than the current queue clock')
    }

    await this.transitionOwnedJob(input, {
      status: 'RETRY_WAIT',
      eventType: 'job.retry_scheduled',
      eventLevel: 'WARN',
      message: input.message ?? 'Job retry scheduled',
      assignments: `"availableAt" = $6,
                    "errorCode" = $7,
                    "error" = $8`,
      values: [input.availableAt, truncate(input.errorCode, 80), sanitizeError(input.error)],
      extraPredicate: `AND "status" = 'RUNNING' AND "attempt" < "maxAttempts"`,
      eventData: { availableAt: input.availableAt.toISOString() }
    })
  }

  async skip(input: SkipExecutionInput): Promise<void> {
    await this.transitionOwnedJob(input, {
      status: 'SKIPPED',
      eventType: 'job.skipped',
      eventLevel: 'WARN',
      message: input.message ?? `Job skipped: ${input.reason}`,
      assignments: `"skipReason" = $6::"JobSkipReason",
                    "skippedAt" = $5`,
      values: [input.reason],
      extraPredicate: `AND "status" = 'RUNNING'`,
      eventData: { reason: input.reason }
    })
  }

  async cancel(input: CancelExecutionInput): Promise<void> {
    await this.transitionOwnedJob(input, {
      status: 'CANCELLED',
      eventType: 'job.cancelled',
      eventLevel: 'WARN',
      message: input.message ?? 'Job cancelled',
      assignments: `"cancelRequestedAt" = COALESCE("cancelRequestedAt", $5)`,
      values: []
    })
  }

  async pause(input: CancelExecutionInput): Promise<void> {
    await this.transitionOwnedJob(input, {
      status: 'PAUSED',
      eventType: 'job.paused',
      eventLevel: 'INFO',
      message: input.message ?? 'Job paused',
      assignments: `"pauseRequestedAt" = COALESCE("pauseRequestedAt", $5)`,
      values: [],
      extraPredicate: `AND "status" = 'PAUSING'`
    })
  }

  async release(input: CancelExecutionInput): Promise<void> {
    await this.transitionOwnedJob(input, {
      status: 'PENDING',
      eventType: 'job.retry_scheduled',
      eventLevel: 'INFO',
      message: input.message ?? 'Worker shutdown released job without a business failure',
      assignments: `"availableAt" = $5,
                    "maxAttempts" = GREATEST("maxAttempts", "attempt" + 1),
                    "errorCode" = NULL,
                    "error" = NULL`,
      values: [],
      extraPredicate: `AND "status" = 'RUNNING'`,
      eventData: { reason: 'WORKER_SHUTDOWN_RELEASE' }
    })
  }

  async requestCancellation(jobId: string): Promise<RequestCancellationResult | null> {
    if (!jobId) {
      throw new Error('jobId is required')
    }
    const now = this.clock.now()

    return this.runTransaction(async (transaction) => {
      await transaction.$queryRawUnsafe(
        `SELECT "resourceKey"
         FROM "job_resource_leases"
         WHERE "resourceKey" = $1
           AND "ownerJobId" = $2
         LIMIT 1
         FOR UPDATE`,
        GLOBAL_BACKGROUND_WORKER_RESOURCE,
        jobId
      )
      const rows = await transaction.$queryRawUnsafe<
        Array<{ id: string; status: 'CANCELLING' | 'CANCELLED'; attempt: number; workerId: string | null }>
      >(
        `UPDATE "system_jobs"
         SET
           "status" = CASE
             WHEN "status" IN ('PENDING', 'RETRY_WAIT', 'PAUSED') THEN 'CANCELLED'::"JobStatus"
             ELSE 'CANCELLING'::"JobStatus"
           END,
           "cancelRequestedAt" = COALESCE("cancelRequestedAt", $2),
           "finishedAt" = CASE
             WHEN "status" IN ('PENDING', 'RETRY_WAIT', 'PAUSED') THEN $2
             ELSE "finishedAt"
           END,
           "workerId" = CASE
             WHEN "status" IN ('PENDING', 'RETRY_WAIT', 'PAUSED') THEN NULL
             ELSE "workerId"
           END,
           "leaseToken" = CASE
             WHEN "status" IN ('PENDING', 'RETRY_WAIT', 'PAUSED') THEN NULL
             ELSE "leaseToken"
           END,
           "leaseExpiresAt" = CASE
             WHEN "status" IN ('PENDING', 'RETRY_WAIT', 'PAUSED') THEN NULL
             ELSE "leaseExpiresAt"
           END,
           "updatedAt" = $2
         WHERE "id" = $1
           AND "status" IN ('PENDING', 'RETRY_WAIT', 'PAUSED', 'RUNNING', 'PAUSING')
         RETURNING "id", "status", "attempt", "workerId"`,
        jobId,
        now
      )
      const row = rows[0]
      if (!row) {
        return null
      }

      if (row.status === 'CANCELLED') {
        await transaction.$executeRawUnsafe(
          `DELETE FROM "job_resource_leases"
           WHERE "resourceKey" = $1
             AND "ownerJobId" = $2`,
          GLOBAL_BACKGROUND_WORKER_RESOURCE,
          jobId
        )
      }

      await this.insertEvent(transaction, {
        jobId,
        type: row.status === 'CANCELLED' ? 'job.cancelled' : 'job.cancel_requested',
        level: 'WARN',
        attempt: row.attempt,
        workerId: row.workerId,
        message: row.status === 'CANCELLED' ? 'Queued job cancelled' : 'Job cancellation requested',
        data: null,
        now
      })
      return { jobId, status: row.status }
    })
  }

  async withFencedExecutionTransaction<TTransaction extends QueueSqlExecutor = QueueSqlExecutor, TResult = void>(
    fence: ExecutionFence,
    operation: (scope: FencedExecutionTransaction<TTransaction>) => Promise<TResult>
  ): Promise<TResult> {
    assertFence(fence)
    const now = this.clock.now()

    return this.runTransaction(async (transaction) => {
      await this.lockOwnedExecution(transaction, fence, now)
      let finalized = false

      const finalize = async (transition: OwnedJobTransition): Promise<void> => {
        if (finalized) {
          throw new Error(`Execution ${fence.jobId} was already finalized in this transaction`)
        }
        await this.transitionOwnedJobInTransaction(transaction, fence, now, transition)
        finalized = true
      }

      const result = await operation({
        transaction: transaction as TTransaction,
        complete: (input = {}) =>
          finalize({
            status: 'COMPLETED',
            eventType: 'job.completed',
            eventLevel: 'INFO',
            message: input.message ?? 'Job completed',
            assignments: `"progress" = 100,
                          "result" = $6::jsonb,
                          "errorCode" = NULL,
                          "error" = NULL`,
            values: [toJsonParameter(input.result)],
            extraPredicate: `AND "status" = 'RUNNING'`
          }),
        fail: (input) =>
          finalize({
            status: 'FAILED',
            eventType: 'job.failed',
            eventLevel: 'ERROR',
            message: input.message ?? 'Job failed',
            assignments: `"errorCode" = $6,
                          "error" = $7`,
            values: [truncate(input.errorCode, 80), sanitizeError(input.error)],
            extraPredicate: `AND "status" = 'RUNNING'`
          }),
        retry: (input) => {
          if (input.availableAt.getTime() < now.getTime()) {
            throw new Error('Retry availableAt cannot be earlier than the current queue clock')
          }
          return finalize({
            status: 'RETRY_WAIT',
            eventType: 'job.retry_scheduled',
            eventLevel: 'WARN',
            message: input.message ?? 'Job retry scheduled',
            assignments: `"availableAt" = $6,
                          "errorCode" = $7,
                          "error" = $8`,
            values: [input.availableAt, truncate(input.errorCode, 80), sanitizeError(input.error)],
            extraPredicate: `AND "status" = 'RUNNING' AND "attempt" < "maxAttempts"`,
            eventData: { availableAt: input.availableAt.toISOString() }
          })
        },
        skip: (input) =>
          finalize({
            status: 'SKIPPED',
            eventType: 'job.skipped',
            eventLevel: 'WARN',
            message: input.message ?? `Job skipped: ${input.reason}`,
            assignments: `"skipReason" = $6::"JobSkipReason",
                          "skippedAt" = $5`,
            values: [input.reason],
            extraPredicate: `AND "status" = 'RUNNING'`,
            eventData: { reason: input.reason }
          }),
        cancel: (message) =>
          finalize({
            status: 'CANCELLED',
            eventType: 'job.cancelled',
            eventLevel: 'WARN',
            message: message ?? 'Job cancelled',
            assignments: `"cancelRequestedAt" = COALESCE("cancelRequestedAt", $5)`,
            values: []
          })
      })

      if (!finalized) {
        throw new Error(`Fenced transaction for job ${fence.jobId} must call exactly one terminal finalizer`)
      }
      return result
    })
  }

  async recoverExpiredExecution(): Promise<RecoveredExecution | null> {
    const now = this.clock.now()
    return this.runTransaction(async (transaction) => {
      await this.acquireDispatcherTransactionLock(transaction)
      return this.recoverExpiredExecutionInTransaction(transaction, now)
    })
  }

  async skipExpiredScheduledJobs(): Promise<string[]> {
    const now = this.clock.now()
    return this.runTransaction(async (transaction) => {
      await this.acquireDispatcherTransactionLock(transaction)
      return this.skipExpiredScheduledJobsInTransaction(transaction, now)
    })
  }

  private async transitionOwnedJob(input: ExecutionFence, transition: OwnedJobTransition): Promise<void> {
    assertFence(input)
    const now = this.clock.now()

    await this.runTransaction(async (transaction) => {
      await this.lockOwnedExecution(transaction, input, now)
      await this.transitionOwnedJobInTransaction(transaction, input, now, transition)
    })
  }

  private async transitionOwnedJobInTransaction(
    transaction: QueueSqlExecutor,
    input: ExecutionFence,
    now: Date,
    transition: OwnedJobTransition
  ): Promise<void> {
    const offsetValues = transition.values
    const updatedRows = await transaction.$queryRawUnsafe<Array<{ id: string; attempt: number }>>(
      `UPDATE "system_jobs"
       SET
         "status" = '${transition.status}',
         "finishedAt" = CASE
           WHEN '${transition.status}' IN ('COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED') THEN $5
           ELSE NULL
         END,
         "workerId" = NULL,
         "leaseToken" = NULL,
         "leaseExpiresAt" = NULL,
         "heartbeatAt" = $5,
         "updatedAt" = $5,
         ${transition.assignments}
       WHERE "id" = $1
         AND "workerId" = $2
         AND "leaseToken" = $3::uuid
         AND "attempt" = $4
         AND "status" IN ('RUNNING', 'PAUSING', 'CANCELLING')
         AND "leaseExpiresAt" > $5
         ${transition.extraPredicate ?? ''}
       RETURNING "id", "attempt"`,
      input.jobId,
      input.workerId,
      input.executionToken,
      input.attempt,
      now,
      ...offsetValues
    )
    if (updatedRows.length !== 1) {
      throw new JobExecutionFenceError(input.jobId)
    }

    const deleted = await transaction.$executeRawUnsafe(
      `DELETE FROM "job_resource_leases"
       WHERE "resourceKey" = $1
         AND "ownerJobId" = $2
         AND "workerId" = $3
         AND "leaseToken" = $4::uuid`,
      GLOBAL_BACKGROUND_WORKER_RESOURCE,
      input.jobId,
      input.workerId,
      input.executionToken
    )
    if (deleted !== 1) {
      throw new JobExecutionFenceError(input.jobId)
    }

    await this.insertEvent(transaction, {
      jobId: input.jobId,
      type: transition.eventType,
      level: transition.eventLevel,
      attempt: input.attempt,
      workerId: input.workerId,
      message: transition.message,
      data: transition.eventData ?? null,
      now
    })
  }

  private async lockOwnedExecution(transaction: QueueSqlExecutor, input: ExecutionFence, now: Date): Promise<void> {
    const leaseRows = await transaction.$queryRawUnsafe<Array<{ resourceKey: string }>>(
      `SELECT "resourceKey"
       FROM "job_resource_leases"
       WHERE "resourceKey" = $1
         AND "ownerJobId" = $2
         AND "workerId" = $3
         AND "leaseToken" = $4::uuid
         AND "expiresAt" > $5
       LIMIT 1
       FOR UPDATE`,
      GLOBAL_BACKGROUND_WORKER_RESOURCE,
      input.jobId,
      input.workerId,
      input.executionToken,
      now
    )
    if (leaseRows.length !== 1) {
      throw new JobExecutionFenceError(input.jobId)
    }

    const jobRows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id"
       FROM "system_jobs"
       WHERE "id" = $1
         AND "workerId" = $2
         AND "leaseToken" = $3::uuid
         AND "attempt" = $4
         AND "status" IN ('RUNNING', 'PAUSING', 'CANCELLING')
         AND "leaseExpiresAt" > $5
       LIMIT 1
       FOR UPDATE`,
      input.jobId,
      input.workerId,
      input.executionToken,
      input.attempt,
      now
    )
    if (jobRows.length !== 1) {
      throw new JobExecutionFenceError(input.jobId)
    }
  }

  private async recoverExpiredExecutionInTransaction(
    transaction: QueueSqlExecutor,
    now: Date
  ): Promise<RecoveredExecution | null> {
    const leases = await transaction.$queryRawUnsafe<JobResourceLeaseRow[]>(
      `SELECT
         "ownerJobId",
         "workerId",
         "leaseToken"::text AS "leaseToken",
         "expiresAt"
       FROM "job_resource_leases"
       WHERE "resourceKey" = $1
       LIMIT 1
       FOR UPDATE`,
      GLOBAL_BACKGROUND_WORKER_RESOURCE
    )
    const lease = leases[0]

    const executingJobs = await transaction.$queryRawUnsafe<ExecutingJobRow[]>(
      `SELECT
         "id", "status", "workerId", "leaseToken"::text AS "leaseToken",
         "leaseExpiresAt", "attempt", "maxAttempts"
       FROM "system_jobs"
       WHERE "definitionVersion" > 0
         AND "status" IN ('RUNNING', 'PAUSING', 'CANCELLING')
       ORDER BY "startedAt" ASC NULLS FIRST, "createdAt" ASC
       LIMIT 1
       FOR UPDATE`
    )
    const executingJob = executingJobs[0]

    if (!executingJob) {
      if (lease && lease.expiresAt.getTime() <= now.getTime()) {
        const ownerRows = await transaction.$queryRawUnsafe<Array<{ id: string; attempt: number }>>(
          `SELECT "id", "attempt"
           FROM "system_jobs"
           WHERE "id" = $1
           LIMIT 1`,
          lease.ownerJobId
        )
        await transaction.$executeRawUnsafe(
          `DELETE FROM "job_resource_leases"
           WHERE "resourceKey" = $1
             AND "leaseToken" = $2::uuid`,
          GLOBAL_BACKGROUND_WORKER_RESOURCE,
          lease.leaseToken
        )
        const owner = ownerRows[0]
        if (owner) {
          await this.insertEvent(transaction, {
            jobId: owner.id,
            type: 'worker.lease_recovered',
            level: 'WARN',
            attempt: owner.attempt,
            workerId: lease.workerId,
            message: 'Removed an expired orphan global worker lease',
            data: { cleanupOnly: true },
            now
          })
        }
      }
      return null
    }

    const jobLeaseExpired =
      executingJob.leaseExpiresAt === null || executingJob.leaseExpiresAt.getTime() <= now.getTime()
    const resourceLeaseMatches =
      lease?.ownerJobId === executingJob.id &&
      lease.workerId === executingJob.workerId &&
      lease.leaseToken === executingJob.leaseToken
    const resourceLeaseExpired = !lease || lease.expiresAt.getTime() <= now.getTime()

    if (!jobLeaseExpired || (resourceLeaseMatches && !resourceLeaseExpired)) {
      return null
    }
    if (lease && !resourceLeaseExpired && !resourceLeaseMatches) {
      return null
    }

    const recoveredStatus =
      executingJob.status === 'CANCELLING'
        ? ('CANCELLED' as const)
        : executingJob.status === 'PAUSING'
          ? ('PAUSED' as const)
          : executingJob.attempt < executingJob.maxAttempts
            ? ('RETRY_WAIT' as const)
            : ('FAILED' as const)
    const updatedRows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `UPDATE "system_jobs"
       SET
         "status" = $6::"JobStatus",
         "availableAt" = CASE WHEN $6 = 'RETRY_WAIT' THEN $5 ELSE "availableAt" END,
         "finishedAt" = CASE WHEN $6 IN ('FAILED', 'CANCELLED') THEN $5 ELSE NULL END,
         "workerId" = NULL,
         "leaseToken" = NULL,
         "leaseExpiresAt" = NULL,
         "heartbeatAt" = $5,
         "errorCode" = CASE
           WHEN $6 IN ('RETRY_WAIT', 'FAILED') THEN 'WORKER_LEASE_EXPIRED'
           ELSE NULL
         END,
         "error" = CASE
           WHEN $6 IN ('RETRY_WAIT', 'FAILED')
             THEN 'The previous worker execution lease expired before completion.'
           ELSE NULL
         END,
         "updatedAt" = $5
       WHERE "id" = $1
         AND "workerId" IS NOT DISTINCT FROM $2
         AND "leaseToken" IS NOT DISTINCT FROM $3::uuid
         AND "attempt" = $4
         AND "status" = $7::"JobStatus"
         AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= $5)
       RETURNING "id"`,
      executingJob.id,
      executingJob.workerId,
      executingJob.leaseToken,
      executingJob.attempt,
      now,
      recoveredStatus,
      executingJob.status
    )
    if (updatedRows.length !== 1) {
      return null
    }

    if (lease) {
      await transaction.$executeRawUnsafe(
        `DELETE FROM "job_resource_leases"
         WHERE "resourceKey" = $1
           AND "leaseToken" = $2::uuid`,
        GLOBAL_BACKGROUND_WORKER_RESOURCE,
        lease.leaseToken
      )
    }
    await this.insertEvent(transaction, {
      jobId: executingJob.id,
      type: 'worker.lease_recovered',
      level: 'WARN',
      attempt: executingJob.attempt,
      workerId: executingJob.workerId,
      message: `Expired worker lease recovered to ${recoveredStatus}`,
      data: { recoveredStatus },
      now
    })
    const lifecycleEvent =
      recoveredStatus === 'CANCELLED'
        ? { type: 'job.cancelled', level: 'WARN' as const, message: 'Cancellation confirmed after worker lease expiry' }
        : recoveredStatus === 'PAUSED'
          ? { type: 'job.paused', level: 'INFO' as const, message: 'Pause confirmed after worker lease expiry' }
          : recoveredStatus === 'RETRY_WAIT'
            ? {
                type: 'job.retry_scheduled',
                level: 'WARN' as const,
                message: 'Retry scheduled after worker lease expiry'
              }
            : { type: 'job.failed', level: 'ERROR' as const, message: 'Job failed after final worker lease expired' }
    await this.insertEvent(transaction, {
      jobId: executingJob.id,
      type: lifecycleEvent.type,
      level: lifecycleEvent.level,
      attempt: executingJob.attempt,
      workerId: executingJob.workerId,
      message: lifecycleEvent.message,
      data: { reason: 'WORKER_LEASE_EXPIRED' },
      now
    })

    return {
      jobId: executingJob.id,
      previousWorkerId: executingJob.workerId,
      attempt: executingJob.attempt,
      status: recoveredStatus
    }
  }

  private async skipExpiredScheduledJobsInTransaction(transaction: QueueSqlExecutor, now: Date): Promise<string[]> {
    const localTime = this.windowPolicy.localTime(now)
    const hasTodaysWindowEnded = localTime.hour >= this.windowPolicy.endHour
    const skippedRows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `WITH skipped AS (
         UPDATE "system_jobs"
         SET
           "status" = 'SKIPPED',
           "skipReason" = 'WINDOW_EXPIRED',
           "skippedAt" = $1,
           "finishedAt" = $1,
           "message" = 'Scheduled execution window expired before claim',
           "workerId" = NULL,
           "leaseToken" = NULL,
           "leaseExpiresAt" = NULL,
           "updatedAt" = $1
         WHERE "definitionVersion" > 0
           AND "status" IN ('PENDING', 'RETRY_WAIT')
           AND "triggerSource" <> 'MANUAL'
           AND "effectivePriority" BETWEEN 100 AND 999
           AND (
             ("deadlineAt" IS NOT NULL AND "deadlineAt" <= $1)
             OR (
               "triggerSource" = 'SCHEDULE'
               AND "scheduledForDate" IS NOT NULL
               AND (
                 "scheduledForDate" < $2
                 OR ("scheduledForDate" = $2 AND $3::boolean)
               )
             )
           )
         RETURNING "id", "attempt"
       ), inserted_events AS (
         INSERT INTO "system_job_events" (
           "jobId", "type", "level", "attempt", "message", "data", "createdAt"
         )
         SELECT
           "id", 'job.skipped', 'WARN', "attempt",
           'Scheduled execution window expired before claim',
           '{"reason":"WINDOW_EXPIRED"}'::jsonb,
           $1
         FROM skipped
         RETURNING "jobId"
       )
       SELECT "jobId" AS "id" FROM inserted_events ORDER BY "jobId"`,
      now,
      localTime.date,
      hasTodaysWindowEnded
    )

    return skippedRows.map(({ id }) => id)
  }

  private async ageEligibleCandidatesInTransaction(
    transaction: QueueSqlExecutor,
    now: Date,
    automaticWindowOpen: boolean,
    supportedCapabilities: readonly WorkerCapability[]
  ): Promise<void> {
    await transaction.$executeRawUnsafe(
      `WITH eligible AS (
         SELECT
           "id",
           GREATEST(
             CASE
               WHEN "triggerSource" IN ('MANUAL', 'RETRY') THEN 0
               ELSE 100
             END,
             "queuePriority" - FLOOR(
               GREATEST(0, EXTRACT(EPOCH FROM ($1 - "createdAt"))) / 1800
             )::integer
           ) AS "agedPriority",
           "availableAt",
           "createdAt"
         FROM "system_jobs"
         WHERE "definitionVersion" > 0
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements($3::jsonb) AS capability
             WHERE capability->>'jobType' = "system_jobs"."type"
               AND "system_jobs"."definitionVersion" IN (
                 SELECT jsonb_array_elements_text(capability->'definitionVersions')::integer
               )
           )
           AND (
             "status" = 'PENDING'
             OR (
               "status" = 'RETRY_WAIT'
               AND ("availableAt" IS NULL OR "availableAt" <= $1)
             )
           )
           AND ("availableAt" IS NULL OR "availableAt" <= $1)
           AND ("deadlineAt" IS NULL OR "deadlineAt" > $1)
           AND (
             (
               (
                 "triggerSource" = 'MANUAL'
                 OR ("triggerSource" = 'RETRY' AND "deadlineAt" IS NULL)
               )
               AND "queuePriority" BETWEEN 0 AND 99
             )
             OR (
               "triggerSource" = 'SYSTEM'
               AND "deadlineAt" IS NULL
               AND "queuePriority" BETWEEN 100 AND 999
             )
             OR (
               $2::boolean
               AND "triggerSource" NOT IN ('MANUAL', 'RETRY', 'LEGACY')
               AND "queuePriority" BETWEEN 100 AND 999
             )
           )
         ORDER BY "agedPriority" ASC, "availableAt" ASC NULLS FIRST, "createdAt" ASC, "id" ASC
         LIMIT 200
         FOR UPDATE SKIP LOCKED
       )
       UPDATE "system_jobs" AS job
       SET
         "effectivePriority" = eligible."agedPriority",
         "updatedAt" = $1
       FROM eligible
       WHERE job."id" = eligible."id"
         AND job."effectivePriority" IS DISTINCT FROM eligible."agedPriority"`,
      now,
      automaticWindowOpen,
      toJsonParameter(supportedCapabilities)
    )
  }

  private async acquireDispatcherTransactionLock(transaction: QueueSqlExecutor): Promise<void> {
    await transaction.$queryRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS "locked"`,
      GLOBAL_BACKGROUND_WORKER_RESOURCE
    )
  }

  private async insertEvent(
    transaction: QueueSqlExecutor,
    event: {
      jobId: string
      type: string
      level: 'INFO' | 'WARN' | 'ERROR'
      attempt: number
      workerId?: string | null
      stage?: string | null
      progress?: number | null
      message?: string | null
      data?: unknown
      now: Date
    }
  ): Promise<void> {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "system_job_events" (
         "jobId", "type", "level", "attempt", "workerId", "stage", "progress",
         "message", "data", "createdAt"
       ) VALUES ($1, $2, $3::"JobEventLevel", $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      event.jobId,
      event.type,
      event.level,
      event.attempt,
      event.workerId ?? null,
      event.stage ?? null,
      event.progress ?? null,
      event.message === undefined || event.message === null
        ? null
        : truncate(redactSensitiveText(event.message), 4_096),
      toJsonParameter(sanitizeEventData(event.data)),
      event.now
    )
  }

  private runTransaction<T>(operation: (transaction: QueueSqlExecutor) => Promise<T>): Promise<T> {
    return this.database.$transaction(operation, {
      isolationLevel: 'ReadCommitted',
      maxWait: this.transactionMaxWaitMs,
      timeout: this.transactionTimeoutMs
    })
  }
}

function assertWorkerId(workerId: string): void {
  if (workerId.length === 0 || workerId.length > 120) {
    throw new Error('workerId must contain 1-120 characters')
  }
}

function assertFence(fence: ExecutionFence): void {
  assertWorkerId(fence.workerId)
  if (!fence.jobId || !Number.isSafeInteger(fence.attempt) || fence.attempt <= 0) {
    throw new Error('Execution fence requires a job id and positive integer attempt')
  }
  if (!UUID_PATTERN.test(fence.executionToken)) {
    throw new Error('Execution fence token must be a UUID')
  }
}

function toJsonParameter(value: unknown): string | null {
  if (value === undefined) {
    return null
  }
  return JSON.stringify(value)
}

function sanitizeError(value: string): string {
  return truncate(redactSensitiveText(value), 8_192)
}

function sanitizeEventData(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return truncate(redactSensitiveText(value), 4_096)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString(10)
  if (Array.isArray(value)) return value.map(sanitizeEventData)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SENSITIVE_EVENT_KEY.test(key) ? '[REDACTED]' : sanitizeEventData(nested)
      ])
    )
  }
  return redactSensitiveText(String(value))
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}
