import 'server-only'

import { prisma } from '@/lib/prisma'
import { getSystemSettings } from '@/services/setting.service'
import {
  ACTIVE_JOB_STATUSES,
  JOB_DEFINITION_VERSION,
  pendingReplacePayloadSchema,
  type PendingReplacePayload
} from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import { BackgroundTaskError } from './background-task/background-task-error'
import { cancelJobCommand, enqueueJob } from './background-task/job-command-service'

const PENDING_REPLACE_ENQUEUE_LOCK = 7_283_470
const REPLACEMENT_RESUME_STATUSES = [
  'READY',
  'FAILED',
  'STAGING',
  'BACKING_UP',
  'SWAPPING',
  'COMMITTING',
  'ARCHIVING',
  'ROLLING_BACK'
] as const
const RESTORE_RESUME_STATUSES = ['SUCCESS', 'RESTORING', 'RESTORE_SWAPPING', 'RESTORE_COMMITTED'] as const

type OperationMode = PendingReplacePayload['mode']

export async function enqueueCentralPendingReplacePreview(requestedByUserId: string) {
  return prisma.$transaction(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as Prisma.TransactionClient
    await lockPendingReplaceEnqueue(transaction)
    await assertNoActivePendingReplace(transaction)
    const batch = await transaction.pendingReplaceBatch.create({
      data: { sourceRoot: '/pending-replaces', status: 'PREVIEWED' },
      select: { id: true }
    })
    const payload = pendingReplacePayloadSchema.parse({
      mode: 'DISCOVER',
      batchId: batch.id,
      sourceRoot: 'pending-replaces'
    })
    const job = await createOperation(transaction, { payload, requestedByUserId })
    await transaction.pendingReplaceBatch.update({ where: { id: batch.id }, data: { systemJobId: job.id } })
    return { batchId: batch.id, jobId: job.id, status: job.status, reused: false }
  })
}

export async function enqueueCentralPendingReplaceBatch(input: {
  batchId: string
  itemIds?: string[]
  requestedByUserId: string
}) {
  const settings = await getSystemSettings()
  const appendTagIds = [...new Set(settings.replace_default_tag_ids)].sort((left, right) => left - right)
  return prisma.$transaction(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as Prisma.TransactionClient
    await lockPendingReplaceEnqueue(transaction)
    const batch = await transaction.pendingReplaceBatch.findUnique({
      where: { id: input.batchId },
      include: { items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }
    })
    if (!batch) throw new Error('Pending replacement batch not found')
    if (!['PREVIEWED', 'PARTIAL_FAILED', 'FAILED'].includes(batch.status)) {
      throw new Error('Pending replacement batch cannot be queued from its current state')
    }
    const requested = input.itemIds ? new Set(input.itemIds) : null
    const selected = batch.items.filter(
      (item) =>
        REPLACEMENT_RESUME_STATUSES.includes(item.status as (typeof REPLACEMENT_RESUME_STATUSES)[number]) &&
        (!requested || requested.has(item.id))
    )
    if (selected.length === 0) throw new Error('没有可执行的替换项目')
    if (requested && (requested.size !== selected.length || selected.some((item) => !requested.has(item.id)))) {
      throw new Error('请求项目不属于当前批次或状态不可执行')
    }
    const payload = pendingReplacePayloadSchema.parse({
      mode: 'BATCH',
      batchId: batch.id,
      itemIds: selected.map((item) => item.id),
      appendTagIds
    }) as Extract<PendingReplacePayload, { mode: 'BATCH' }>
    const existing = await findEquivalentActiveOperation(transaction, payload)
    if (existing) return { batchId: batch.id, jobId: existing.id, status: existing.status, reused: true }
    await assertNoActivePendingReplace(transaction)
    const job = await createOperation(transaction, { payload, requestedByUserId: input.requestedByUserId })
    const selectedIds = payload.itemIds
    await transaction.pendingReplaceItem.updateMany({
      where: { batchId: batch.id, id: { in: selectedIds }, status: { in: [...REPLACEMENT_RESUME_STATUSES] } },
      data: { included: true, error: null, finishedAt: null }
    })
    await transaction.pendingReplaceItem.updateMany({
      where: { batchId: batch.id, status: 'READY', id: { notIn: selectedIds } },
      data: { status: 'EXCLUDED', included: false }
    })
    await transaction.pendingReplaceBatch.update({
      where: { id: batch.id },
      data: { systemJobId: job.id, finishedAt: null }
    })
    return { batchId: batch.id, jobId: job.id, status: job.status, reused: false }
  })
}

