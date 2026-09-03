import { randomUUID } from 'node:crypto'
import { archiveMaintenancePayloadSchema, JOB_DEFINITION_VERSION } from '@pixishelf/job-contracts'
import type { PrismaClientSingleton } from '@/lib/prisma'
import { prisma } from '@/lib/prisma'
import { writeJobEvent } from '@/services/background-task/job-event-service'
import { ArchiveError } from './errors'
import { ARCHIVE_PUBLISH_ADVISORY_LOCK_ID } from './archive-coordination'
import type { ArchiveTransactionClient } from './relationships'

const ARCHIVE_TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVE_MAINTENANCE_JOB_STATUSES = ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] as const

export type ArchiveArtworkMaintenanceAction = 'TRASH_ARCHIVE' | 'RESTORE_ARCHIVE'

export interface ArchiveArtworkMaintenanceRequest {
  artworkId: number
  action: ArchiveArtworkMaintenanceAction
  requestedByUserId: string | null
  parentJobId?: string | null
  requestedAt?: Date
}

export interface ArchiveArtworkMaintenanceResult {
  artworkId: number
  lifecycleState: 'ACTIVE' | 'TRASHING' | 'TRASHED' | 'RESTORING'
  jobId: string | null
  reused: boolean
}

export interface ArchiveStagingCleanupRequest {
  archiveImportId: string
  requestedByUserId: string | null
  expectedSystemJobId?: string
  requestedAt?: Date
}

export interface ArchiveStagingCleanupResult {
  archiveImportId: string
  jobId: string
  reused: boolean
}

export interface ArchivePurgeMaintenanceRequest {
  artworkId: number
  requestedByUserId: string | null
  parentJobId?: string | null
  requestedAt?: Date
}

export interface ArchivePurgeMaintenanceResult {
  artworkId: number
  jobId: string
  reused: boolean
}

interface ArchiveMaintenanceServiceDependencies {
  database: Pick<PrismaClientSingleton, '$transaction'>
  now: () => Date
}

const defaultDependencies: ArchiveMaintenanceServiceDependencies = {
  database: prisma,
  now: () => new Date()
}

/**
 * Records a durable archive lifecycle intent and materializes its writer-lane job in one transaction.
 * File movement is deliberately left to ARCHIVE_MAINTENANCE after this transaction commits.
 */
