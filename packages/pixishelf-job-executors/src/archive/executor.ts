import { setTimeout as delay } from 'node:timers/promises'
import { archiveImportPayloadSchema, type JobErrorCode } from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  ExecutorDefinition,
  FencedExecutionTransaction,
  JobExecutionOutcome
} from '@pixishelf/job-runtime'
import { ArchiveExecutorError, toArchiveExecutorError } from './errors.js'
import { publishArchiveImportInTransaction } from './publisher.js'
import {
  buildArchiveStoragePaths,
  pathExists,
  prepareArchiveRevisionDirectory,
  prepareArchiveStagingDirectory,
  storeArchiveRemoteMedia,
  validateArchiveStoredMedia,
  writeArchiveManifest
} from './storage.js'
import type {
  ArchiveExecutorDependencies,
  ArchiveMediaItem,
  ArchiveMediaProvider,
  ArchiveProviderMediaItem,
  ArchiveTransaction
} from './types.js'

const FAILED_STAGING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const PARTIAL_FAILED_STAGING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MEDIA_CONCURRENCY = 2
const DEFAULT_MAX_MEDIA_ATTEMPTS = 3

type ArchiveImportPayload = { archiveImportId: string }
type ArchiveExecutionResult = { artworkId: number; revisionId: string; archivePath: string }
type ArchiveExecutorContext = ExecutionContext<ArchiveImportPayload, EnqueuedChildJob>

type LoadedArchiveImport = Prisma.ArchiveImportGetPayload<{
  include: { items: { orderBy: { pageIndex: 'asc' } } }
}>
type LoadedArchiveItem = LoadedArchiveImport['items'][number]

type ItemAttemptResult = { kind: 'COMPLETED' } | { kind: 'RETRY'; item: ArchiveMediaItem } | { kind: 'FAILED' }

interface ArchiveItemCounts {
  completed: number
  failed: number
  pending: number
  downloading: number
}

export function createArchiveExecutorRegistrations(
  dependencies: ArchiveExecutorDependencies
): ExecutorDefinition<ArchiveImportPayload, ArchiveExecutionResult>[] {
  validateDependencies(dependencies)
  return [
    {
      jobType: 'ARCHIVE_IMPORT',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1,
      parsePayload: (payload) => archiveImportPayloadSchema.parse(payload),
      execute: (context) => executeArchiveImport(context, dependencies)
    }
  ]
}

