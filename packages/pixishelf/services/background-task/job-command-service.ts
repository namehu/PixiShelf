import {
  hasBlockingMediaContentCancellation,
  hasBlockingMediaContentRecoveryResume,
  MEDIA_CONTENT_CANCELLATION_MESSAGE
} from '@pixishelf/job-runtime'
import { ARTWORK_SUMMARY_RETIRED_MESSAGE } from '@/lib/reading/artwork-stacks'
import { prisma } from '@/lib/prisma'
import { FULL_SCAN_RETIRED_MESSAGE, isRetiredFullReconcilePayload } from '@/services/scan-source-policy'
import { Prisma, lockCreatorCatalog } from '@pixishelf/db'
import { ArchiveError } from '@/services/archive/errors'
import { assertArchiveIntakeSourceProof } from '@/services/archive-intake/archive-intake-source-proof'
import {
  executionLaneForJobType,
  JOB_DEFINITION_VERSION,
  jobTypeSchema,
  jsonValueSchema,
  parseJobPayload,
  SCAN_AUDIT_APPLY_DEFINITION_VERSION,
  scanAuditApplyPayloadSchema,
  type JobDto,
  type JobStatus,
  type ScanAuditApplyPayload
} from '@pixishelf/job-contracts'
import { controlDiscoveryBatch } from '@pixishelf/job-executors'
import { z } from 'zod'
import { BackgroundTaskError } from './background-task-error'
import { writeJobEvent } from './job-event-service'
import { acknowledgeJobFailure, unacknowledgedFailureWhere } from './job-failure-policy'
import { jobPayloadsHaveSameSemantics } from './job-payload-semantics'
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
  definitionVersion: z.union([z.literal(1), z.literal(2)]).default(JOB_DEFINITION_VERSION),
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
export const acknowledgeJobFailureInputSchema = jobIdInputSchema.extend({
  requestedByUserId: z.string().min(1)
})
export const acknowledgeJobFailuresRequestSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('selected'),
      jobIds: z
        .array(z.string().min(1).max(128))
        .min(1)
        .max(100)
        .transform((ids) => [...new Set(ids)])
    })
    .strict(),
  z.object({ scope: z.literal('all') }).strict()
])
export type AcknowledgeJobFailuresRequest = z.input<typeof acknowledgeJobFailuresRequestSchema>
export const changeJobPriorityInputSchema = jobIdInputSchema.extend({ priority: z.number().int().min(0).max(999) })