export async function requestArchiveArtworkMaintenance(
  input: ArchiveArtworkMaintenanceRequest,
  dependencies: ArchiveMaintenanceServiceDependencies = defaultDependencies
): Promise<ArchiveArtworkMaintenanceResult> {
  if (!Number.isSafeInteger(input.artworkId) || input.artworkId <= 0) {
    throw new ArchiveError('INTERNAL', '归档作品标识无效')
  }
  if (input.requestedByUserId !== null && !input.requestedByUserId.trim()) {
    throw stateConflict('归档维护命令需要已认证的管理员')
  }

  return dependencies.database.$transaction(async (transaction) => {
    const tx = transaction as ArchiveTransactionClient
    // Publication, lifecycle intent, and maintenance materialization share this lock so an update cannot publish
    // between the final active-import check and the TRASHING/RESTORING transition.
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const artwork = await tx.artwork.findUnique({
      where: { id: input.artworkId },
      include: {
        archiveRevisions: {
          include: {
            externalRef: true,
            archiveImport: { select: { systemJobId: true } }
          }
        }
      }
    })
    if (!artwork || artwork.createdVia !== 'URL_ARCHIVE') {
      throw new ArchiveError('INTERNAL', '只能维护 URL 归档作品')
    }
    if (artwork.archiveRevisions.length === 0) {
      throw new ArchiveError('INTERNAL', '作品缺少归档版本')
    }
    const requestedAt = input.requestedAt ?? dependencies.now()
    if (input.action === 'RESTORE_ARCHIVE' && (await findActivePurgeJob(tx, artwork.id))) {
      // RESTORE 与 PURGE 共享同一作品实体，任何未完成的永久清理任务都阻塞恢复，避免并发互相翻转状态。
      throw stateConflict('作品正在永久清理，不能恢复')
    }
    if (
      input.action === 'RESTORE_ARCHIVE' &&
      artwork.archiveRevisions.some(
        (revision) => revision.purgeAfter && revision.purgeAfter.getTime() <= requestedAt.getTime()
      )
    ) {
      // 过了保留期限意味着应进入永久清理路径，恢复入口在该时间点上拒绝执行。
      throw stateConflict('作品保留期已结束，不能再恢复')
    }

    const pendingState = input.action === 'TRASH_ARCHIVE' ? 'TRASHING' : 'RESTORING'
    if (artwork.archiveLifecycleState === pendingState) {
      const activeJob = await findActiveArtworkMaintenanceJob(tx, input.action, artwork.id)
      if (activeJob) {
        return {
          artworkId: artwork.id,
          lifecycleState: pendingState,
          jobId: activeJob.id,
          reused: true
        }
      }
    }

    if (input.action === 'TRASH_ARCHIVE') {
      if (artwork.archiveLifecycleState === 'RESTORING') throw stateConflict('作品正在恢复，请稍后再删除')
      if (artwork.archiveLifecycleState === 'TRASHED') {
        if (!artwork.deletedAt) throw stateConflict('作品回收站状态不一致')
        return {
          artworkId: artwork.id,
          lifecycleState: 'TRASHED',
          jobId: null,
          reused: true
        }
      }
      if (!['ACTIVE', 'TRASHING'].includes(artwork.archiveLifecycleState)) {
        throw stateConflict('作品当前状态不允许移入回收站')
      }
      if (artwork.archiveLifecycleState === 'ACTIVE' && artwork.deletedAt) {
        throw stateConflict('作品删除状态不一致')
      }
    } else {
      if (artwork.archiveLifecycleState === 'ACTIVE') throw stateConflict('作品不在归档回收站中')
      if (artwork.archiveLifecycleState === 'TRASHING') throw stateConflict('作品仍在移入回收站，请稍后再恢复')
      if (!['TRASHED', 'RESTORING'].includes(artwork.archiveLifecycleState)) {
        throw stateConflict('作品当前状态不允许恢复')
      }
      if (!artwork.deletedAt || artwork.archiveRevisions.some((revision) => !revision.trashPath)) {
        throw stateConflict('作品回收站状态不完整，暂时不能恢复')
      }
    }

    for (const identity of uniqueArchiveIdentities(artwork.archiveRevisions)) {
      const activeImport = await tx.archiveImport.findFirst({
        where: {
          providerKey: identity.providerKey,
          externalId: identity.externalId,
          status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] }
        },
        select: { id: true }
      })
      if (activeImport) throw stateConflict('该作品有进行中的归档更新，暂时不能删除或恢复')
    }

    const intentAt =
      artwork.archiveLifecycleState === pendingState
        ? nextArchiveMaintenanceIntentAt(requestedAt, artwork.updatedAt)
        : requestedAt
    if (input.action === 'TRASH_ARCHIVE') {
      const deletedAt = artwork.deletedAt ?? intentAt
      for (const revision of artwork.archiveRevisions) {
        await tx.archiveRevision.update({
          where: { id: revision.id },
          data: {
            trashPath: revision.trashPath ?? buildArchiveMaintenanceTrashPath(artwork.id, revision.id),
            trashedAt: revision.trashedAt ?? deletedAt,
            purgeAfter: revision.purgeAfter ?? new Date(deletedAt.getTime() + ARCHIVE_TRASH_RETENTION_MS)
          }
        })
      }
      const changed = await tx.artwork.updateMany({
        where: {
          id: artwork.id,
          archiveLifecycleState: artwork.archiveLifecycleState,
          ...(artwork.deletedAt ? { deletedAt: artwork.deletedAt } : { deletedAt: null })
        },
        data: { deletedAt, archiveLifecycleState: 'TRASHING', updatedAt: intentAt }
      })
      if (changed.count !== 1) throw stateConflict('作品状态已改变，未能开始删除')
    } else {
      const changed = await tx.artwork.updateMany({
        where: { id: artwork.id, archiveLifecycleState: artwork.archiveLifecycleState, deletedAt: { not: null } },
        data: { archiveLifecycleState: 'RESTORING', updatedAt: intentAt }
      })
      if (changed.count !== 1) throw stateConflict('作品状态已改变，未能开始恢复')
    }

    const payload = archiveMaintenancePayloadSchema.parse({ action: input.action, artworkId: artwork.id })
    const jobId = randomUUID()
    const parentJobId = input.parentJobId ?? inferCurrentArchiveJobId(artwork.archiveRevisions)
    await tx.systemJob.create({
      data: {
        id: jobId,
        type: 'ARCHIVE_MAINTENANCE',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: JOB_DEFINITION_VERSION,
        status: 'PENDING',
        triggerSource: input.requestedByUserId === null ? 'SYSTEM' : 'MANUAL',
        requestedByUserId: input.requestedByUserId,
        parentJobId,
        idempotencyKey: archiveMaintenanceIdempotencyKey(input.action, artwork.id, intentAt),
        payload,
        queuePriority: 20,
        effectivePriority: 20,
        availableAt: intentAt,
        maxAttempts: 3,
        progress: 0,
        message: input.action === 'TRASH_ARCHIVE' ? '将归档作品移入回收站' : '从回收站恢复归档作品'
      }
    })
    await writeJobEvent(tx as unknown as Parameters<typeof writeJobEvent>[0], {
      jobId,
      type: 'job.queued',
      attempt: 0,
      message: input.action === 'TRASH_ARCHIVE' ? '将归档作品移入回收站' : '从回收站恢复归档作品',
      data: { action: input.action, artworkId: artwork.id }
    })
    return {
      artworkId: artwork.id,
      lifecycleState: pendingState,
      jobId,
      reused: false
    }
  })
}