export async function executeArchiveImport(
  context: ArchiveExecutorContext,
  dependencies: ArchiveExecutorDependencies
): Promise<JobExecutionOutcome<ArchiveExecutionResult>> {
  const now = dependencies.now ?? (() => new Date())
  const sleep = dependencies.sleep ?? abortableDelay
  const random = dependencies.random ?? Math.random
  const mediaConcurrency = dependencies.config.mediaConcurrency ?? DEFAULT_MEDIA_CONCURRENCY
  const maxMediaAttempts = dependencies.config.maxMediaAttempts ?? DEFAULT_MAX_MEDIA_ATTEMPTS
  let finalizationStarted = false
  const archiveImportId = context.payload.archiveImportId

  try {
    throwIfAborted(context.signal)
    const archiveImport = await startArchiveImport(context, dependencies, now())
    const paths = buildArchiveStoragePaths({
      scanRoot: dependencies.config.scanRoot,
      archiveImportId,
      providerKey: archiveImport.providerKey,
      creatorBucket: archiveImport.creatorBucket,
      externalId: archiveImport.externalId
    })
    if (normalizeStoredPath(archiveImport.stagingPath) !== normalizeStoredPath(paths.stagingRelativePath)) {
      throw new ArchiveExecutorError(
        'MEDIA_INVALID',
        'Archive staging path does not match its deterministic import path'
      )
    }
    const stagingDirectory = (await pathExists(paths.finalAbsolutePath))
      ? paths.finalAbsolutePath
      : await prepareArchiveStagingDirectory(dependencies.config.scanRoot, archiveImport.stagingPath)
    const provider = dependencies.providers.get(archiveImport.providerKey)
    const controller = linkedAbortController(context.signal)

    try {
      let roundItems = archiveImport.items
        .filter((item) => item.status === 'PENDING' || item.status === 'DOWNLOADING')
        .map(toArchiveMediaItem)
      let round = 1

      while (roundItems.length > 0 && round <= maxMediaAttempts) {
        const retryItems: ArchiveMediaItem[] = []
        const results = await runConcurrentRound(roundItems, mediaConcurrency, async (item) => {
          try {
            return await downloadArchiveItem({
              context,
              dependencies,
              archiveImport,
              item,
              provider,
              stagingDirectory,
              signal: controller.signal,
              maxMediaAttempts,
              now
            })
          } catch (error) {
            if (!controller.signal.aborted) controller.abort(error)
            throw error
          }
        })
        for (const result of results.fulfilled) {
          if (result.kind === 'RETRY') retryItems.push(result.item)
        }
        const primaryError = selectPrimaryError(controller.signal.reason, results.rejected)
        if (primaryError) throw primaryError

        const counts = await synchronizeArchiveCounts(context, archiveImportId)
        await context.progress({
          progress: archiveProgress(counts.completed, archiveImport.totalItems),
          stage: 'DOWNLOADING',
          message: `Archive download round ${round}/${maxMediaAttempts}: ${counts.completed}/${archiveImport.totalItems}`,
          data: { completed: counts.completed, failed: counts.failed, retrying: retryItems.length }
        })
        if (retryItems.length === 0 || round >= maxMediaAttempts) break
        await sleep(backoffWithJitter(round, random), controller.signal)
        roundItems = retryItems.sort((left, right) => left.pageIndex - right.pageIndex)
        round += 1
      }
    } finally {
      controller.dispose()
    }

    throwIfAborted(context.signal)
    const counts = await synchronizeArchiveCounts(context, archiveImportId)
    if (counts.failed > 0) {
      finalizationStarted = true
      return finalizeArchiveFailure(context, archiveImportId, counts, now(), {
        code: 'PARTIAL_FAILURE',
        message: `Archive import partially failed: ${counts.completed}/${archiveImport.totalItems} completed, ${counts.failed} failed`
      })
    }
    if (counts.pending > 0 || counts.downloading > 0) {
      throw new ArchiveExecutorError('MEDIA_INVALID', 'Archive import still has unfinished media checkpoints', {
        recoverable: true
      })
    }

    const completed = await context.mutateInTransaction<ArchiveTransaction, LoadedArchiveItem[]>(async (transaction) =>
      transaction.archiveImportItem.findMany({ where: { archiveImportId }, orderBy: { pageIndex: 'asc' } })
    )
    if (completed.length !== archiveImport.totalItems || completed.some((item) => item.status !== 'COMPLETED')) {
      throw new ArchiveExecutorError('MEDIA_INVALID', 'Archive import checkpoints are incomplete', {
        recoverable: true
      })
    }
    await validateArchiveStoredMedia(stagingDirectory, completed)
    throwIfAborted(context.signal)
    await writeArchiveManifest(stagingDirectory, buildManifest(archiveImport, completed, now()))
    throwIfAborted(context.signal)
    await prepareArchiveRevisionDirectory(paths)
    throwIfAborted(context.signal)

    finalizationStarted = true
    return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
      if (await finalizeRequestedArchiveControl(scope, archiveImportId, now())) return
      const result = await publishArchiveImportInTransaction(scope.transaction, archiveImportId, paths, now())
      await scope.complete({ result, message: 'Archive import published' })
    })
  } catch (error) {
    if (finalizationStarted) throw error
    return handleArchiveExecutionFailure(context, archiveImportId, error, dependencies, now())
  }
}