interface CommandDatabaseClient {
  $transaction<T>(
    callback: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: { timeout?: number }
  ): Promise<T>
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

function isFrozenScanSnapshotPayload(type: string, payload: unknown) {
  // Generic retry creates a new job, but these inputs live under the original job's ScanRun.
  // Their producers must freeze and enqueue a fresh snapshot as one transaction instead.
  if (type !== 'SCAN' || typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false
  if (!('mode' in payload)) return false
  return payload.mode === 'CLIENT_LIST' || payload.mode === 'ARTWORK_RESCAN'
}

function assertIdempotencySemantics(existing: SystemJobWireRecord, input: ParsedEnqueueInput, payload: unknown) {
  const expectedRequestedByUserId = input.triggerSource === 'MANUAL' ? input.requestedByUserId : null
  const expectedScheduledTaskId = input.triggerSource === 'SCHEDULE' ? input.scheduledTaskId : null
  const expectedScheduledForDate = input.triggerSource === 'SCHEDULE' ? input.scheduledForDate : null
  const semanticMatch =
    existing.type === input.type &&
    existing.executionLane === executionLaneForJobType(input.type) &&
    existing.definitionVersion === input.definitionVersion &&
    existing.triggerSource === input.triggerSource &&
    existing.requestedByUserId === expectedRequestedByUserId &&
    existing.parentJobId === (input.parentJobId ?? null) &&
    existing.scheduledTaskId === expectedScheduledTaskId &&
    existing.scheduledForDate === expectedScheduledForDate &&
    existing.queuePriority === input.priority &&
    existing.maxAttempts === input.maxAttempts &&
    jobPayloadsHaveSameSemantics(input.type, input.definitionVersion, existing.payload, payload) &&
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
  if (
    parsed.triggerSource === 'MANUAL' &&
    parsed.definitionVersion !== JOB_DEFINITION_VERSION &&
    !(parsed.type === 'ARCHIVE_MAINTENANCE' && parsed.definitionVersion === 2)
  ) {
    throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '该任务版本必须通过领域入口创建')
  }
  if (
    parsed.type === 'ARCHIVE_MAINTENANCE' &&
    (parsed.payload as { action?: string } | undefined)?.action === 'RETIRE_PARTIAL_REVISION'
  ) {
    throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '部分归档清理只能由补全发布创建')
  }
  if (['ARTWORK_BATCH_DELETE', 'ARTWORK_DEDUP_SCAN', 'ARTWORK_DEDUP_MAINTENANCE'].includes(parsed.type)) {
    throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '重复作品检查必须通过领域入口创建和控制')
  }
  if (parsed.type === 'ARTWORK_SUMMARY_GENERATE') {
    throw new BackgroundTaskError('INVALID_STATE_TRANSITION', ARTWORK_SUMMARY_RETIRED_MESSAGE)
  }
  if (
    ['ARCHIVE_IMPORT', 'ARCHIVE_DOWNLOAD', 'ARCHIVE_PUBLISH'].includes(parsed.type) ||
    parsed.type === 'ARCHIVE_DISCOVERY_BATCH_SCAN' ||
    parsed.type === 'ARCHIVE_RESOLVE_ITEM' ||
    parsed.type === 'ARCHIVE_UPLOADER_SCAN' ||
    parsed.type === 'ARCHIVE_SEARCH_SCAN'
  ) {
    throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '归档解析和上传者扫描任务必须通过对应的归档流程创建')
  }
  if (isRetiredFullReconcilePayload(parsed.type, parsed.payload)) {
    throw new BackgroundTaskError('INVALID_STATE_TRANSITION', FULL_SCAN_RETIRED_MESSAGE)
  }
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
      const executionLane = executionLaneForJobType(parsed.type)
      const record = await transaction.systemJob.create({
        data: {
          type: parsed.type,
          executionLane,
          definitionVersion: parsed.definitionVersion,
          status: 'PENDING',
          triggerSource: parsed.triggerSource,
          payload: payload as Prisma.InputJsonValue,
          queuePriority: parsed.priority,
          effectivePriority: parsed.priority,
          availableAt: parsed.availableAt ?? timestamp,
          deadlineAt: parsed.deadlineAt,
          maxAttempts: parsed.maxAttempts,
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
    if (['ARTWORK_BATCH_DELETE', 'ARTWORK_DEDUP_SCAN', 'ARTWORK_DEDUP_MAINTENANCE'].includes(job.type)) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '请通过重复作品检查页面控制此任务')
    }
    if (job.definitionVersion === 0) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '历史任务仅供查看，不能重新执行或控制')
    }
    const batchId = await controlDiscoveryBatch(transaction, jobId, 'CANCEL', now(), job)
    if (batchId) {
      return toJobDto(
        requireJob(await transaction.systemJob.findUnique({ where: { id: batchId }, select: systemJobWireSelect }))
      )
    }

    if (job.status === 'CANCELLING' || job.status === 'CANCELLED') return toJobDto(job)
    assertStatus(job, ['PENDING', 'RETRY_WAIT', 'PAUSED', 'RUNNING', 'PAUSING'], 'cancel')
    if (await hasBlockingMediaContentCancellation(transaction, jobId)) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', MEDIA_CONTENT_CANCELLATION_MESSAGE)
    }
    const timestamp = now()
    const direct = ['PENDING', 'RETRY_WAIT', 'PAUSED'].includes(job.status)
    let auditApplySnapshot: ValidatedAuditApplySnapshot | null = null
    if (direct && job.type === 'SCAN' && job.definitionVersion === SCAN_AUDIT_APPLY_DEFINITION_VERSION) {
      const payload = scanAuditApplyPayloadSchema.safeParse(job.payload)
      if (!payload.success) {
        throw new BackgroundTaskError('INVALID_STATE_TRANSITION', 'Audit apply job payload is invalid')
      }
      auditApplySnapshot = await validateQueuedAuditApply(transaction, job.id, payload.data)
    }
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
    if (job.type === 'ARCHIVE_RESOLVE_ITEM') {
      const item = await transaction.archiveIntakeItem.updateMany({
        where: { currentSystemJobId: job.id },
        data: {
          cancelRequestedAt: timestamp,
          ...(direct ? { status: 'CANCELLED', finishedAt: timestamp, retryable: false } : {})
        }
      })
      if (item.count !== 1) {
        throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '归档解析任务未绑定收件项')
      }
    }
    if ((job.type === 'ARCHIVE_UPLOADER_SCAN' || job.type === 'ARCHIVE_SEARCH_SCAN') && direct) {
      const scan = await transaction.archiveUploaderScanRun.updateMany({
        where: { systemJobId: job.id, status: { in: ['PENDING', 'RETRY_WAIT', 'PAUSED'] } },
        data: { status: 'CANCELLED', finishedAt: timestamp, errorCode: 'CANCELLED', errorMessage: null }
      })
      if (scan.count !== 1) {
        throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '上传者扫描任务未绑定活动扫描记录')
      }
    }
    if (direct && (job.type === 'SCAN' || job.type === 'LOCAL_DIRECTORY_IMPORT')) {
      if (auditApplySnapshot) {
        await cancelQueuedAuditApply(transaction, auditApplySnapshot, timestamp)
      } else {
        await transaction.scanRun.updateMany({
          where: {
            systemJobId: job.id,
            status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] }
          },
          data: { status: 'CANCELLED', checkpointStage: 'CANCELLED', finishedAt: timestamp }
        })
      }
    }
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
        message: '排队任务在执行前已取消'
      })
    }
    return toJobDto(updated)
  })
}