/**
 * Persists or advances a staging-cleanup intent before queuing its file-system executor.
 * Automatic reconciliation passes a null user and receives a SYSTEM-triggered child job.
 */
export async function requestArchiveStagingCleanup(
  input: ArchiveStagingCleanupRequest,
  dependencies: ArchiveMaintenanceServiceDependencies = defaultDependencies
): Promise<ArchiveStagingCleanupResult> {
  if (!input.archiveImportId.trim()) throw new ArchiveError('INTERNAL', '归档任务标识无效')
  if (input.requestedByUserId !== null && !input.requestedByUserId.trim()) {
    throw stateConflict('归档维护命令需要已认证的管理员')
  }

  return dependencies.database.$transaction(async (transaction) => {
    const tx = transaction as ArchiveTransactionClient
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const archiveImport = await tx.archiveImport.findUnique({
      where: { id: input.archiveImportId },
      include: { systemJob: true }
    })
    if (!archiveImport) throw new ArchiveError('INTERNAL', '归档任务不存在')
    if (input.expectedSystemJobId && archiveImport.systemJobId !== input.expectedSystemJobId) {
      throw stateConflict('归档任务状态已改变，请刷新后重试')
    }
    if (!['PENDING', 'PAUSED', 'FAILED', 'CANCELLED'].includes(archiveImport.status)) {
      throw stateConflict('归档任务当前状态不允许清理暂存文件')
    }

    const activeJob = await findActiveStagingCleanupJob(tx, archiveImport.id)
    if (activeJob) return { archiveImportId: archiveImport.id, jobId: activeJob.id, reused: true }

    const requestedAt = input.requestedAt ?? dependencies.now()
    const intentAt = archiveImport.cleanupRequestedAt
      ? nextArchiveMaintenanceIntentAt(requestedAt, archiveImport.cleanupRequestedAt)
      : requestedAt
    const changed = await tx.archiveImport.updateMany({
      where: {
        id: archiveImport.id,
        status: archiveImport.status,
        cleanupRequestedAt: archiveImport.cleanupRequestedAt
      },
      data: { cleanupRequestedAt: intentAt, updatedAt: intentAt }
    })
    if (changed.count !== 1) throw stateConflict('暂存清理状态已改变，请刷新后重试')

    const payload = archiveMaintenancePayloadSchema.parse({
      action: 'CLEAN_STAGING',
      archiveImportId: archiveImport.id
    })
    const jobId = randomUUID()
    await tx.systemJob.create({
      data: {
        id: jobId,
        type: 'ARCHIVE_MAINTENANCE',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: JOB_DEFINITION_VERSION,
        status: 'PENDING',
        triggerSource: input.requestedByUserId === null ? 'SYSTEM' : 'MANUAL',
        requestedByUserId: input.requestedByUserId,
        parentJobId: archiveImport.systemJobId,
        idempotencyKey: archiveMaintenanceIdempotencyKey('CLEAN_STAGING', archiveImport.id, intentAt),
        payload,
        queuePriority: 0,
        effectivePriority: 0,
        availableAt: intentAt,
        maxAttempts: 3,
        progress: 0,
        message: '清理归档暂存文件'
      }
    })
    await writeJobEvent(tx as unknown as Parameters<typeof writeJobEvent>[0], {
      jobId,
      type: 'job.queued',
      attempt: 0,
      message: '清理归档暂存文件',
      data: { action: payload.action, archiveImportId: archiveImport.id }
    })
    return { archiveImportId: archiveImport.id, jobId, reused: false }
  })
}

