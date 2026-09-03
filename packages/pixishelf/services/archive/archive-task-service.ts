import { randomUUID } from 'node:crypto'
import {
  ARCHIVE_IMPORT_DEFINITION_VERSION,
  ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE,
  archiveImportV2PayloadSchema,
  archiveUploaderIdentityLockKey,
  archiveUploaderUrlLockKey
} from '@pixishelf/job-contracts'
import { Prisma, type PrismaClient } from '@pixishelf/db'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  getArchiveBulkOperation,
  runArchiveBulkOperation,
  type ArchiveBulkTargetResult
} from './archive-bulk-operation'
import { ArchiveError } from './errors'
import { ARCHIVE_PUBLISH_ADVISORY_LOCK_ID } from './archive-coordination'
import { writeJobEvent } from '@/services/background-task/job-event-service'
import { archiveTaskActionIneligibility, recoverAppliedArchiveTaskAction } from './archive-task-action-policy'
import { archiveWireErrorMessage, redactArchiveText, redactArchiveUrl } from './archive-redaction'
import { archiveImportDefaultTagIdsForRetry } from './archive-job-payload'

const FAILED_STAGING_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

export const archiveTaskListSchema = z
  .object({
    taskId: z.string().trim().min(1).max(128).optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    statuses: z
      .array(z.enum(['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED']))
      .max(7)
      .optional(),
    providerKey: z.string().trim().min(1).max(50).optional(),
    kind: z.enum(['NEW', 'UPDATE']).optional(),
    submissionId: z.string().trim().min(1).max(128).optional(),
    search: z.string().trim().min(1).max(500).optional()
  })
  .strict()

export const archiveTaskActionManySchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(180),
    taskIds: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(100)
      .transform((values) => [...new Set(values)]),
    action: z.enum(['PAUSE', 'RESUME', 'CANCEL', 'RETRY'])
  })
  .strict()

export interface ArchiveTaskServiceDependencies {
  database?: PrismaClient
  now?: () => Date
  uuid?: () => string
}

export async function listArchiveTasks(
  input: z.input<typeof archiveTaskListSchema>,
  dependencies: ArchiveTaskServiceDependencies = {}
) {
  const parsed = archiveTaskListSchema.parse(input)
  const database = getDatabase(dependencies)
  const cursor = !parsed.taskId && parsed.cursor ? decodeTaskCursor(parsed.cursor) : null
  const requestedAttribution: Prisma.ArchiveIntakeItemWhereInput = {
    ...(parsed.kind ? { resolutionKind: parsed.kind } : {}),
    ...(parsed.submissionId ? { submissionId: parsed.submissionId } : {})
  }
  const attributionWhere: Prisma.ArchiveIntakeItemWhereInput =
    parsed.kind || parsed.submissionId ? requestedAttribution : {}
  const records = await database.archiveImport.findMany({
    where: parsed.taskId
      ? { id: parsed.taskId }
      : {
          ...(parsed.statuses?.length ? { status: { in: parsed.statuses } } : {}),
          ...(parsed.providerKey ? { providerKey: parsed.providerKey } : {}),
          ...(parsed.kind || parsed.submissionId
            ? {
                intakeItems: {
                  some: requestedAttribution
                }
              }
            : {}),
          ...((parsed.search || cursor) && {
            AND: [
              ...(parsed.search
                ? [
                    {
                      OR: [
                        { submittedUrl: { contains: parsed.search, mode: 'insensitive' as const } },
                        { canonicalUrl: { contains: parsed.search, mode: 'insensitive' as const } },
                        { externalId: { contains: parsed.search, mode: 'insensitive' as const } },
                        { normalizedMetadata: { path: ['titles', 'display'], string_contains: parsed.search } }
                      ]
                    }
                  ]
                : []),
              ...(cursor
                ? [
                    {
                      OR: [
                        { createdAt: { lt: cursor.createdAt } },
                        { createdAt: cursor.createdAt, id: { lt: cursor.id } }
                      ]
                    }
                  ]
                : [])
            ]
          })
        },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: parsed.limit + 1,
    select: buildArchiveTaskWireSelect(attributionWhere)
  })
  const hasMore = records.length > parsed.limit
  const visible = hasMore ? records.slice(0, parsed.limit) : records
  const last = visible.at(-1)
  return {
    items: visible.map(serializeTask),
    nextCursor: hasMore && last ? encodeTaskCursor(last.createdAt, last.id) : null
  }
}

