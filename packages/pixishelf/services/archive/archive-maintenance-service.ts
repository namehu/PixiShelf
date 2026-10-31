import { createArchiveArtworkMaintenanceRequest } from '@pixishelf/job-executors/artwork-delete'
import {
  ArtworkDedupOperationError,
  lockCreatorCatalog,
  findUnresolvedArchiveStagingCleanup,
  assertNoArtworkDedupUrlHold,
  assertArtworkDedupWritable,
  assertNoArtworkDedupArchiveSourceHold,
  type Prisma
} from '@pixishelf/db'
import { randomUUID } from 'node:crypto'
import { archiveMaintenancePayloadSchema, ARCHIVE_COVERAGE_DEFINITION_VERSION } from '@pixishelf/job-contracts'
import type { PrismaClientSingleton } from '@/lib/prisma'
import { prisma } from '@/lib/prisma'
import { writeJobEvent } from '@/services/background-task/job-event-service'
import { ArchiveError } from './errors'
import { ARCHIVE_PUBLISH_ADVISORY_LOCK_ID } from './archive-coordination'
import type { ArchiveTransactionClient } from './relationships'

const ACTIVE_MAINTENANCE_JOB_STATUSES = ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] as const

export type {
  ArchiveArtworkMaintenanceAction,
  ArchiveArtworkMaintenanceRequest,
  ArchiveArtworkMaintenanceResult
} from '@pixishelf/job-executors/artwork-delete'
import type {
  ArchiveArtworkMaintenanceAction,
  ArchiveArtworkMaintenanceRequest,
  ArchiveArtworkMaintenanceResult
} from '@pixishelf/job-executors/artwork-delete'

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

  return dependencies.database.$transaction((transaction) =>
    requestArchiveArtworkMaintenanceInTransaction(input, transaction as ArchiveTransactionClient, dependencies.now)
  )
}

const sharedRequestArchiveArtworkMaintenance = createArchiveArtworkMaintenanceRequest({
  ArchiveError: ArchiveError as Parameters<typeof createArchiveArtworkMaintenanceRequest>[0]['ArchiveError'],
  writeJobEvent
})

export function requestArchiveArtworkMaintenanceInTransaction(
  input: ArchiveArtworkMaintenanceRequest,
  tx: ArchiveTransactionClient,
  now: () => Date = () => new Date()
) {
  return sharedRequestArchiveArtworkMaintenance(input, tx as unknown as Prisma.TransactionClient, now)
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
    await lockCreatorCatalog(tx as unknown as Prisma.TransactionClient)
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const archiveImport = await tx.archiveImport.findUnique({
      where: { id: input.archiveImportId },
      include: { systemJob: true }
    })
    if (!archiveImport) throw new ArchiveError('INTERNAL', '归档任务不存在')
    await assertNoArtworkDedupArchiveSourceHold(tx as unknown as Prisma.TransactionClient, archiveImport).catch(
      throwMaintenanceGuardError
    )
    if (input.expectedSystemJobId && archiveImport.systemJobId !== input.expectedSystemJobId) {
      throw stateConflict('归档任务状态已改变，请刷新后重试')
    }
    if (!['PENDING', 'PAUSED', 'FAILED', 'CANCELLED'].includes(archiveImport.status)) {
      throw stateConflict('归档任务当前状态不允许清理暂存文件')
    }

    const publicationClaim = await tx.mediaContentPathWrite.findFirst({
      where: {
        status: { in: ['ACTIVE', 'READY', 'RECOVERY_REQUIRED'] },
        OR: [{ jobId: archiveImport.systemJobId }, { sessionId: `archive-publish:${archiveImport.id}` }]
      },
      select: { id: true }
    })
    if (publicationClaim) throw stateConflict('归档发布仍有未解决的媒体写入，请先恢复原发布任务，再清理暂存文件')

    const cleanupClaim = await findUnresolvedArchiveStagingCleanup(
      tx as unknown as Prisma.TransactionClient,
      archiveImport.id
    )
    if (cleanupClaim) {
      throw stateConflict(
        `原暂存清理仍有未解决声明，请通过原任务恢复入口续行（${cleanupClaim.jobId ?? cleanupClaim.sessionId}）`
      )
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
        definitionVersion: ARCHIVE_COVERAGE_DEFINITION_VERSION,
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
    await lockCreatorCatalog(tx as unknown as Prisma.TransactionClient)
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    await assertNoArtworkDedupUrlHold(tx as unknown as Prisma.TransactionClient, { artworkId: input.artworkId })
      .catch(throwMaintenanceGuardError)
      .catch(throwMaintenanceGuardError)
    await assertArtworkDedupWritable(tx as unknown as Prisma.TransactionClient, {
      artworkId: input.artworkId,
      kind: 'DELETE'
    })
      .catch(throwMaintenanceGuardError)
      .catch(throwMaintenanceGuardError)
    const artwork = await tx.artwork.findUnique({
      where: { id: input.artworkId },
      include: {
        archiveRevisions: { where: { retiredAt: null }, include: { archiveImport: { select: { systemJobId: true } } } }
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
        definitionVersion: ARCHIVE_COVERAGE_DEFINITION_VERSION,
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

function stateConflict(message: string): ArchiveError {
  return new ArchiveError('STATE_CONFLICT', message, { recoverable: true })
}

function throwMaintenanceGuardError(error: unknown): never {
  if (
    error instanceof ArtworkDedupOperationError &&
    ['ARTWORK_CLAIMED', 'URL_HELD', 'SOURCE_HELD'].includes(error.code)
  ) {
    throw stateConflict('作品或归档来源正在去重维护，请稍后重试')
  }
  throw error
}
