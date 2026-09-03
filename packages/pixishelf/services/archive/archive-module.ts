import { randomUUID } from 'node:crypto'
import {
  ARCHIVE_IMPORT_DEFINITION_VERSION,
  ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE,
  archiveImportV2PayloadSchema,
  archiveUploaderIdentityLockKey,
  archiveUploaderUrlLockKey
} from '@pixishelf/job-contracts'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { writeJobEvent } from '@/services/background-task/job-event-service'
import { redactArchiveUrl } from './archive-redaction'
import { ArchiveError } from './errors'
import { ARCHIVE_PUBLISH_ADVISORY_LOCK_ID } from './archive-coordination'
import type { ArchiveItemStatusFilter, ArchiveTaskAction } from './types'
import { requestArchiveArtworkMaintenance, requestArchiveStagingCleanup } from './archive-maintenance-service'
import { archiveImportDefaultTagIdsForRetry } from './archive-job-payload'

const FAILED_STAGING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const ARCHIVE_IMPORT_JOB_TYPE = 'ARCHIVE_IMPORT'

type ArchiveControlTaskRecord = Prisma.ArchiveImportGetPayload<{ include: { systemJob: true } }>

export class ArchiveModule {
  async listTaskItems(
    taskId: string,
    cursor: number | null | undefined = null,
    limit = 50,
    status: ArchiveItemStatusFilter = 'ALL'
  ) {
    const normalizedLimit = Math.min(Math.max(limit, 1), 100)
    const task = await prisma.archiveImport.findUnique({
      where: { id: taskId },
      select: { id: true, totalItems: true }
    })
    if (!task) throw new ArchiveError('INTERNAL', '归档任务不存在')

    const rows = await prisma.archiveImportItem.findMany({
      where: {
        archiveImportId: task.id,
        ...(cursor == null ? {} : { pageIndex: { gt: cursor } }),
        ...(status === 'ALL' ? {} : { status })
      },
      orderBy: { pageIndex: 'asc' },
      take: normalizedLimit + 1,
      select: {
        id: true,
        pageIndex: true,
        sourcePageUrl: true,
        expectedFilename: true,
        status: true,
        attempts: true,
        byteCount: true,
        mimeType: true,
        quality: true,
        width: true,
        height: true,
        errorCode: true,
        errorMessage: true,
        errorStage: true,
        remoteHost: true,
        startedAt: true,
        finishedAt: true,
        updatedAt: true
      }
    })
    const hasNextPage = rows.length > normalizedLimit
    const items = hasNextPage ? rows.slice(0, normalizedLimit) : rows

    return {
      totalItems: task.totalItems,
      nextCursor: hasNextPage ? items.at(-1)?.pageIndex : undefined,
      items: items.map((item) => ({
        id: item.id,
        pageIndex: item.pageIndex,
        sourcePageUrl: redactArchiveUrl(item.sourcePageUrl),
        expectedFilename: item.expectedFilename,
        status: item.status,
        attempts: item.attempts,
        byteCount: item.byteCount?.toString() ?? null,
        mimeType: item.mimeType,
        quality: item.quality,
        width: item.width,
        height: item.height,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage ? '图片处理失败，请根据错误码与失败阶段排查。' : null,
        errorStage: item.errorStage,
        remoteHost: item.remoteHost,
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        updatedAt: item.updatedAt
      }))
    }
  }

  async getTaskItemCounts(taskId: string) {
    const task = await prisma.archiveImport.findUnique({ where: { id: taskId }, select: { id: true } })
    if (!task) throw new ArchiveError('INTERNAL', '归档任务不存在')
    const groups = await prisma.archiveImportItem.groupBy({
      by: ['status'],
      where: { archiveImportId: task.id },
      _count: { _all: true }
    })
    const counts = { all: 0, completed: 0, failed: 0, pending: 0, downloading: 0 }
    for (const group of groups) {
      const count = group._count._all
      counts.all += count
      if (group.status === 'COMPLETED') counts.completed = count
      else if (group.status === 'FAILED') counts.failed = count
      else if (group.status === 'PENDING') counts.pending = count
      else counts.downloading = count
    }
    return counts
  }

  async retryTaskItem(taskId: string, itemId: string, options: { requestedByUserId?: string } = {}) {
    const task = await prisma.archiveImport.findUnique({ where: { id: taskId }, include: { systemJob: true } })
    if (!task) throw new ArchiveError('INTERNAL', '归档任务不存在')
    if (task.status !== 'FAILED' || task.errorCode !== 'PARTIAL_FAILURE' || task.failedItems <= 0) {
      throw stateConflict('只有部分失败的终态任务可以重试单张图片')
    }
    const item = await prisma.archiveImportItem.findFirst({
      where: { id: itemId, archiveImportId: task.id },
      select: { id: true, status: true }
    })
    if (!item || item.status !== 'FAILED') throw stateConflict('该图片当前不是可重试的失败状态')

    return this.retryCentralArchiveImport(task, {
      requestedByUserId: requireCentralRequestedBy(options.requestedByUserId),
      message: 'Retry selected archive media item',
      retryItemId: item.id
    })
  }