interface ValidatedAuditApplySnapshot {
  id: string
  inputCount: number
}

async function validateQueuedAuditApply(
  transaction: Prisma.TransactionClient,
  jobId: string,
  payload: ScanAuditApplyPayload
): Promise<ValidatedAuditApplySnapshot> {
  const run = await transaction.scanRun.findUnique({
    where: { systemJobId: jobId },
    select: {
      id: true,
      operationKind: true,
      sourceAuditRunId: true,
      inputCount: true,
      inputDigest: true,
      inputFrozenAt: true,
      metadataInputs: { select: { sourceAuditItemId: true } },
      items: { select: { sourceAuditItemId: true } }
    }
  })
  if (
    !run ||
    run.operationKind !== 'AUDIT_APPLY' ||
    run.sourceAuditRunId !== payload.auditRunId ||
    run.inputCount !== payload.inputCount ||
    run.inputDigest !== payload.inputDigest ||
    !run.inputFrozenAt
  ) {
    throw new BackgroundTaskError('INVALID_STATE_TRANSITION', 'Audit apply job is not bound to its frozen operation')
  }
  const metadataItemIds = run.metadataInputs.flatMap((item) => item.sourceAuditItemId ?? [])
  const runItemIds = run.items.flatMap((item) => item.sourceAuditItemId ?? [])
  const uniqueMetadataItemIds = new Set(metadataItemIds)
  const uniqueRunItemIds = new Set(runItemIds)
  const completeInputSet =
    metadataItemIds.length === payload.inputCount &&
    runItemIds.length === payload.inputCount &&
    uniqueMetadataItemIds.size === payload.inputCount &&
    uniqueRunItemIds.size === payload.inputCount &&
    [...uniqueMetadataItemIds].every((id) => uniqueRunItemIds.has(id))
  if (!completeInputSet) {
    throw new BackgroundTaskError('INVALID_STATE_TRANSITION', 'Audit apply frozen item set is incomplete')
  }
  return { id: run.id, inputCount: run.inputCount }
}