async function startArchiveImport(
  context: ArchiveExecutorContext,
  dependencies: ArchiveExecutorDependencies,
  startedAt: Date
): Promise<LoadedArchiveImport> {
  return context.mutateInTransaction<ArchiveTransaction, LoadedArchiveImport>(async (transaction) => {
    const archiveImport = await transaction.archiveImport.findUnique({
      where: { id: context.payload.archiveImportId },
      include: { items: { orderBy: { pageIndex: 'asc' } } }
    })
    if (!archiveImport || archiveImport.systemJobId !== context.job.id) {
      throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive import payload is not bound to the claimed job')
    }
    if (!['PENDING', 'RUNNING'].includes(archiveImport.status)) {
      throw new ArchiveExecutorError('STATE_CONFLICT', `Archive import cannot start from ${archiveImport.status}`)
    }
    await transaction.archiveImportItem.updateMany({
      where: { archiveImportId: archiveImport.id, status: 'DOWNLOADING' },
      data: { status: 'PENDING', startedAt: null, finishedAt: null }
    })
    const changed = await transaction.archiveImport.updateMany({
      where: { id: archiveImport.id, systemJobId: context.job.id, status: { in: ['PENDING', 'RUNNING'] } },
      data: {
        status: 'RUNNING',
        startedAt: archiveImport.startedAt ?? startedAt,
        finishedAt: null,
        retainUntil: null,
        errorCode: null,
        errorMessage: null
      }
    })
    if (changed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive import start state changed')
    dependencies.logger?.info('archive.execution_started', { archiveImportId: archiveImport.id, jobId: context.job.id })
    return {
      ...archiveImport,
      status: 'RUNNING',
      items: archiveImport.items.map((item) =>
        item.status === 'DOWNLOADING'
          ? { ...item, status: 'PENDING' as const, startedAt: null, finishedAt: null }
          : item
      )
    }
  })
}

async function downloadArchiveItem(input: {
  context: ArchiveExecutorContext
  dependencies: ArchiveExecutorDependencies
  archiveImport: LoadedArchiveImport
  item: ArchiveMediaItem
  provider: ArchiveMediaProvider
  stagingDirectory: string
  signal: AbortSignal
  maxMediaAttempts: number
  now: () => Date
}): Promise<ItemAttemptResult> {
  throwIfAborted(input.signal)
  const attempt = input.item.attempts + 1
  await input.context.mutateInTransaction<ArchiveTransaction>(async (transaction) => {
    const claimed = await transaction.archiveImportItem.updateMany({
      where: {
        id: input.item.id,
        archiveImportId: input.archiveImport.id,
        status: 'PENDING',
        attempts: input.item.attempts
      },
      data: {
        status: 'DOWNLOADING',
        attempts: { increment: 1 },
        startedAt: input.now(),
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
        errorStage: null,
        remoteHost: null
      }
    })
    if (claimed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive item checkpoint changed')
  })

  let mediaStored = false
  try {
    const remote = await input.provider.openMedia(toProviderMediaItem(input.item), {
      quality: input.archiveImport.selectedQuality,
      signal: input.signal
    })
    let stored
    try {
      stored = await storeArchiveRemoteMedia({
        remote,
        stagingDirectory: input.stagingDirectory,
        index: input.item.pageIndex,
        expectedFilename: input.item.expectedFilename,
        signal: input.signal,
        ...(input.dependencies.config.maxMediaBytes === undefined
          ? {}
          : { maxBytes: input.dependencies.config.maxMediaBytes }),
        partialKey: input.context.job.executionToken
      })
    } finally {
      if (!remote.stream.destroyed) remote.stream.destroy()
    }
    mediaStored = true
    const completedItems = await input.context.mutateInTransaction<ArchiveTransaction, number>(async (transaction) => {
      const completed = await transaction.archiveImportItem.updateMany({
        where: {
          id: input.item.id,
          archiveImportId: input.archiveImport.id,
          status: 'DOWNLOADING',
          attempts: attempt
        },
        data: {
          status: 'COMPLETED',
          stagedPath: stored.relativePath,
          byteCount: stored.byteCount,
          mimeType: stored.mimeType,
          quality: remote.quality,
          width: stored.width,
          height: stored.height,
          sha256: stored.sha256,
          errorCode: null,
          errorMessage: null,
          errorStage: null,
          remoteHost: null,
          finishedAt: input.now()
        }
      })
      if (completed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive item completion changed')
      return transaction.archiveImportItem.count({
        where: { archiveImportId: input.archiveImport.id, status: 'COMPLETED' }
      })
    })
    await input.context.progress({
      progress: archiveProgress(completedItems, input.archiveImport.totalItems),
      stage: 'DOWNLOADING',
      message: `Downloaded ${completedItems}/${input.archiveImport.totalItems}`
    })
    return { kind: 'COMPLETED' }
  } catch (error) {
    const classified = toArchiveExecutorError(error)
    if (mediaStored || input.signal.aborted) throw classified
    const retry = isRetryableItemFailure(classified) && attempt < input.maxMediaAttempts
    const terminalItemFailure = !retry && !classified.pause
    await input.context.mutateInTransaction<ArchiveTransaction>(async (transaction) => {
      const updated = await transaction.archiveImportItem.updateMany({
        where: {
          id: input.item.id,
          archiveImportId: input.archiveImport.id,
          status: 'DOWNLOADING',
          attempts: attempt
        },
        data: {
          status: terminalItemFailure ? 'FAILED' : 'PENDING',
          errorCode: classified.code,
          errorMessage: classified.message,
          errorStage: classified.stage,
          remoteHost: classified.remoteHost,
          finishedAt: terminalItemFailure ? input.now() : null
        }
      })
      if (updated.count !== 1) {
        throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive item failure checkpoint changed')
      }
    })
    if (classified.pause || isTaskStoppingFailure(classified)) throw classified
    return retry ? { kind: 'RETRY', item: { ...input.item, attempts: attempt } } : { kind: 'FAILED' }
  }
}

async function synchronizeArchiveCounts(
  context: ArchiveExecutorContext,
  archiveImportId: string
): Promise<ArchiveItemCounts> {
  return context.mutateInTransaction<ArchiveTransaction, ArchiveItemCounts>(async (transaction) => {
    const groups = await transaction.archiveImportItem.groupBy({
      by: ['status'],
      where: { archiveImportId },
      _count: { _all: true }
    })
    const counts = normalizeCounts(groups)
    await transaction.archiveImport.update({
      where: { id: archiveImportId },
      data: { completedItems: counts.completed, failedItems: counts.failed }
    })
    return counts
  })
}

async function handleArchiveExecutionFailure(
  context: ArchiveExecutorContext,
  archiveImportId: string,
  error: unknown,
  dependencies: ArchiveExecutorDependencies,
  now: Date
): Promise<JobExecutionOutcome<ArchiveExecutionResult>> {
  const interruption = interruptionReason(context.signal.reason)
  if (context.signal.aborted && interruption === 'CANCEL_REQUESTED') {
    return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
      if (await finalizeRequestedArchiveControl(scope, archiveImportId, now)) return
      const counts = await readCounts(scope.transaction, archiveImportId)
      await finishArchiveImport(scope.transaction, {
        archiveImportId,
        status: 'CANCELLED',
        counts,
        now,
        errorCode: 'CANCELLED',
        errorMessage: 'Archive import cancelled'
      })
      await scope.cancel('Archive import cancelled')
    })
  }
  if (context.signal.aborted && interruption === 'PAUSE_REQUESTED') {
    return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
      if (await finalizeRequestedArchiveControl(scope, archiveImportId, now)) return
      await pauseOrReleaseArchiveImport(scope.transaction, archiveImportId, 'PAUSED')
      await scope.pause({ reason: 'USER_REQUESTED', message: 'Archive import paused' })
    })
  }
  if (context.signal.aborted && interruption === 'SHUTDOWN') {
    return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
      if (await finalizeRequestedArchiveControl(scope, archiveImportId, now)) return
      await pauseOrReleaseArchiveImport(scope.transaction, archiveImportId, 'PENDING')
      await scope.release('Archive worker stopped; import will resume')
    })
  }
  if (context.signal.aborted) throw context.signal.reason ?? error

  const classified = toArchiveExecutorError(error)
  dependencies.logger?.error('archive.execution_failed', classified, { archiveImportId, code: classified.code })
  if (classified.pause) {
    return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
      if (await finalizeRequestedArchiveControl(scope, archiveImportId, now)) return
      const counts = await readCounts(scope.transaction, archiveImportId)
      const changed = await scope.transaction.archiveImport.updateMany({
        where: { id: archiveImportId, status: 'RUNNING' },
        data: {
          status: 'PAUSED',
          decisionCode: classified.decisionCode,
          errorCode: classified.code,
          errorMessage: classified.message,
          completedItems: counts.completed,
          failedItems: counts.failed
        }
      })
      if (changed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive pause state changed')
      await scope.pause({
        reason: 'ACTION_REQUIRED',
        message: classified.message,
        data: {
          errorCode: classified.code,
          decisionCode: classified.decisionCode ?? 'ORIGINAL_UNAVAILABLE'
        }
      })
    })
  }

  const counts = await context.mutateInTransaction<ArchiveTransaction, ArchiveItemCounts>((transaction) =>
    readCounts(transaction, archiveImportId)
  )
  return finalizeArchiveFailure(context, archiveImportId, counts, now, classified)
}

