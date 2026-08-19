import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  archiveMaintenancePayloadSchema,
  JOB_DEFINITION_VERSION,
  type ArchiveMaintenancePayload
} from '@pixishelf/job-contracts'
import type { PrismaClient } from '@pixishelf/db'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  ExecutorDefinition,
  FencedExecutionTransaction,
  JobExecutionOutcome
} from '@pixishelf/job-runtime'
import { ArchiveExecutorError } from './errors.ts'
import {
  buildArchiveStoragePaths,
  pathExists,
  resolveCreatablePathWithinRoot,
  resolveExistingPathWithinRoot
} from './storage.ts'
import type { ArchiveTransaction } from './types.ts'

const ARCHIVE_PUBLISH_ADVISORY_LOCK_ID = 7_341_902_117

type ArchiveMaintenanceContext = ExecutionContext<ArchiveMaintenancePayload, EnqueuedChildJob>
type ArchiveMaintenanceResult =
  | { action: 'CLEAN_STAGING'; archiveImportId: string }
  | { action: 'TRASH_ARCHIVE' | 'RESTORE_ARCHIVE'; artworkId: number }
  | { action: 'PURGE_ARCHIVE'; artworkId: number }
  | { action: 'RECONCILE'; discovered: number; materialized: number; reused: number; skipped: number }

const ACTIVE_MAINTENANCE_JOB_STATUSES = [
  'PENDING',
  'RUNNING',
  'PAUSING',
  'PAUSED',
  'RETRY_WAIT',
  'CANCELLING'
] as const
const RECONCILE_BATCH_SIZE = 200

export interface ArchiveMaintenanceExecutorDependencies {
  database: PrismaClient
  config: { scanRoot: string }
  now?: () => Date
}

export function createArchiveMaintenanceExecutorRegistrations(
  dependencies: ArchiveMaintenanceExecutorDependencies
): ExecutorDefinition<ArchiveMaintenancePayload, ArchiveMaintenanceResult>[] {
  if (!dependencies.config.scanRoot.trim()) throw new Error('Archive maintenance scanRoot is required')
  return [
    {
      jobType: 'ARCHIVE_MAINTENANCE',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: JOB_DEFINITION_VERSION,
      parsePayload: (payload) => archiveMaintenancePayloadSchema.parse(payload),
      execute: (context) => executeArchiveMaintenance(context, dependencies)
    }
  ]
}

export async function executeArchiveMaintenance(
  context: ArchiveMaintenanceContext,
  dependencies: ArchiveMaintenanceExecutorDependencies
): Promise<JobExecutionOutcome<ArchiveMaintenanceResult>> {
  throwIfAborted(context.signal)
  await context.progress({ progress: 5, stage: 'PREPARING', message: 'Preparing archive maintenance' })
  if (context.payload.action === 'CLEAN_STAGING') {
    return executeStagingCleanup(context, context.payload, dependencies)
  }
  if (context.payload.action === 'RECONCILE') {
    return executeArchiveReconcile(context, dependencies)
  }
  if (context.payload.action === 'PURGE_ARCHIVE') {
    return executeArchivePurge(context, context.payload, dependencies)
  }
  return executeArtworkMaintenance(context, context.payload, dependencies)
}