async function cancelQueuedAuditApply(
  transaction: Prisma.TransactionClient,
  run: ValidatedAuditApplySnapshot,
  timestamp: Date
) {
  await transaction.scanRunItem.updateMany({
    where: { scanRunId: run.id, applyOutcome: null },
    data: {
      status: 'FAILED',
      applyOutcome: 'FAILED',
      applyReasonCode: 'OPERATION_CANCELLED',
      applyReasonSummary: 'Operation was cancelled before this item completed',
      applyRetryable: true,
      finishedAt: timestamp
    }
  })
  const items = await transaction.scanRunItem.findMany({
    where: { scanRunId: run.id },
    select: { applyOutcome: true, applyReasonCode: true, newImageCount: true }
  })
  if (items.length !== run.inputCount) {
    throw new BackgroundTaskError('INVALID_STATE_TRANSITION', 'Audit apply frozen item set is incomplete')
  }
  const applied = items.filter((item) => item.applyOutcome === 'APPLIED').length
  const skipped = items.filter((item) => item.applyOutcome === 'SKIPPED').length
  const stale = items.filter(
    (item) => item.applyOutcome === 'SKIPPED' && item.applyReasonCode === 'STALE_SOURCE_INPUT'
  ).length
  const conflicts = items.filter((item) => item.applyOutcome === 'CONFLICT').length
  const failed = items.filter((item) => item.applyOutcome === 'FAILED').length
  const newImages = items.reduce((total, item) => total + item.newImageCount, 0)
  const updated = await transaction.scanRun.updateMany({
    where: { id: run.id, status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] } },
    data: {
      status: 'CANCELLED',
      checkpointStage: 'CANCELLED',
      finishedAt: timestamp,
      processedArtworks: items.length,
      succeededArtworks: applied,
      skippedArtworks: skipped,
      failedArtworks: conflicts + failed,
      publishedInputs: applied,
      failedInputs: conflicts + failed,
      auditApplyStaleInputs: stale,
      auditApplyConflictInputs: conflicts,
      newImages,
      errorMessage: null
    }
  })
  if (updated.count !== 1) {
    throw new BackgroundTaskError('CONCURRENT_MODIFICATION', 'Audit apply operation changed while cancelling')
  }
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
    if (['ARTWORK_BATCH_DELETE', 'ARTWORK_DEDUP_SCAN', 'ARTWORK_DEDUP_MAINTENANCE'].includes(job.type)) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '请通过重复作品检查页面控制此任务')
    }
    if (job.definitionVersion === 0) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '历史任务仅供查看，不能重新执行或控制')
    }
    const batchId = await controlDiscoveryBatch(transaction, jobId, 'PAUSE', now(), job)
    if (batchId) {
      return toJobDto(
        requireJob(await transaction.systemJob.findUnique({ where: { id: batchId }, select: systemJobWireSelect }))
      )
    }

    if (job.status === 'PAUSING' || job.status === 'PAUSED') return toJobDto(job)
    assertStatus(job, ['PENDING', 'RETRY_WAIT', 'RUNNING'], 'pause')
    const direct = job.status !== 'RUNNING'
    const timestamp = now()
    const updated = await compareAndSetJob(transaction, job, {
      status: direct ? 'PAUSED' : 'PAUSING',
      pauseRequestedAt: timestamp,
      ...(direct ? { workerId: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null } : {})
    })
    if ((job.type === 'ARCHIVE_UPLOADER_SCAN' || job.type === 'ARCHIVE_SEARCH_SCAN') && direct) {
      const scan = await transaction.archiveUploaderScanRun.updateMany({
        where: { systemJobId: job.id, status: { in: ['PENDING', 'RETRY_WAIT'] } },
        data: { status: 'PAUSED', finishedAt: null }
      })
      if (scan.count !== 1) {
        throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '上传者扫描任务未绑定活动扫描记录')
      }
    }
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
        message: '排队任务在执行前已暂停'
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
    if (['ARTWORK_BATCH_DELETE', 'ARTWORK_DEDUP_SCAN', 'ARTWORK_DEDUP_MAINTENANCE'].includes(job.type)) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '请通过重复作品检查页面控制此任务')
    }
    if (job.definitionVersion === 0) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '历史任务仅供查看，不能重新执行或控制')
    }
    const batchId = await controlDiscoveryBatch(transaction, jobId, 'RESUME', now(), job)
    if (batchId) {
      return toJobDto(
        requireJob(await transaction.systemJob.findUnique({ where: { id: batchId }, select: systemJobWireSelect }))
      )
    }

    assertStatus(job, ['PAUSED'], 'resume')
    if (await hasBlockingMediaContentRecoveryResume(transaction, jobId)) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '取消未完成，请先停写并完成媒体恢复授权，再继续任务')
    }
    const timestamp = now()
    const updated = await compareAndSetJob(transaction, job, {
      status: 'PENDING',
      availableAt: timestamp,
      pauseRequestedAt: null,
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null
    })
    if (job.type === 'ARCHIVE_UPLOADER_SCAN' || job.type === 'ARCHIVE_SEARCH_SCAN') {
      const scan = await transaction.archiveUploaderScanRun.updateMany({
        where: { systemJobId: job.id, status: 'PAUSED' },
        data: { status: 'PENDING', finishedAt: null, errorCode: null, errorMessage: null }
      })
      if (scan.count !== 1) {
        throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '上传者扫描任务未绑定已暂停的扫描记录')
      }
    }
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
    if (['ARTWORK_BATCH_DELETE', 'ARTWORK_DEDUP_SCAN', 'ARTWORK_DEDUP_MAINTENANCE'].includes(job.type)) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '请通过重复作品检查页面控制此任务')
    }
    assertStatus(job, ['FAILED', 'CANCELLED', 'SKIPPED'], 'retry')
    if (await hasBlockingMediaContentCancellation(transaction, job.id)) {
      throw new BackgroundTaskError(
        'INVALID_STATE_TRANSITION',
        '存在未解决的媒体写入，请使用原任务的离线恢复授权，不能创建新的重试任务'
      )
    }
    if (job.type === 'ARTWORK_SUMMARY_GENERATE') {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', ARTWORK_SUMMARY_RETIRED_MESSAGE)
    }
    if (
      job.type === 'ARCHIVE_DISCOVERY_BATCH_SCAN' ||
      job.type === 'ARCHIVE_UPLOADER_SCAN' ||
      job.type === 'ARCHIVE_SEARCH_SCAN'
    ) {
      throw new BackgroundTaskError(
        'INVALID_STATE_TRANSITION',
        '上传者扫描的游标保存在来源记录中，请从上传者来源重新发起手动扫描'
      )
    }
    if (job.definitionVersion !== JOB_DEFINITION_VERSION) {
      throw new BackgroundTaskError(
        'INVALID_STATE_TRANSITION',
        `Only definition version ${JOB_DEFINITION_VERSION} jobs can be retried; create a new task instead`
      )
    }
    if (isRetiredFullReconcilePayload(job.type, job.payload)) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', FULL_SCAN_RETIRED_MESSAGE)
    }
    let retryPayload
    let retryType
    try {
      retryType = jobTypeSchema.parse(job.type)
      retryPayload = parseJobPayload(retryType, job.payload ?? {})
    } catch {
      throw new BackgroundTaskError(
        'INVALID_STATE_TRANSITION',
        'This historical job does not contain a valid v1 payload; create a new task instead'
      )
    }
    if (isFrozenScanSnapshotPayload(retryType, retryPayload)) {
      throw new BackgroundTaskError(
        'INVALID_STATE_TRANSITION',
        'This scan uses a frozen input snapshot; submit the list or artwork rescan again instead'
      )
    }
    const executionLane = executionLaneForJobType(retryType)
    if (job.executionLane !== executionLane) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '该历史任务的执行通道无效，请修复后再重试')
    }
    if (retryType === 'ARCHIVE_RESOLVE_ITEM') {
      const item = await transaction.archiveIntakeItem.findFirst({
        where: { currentSystemJobId: job.id, status: { in: ['FAILED', 'CANCELLED'] } },
        select: { submittedUrl: true, dedupSourceSnapshot: true }
      })
      if (!item) {
        throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '收件记录已删除或不再可重试，请从收件箱重新添加链接')
      }
      await lockCreatorCatalog(transaction)
      try {
        await assertArchiveIntakeSourceProof(transaction, item.dedupSourceSnapshot, item.submittedUrl)
      } catch (error) {
        if (error instanceof ArchiveError && error.code === 'STATE_CONFLICT') {
          throw new BackgroundTaskError('PRECONDITION_FAILED', error.message)
        }
        throw error
      }
    }
    const priority = Math.min(job.queuePriority, 99)
    const timestamp = now()
    const retried = await transaction.systemJob.create({
      data: {
        type: job.type,
        executionLane,
        definitionVersion: job.definitionVersion,
        status: 'PENDING',
        triggerSource: 'RETRY',
        requestedByUserId: requestedByUserId ?? job.requestedByUserId,
        payload: retryPayload === null ? Prisma.JsonNull : (retryPayload as Prisma.InputJsonValue),
        parentJobId: job.id,
        queuePriority: priority,
        effectivePriority: priority,
        availableAt: timestamp,
        maxAttempts: job.maxAttempts
      },
      select: systemJobWireSelect
    })
    if (retryType === 'ARCHIVE_RESOLVE_ITEM') {
      const reboundItems = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "archive_intake_items"
         SET "currentSystemJobId" = $2,
             "status" = 'QUEUED',
             "queueOrder" = nextval(pg_get_serial_sequence('archive_intake_items', 'queueOrder')),
             "attempts" = 0,
             "availableAt" = $3,
             "cancelRequestedAt" = NULL,
             "startedAt" = NULL,
             "finishedAt" = NULL,
             "errorCode" = NULL,
             "errorMessage" = NULL,
             "errorStage" = NULL,
             "retryable" = NULL,
             "updatedAt" = $3
         WHERE "currentSystemJobId" = $1
           AND "status" IN ('FAILED', 'CANCELLED')
         RETURNING "id"`,
        job.id,
        retried.id,
        timestamp
      )
      if (reboundItems.length !== 1) {
        throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '收件记录已删除或不再可重试，请从收件箱重新添加链接')
      }
    }
    if (job.status === 'FAILED') {
      await acknowledgeJobFailure(transaction, {
        jobId: job.id,
        acknowledgedAt: timestamp,
        acknowledgedByUserId: requestedByUserId,
        source: 'RETRY'
      })
    }
    await writeJobEvent(transaction, {
      jobId: job.id,
      type: 'job.retry_scheduled',
      attempt: job.attempt,
      message: '手动重试已创建新的任务实例',
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

export async function acknowledgeJobFailureCommand(
  input: z.input<typeof acknowledgeJobFailureInputSchema>,
  client?: CommandDatabaseClient,
  now: () => Date = () => new Date()
) {
  const parsed = acknowledgeJobFailureInputSchema.parse(input)
  return commandDatabase(client).$transaction(async (transaction) => {
    const job = requireJob(
      await transaction.systemJob.findUnique({ where: { id: parsed.jobId }, select: systemJobWireSelect })
    )
    assertStatus(job, ['FAILED'], 'acknowledge the failure notification for')
    await acknowledgeJobFailure(transaction, {
      jobId: job.id,
      acknowledgedAt: now(),
      acknowledgedByUserId: parsed.requestedByUserId,
      source: 'MANUAL'
    })
    return toJobDto(job)
  })
}

export async function acknowledgeJobFailuresCommand(
  input: AcknowledgeJobFailuresRequest,
  requestedByUserId: string,
  client?: CommandDatabaseClient,
  now: () => Date = () => new Date()
) {
  const parsed = acknowledgeJobFailuresRequestSchema.parse(input)
  const userId = z.string().min(1).parse(requestedByUserId)
  return commandDatabase(client).$transaction(
    async (transaction) => {
      // Freeze candidates once: failures arriving during later insert batches remain unread.
      const jobs = await transaction.systemJob.findMany({
        where: { ...unacknowledgedFailureWhere, ...(parsed.scope === 'selected' ? { id: { in: parsed.jobIds } } : {}) },
        select: { id: true },
        orderBy: { id: 'asc' }
      })
      const acknowledgedAt = now()
      let acknowledgedCount = 0
      for (let offset = 0; offset < jobs.length; offset += 500) {
        const result = await transaction.systemJobFailureAcknowledgement.createMany({
          data: jobs.slice(offset, offset + 500).map(({ id }) => ({
            jobId: id,
            acknowledgedAt,
            acknowledgedByUserId: userId,
            source: 'MANUAL' as const
          })),
          skipDuplicates: true
        })
        acknowledgedCount += result.count
      }
      return {
        acknowledgedCount,
        skippedCount: (parsed.scope === 'selected' ? parsed.jobIds.length : jobs.length) - acknowledgedCount
      }
    },
    { timeout: 30_000 }
  )
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
    if (['ARTWORK_BATCH_DELETE', 'ARTWORK_DEDUP_SCAN', 'ARTWORK_DEDUP_MAINTENANCE'].includes(job.type)) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '重复作品检查使用固定低优先级')
    }
    if (job.definitionVersion === 0) {
      throw new BackgroundTaskError('INVALID_STATE_TRANSITION', '历史任务仅供查看，不能重新执行或控制')
    }
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
