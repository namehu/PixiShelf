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
import { ArchiveExecutorError } from './errors.js'
import {
  buildArchiveStoragePaths,
  pathExists,
  resolveCreatablePathWithinRoot,
  resolveExistingPathWithinRoot
} from './storage.js'
import type { ArchiveTransaction } from './types.js'

const ARCHIVE_PUBLISH_ADVISORY_LOCK_ID = 7_341_902_117

type ArchiveMaintenanceContext = ExecutionContext<ArchiveMaintenancePayload, EnqueuedChildJob>
type ArchiveMaintenanceResult =
  | { action: 'CLEAN_STAGING'; archiveImportId: string }
  | { action: 'TRASH_ARCHIVE' | 'RESTORE_ARCHIVE'; artworkId: number }

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
  return executeArtworkMaintenance(context, context.payload, dependencies)
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