async function executeArchiveReconcile(
  context: ArchiveMaintenanceContext,
  dependencies: ArchiveMaintenanceExecutorDependencies
) {
  const now = (dependencies.now ?? (() => new Date()))()
  // RECONCILE 仅发起修复动作，不执行实际文件/记录落地；它只为每个候选对象补齐子任务意图并入队。
  const candidates = await context.mutateInTransaction<
    ArchiveTransaction,
    {
      staging: Array<{ id: string }>
      artworks: Array<{ id: number; archiveLifecycleState: string }>
    }
  >(async (transaction) => {
    const [staging, artworks] = await Promise.all([
      transaction.archiveImport.findMany({
        where: {
          OR: [
            { cleanupRequestedAt: { not: null } },
            {
              status: { in: ['FAILED', 'CANCELLED'] },
              cleanupRequestedAt: null,
              retainUntil: { lte: now }
            }
          ]
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: RECONCILE_BATCH_SIZE,
        select: { id: true }
      }),
      transaction.artwork.findMany({
        where: {
          createdVia: 'URL_ARCHIVE',
          OR: [
            { archiveLifecycleState: { in: ['TRASHING', 'RESTORING'] } },
            {
              archiveLifecycleState: 'TRASHED',
              deletedAt: { not: null },
              archiveRevisions: { some: { purgeAfter: { lte: now } } }
            }
          ]
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: RECONCILE_BATCH_SIZE,
        select: { id: true, archiveLifecycleState: true }
      })
    ])
    return { staging, artworks }
  })

  const result = {
    action: 'RECONCILE' as const,
    discovered: candidates.staging.length + candidates.artworks.length,
    materialized: 0,
    reused: 0,
    skipped: 0
  }
  let processed = 0
  for (const candidate of candidates.staging) {
    throwIfAborted(context.signal)
    const decision = await prepareStagingReconcileChild(context, candidate.id, now)
    await applyReconcileDecision(context, decision, result)
    processed += 1
    await reportReconcileProgress(context, processed, result.discovered)
  }
  for (const candidate of candidates.artworks) {
    throwIfAborted(context.signal)
    const decision = await prepareArtworkReconcileChild(context, candidate.id, now)
    await applyReconcileDecision(context, decision, result)
    processed += 1
    await reportReconcileProgress(context, processed, result.discovered)
  }

  return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
    await scope.complete({ result, message: 'Archive maintenance reconciliation completed' })
  })
}

type ReconcileDecision =
  | { kind: 'SKIP' }
  | { kind: 'REUSE' }
  | { kind: 'ENQUEUE'; payload: ArchiveMaintenancePayload; idempotencyKey: string }

async function prepareStagingReconcileChild(
  context: ArchiveMaintenanceContext,
  archiveImportId: string,
  now: Date
): Promise<ReconcileDecision> {
  return context.mutateInTransaction<ArchiveTransaction, ReconcileDecision>(async (transaction) => {
    // 与发布路径持统一锁，避免 RECONCILE 读取与下游恢复/发布同时改写同一入库/状态位。
    await lockArchivePublication(transaction)
    const archiveImport = await transaction.archiveImport.findUnique({ where: { id: archiveImportId } })
    if (!archiveImport || !['PENDING', 'PAUSED', 'FAILED', 'CANCELLED'].includes(archiveImport.status)) {
      return { kind: 'SKIP' }
    }
    if (
      !archiveImport.cleanupRequestedAt &&
      (!['FAILED', 'CANCELLED'].includes(archiveImport.status) ||
        !archiveImport.retainUntil ||
        archiveImport.retainUntil.getTime() > now.getTime())
    ) {
      return { kind: 'SKIP' }
    }
    if (await findActiveMaintenanceJob(transaction, { action: 'CLEAN_STAGING', archiveImportId })) {
      return { kind: 'REUSE' }
    }

    const intentAt = archiveImport.cleanupRequestedAt
      ? nextMaintenanceIntentAt(now, archiveImport.cleanupRequestedAt)
      : now
    // 当旧轮次的子任务进入终态后，递增 intentAt 生成新的时间片，避免新一轮 maintenance 与旧的幂等键撞上。
    const changed = await transaction.archiveImport.updateMany({
      where: {
        id: archiveImport.id,
        status: archiveImport.status,
        cleanupRequestedAt: archiveImport.cleanupRequestedAt
      },
      data: { cleanupRequestedAt: intentAt, updatedAt: intentAt }
    })
    if (changed.count !== 1) return { kind: 'SKIP' }
    return {
      kind: 'ENQUEUE',
      payload: { action: 'CLEAN_STAGING', archiveImportId },
      idempotencyKey: maintenanceIdempotencyKey('CLEAN_STAGING', archiveImportId, intentAt)
    }
  })
}