async function finalizeArchiveFailure(
  context: ArchiveExecutorContext,
  archiveImportId: string,
  counts: ArchiveItemCounts,
  now: Date,
  error: { code: string; message: string }
) {
  return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
    if (await finalizeRequestedArchiveControl(scope, archiveImportId, now)) return
    await finishArchiveImport(scope.transaction, {
      archiveImportId,
      status: 'FAILED',
      counts,
      now,
      errorCode: error.code,
      errorMessage: error.message
    })
    await scope.fail({ errorCode: mapArchiveJobErrorCode(error.code), error: error.message, message: error.message })
  })
}

async function finalizeRequestedArchiveControl(
  scope: FencedExecutionTransaction<ArchiveTransaction>,
  archiveImportId: string,
  now: Date
): Promise<boolean> {
  if (scope.executionStatus === 'CANCELLING') {
    const counts = await readCounts(scope.transaction, archiveImportId)
    await finishArchiveImport(scope.transaction, {
      archiveImportId,
      status: 'CANCELLED',
      counts,
      now,
      errorCode: 'CANCELLED',
      errorMessage: 'Archive import cancelled'
    })
    await scope.cancel('Archive import cancelled')
    return true
  }
  if (scope.executionStatus === 'PAUSING') {
    await pauseOrReleaseArchiveImport(scope.transaction, archiveImportId, 'PAUSED')
    await scope.pause({ reason: 'USER_REQUESTED', message: 'Archive import paused' })
    return true
  }
  return false
}