/** Materializes permanent trash removal only after every archived revision has reached its retention deadline. */
export async function requestArchivePurgeMaintenance(
  input: ArchivePurgeMaintenanceRequest,
  dependencies: ArchiveMaintenanceServiceDependencies = defaultDependencies
): Promise<ArchivePurgeMaintenanceResult> {
  if (!Number.isSafeInteger(input.artworkId) || input.artworkId <= 0) {
    throw new ArchiveError('INTERNAL', '归档作品标识无效')
  }
  if (input.requestedByUserId !== null && !input.requestedByUserId.trim()) {
    throw stateConflict('归档维护命令需要已认证的管理员')
  }

  return dependencies.database.$transaction(async (transaction) => {
    const tx = transaction as ArchiveTransactionClient
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const artwork = await tx.artwork.findUnique({
      where: { id: input.artworkId },
      include: {
        archiveRevisions: { include: { archiveImport: { select: { systemJobId: true } } } }
      }
    })
    if (!artwork || artwork.createdVia !== 'URL_ARCHIVE') {
      throw new ArchiveError('INTERNAL', '只能永久清理 URL 归档作品')
    }
    const requestedAt = input.requestedAt ?? dependencies.now()
    // 永久清理只允许在 TRASHED 且所有 revision 的保留窗口到期后触发，防止与恢复流程重叠。
    if (
      artwork.archiveLifecycleState !== 'TRASHED' ||
      !artwork.deletedAt ||
      artwork.archiveRevisions.length === 0 ||
      artwork.archiveRevisions.some(
        (revision) =>
          !revision.trashPath || !revision.purgeAfter || revision.purgeAfter.getTime() > requestedAt.getTime()
      )
    ) {
      throw stateConflict('作品尚未达到永久清理条件')
    }

    const activeJob = await findActivePurgeJob(tx, artwork.id)
    if (activeJob) return { artworkId: artwork.id, jobId: activeJob.id, reused: true }

    const intentAt = nextArchiveMaintenanceIntentAt(requestedAt, artwork.updatedAt)
    const changed = await tx.artwork.updateMany({
      where: {
        id: artwork.id,
        archiveLifecycleState: 'TRASHED',
        deletedAt: artwork.deletedAt,
        updatedAt: artwork.updatedAt
      },
      data: { updatedAt: intentAt }
    })
    if (changed.count !== 1) throw stateConflict('作品状态已改变，未能开始永久清理')

    const payload = archiveMaintenancePayloadSchema.parse({ action: 'PURGE_ARCHIVE', artworkId: artwork.id })
    const jobId = randomUUID()
    const currentRevision = artwork.archiveRevisions.find((revision) => revision.isCurrent)
    await tx.systemJob.create({
      data: {
        id: jobId,
        type: 'ARCHIVE_MAINTENANCE',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: JOB_DEFINITION_VERSION,
        status: 'PENDING',
        triggerSource: input.requestedByUserId === null ? 'SYSTEM' : 'MANUAL',
        requestedByUserId: input.requestedByUserId,
        parentJobId: input.parentJobId ?? currentRevision?.archiveImport?.systemJobId ?? null,
        idempotencyKey: archiveMaintenanceIdempotencyKey('PURGE_ARCHIVE', artwork.id, intentAt),
        payload,
        queuePriority: input.requestedByUserId === null ? 100 : 20,
        effectivePriority: input.requestedByUserId === null ? 100 : 20,
        availableAt: intentAt,
        maxAttempts: 3,
        progress: 0,
        message: '永久清理归档作品回收站内容'
      }
    })
    await writeJobEvent(tx as unknown as Parameters<typeof writeJobEvent>[0], {
      jobId,
      type: 'job.queued',
      attempt: 0,
      message: '永久清理归档作品回收站内容',
      data: { action: payload.action, artworkId: artwork.id }
    })
    return { artworkId: artwork.id, jobId, reused: false }
  })
}