async function prepareArtworkReconcileChild(
  context: ArchiveMaintenanceContext,
  artworkId: number,
  now: Date
): Promise<ReconcileDecision> {
  return context.mutateInTransaction<ArchiveTransaction, ReconcileDecision>(async (transaction) => {
    // RECONCILE 只在此阶段“标记”待办意图并让子任务执行实体变更。
    await lockArchivePublication(transaction)
    const artwork = await transaction.artwork.findUnique({
      where: { id: artworkId },
      include: { archiveRevisions: true }
    })
    if (!artwork || artwork.createdVia !== 'URL_ARCHIVE' || !artwork.deletedAt || artwork.archiveRevisions.length === 0) {
      return { kind: 'SKIP' }
    }
    const action =
      artwork.archiveLifecycleState === 'TRASHING'
        ? 'TRASH_ARCHIVE'
        : artwork.archiveLifecycleState === 'RESTORING'
          ? 'RESTORE_ARCHIVE'
          : artwork.archiveLifecycleState === 'TRASHED'
            ? 'PURGE_ARCHIVE'
            : null
    if (!action) return { kind: 'SKIP' }
    if (artwork.archiveRevisions.some((revision) => !revision.trashPath)) return { kind: 'SKIP' }
    if (
      action === 'PURGE_ARCHIVE' &&
      artwork.archiveRevisions.some(
        (revision) => !revision.purgeAfter || revision.purgeAfter.getTime() > now.getTime()
      )
    ) {
      return { kind: 'SKIP' }
    }
    if (await findActiveMaintenanceJob(transaction, { action, artworkId })) return { kind: 'REUSE' }

    const intentAt = nextMaintenanceIntentAt(now, artwork.updatedAt)
    // 当对象状态在重试间已进入终态且重跑 reconcile 时，递增 intentAt 用于生成新一轮的幂等 key，避免与旧 terminal 轮次混淆。
    const changed = await transaction.artwork.updateMany({
      where: {
        id: artwork.id,
        archiveLifecycleState: artwork.archiveLifecycleState,
        deletedAt: artwork.deletedAt,
        updatedAt: artwork.updatedAt
      },
      data: { updatedAt: intentAt }
    })
    if (changed.count !== 1) return { kind: 'SKIP' }
    return {
      kind: 'ENQUEUE',
      payload: { action, artworkId },
      idempotencyKey: maintenanceIdempotencyKey(action, artworkId, intentAt)
    }
  })
}

async function applyReconcileDecision(
  context: ArchiveMaintenanceContext,
  decision: ReconcileDecision,
  result: { materialized: number; reused: number; skipped: number }
) {
  if (decision.kind === 'SKIP') {
    result.skipped += 1
    return
  }
  if (decision.kind === 'REUSE') {
    result.reused += 1
    return
  }
  const child = await context.enqueueChild({
    type: 'ARCHIVE_MAINTENANCE',
    payload: decision.payload,
    queuePriority: 100,
    idempotencyKey: decision.idempotencyKey
  })
  result[child.created ? 'materialized' : 'reused'] += 1
}

async function reportReconcileProgress(context: ArchiveMaintenanceContext, processed: number, discovered: number) {
  if (discovered === 0) return
  await context.progress({
    progress: Math.min(90, 5 + Math.round((processed / discovered) * 80)),
    stage: 'RECONCILE',
    message: `Reconciled archive maintenance intent ${processed}/${discovered}`
  })
}