export async function enqueueCentralPendingReplaceRestore(input: { itemId: string; requestedByUserId: string }) {
  return prisma.$transaction(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as Prisma.TransactionClient
    await lockPendingReplaceEnqueue(transaction)
    const item = await transaction.pendingReplaceItem.findUnique({ where: { id: input.itemId } })
    if (!item || !RESTORE_RESUME_STATUSES.includes(item.status as (typeof RESTORE_RESUME_STATUSES)[number])) {
      throw new Error('该作品没有可恢复的旧媒体备份')
    }
    if (!item.backupDirectory) throw new Error('该作品缺少可验证的旧媒体备份')
    const payload = pendingReplacePayloadSchema.parse({ mode: 'RESTORE', batchId: item.batchId, itemId: item.id })
    const existing = await findEquivalentActiveOperation(transaction, payload)
    if (existing) {
      return { batchId: item.batchId, itemId: item.id, jobId: existing.id, status: existing.status, reused: true }
    }
    await assertNoActivePendingReplace(transaction)
    const job = await createOperation(transaction, { payload, requestedByUserId: input.requestedByUserId })
    await transaction.pendingReplaceBatch.update({
      where: { id: item.batchId },
      data: { systemJobId: job.id, finishedAt: null }
    })
    return { batchId: item.batchId, itemId: item.id, jobId: job.id, status: job.status, reused: false }
  })
}

export async function enqueueCentralPendingReplaceCleanup(input: { batchId: string; requestedByUserId: string }) {
  return prisma.$transaction(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as Prisma.TransactionClient
    await lockPendingReplaceEnqueue(transaction)
    const batch = await transaction.pendingReplaceBatch.findUnique({
      where: { id: input.batchId },
      select: { id: true }
    })
    if (!batch) throw new Error('Pending replacement batch not found')
    const candidates = await transaction.pendingReplaceItem.count({
      where: { batchId: batch.id, status: { in: ['SUCCESS', 'CLEANING_BACKUP'] }, backupDirectory: { not: null } }
    })
    if (candidates === 0) throw new Error('没有可清理的旧媒体备份')
    const payload = pendingReplacePayloadSchema.parse({ mode: 'CLEANUP', batchId: batch.id })
    const existing = await findEquivalentActiveOperation(transaction, payload)
    if (existing) return { batchId: batch.id, jobId: existing.id, status: existing.status, reused: true }
    await assertNoActivePendingReplace(transaction)
    const job = await createOperation(transaction, { payload, requestedByUserId: input.requestedByUserId })
    await transaction.pendingReplaceBatch.update({
      where: { id: batch.id },
      data: { systemJobId: job.id, finishedAt: null }
    })
    return { batchId: batch.id, jobId: job.id, status: job.status, reused: false }
  })
}

/**
 * Central recovery never steals a live lease. An active job is returned unchanged; otherwise the
 * latest frozen operation is re-enqueued with exactly the same payload so the executor resumes its
 * persisted item phase. DISCOVER can only be retried while the batch is still empty.
 */
export async function recoverCentralPendingReplaceBatch(input: { batchId: string; requestedByUserId: string }) {
  const active = await prisma.pendingReplaceOperation.findFirst({
    where: { batchId: input.batchId, systemJob: { status: { in: [...ACTIVE_JOB_STATUSES] } } },
    orderBy: { createdAt: 'desc' },
    include: { systemJob: { select: { id: true, status: true } } }
  })
  if (active) {
    return {
      batchId: input.batchId,
      jobId: active.systemJob.id,
      status: active.systemJob.status,
      reused: true,
      recovery: 'LEASE_MANAGED' as const
    }
  }
  const latest = await prisma.pendingReplaceOperation.findFirst({
    where: { batchId: input.batchId },
    orderBy: { createdAt: 'desc' },
    include: { systemJob: { select: { payload: true } } }
  })
  if (!latest) throw new Error('没有可恢复的中央替换任务')
  const parsed = pendingReplacePayloadSchema.safeParse(latest.systemJob.payload)
  if (!parsed.success || parsed.data.mode !== latest.mode || parsed.data.batchId !== input.batchId) {
    throw new Error('历史替换任务缺少可验证的冻结输入')
  }
  const payload = parsed.data
  if (payload.mode === 'DISCOVER') {
    const existingItems = await prisma.pendingReplaceItem.count({ where: { batchId: input.batchId } })
    if (existingItems !== 0) throw new Error('发现任务已写入项目，不能重复覆盖批次')
    return enqueueRecoveredOperation(payload, input.requestedByUserId)
  }
  if (payload.mode === 'BATCH') {
    const resumable = await prisma.pendingReplaceItem.count({
      where: { batchId: input.batchId, id: { in: payload.itemIds }, status: { in: [...REPLACEMENT_RESUME_STATUSES] } }
    })
    if (resumable === 0) throw new Error('没有可恢复的替换阶段')
  }
  if (payload.mode === 'RESTORE') {
    const item = await prisma.pendingReplaceItem.findFirst({
      where: { id: payload.itemId, batchId: payload.batchId, status: { in: [...RESTORE_RESUME_STATUSES] } },
      select: { id: true }
    })
    if (!item) throw new Error('没有可恢复的还原阶段')
  }
  if (payload.mode === 'CLEANUP') {
    const item = await prisma.pendingReplaceItem.findFirst({
      where: { batchId: payload.batchId, status: 'CLEANING_BACKUP', backupDirectory: { not: null } },
      select: { id: true }
    })
    if (!item) throw new Error('没有可恢复的备份清理阶段')
  }
  return enqueueRecoveredOperation(payload, input.requestedByUserId)
}