async function finishArchiveImport(
  transaction: ArchiveTransaction,
  input: {
    archiveImportId: string
    status: 'FAILED' | 'CANCELLED'
    counts: ArchiveItemCounts
    now: Date
    errorCode: string
    errorMessage: string
  }
) {
  const changed = await transaction.archiveImport.updateMany({
    where: { id: input.archiveImportId, status: { in: ['PENDING', 'RUNNING', 'CANCELLING'] } },
    data: {
      status: input.status,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      completedItems: input.counts.completed,
      failedItems: input.counts.failed,
      finishedAt: input.now,
      retainUntil: new Date(
        input.now.getTime() +
          (input.status === 'FAILED' && input.counts.completed > 0
            ? PARTIAL_FAILED_STAGING_RETENTION_MS
            : FAILED_STAGING_RETENTION_MS)
      )
    }
  })
  if (changed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive terminal state changed')
}

async function pauseOrReleaseArchiveImport(
  transaction: ArchiveTransaction,
  archiveImportId: string,
  status: 'PAUSED' | 'PENDING'
) {
  await transaction.archiveImportItem.updateMany({
    where: { archiveImportId, status: 'DOWNLOADING' },
    data: { status: 'PENDING', startedAt: null, finishedAt: null }
  })
  const counts = await readCounts(transaction, archiveImportId)
  const changed = await transaction.archiveImport.updateMany({
    where: { id: archiveImportId, status: { in: ['PENDING', 'RUNNING'] } },
    data: { status, completedItems: counts.completed, failedItems: counts.failed }
  })
  if (changed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive lifecycle state changed')
}

async function readCounts(transaction: ArchiveTransaction, archiveImportId: string): Promise<ArchiveItemCounts> {
  const groups = await transaction.archiveImportItem.groupBy({
    by: ['status'],
    where: { archiveImportId },
    _count: { _all: true }
  })
  return normalizeCounts(groups)
}

function normalizeCounts(
  groups: Array<{ status: 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'FAILED'; _count: { _all: number } }>
): ArchiveItemCounts {
  const counts: ArchiveItemCounts = { completed: 0, failed: 0, pending: 0, downloading: 0 }
  for (const group of groups) {
    if (group.status === 'COMPLETED') counts.completed = group._count._all
    else if (group.status === 'FAILED') counts.failed = group._count._all
    else if (group.status === 'PENDING') counts.pending = group._count._all
    else counts.downloading = group._count._all
  }
  return counts
}

async function runConcurrentRound<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  processItem: (item: TItem) => Promise<TResult>
) {
  let cursor = 0
  const fulfilled: TResult[] = []
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      if (item === undefined) return
      fulfilled.push(await processItem(item))
    }
  })
  const settled = await Promise.allSettled(workers)
  return { fulfilled, rejected: settled.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])) }
}

function buildManifest(
  archiveImport: LoadedArchiveImport,
  completed: Array<ArchiveMediaItem | LoadedArchiveImport['items'][number]>,
  createdAt: Date
) {
  return {
    manifestVersion: 1,
    revisionId: archiveImport.id,
    provider: {
      key: archiveImport.providerKey,
      externalId: archiveImport.externalId,
      canonicalUrl: archiveImport.canonicalUrl,
      locator: archiveImport.locator
    },
    creatorBucket: archiveImport.creatorBucket,
    requestedQuality: archiveImport.requestedQuality,
    selectedQuality: archiveImport.selectedQuality,
    sourceSnapshot: {
      metadataHash: archiveImport.metadataHash,
      normalized: archiveImport.normalizedMetadata,
      raw: archiveImport.rawMetadata
    },
    relationships: relationshipValues(archiveImport.normalizedMetadata),
    media: completed.map((item) => ({
      index: item.pageIndex,
      path: item.stagedPath,
      originalFilename: item.expectedFilename,
      sourcePageUrl: item.sourcePageUrl,
      sourcePageLocator: item.locator,
      quality: item.quality,
      mimeType: item.mimeType,
      width: item.width,
      height: item.height,
      bytes: item.byteCount?.toString() ?? null,
      sha256: item.sha256
    })),
    createdAt: createdAt.toISOString()
  }
}