async function executeArchivePurge(
  context: ArchiveMaintenanceContext,
  payload: Extract<ArchiveMaintenancePayload, { action: 'PURGE_ARCHIVE' }>,
  dependencies: ArchiveMaintenanceExecutorDependencies
) {
  const now = (dependencies.now ?? (() => new Date()))()
  const revisions = await context.mutateInTransaction<
    ArchiveTransaction,
    Array<{ id: string; archivePath: string; trashPath: string }>
  >(async (transaction) => {
    await lockArchivePublication(transaction)
    const artwork = await transaction.artwork.findUnique({
      where: { id: payload.artworkId },
      include: { archiveRevisions: true }
    })
    if (
      !artwork ||
      artwork.createdVia !== 'URL_ARCHIVE' ||
      artwork.archiveLifecycleState !== 'TRASHED' ||
      !artwork.deletedAt ||
      artwork.archiveRevisions.length === 0 ||
      artwork.archiveRevisions.some(
        (revision) =>
          !revision.trashPath || !revision.purgeAfter || revision.purgeAfter.getTime() > now.getTime()
      )
    ) {
      throw stateChanged('Archive artwork is not eligible for permanent purge')
    }
    return artwork.archiveRevisions.map((revision) => ({
      id: revision.id,
      archivePath: revision.archivePath,
      trashPath: revision.trashPath!
    }))
  })

  const paths = [...new Set(revisions.flatMap((revision) => [revision.trashPath, revision.archivePath]))]
  // 先删除文件再提交事务是因为文件 I/O 不可放回滚；第二阶段在写事务内按快照重检，确保崩溃恢复时可安全重放。
  for (const [index, storedPath] of paths.entries()) {
    throwIfAborted(context.signal)
    await removeRootConfinedPath(dependencies.config.scanRoot, storedPath)
    await context.progress({
      progress: Math.max(10, Math.round(((index + 1) / paths.length) * 80)),
      stage: 'PURGE_ARCHIVE',
      message: `Permanently removed archive path ${index + 1}/${paths.length}`
    })
  }

  throwIfAborted(context.signal)
  return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
    // 结合发布锁与再次状态校验，避免“先删文件后状态变化”导致误删新版本或重复执行导致错误。
    await lockArchivePublication(scope.transaction)
    const artwork = await scope.transaction.artwork.findUnique({
      where: { id: payload.artworkId },
      include: { archiveRevisions: true }
    })
    if (
      !artwork ||
      artwork.archiveLifecycleState !== 'TRASHED' ||
      !artwork.deletedAt ||
      artwork.archiveRevisions.length !== revisions.length ||
      artwork.archiveRevisions.some((revision) => {
        const prepared = revisions.find((candidate) => candidate.id === revision.id)
        return (
          !prepared ||
          revision.archivePath !== prepared.archivePath ||
          revision.trashPath !== prepared.trashPath ||
          !revision.purgeAfter ||
          revision.purgeAfter.getTime() > now.getTime()
        )
      })
    ) {
      throw stateChanged('Archive purge intent changed before finalization')
    }
    await scope.transaction.image.deleteMany({ where: { artworkId: artwork.id } })
    const changed = await scope.transaction.artwork.deleteMany({
      where: {
        id: artwork.id,
        createdVia: 'URL_ARCHIVE',
        archiveLifecycleState: 'TRASHED',
        deletedAt: artwork.deletedAt
      }
    })
    if (changed.count !== 1) throw stateChanged('Archive artwork changed before permanent purge')
    await scope.complete({
      result: { action: 'PURGE_ARCHIVE', artworkId: artwork.id },
      message: 'Archived artwork permanently purged'
    })
  })
}

async function executeStagingCleanup(
  context: ArchiveMaintenanceContext,
  payload: Extract<ArchiveMaintenancePayload, { action: 'CLEAN_STAGING' }>,
  dependencies: ArchiveMaintenanceExecutorDependencies
) {
  const archiveImport = await context.mutateInTransaction<
    ArchiveTransaction,
    { id: string; stagingPath: string; providerKey: string; creatorBucket: string; externalId: string }
  >(async (transaction) => {
    const current = await transaction.archiveImport.findUnique({ where: { id: payload.archiveImportId } })
    if (!current || !current.cleanupRequestedAt) {
      throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive cleanup intent no longer exists', {
        recoverable: true
      })
    }
    if (!['PENDING', 'PAUSED', 'FAILED', 'CANCELLED'].includes(current.status)) {
      throw new ArchiveExecutorError('STATE_CONFLICT', `Archive cleanup cannot run from ${current.status}`, {
        recoverable: true
      })
    }
    return current
  })
  const paths = buildArchiveStoragePaths({
    scanRoot: dependencies.config.scanRoot,
    archiveImportId: archiveImport.id,
    providerKey: archiveImport.providerKey,
    creatorBucket: archiveImport.creatorBucket,
    externalId: archiveImport.externalId
  })

  throwIfAborted(context.signal)
  await removeRootConfinedPath(dependencies.config.scanRoot, archiveImport.stagingPath)
  throwIfAborted(context.signal)
  if (paths.finalRelativePath !== archiveImport.stagingPath) {
    await removeRootConfinedPath(dependencies.config.scanRoot, paths.finalRelativePath)
  }
  throwIfAborted(context.signal)
  await context.progress({ progress: 85, stage: 'FINALIZING', message: 'Archive staging files removed' })

  const now = (dependencies.now ?? (() => new Date()))()
  return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
    // 清理与发布链路共享同一把 advisory 锁，确保删除目录与状态重置与后续入队/发布操作严格有序。
    await lockArchivePublication(scope.transaction)
    const current = await scope.transaction.archiveImport.findUnique({
      where: { id: archiveImport.id },
      include: { systemJob: true }
    })
    if (
      !current ||
      !current.cleanupRequestedAt ||
      !['PENDING', 'PAUSED', 'FAILED', 'CANCELLED'].includes(current.status)
    ) {
      throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive cleanup intent changed before finalization', {
        recoverable: true
      })
    }
    await scope.transaction.archiveImportItem.updateMany({
      where: { archiveImportId: current.id },
      data: {
        status: 'PENDING',
        attempts: 0,
        stagedPath: null,
        byteCount: null,
        mimeType: null,
        quality: null,
        width: null,
        height: null,
        sha256: null,
        errorCode: null,
        errorMessage: null,
        errorStage: null,
        remoteHost: null,
        startedAt: null,
        finishedAt: null
      }
    })
    const changed = await scope.transaction.archiveImport.updateMany({
      where: { id: current.id, status: current.status, cleanupRequestedAt: current.cleanupRequestedAt },
      data: { cleanupRequestedAt: null, completedItems: 0, failedItems: 0, retainUntil: null, updatedAt: now }
    })
    if (changed.count !== 1) throw stateChanged('Archive cleanup state changed')
    await scope.complete({
      result: { action: 'CLEAN_STAGING', archiveImportId: current.id },
      message: 'Archive staging cleanup completed'
    })
  })
}