  async requestAction(taskId: string, action: ArchiveTaskAction, options: { requestedByUserId?: string } = {}) {
    const task = await prisma.archiveImport.findUnique({ where: { id: taskId }, include: { systemJob: true } })
    if (!task) throw new ArchiveError('INTERNAL', '归档任务不存在')
    const now = new Date()
    // 清理暂存为独立入口：其他动作遇到 cleanupRequestedAt 会被拒绝，避免状态与清理执行器互相覆盖。
    if (task.cleanupRequestedAt && action !== 'DELETE_STAGING') {
      throw stateConflict('暂存目录正在由归档 Worker 清理，请等待清理完成')
    }
    return this.requestCentralAction(task, action, {
      requestedByUserId: requireCentralRequestedBy(options.requestedByUserId),
      now
    })
  }

  private async requestCentralAction(
    task: ArchiveControlTaskRecord,
    action: ArchiveTaskAction,
    options: { requestedByUserId: string; now: Date }
  ) {
    if (action === 'RETRY') {
      assertActionStatus(action, task.status, ['FAILED', 'CANCELLED'])
      return this.retryCentralArchiveImport(task, {
        requestedByUserId: options.requestedByUserId,
        message: 'Retry archive import'
      })
    }
    if (action === 'USE_DISPLAY_QUALITY') {
      assertActionStatus(action, task.status, ['PAUSED', 'FAILED'])
      if (task.status === 'FAILED') {
        return this.retryCentralArchiveImport(task, {
          requestedByUserId: options.requestedByUserId,
          message: 'Retry archive import with display quality',
          useDisplayQuality: true
        })
      }
      await transitionCentralArchiveControl(task, 'RESUME', options.now, { useDisplayQuality: true })
      return archiveMutationAck(task.id)
    }
    if (action === 'PAUSE' || action === 'RESUME' || action === 'CANCEL') {
      await transitionCentralArchiveControl(task, action, options.now)
      return archiveMutationAck(task.id)
    }
    await requestCentralArchiveMaintenance(task, action, options)
    return archiveMutationAck(task.id)
  }

  private async retryCentralArchiveImport(
    task: ArchiveControlTaskRecord,
    options: {
      requestedByUserId: string
      message: string
      retryItemId?: string
      useDisplayQuality?: boolean
    }
  ) {
    const nextJobId = randomUUID()
    const timestamp = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
      const current = await tx.archiveImport.findUnique({ where: { id: task.id }, include: { systemJob: true } })
      if (
        !current ||
        current.systemJobId !== task.systemJobId ||
        !['FAILED', 'CANCELLED', 'PAUSED'].includes(current.status)
      ) {
        throw stateConflict('归档任务状态已改变，请刷新后重试')
      }
      await lockUploaderCatalogImport(tx, current)
      if (options.retryItemId) {
        const item = await tx.archiveImportItem.updateMany({
          where: { id: options.retryItemId, archiveImportId: current.id, status: 'FAILED' },
          data: resetArchiveItemForRetry()
        })
        if (item.count !== 1) throw stateConflict('该图片状态已改变，请刷新后重试')
      } else {
        await tx.archiveImportItem.updateMany({
          where: { archiveImportId: current.id, status: { not: 'COMPLETED' } },
          data: resetArchiveItemForRetry()
        })
      }
      const priority = Math.min(99, Math.max(0, current.systemJob.queuePriority))
      const defaultTagIds = archiveImportDefaultTagIdsForRetry(current.systemJob, current.id)
      await tx.systemJob.create({
        data: {
          id: nextJobId,
          type: ARCHIVE_IMPORT_JOB_TYPE,
          definitionVersion: ARCHIVE_IMPORT_DEFINITION_VERSION,
          status: 'PENDING',
          triggerSource: 'RETRY',
          requestedByUserId: options.requestedByUserId,
          parentJobId: current.systemJobId,
          payload: archiveImportV2PayloadSchema.parse({
            archiveImportId: current.id,
            defaultTagIds
          }),
          queuePriority: priority,
          effectivePriority: priority,
          availableAt: timestamp,
          maxAttempts: current.systemJob.maxAttempts,
          progress: taskProgress(current.completedItems, current.totalItems),
          message: options.message
        }
      })
      const changed = await tx.archiveImport.updateMany({
        where: { id: current.id, systemJobId: current.systemJobId, status: current.status },
        data: {
          systemJobId: nextJobId,
          status: 'PENDING',
          ...(options.useDisplayQuality ? { selectedQuality: 'DISPLAY' as const } : {}),
          decisionCode: null,
          errorCode: null,
          errorMessage: null,
          failedItems: Math.max(0, current.failedItems - (options.retryItemId ? 1 : current.failedItems)),
          finishedAt: null,
          retainUntil: null
        }
      })
      if (changed.count !== 1) throw stateConflict('归档任务状态已改变，请刷新后重试')
      await tx.archiveUploaderCatalogItem.updateMany({
        where: {
          OR: [
            { lastArchiveImportId: current.id },
            { providerKey: current.providerKey, externalId: current.externalId }
          ]
        },
        data: {
          lastArchiveImportId: current.id,
          lastOutcome: 'SUBMITTED',
          lastOutcomeAt: timestamp,
          lastErrorCode: null,
          lastErrorMessage: null
        }
      })
      await writeArchiveJobEvent(tx, {
        jobId: current.systemJobId,
        type: 'job.retry_scheduled',
        attempt: current.systemJob.attempt,
        message: options.message,
        data: { retryJobId: nextJobId }
      })
      await writeArchiveJobEvent(tx, {
        jobId: nextJobId,
        type: 'job.queued',
        attempt: 0,
        message: options.message,
        data: { retryOfJobId: current.systemJobId, archiveImportId: current.id, priority }
      })
    })
    return archiveMutationAck(task.id)
  }
}