export async function actionArchiveTasksMany(
  input: z.input<typeof archiveTaskActionManySchema>,
  requestedByUserId: string,
  dependencies: ArchiveTaskServiceDependencies = {}
) {
  const parsed = archiveTaskActionManySchema.parse(input)
  const database = getDatabase(dependencies)
  const now = dependencies.now ?? (() => new Date())
  const uuid = dependencies.uuid ?? randomUUID
  // 批量动作用统一的 archiveBulkOperation 路由，保持与收件箱动作一致的审计与幂等重放模型。
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.idempotencyKey,
      requestedByUserId,
      commandType: parsed.action,
      targetType: 'ARCHIVE_IMPORT',
      targetIds: parsed.taskIds
    },
    (transaction, taskId) =>
      applyTaskAction(transaction, taskId, {
        action: parsed.action,
        requestedByUserId,
        timestamp: now(),
        uuid
      }),
    { database, now },
    (transaction, taskId) => recoverTaskAction(transaction, taskId, parsed.action)
  )
}

export { getArchiveBulkOperation }

async function applyTaskAction(
  transaction: Prisma.TransactionClient,
  taskId: string,
  options: {
    action: z.infer<typeof archiveTaskActionManySchema>['action']
    requestedByUserId: string
    timestamp: Date
    uuid: () => string
  }
): Promise<ArchiveBulkTargetResult> {
  const { action, requestedByUserId, timestamp, uuid } = options
  // 与发布管线共用全局 advisory lock，使归档控制与发布/回收站状态变更按同一顺序串行。
  await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
  const task = await transaction.archiveImport.findUnique({
    where: { id: taskId },
    include: { systemJob: true }
  })
  if (!task) return { result: 'SKIPPED', code: 'NOT_FOUND', message: '归档任务不存在' }
  await lockUploaderCatalogImport(transaction, task)
  if (task.cleanupRequestedAt) {
    return { result: 'CONFLICT', code: 'CLEANUP_IN_PROGRESS', message: '归档任务正在清理暂存文件' }
  }
  const ineligibility = archiveTaskActionIneligibility(task.status, action)
  if (ineligibility) return ineligibility

  if (action === 'RETRY') {
    // RETRY 新建 SystemJob 并用 parentJobId 保留重试链；旧 job 继续作为历史审计记录。
    const nextJobId = uuid()
    const priority = Math.min(99, Math.max(0, task.systemJob.queuePriority))
    const defaultTagIds = archiveImportDefaultTagIdsForRetry(task.systemJob, task.id)
    await transaction.archiveImportItem.updateMany({
      where: { archiveImportId: task.id, status: { not: 'COMPLETED' } },
      data: resetArchiveImportItem()
    })
    await transaction.systemJob.create({
      data: {
        id: nextJobId,
        type: 'ARCHIVE_IMPORT',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: ARCHIVE_IMPORT_DEFINITION_VERSION,
        status: 'PENDING',
        triggerSource: 'RETRY',
        requestedByUserId,
        parentJobId: task.systemJobId,
        payload: archiveImportV2PayloadSchema.parse({
          archiveImportId: task.id,
          defaultTagIds
        }),
        queuePriority: priority,
        effectivePriority: priority,
        availableAt: timestamp,
        maxAttempts: task.systemJob.maxAttempts,
        progress: taskProgress(task.completedItems, task.totalItems),
        message: 'Retry archive import'
      }
    })
    const changed = await transaction.archiveImport.updateMany({
      where: { id: task.id, systemJobId: task.systemJobId, status: task.status },
      data: {
        systemJobId: nextJobId,
        status: 'PENDING',
        decisionCode: null,
        errorCode: null,
        errorMessage: null,
        failedItems: 0,
        finishedAt: null,
        retainUntil: null
      }
    })
    if (changed.count !== 1) throw new ArchiveError('STATE_CONFLICT', '归档任务状态已改变')
    await transaction.archiveUploaderCatalogItem.updateMany({
      where: {
        OR: [{ lastArchiveImportId: task.id }, { providerKey: task.providerKey, externalId: task.externalId }]
      },
      data: {
        lastArchiveImportId: task.id,
        lastOutcome: 'SUBMITTED',
        lastOutcomeAt: timestamp,
        lastErrorCode: null,
        lastErrorMessage: null
      }
    })
    await writeJobEvent(transaction, {
      jobId: task.systemJobId,
      type: 'job.retry_scheduled',
      attempt: task.systemJob.attempt,
      message: 'Retry archive import',
      data: { retryJobId: nextJobId }
    })
    await writeJobEvent(transaction, {
      jobId: nextJobId,
      type: 'job.queued',
      attempt: 0,
      message: 'Retry archive import',
      data: { retryOfJobId: task.systemJobId, archiveImportId: task.id, priority }
    })
    return { result: 'APPLIED', relatedId: nextJobId }
  }

  const running = ['RUNNING', 'PAUSING'].includes(task.systemJob.status)
  const direct = !running
  const allowedJobStatuses =
    action === 'PAUSE'
      ? ['PENDING', 'RETRY_WAIT', 'RUNNING']
      : action === 'RESUME'
        ? ['PAUSED']
        : ['PENDING', 'RETRY_WAIT', 'PAUSED', 'RUNNING', 'PAUSING']
  if (!allowedJobStatuses.includes(task.systemJob.status)) return invalidTaskState(task.systemJob.status, action)
  const nextJobStatus =
    action === 'CANCEL'
      ? direct
        ? 'CANCELLED'
        : 'CANCELLING'
      : action === 'PAUSE'
        ? direct
          ? 'PAUSED'
          : 'PAUSING'
        : 'PENDING'
  const jobChanged = await transaction.systemJob.updateMany({
    where: { id: task.systemJobId, status: task.systemJob.status },
    data: {
      status: nextJobStatus,
      message:
        action === 'CANCEL'
          ? direct
            ? 'Archive import cancelled before execution'
            : 'Archive import cancellation requested'
          : action === 'PAUSE'
            ? direct
              ? 'Archive import paused before execution'
              : 'Archive import pause requested'
            : 'Archive import resumed',
      ...(action === 'CANCEL' ? { cancelRequestedAt: timestamp } : {}),
      ...(action === 'PAUSE' ? { pauseRequestedAt: timestamp } : {}),
      ...(action === 'RESUME' ? { pauseRequestedAt: null, availableAt: timestamp } : {}),
      ...(direct || action === 'RESUME'
        ? { workerId: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null }
        : {}),
      ...(action === 'CANCEL' && direct ? { finishedAt: timestamp } : {})
    }
  })
  if (jobChanged.count !== 1) throw new ArchiveError('STATE_CONFLICT', '归档任务状态已改变')
  if (direct || action === 'RESUME') {
    // 排队态直接控制或恢复执行时没有合法的旧执行者，清理遗留 lease 后才能重新参与 claim。
    await transaction.jobResourceLease.deleteMany({ where: { ownerJobId: task.systemJobId } })
  }
  if (action === 'RESUME') {
    await transaction.archiveImportItem.updateMany({
      where: { archiveImportId: task.id, status: { not: 'COMPLETED' } },
      data: resetArchiveImportItem()
    })
  }
  const nextImportStatus =
    action === 'PAUSE'
      ? direct
        ? 'PAUSED'
        : 'RUNNING'
      : action === 'RESUME'
        ? 'PENDING'
        : direct
          ? 'CANCELLED'
          : 'CANCELLING'
  const changed = await transaction.archiveImport.updateMany({
    where: { id: task.id, systemJobId: task.systemJobId, status: task.status },
    data: {
      status: nextImportStatus,
      ...(action === 'RESUME'
        ? {
            failedItems: 0,
            errorCode: null,
            errorMessage: null,
            finishedAt: null,
            retainUntil: null
          }
        : {}),
      ...(action === 'CANCEL' && direct
        ? {
            finishedAt: timestamp,
            retainUntil: new Date(timestamp.getTime() + FAILED_STAGING_RETENTION_MS)
          }
        : {})
    }
  })
  if (changed.count !== 1) throw new ArchiveError('STATE_CONFLICT', '归档任务状态已改变')
  if (action === 'CANCEL' && direct) {
    await transaction.archiveUploaderCatalogItem.updateMany({
      where: {
        OR: [{ lastArchiveImportId: task.id }, { providerKey: task.providerKey, externalId: task.externalId }]
      },
      data: {
        lastArchiveImportId: task.id,
        lastOutcome: 'CANCELLED',
        lastOutcomeAt: timestamp,
        lastErrorCode: 'CANCELLED',
        lastErrorMessage: 'Archive import cancelled before execution'
      }
    })
  }
  await writeJobEvent(transaction, {
    jobId: task.systemJobId,
    type:
      action === 'CANCEL'
        ? direct
          ? 'job.cancelled'
          : 'job.cancel_requested'
        : action === 'PAUSE'
          ? 'job.pause_requested'
          : 'job.queued',
    level: action === 'RESUME' ? 'INFO' : 'WARN',
    attempt: task.systemJob.attempt,
    message: `${action.toLowerCase()} archive import`,
    data: action === 'RESUME' ? { reason: 'RESUME' } : null
  })
  if (action === 'PAUSE' && direct) {
    await writeJobEvent(transaction, {
      jobId: task.systemJobId,
      type: 'job.paused',
      level: 'WARN',
      attempt: task.systemJob.attempt,
      message: 'Archive import paused before execution'
    })
  }
  return { result: 'APPLIED', relatedId: task.systemJobId }
}