async function executeArtworkMaintenance(
  context: ArchiveMaintenanceContext,
  payload: Extract<ArchiveMaintenancePayload, { action: 'TRASH_ARCHIVE' | 'RESTORE_ARCHIVE' }>,
  dependencies: ArchiveMaintenanceExecutorDependencies
) {
  const expectedState = payload.action === 'TRASH_ARCHIVE' ? 'TRASHING' : 'RESTORING'
  const revisions = await context.mutateInTransaction<
    ArchiveTransaction,
    Array<{ id: string; archivePath: string; trashPath: string }>
  >(async (transaction) => {
    const artwork = await transaction.artwork.findUnique({
      where: { id: payload.artworkId },
      include: { archiveRevisions: true }
    })
    if (!artwork || artwork.createdVia !== 'URL_ARCHIVE' || artwork.archiveLifecycleState !== expectedState) {
      throw stateChanged(`Archive artwork is not ${expectedState}`)
    }
    if (!artwork.deletedAt || artwork.archiveRevisions.length === 0) {
      throw stateChanged('Archive artwork maintenance intent is incomplete')
    }
    return artwork.archiveRevisions.map((revision) => {
      if (!revision.trashPath) throw stateChanged('Archive revision has no trash path')
      return { id: revision.id, archivePath: revision.archivePath, trashPath: revision.trashPath }
    })
  })

  for (const [index, revision] of revisions.entries()) {
    throwIfAborted(context.signal)
    const source = payload.action === 'TRASH_ARCHIVE' ? revision.archivePath : revision.trashPath
    const target = payload.action === 'TRASH_ARCHIVE' ? revision.trashPath : revision.archivePath
    await moveRootConfinedDirectory(dependencies.config.scanRoot, source, target)
    await context.progress({
      progress: Math.max(10, Math.round(((index + 1) / revisions.length) * 80)),
      stage: payload.action,
      message: `${payload.action} ${index + 1}/${revisions.length}`
    })
  }

  throwIfAborted(context.signal)
  const now = (dependencies.now ?? (() => new Date()))()
  return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
    // 目录移动完成后再二次校验生命周期，保证重复/重放任务只在预期状态下完成最终转态变更。
    await lockArchivePublication(scope.transaction)
    const artwork = await scope.transaction.artwork.findUnique({
      where: { id: payload.artworkId },
      include: { archiveRevisions: true }
    })
    if (!artwork || artwork.archiveLifecycleState !== expectedState || !artwork.deletedAt) {
      throw stateChanged('Archive lifecycle changed before finalization')
    }
    if (payload.action === 'RESTORE_ARCHIVE') {
      await scope.transaction.archiveRevision.updateMany({
        where: { artworkId: artwork.id },
        data: { trashPath: null, trashedAt: null, purgeAfter: null }
      })
    }
    const changed = await scope.transaction.artwork.updateMany({
      where: { id: artwork.id, archiveLifecycleState: expectedState, deletedAt: { not: null } },
      data:
        payload.action === 'TRASH_ARCHIVE'
          ? { archiveLifecycleState: 'TRASHED', updatedAt: now }
          : { archiveLifecycleState: 'ACTIVE', deletedAt: null, updatedAt: now }
    })
    if (changed.count !== 1) throw stateChanged('Archive lifecycle state changed')
    await scope.complete({
      result: { action: payload.action, artworkId: artwork.id },
      message:
        payload.action === 'TRASH_ARCHIVE' ? 'Archived artwork moved to trash' : 'Archived artwork restored from trash'
    })
  })
}