function toArchiveMediaItem(item: LoadedArchiveImport['items'][number]): ArchiveMediaItem {
  return {
    id: item.id,
    pageIndex: item.pageIndex,
    sourcePageUrl: item.sourcePageUrl,
    locator: item.locator,
    expectedFilename: item.expectedFilename,
    status: item.status,
    attempts: item.attempts,
    stagedPath: item.stagedPath,
    byteCount: item.byteCount,
    mimeType: item.mimeType,
    quality: item.quality,
    width: item.width,
    height: item.height,
    sha256: item.sha256
  }
}

function toProviderMediaItem(item: ArchiveMediaItem): ArchiveProviderMediaItem {
  return {
    index: item.pageIndex,
    sourcePageUrl: item.sourcePageUrl,
    locator: item.locator as Record<string, unknown>,
    expectedFilename: item.expectedFilename
  }
}

function linkedAbortController(signal: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  return Object.assign(controller, { dispose: () => signal.removeEventListener('abort', abort) })
}

function selectPrimaryError(rootError: unknown, rejected: unknown[]): ArchiveExecutorError | null {
  if (rootError) return toArchiveExecutorError(rootError)
  const classified = rejected.map(toArchiveExecutorError)
  return classified.find((error) => error.code !== 'CANCELLED') ?? classified[0] ?? null
}

function isRetryableItemFailure(error: ArchiveExecutorError): boolean {
  return error.recoverable && ['REMOTE_RESPONSE_INVALID', 'MEDIA_INVALID'].includes(error.code)
}

function isTaskStoppingFailure(error: ArchiveExecutorError): boolean {
  return ['STORAGE_FULL', 'CANCELLED', 'PAUSED', 'LEASE_LOST', 'WORKER_STOPPED', 'STATE_CONFLICT', 'INTERNAL'].includes(
    error.code
  )
}

function mapArchiveJobErrorCode(code: string): JobErrorCode {
  if (code === 'LEASE_LOST') return 'LEASE_LOST'
  if (code === 'REMOTE_NOT_FOUND') return 'SOURCE_NOT_FOUND'
  if (code === 'STORAGE_FULL') return 'FILESYSTEM_PERMISSION_DENIED'
  if (code === 'ORIGINAL_UNAVAILABLE' || code === 'PARTIAL_FAILURE' || code === 'STATE_CONFLICT') {
    return 'PRECONDITION_FAILED'
  }
  if (code === 'CANCELLED') return 'CANCELLED_BY_USER'
  return 'INTERNAL_ERROR'
}

function interruptionReason(reason: unknown): string | null {
  if (!reason || typeof reason !== 'object' || !('reason' in reason)) return null
  return typeof reason.reason === 'string' ? reason.reason : null
}

function archiveProgress(completed: number, total: number): number {
  return Math.max(1, Math.min(95, Math.round((completed / Math.max(total, 1)) * 90) + 5))
}

function backoffWithJitter(attempt: number, random: () => number) {
  return Math.min(30_000, 500 * 2 ** Math.max(0, attempt - 1)) + Math.floor(random() * 250)
}

function normalizeStoredPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function relationshipValues(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const relationships = (value as Record<string, unknown>).relationships
  return Array.isArray(relationships) ? relationships : []
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new ArchiveExecutorError('CANCELLED', 'Archive execution was interrupted')
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  await delay(milliseconds, undefined, { signal })
}

function validateDependencies(dependencies: ArchiveExecutorDependencies): void {
  if (!dependencies.config.scanRoot.trim()) throw new Error('Archive executor scanRoot is required')
  for (const [name, value] of [
    ['mediaConcurrency', dependencies.config.mediaConcurrency],
    ['maxMediaAttempts', dependencies.config.maxMediaAttempts],
    ['maxMediaBytes', dependencies.config.maxMediaBytes]
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`Archive executor ${name} must be a positive safe integer`)
    }
  }
}