async function recoverTaskAction(
  transaction: Prisma.TransactionClient,
  taskId: string,
  action: z.infer<typeof archiveTaskActionManySchema>['action']
): Promise<ArchiveBulkTargetResult | null> {
  const task = await transaction.archiveImport.findUnique({ where: { id: taskId } })
  return task ? recoverAppliedArchiveTaskAction(task, action) : null
}

function invalidTaskState(status: string, action: string): ArchiveBulkTargetResult {
  return { result: 'SKIPPED', code: 'INVALID_STATE', message: `状态 ${status} 不允许执行 ${action}` }
}

function resetArchiveImportItem(): Prisma.ArchiveImportItemUpdateManyMutationInput {
  return {
    status: 'PENDING',
    attempts: 0,
    errorCode: null,
    errorMessage: null,
    errorStage: null,
    remoteHost: null,
    startedAt: null,
    finishedAt: null
  }
}

function taskProgress(completed: number, total: number): number {
  return Math.max(1, Math.min(95, Math.round((completed / Math.max(total, 1)) * 90) + 5))
}

async function lockUploaderCatalogImport(
  transaction: {
    $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  },
  archiveImport: { providerKey: string; externalId: string; canonicalUrl: string }
) {
  const keys = [
    archiveUploaderIdentityLockKey(archiveImport.providerKey, archiveImport.externalId),
    archiveUploaderUrlLockKey(archiveImport.canonicalUrl)
  ].sort()
  for (const key of keys) {
    await transaction.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock($1::integer, hashtext($2::text))::text AS "lock"',
      ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE,
      key
    )
  }
}