export const archiveModule = new ArchiveModule()

async function requestCentralArchiveMaintenance(
  task: ArchiveControlTaskRecord,
  action: Extract<ArchiveTaskAction, 'DELETE_STAGING' | 'DELETE_ARCHIVE' | 'RESTORE_ARCHIVE'>,
  options: { requestedByUserId: string; now: Date }
) {
  if (action === 'DELETE_STAGING') {
    await requestArchiveStagingCleanup({
      archiveImportId: task.id,
      requestedByUserId: options.requestedByUserId,
      expectedSystemJobId: task.systemJobId,
      requestedAt: options.now
    })
    return
  }

  const current = await prisma.archiveImport.findUnique({ where: { id: task.id }, include: { systemJob: true } })
  if (!current || current.systemJobId !== task.systemJobId) {
    throw stateConflict('归档任务状态已改变，请刷新后重试')
  }
  if (!current.publishedArtworkId) throw new ArchiveError('INTERNAL', '任务尚未发布作品')
  await requestArchiveArtworkMaintenance({
    artworkId: current.publishedArtworkId,
    action: action === 'DELETE_ARCHIVE' ? 'TRASH_ARCHIVE' : 'RESTORE_ARCHIVE',
    requestedByUserId: options.requestedByUserId,
    parentJobId: current.systemJobId,
    requestedAt: options.now
  })
}