async function findActiveArtworkMaintenanceJob(
  transaction: ArchiveTransactionClient,
  action: ArchiveArtworkMaintenanceAction,
  artworkId: number
) {
  return transaction.systemJob.findFirst({
    where: {
      type: 'ARCHIVE_MAINTENANCE',
      status: { in: [...ACTIVE_MAINTENANCE_JOB_STATUSES] },
      payload: { equals: { action, artworkId } }
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  })
}

async function findActiveStagingCleanupJob(transaction: ArchiveTransactionClient, archiveImportId: string) {
  return transaction.systemJob.findFirst({
    where: {
      type: 'ARCHIVE_MAINTENANCE',
      status: { in: [...ACTIVE_MAINTENANCE_JOB_STATUSES] },
      payload: { equals: { action: 'CLEAN_STAGING', archiveImportId } }
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  })
}

async function findActivePurgeJob(transaction: ArchiveTransactionClient, artworkId: number) {
  return transaction.systemJob.findFirst({
    where: {
      type: 'ARCHIVE_MAINTENANCE',
      status: { in: [...ACTIVE_MAINTENANCE_JOB_STATUSES] },
      payload: { equals: { action: 'PURGE_ARCHIVE', artworkId } }
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  })
}

function uniqueArchiveIdentities(
  revisions: Array<{ externalRef: { providerKey: string; externalId: string } }>
): Array<{ providerKey: string; externalId: string }> {
  const identities = new Map<string, { providerKey: string; externalId: string }>()
  for (const revision of revisions) {
    const identity = revision.externalRef
    identities.set(`${identity.providerKey}\u0000${identity.externalId}`, identity)
  }
  return [...identities.values()]
}

function inferCurrentArchiveJobId(
  revisions: Array<{ isCurrent: boolean; archiveImport: { systemJobId: string } | null }>
): string | null {
  return revisions.find((revision) => revision.isCurrent)?.archiveImport?.systemJobId ?? null
}

function archiveMaintenanceIdempotencyKey(action: 'CLEAN_STAGING', targetId: string, intentAt: Date): string
function archiveMaintenanceIdempotencyKey(
  action: ArchiveArtworkMaintenanceAction | 'PURGE_ARCHIVE',
  targetId: number,
  intentAt: Date
): string
function archiveMaintenanceIdempotencyKey(
  action: 'CLEAN_STAGING' | ArchiveArtworkMaintenanceAction | 'PURGE_ARCHIVE',
  targetId: string | number,
  intentAt: Date
): string {
  return `archive-maintenance:${action}:${targetId}:${intentAt.getTime()}`
}

// +1ms 前移仅用于形成下一轮时间片；当旧 terminal job 已结束后，
// 让本轮 maintenance 使用新的 intent 时间与幂等键，避免与旧 terminal 轮次混用。
function nextArchiveMaintenanceIntentAt(now: Date, previous: Date): Date {
  return new Date(Math.max(now.getTime(), previous.getTime() + 1))
}

function buildArchiveMaintenanceTrashPath(artworkId: number, revisionId: string): string {
  return `.trash/archive/${artworkId}/${revisionId}`
}

function stateConflict(message: string): ArchiveError {
  return new ArchiveError('STATE_CONFLICT', message, { recoverable: true })
}