function buildArchiveTaskWireSelect(attributionWhere: Prisma.ArchiveIntakeItemWhereInput) {
  return {
    id: true,
    providerKey: true,
    externalId: true,
    submittedUrl: true,
    normalizedMetadata: true,
    status: true,
    requestedQuality: true,
    selectedQuality: true,
    decisionCode: true,
    totalItems: true,
    completedItems: true,
    failedItems: true,
    warning: true,
    errorCode: true,
    errorMessage: true,
    createdAt: true,
    startedAt: true,
    finishedAt: true,
    retainUntil: true,
    publishedArtwork: { select: { id: true, title: true, deletedAt: true, archiveLifecycleState: true } },
    publishedRevision: { select: { id: true } },
    systemJob: {
      select: {
        id: true,
        executionLane: true,
        status: true,
        progress: true,
        message: true,
        attempt: true,
        heartbeatAt: true
      }
    },
    intakeItems: {
      where: attributionWhere,
      take: 1,
      orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
      select: { submissionId: true, resolutionKind: true }
    }
  } satisfies Prisma.ArchiveImportSelect
}

type ArchiveTaskWire = Prisma.ArchiveImportGetPayload<{ select: ReturnType<typeof buildArchiveTaskWireSelect> }>

function serializeTask(task: ArchiveTaskWire) {
  const itemProgress = taskProgress(task.completedItems, task.totalItems)
  const progress = ['RUNNING', 'PAUSED'].includes(task.status)
    ? Math.max(task.systemJob.progress, itemProgress)
    : task.systemJob.progress
  const message =
    task.status === 'RUNNING' && ['RUNNING', 'PAUSING'].includes(task.systemJob.status)
      ? `Downloaded ${task.completedItems}/${task.totalItems}`
      : archiveWireErrorMessage(task.errorCode, task.systemJob.message)
  return {
    id: task.id,
    systemJobId: task.systemJob.id,
    providerKey: task.providerKey,
    externalId: task.externalId,
    submittedUrl: redactArchiveUrl(task.submittedUrl),
    title: nestedTitle(task.normalizedMetadata),
    status: task.status,
    requestedQuality: task.requestedQuality,
    selectedQuality: task.selectedQuality,
    decisionCode: task.decisionCode,
    progress,
    message,
    errorCode: task.errorCode,
    errorMessage: archiveWireErrorMessage(task.errorCode, task.errorMessage),
    warning: redactArchiveText(task.warning),
    totalItems: task.totalItems,
    completedItems: task.completedItems,
    failedItems: task.failedItems,
    attempt: task.systemJob.attempt,
    executionLane: task.systemJob.executionLane,
    systemJobStatus: task.systemJob.status,
    heartbeatAt: task.systemJob.heartbeatAt,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    retainUntil: task.retainUntil,
    publishedArtwork: task.publishedArtwork,
    revisionId: task.publishedRevision?.id ?? null,
    submissionId: task.intakeItems[0]?.submissionId ?? null,
    kind: task.intakeItems[0]?.resolutionKind ?? null
  }
}

function nestedTitle(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const titles = value.titles
  if (!titles || typeof titles !== 'object' || Array.isArray(titles)) return null
  return typeof titles.display === 'string' ? titles.display : null
}

function encodeTaskCursor(createdAt: Date, id: string) {
  return Buffer.from(JSON.stringify({ version: 1, createdAt: createdAt.toISOString(), id })).toString('base64url')
}

function decodeTaskCursor(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      version: number
      createdAt: string
      id: string
    }
    const createdAt = new Date(parsed.createdAt)
    if (parsed.version !== 1 || !parsed.id || Number.isNaN(createdAt.getTime())) throw new Error('Invalid cursor')
    return { createdAt, id: parsed.id }
  } catch (error) {
    throw new ArchiveError('INVALID_URL', '归档任务分页游标无效', { cause: error })
  }
}

function getDatabase(dependencies: ArchiveTaskServiceDependencies) {
  return dependencies.database ?? (prisma as unknown as PrismaClient)
}