async function transitionCentralArchiveControl(
  task: ArchiveControlTaskRecord,
  action: 'PAUSE' | 'RESUME' | 'CANCEL',
  now: Date,
  options: { useDisplayQuality?: boolean } = {}
) {
  const recoverablePausedDrift = action === 'RESUME' && task.status === 'RUNNING' && task.systemJob.status === 'PAUSED'
  const allowedImportStatuses =
    action === 'PAUSE'
      ? ['PENDING', 'RUNNING']
      : action === 'RESUME'
        ? recoverablePausedDrift
          ? ['PAUSED', 'RUNNING']
          : ['PAUSED']
        : ['PENDING', 'RUNNING', 'PAUSED']
  assertActionStatus(action, task.status, allowedImportStatuses)

  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const current = await tx.archiveImport.findUnique({ where: { id: task.id }, include: { systemJob: true } })
    if (!current || current.systemJobId !== task.systemJobId || current.status !== task.status) {
      throw stateConflict('归档任务状态已改变，请刷新后重试')
    }
    await lockUploaderCatalogImport(tx, current)

    const running = ['RUNNING', 'PAUSING'].includes(current.systemJob.status)
    const direct = !running
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
    const allowedJobStatuses =
      action === 'PAUSE'
        ? ['PENDING', 'RETRY_WAIT', 'RUNNING']
        : action === 'RESUME'
          ? ['PAUSED']
          : ['PENDING', 'RETRY_WAIT', 'PAUSED', 'RUNNING', 'PAUSING']
    if (!allowedJobStatuses.includes(current.systemJob.status)) {
      throw stateConflict(`任务状态 ${current.systemJob.status} 不允许执行 ${action}`)
    }

    const job = await tx.systemJob.updateMany({
      where: { id: current.systemJobId, status: current.systemJob.status },
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
        ...(action === 'CANCEL' ? { cancelRequestedAt: now } : {}),
        ...(action === 'PAUSE' ? { pauseRequestedAt: now } : {}),
        ...(action === 'RESUME' ? { pauseRequestedAt: null, availableAt: now } : {}),
        ...(direct || action === 'RESUME'
          ? { workerId: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null }
          : {}),
        ...(action === 'CANCEL' && direct ? { finishedAt: now } : {})
      }
    })
    if (job.count !== 1) throw stateConflict('归档任务状态已改变，请刷新后重试')

    if (direct || action === 'RESUME') {
      await tx.jobResourceLease.deleteMany({ where: { ownerJobId: current.systemJobId } })
    }
    if (action === 'RESUME') {
      await tx.archiveImportItem.updateMany({
        where: { archiveImportId: current.id, status: { not: 'COMPLETED' } },
        data: resetArchiveItemForRetry()
      })
    }
    const nextImportStatus =
      action === 'CANCEL'
        ? direct
          ? 'CANCELLED'
          : 'CANCELLING'
        : action === 'PAUSE'
          ? direct
            ? 'PAUSED'
            : 'RUNNING'
          : 'PENDING'
    const archiveImport = await tx.archiveImport.updateMany({
      where: { id: current.id, systemJobId: current.systemJobId, status: current.status },
      data: {
        status: nextImportStatus,
        ...(options.useDisplayQuality ? { selectedQuality: 'DISPLAY' as const, decisionCode: null } : {}),
        ...(action === 'RESUME'
          ? { errorCode: null, errorMessage: null, failedItems: 0, finishedAt: null, retainUntil: null }
          : {}),
        ...(action === 'CANCEL' && direct
          ? { finishedAt: now, retainUntil: new Date(now.getTime() + FAILED_STAGING_RETENTION_MS) }
          : {})
      }
    })
    if (archiveImport.count !== 1) throw stateConflict('归档任务状态已改变，请刷新后重试')
    if (action === 'CANCEL' && direct) {
      await tx.archiveUploaderCatalogItem.updateMany({
        where: {
          OR: [
            { lastArchiveImportId: current.id },
            { providerKey: current.providerKey, externalId: current.externalId }
          ]
        },
        data: {
          lastArchiveImportId: current.id,
          lastOutcome: 'CANCELLED',
          lastOutcomeAt: now,
          lastErrorCode: 'CANCELLED',
          lastErrorMessage: 'Archive import cancelled before execution'
        }
      })
    }

    await writeArchiveJobEvent(tx, {
      jobId: current.systemJobId,
      type:
        action === 'CANCEL'
          ? direct
            ? 'job.cancelled'
            : 'job.cancel_requested'
          : action === 'PAUSE'
            ? 'job.pause_requested'
            : 'job.queued',
      level: action === 'RESUME' ? 'INFO' : 'WARN',
      attempt: current.systemJob.attempt,
      message: `${action.toLowerCase()} archive import`,
      data: action === 'RESUME' ? { reason: 'RESUME' } : null
    })
    if (action === 'PAUSE' && direct) {
      await writeArchiveJobEvent(tx, {
        jobId: current.systemJobId,
        type: 'job.paused',
        level: 'WARN',
        attempt: current.systemJob.attempt,
        message: 'Archive import paused before execution'
      })
    }
  })
}

function resetArchiveItemForRetry(): Prisma.ArchiveImportItemUpdateManyMutationInput {
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

async function lockUploaderCatalogImport(
  transaction: {
    $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  },
  archiveImport: Pick<ArchiveControlTaskRecord, 'providerKey' | 'externalId' | 'canonicalUrl'>
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

function requireCentralRequestedBy(value: string | undefined): string {
  if (!value) throw stateConflict('Central archive command requires an authenticated administrator')
  return value
}

function writeArchiveJobEvent(transaction: unknown, input: Parameters<typeof writeJobEvent>[1]) {
  return writeJobEvent(transaction as Parameters<typeof writeJobEvent>[0], input)
}

function assertActionStatus(action: ArchiveTaskAction, actual: string, allowed: readonly string[]): void {
  if (!allowed.includes(actual)) throw stateConflict(`任务状态 ${actual} 不允许执行 ${action}`)
}

function stateConflict(message: string): ArchiveError {
  return new ArchiveError('STATE_CONFLICT', message, { recoverable: true })
}

function archiveMutationAck(taskId: string): { taskId: string } {
  return { taskId }
}

function taskProgress(completed: number, total: number): number {
  return Math.max(1, Math.min(95, Math.round((completed / Math.max(total, 1)) * 90) + 5))
}