export async function cancelCentralPendingReplaceBatch(batchId: string) {
  const active = await prisma.pendingReplaceOperation.findFirst({
    where: { batchId, systemJob: { status: { in: [...ACTIVE_JOB_STATUSES] } } },
    orderBy: { createdAt: 'desc' },
    include: { systemJob: { select: { id: true } } }
  })
  if (!active) return { success: false }
  const job = await cancelJobCommand({ jobId: active.systemJob.id })
  return { success: true, jobId: job.id, status: job.status }
}

/**
 * Serializes preview edits with operation creation. Call this inside the same transaction that
 * compare-and-sets the preview row, otherwise a queued operation could observe mutable snapshots.
 */
export async function lockCentralPendingReplacePreviewMutation(transaction: Prisma.TransactionClient, batchId: string) {
  await lockPendingReplaceEnqueue(transaction)
  const active = await transaction.pendingReplaceOperation.findFirst({
    where: { batchId, systemJob: { status: { in: [...ACTIVE_JOB_STATUSES] } } },
    select: { systemJobId: true }
  })
  if (active) throw new Error('Pending replacement job already in progress')
}

async function enqueueRecoveredOperation(payload: PendingReplacePayload, requestedByUserId: string) {
  return prisma.$transaction(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as Prisma.TransactionClient
    await lockPendingReplaceEnqueue(transaction)
    const existing = await findEquivalentActiveOperation(transaction, payload)
    if (existing) {
      return {
        batchId: payload.batchId,
        jobId: existing.id,
        status: existing.status,
        reused: true,
        recovery: 'REENQUEUED' as const
      }
    }
    await assertNoActivePendingReplace(transaction)
    const job = await createOperation(transaction, { payload, requestedByUserId })
    await transaction.pendingReplaceBatch.update({
      where: { id: payload.batchId },
      data: { systemJobId: job.id, finishedAt: null }
    })
    return {
      batchId: payload.batchId,
      jobId: job.id,
      status: job.status,
      reused: false,
      recovery: 'REENQUEUED' as const
    }
  })
}

async function createOperation(
  transaction: Prisma.TransactionClient,
  input: { payload: PendingReplacePayload; requestedByUserId: string }
) {
  const job = await enqueueJob(
    {
      type: 'PENDING_REPLACE',
      definitionVersion: JOB_DEFINITION_VERSION,
      triggerSource: 'MANUAL',
      requestedByUserId: input.requestedByUserId,
      priority: 5,
      maxAttempts: 3,
      payload: input.payload
    },
    transactionClient(transaction)
  )
  await transaction.pendingReplaceOperation.create({
    data: {
      systemJobId: job.id,
      batchId: input.payload.batchId,
      itemId: input.payload.mode === 'RESTORE' ? input.payload.itemId : null,
      mode: input.payload.mode
    }
  })
  return job
}

async function findEquivalentActiveOperation(transaction: Prisma.TransactionClient, payload: PendingReplacePayload) {
  const active = await transaction.pendingReplaceOperation.findFirst({
    where: { batchId: payload.batchId, systemJob: { status: { in: [...ACTIVE_JOB_STATUSES] } } },
    orderBy: { createdAt: 'desc' },
    include: { systemJob: { select: { id: true, status: true, definitionVersion: true, payload: true } } }
  })
  if (!active) return null
  const parsed = pendingReplacePayloadSchema.safeParse(active.systemJob.payload)
  if (
    active.mode === payload.mode &&
    active.systemJob.definitionVersion === JOB_DEFINITION_VERSION &&
    parsed.success &&
    canonicalJson(parsed.data) === canonicalJson(payload)
  ) {
    return active.systemJob
  }
  throw new BackgroundTaskError('ACTIVE_JOB_CONFLICT', 'An active pending replacement has different frozen input')
}

async function assertNoActivePendingReplace(transaction: Prisma.TransactionClient) {
  const active = await transaction.systemJob.findFirst({
    where: { type: 'PENDING_REPLACE', status: { in: [...ACTIVE_JOB_STATUSES] } },
    select: { id: true }
  })
  if (active) throw new BackgroundTaskError('ACTIVE_JOB_CONFLICT', 'A pending replacement job is already active')
}

async function lockPendingReplaceEnqueue(transaction: Prisma.TransactionClient) {
  await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', PENDING_REPLACE_ENQUEUE_LOCK)
}

function transactionClient(transaction: Prisma.TransactionClient) {
  return { $transaction: <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) => operation(transaction) }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(',')}}`
}

export const PENDING_REPLACE_CENTRAL_OPERATION_MODES: readonly OperationMode[] = [
  'DISCOVER',
  'BATCH',
  'RESTORE',
  'CLEANUP'
]