async function moveRootConfinedDirectory(scanRoot: string, sourcePath: string, targetPath: string): Promise<void> {
  assertNonRootArchivePath(scanRoot, sourcePath)
  assertNonRootArchivePath(scanRoot, targetPath)
  const sourceCandidate = await resolveCreatablePathWithinRoot(scanRoot, sourcePath)
  const targetCandidate = await resolveCreatablePathWithinRoot(scanRoot, targetPath)
  const [sourceExists, targetExists] = await Promise.all([pathExists(sourceCandidate), pathExists(targetCandidate)])
  if (sourceExists && !targetExists) {
    const source = await resolveExistingPathWithinRoot(scanRoot, sourcePath)
    const target = await resolveCreatablePathWithinRoot(scanRoot, targetPath)
    await mkdir(path.dirname(target), { recursive: true })
    await rename(source, target)
    return
  }
  if (!sourceExists && targetExists) {
    await resolveExistingPathWithinRoot(scanRoot, targetPath)
    return
  }
  if (!sourceExists && !targetExists) throw new ArchiveExecutorError('MEDIA_INVALID', 'Archive directory is missing')
  throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive source and target directories both exist', {
    recoverable: true
  })
}

async function removeRootConfinedPath(scanRoot: string, storedPath: string): Promise<void> {
  assertNonRootArchivePath(scanRoot, storedPath)
  const target = await resolveCreatablePathWithinRoot(scanRoot, storedPath)
  if (!(await pathExists(target))) return
  const existing = await resolveExistingPathWithinRoot(scanRoot, storedPath)
  await rm(existing, { recursive: true, force: true })
}

async function findActiveMaintenanceJob(
  transaction: ArchiveTransaction,
  payload:
    | { action: 'CLEAN_STAGING'; archiveImportId: string }
    | { action: 'TRASH_ARCHIVE' | 'RESTORE_ARCHIVE' | 'PURGE_ARCHIVE'; artworkId: number }
) {
  return transaction.systemJob.findFirst({
    where: {
      type: 'ARCHIVE_MAINTENANCE',
      status: { in: [...ACTIVE_MAINTENANCE_JOB_STATUSES] },
      payload: { equals: payload }
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  })
}

function maintenanceIdempotencyKey(action: string, targetId: string | number, intentAt: Date) {
  return `archive-maintenance:${action}:${targetId}:${intentAt.getTime()}`
}

function nextMaintenanceIntentAt(now: Date, previous: Date) {
  return new Date(Math.max(now.getTime(), previous.getTime() + 1))
}

function assertNonRootArchivePath(scanRoot: string, storedPath: string): void {
  const trimmed = storedPath.trim()
  if (!trimmed || path.resolve(scanRoot, trimmed) === path.resolve(scanRoot)) {
    throw new ArchiveExecutorError('MEDIA_INVALID', 'Archive maintenance path cannot target the storage root')
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw (
      signal.reason ?? new ArchiveExecutorError('CANCELLED', 'Archive maintenance was cancelled', { recoverable: true })
    )
  }
}

function stateChanged(message: string): ArchiveExecutorError {
  return new ArchiveExecutorError('STATE_CONFLICT', message, { recoverable: true })
}

function lockArchivePublication(transaction: ArchiveTransaction): Promise<unknown> {
  return transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
}
