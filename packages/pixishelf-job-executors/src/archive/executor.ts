import { assertArchiveCompletionBase } from './completion-proof.ts'
import {
  assertArchiveSourceSnapshot,
  assertArchiveDownloadGeneration,
  assertArchiveSourceUnchanged,
  lockArchiveSourcePublication
} from './dedup-source-snapshot.ts'
import {
  registerArchiveDownloadGeneration,
  prepareDownloadGeneration,
  markDownloadDrained
} from './download-generation.ts'
import {
  beginExecutorMediaWrite,
  publishExecutorMediaWrite,
  resolveExecutorMediaDirectory
} from '../scan/media-content-write.ts'
import { recoverCompletedArchivePublicationWrite } from './media-content-publication.ts'
import path from 'node:path'
import { finalizeArchivePublication, handoffArchivePhase } from './phase-handoff.ts'
import { assertArchiveImportNotDeleted } from './deletion-policy.ts'
import { setTimeout as delay } from 'node:timers/promises'
import {
  extractJobDiagnostic,
  ARCHIVE_MEDIA_CONCURRENCY_ADVISORY_LOCK_KEY,
  ARCHIVE_MEDIA_CONCURRENCY_DEFAULT,
  ARCHIVE_MEDIA_CONCURRENCY_SETTING_KEY,
  ARCHIVE_IMPORT_DEFINITION_VERSION,
  ARCHIVE_COVERAGE_DEFINITION_VERSION,
  archiveImportPayloadSchema,
  archiveMediaConcurrencySchema,
  archiveImportV2PayloadSchema,
  type ArchiveImportV2Payload,
  type JobErrorCode
} from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  ExecutionProgressUpdate,
  ExecutorDefinition,
  FencedExecutionTransaction,
  QueueSqlExecutor,
  JobExecutionOutcome
} from '@pixishelf/job-runtime'
import { ArchiveExecutorError, toArchiveExecutorError } from './errors.ts'
import { ArchiveTransferMeter, startArchiveTransferReporter } from './transfer-meter.ts'
import { ArchiveDownloadCheckpoints, DOWNLOAD_SAVE_INTERVAL_MS } from './download-checkpoints.ts'
import { lockArchiveUploaderCatalogIdentities } from './uploader-catalog-lock.ts'
import { publishArchiveImportInTransaction } from './publisher.ts'
import {
  buildArchiveStoragePaths,
  readArchiveManifestDigest,
  pathExists,
  prepareArchiveRevisionDirectory,
  storeArchiveRemoteMedia,
  validateArchiveStoredMedia,
  writeArchiveManifest
} from './storage.ts'
import type {
  ArchiveExecutorDependencies,
  ArchiveMediaItem,
  ArchiveMediaProvider,
  ArchiveProviderMediaItem,
  ArchiveTransaction
} from './types.ts'

const FAILED_STAGING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const PARTIAL_FAILED_STAGING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_MEDIA_ATTEMPTS = 3

type ArchiveImportPayload = ArchiveImportV2Payload
type ArchiveExecutionResult = { artworkId: number; revisionId: string; archivePath: string }
export type ArchiveExecutorContext = ExecutionContext<ArchiveImportPayload, EnqueuedChildJob>

export type LoadedArchiveImport = Prisma.ArchiveImportGetPayload<{
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
      progressPolicy: 'REALTIME',
      parsePayload: (payload) => ({ ...archiveImportPayloadSchema.parse(payload), defaultTagIds: [] }),
      execute: (context) => executeLegacyArchiveHandoff(context, dependencies)
    },
    {
      jobType: 'ARCHIVE_IMPORT',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: ARCHIVE_IMPORT_DEFINITION_VERSION,
      progressPolicy: 'REALTIME',
      parsePayload: (payload) => archiveImportV2PayloadSchema.parse(payload),
      execute: (context) => executeLegacyArchiveHandoff(context, dependencies)
    },
    {
      jobType: 'ARCHIVE_DOWNLOAD',
      executionLane: 'ARCHIVE_DOWNLOAD',
      definitionVersion: 1,
      progressPolicy: 'REALTIME',
      parsePayload: (payload) => archiveImportV2PayloadSchema.parse(payload),
      execute: (context) => executeArchiveImport(context, dependencies)
    },
    {
      jobType: 'ARCHIVE_PUBLISH',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1,
      parsePayload: (payload) => archiveImportV2PayloadSchema.parse(payload),
      execute: (context) => executeArchivePublish(context, dependencies)
    },
    {
      jobType: 'ARCHIVE_DOWNLOAD',
      executionLane: 'ARCHIVE_DOWNLOAD',
      definitionVersion: ARCHIVE_COVERAGE_DEFINITION_VERSION,
      progressPolicy: 'REALTIME',
      parsePayload: (payload) => archiveImportV2PayloadSchema.parse(payload),
      execute: (context) => executeArchiveImport(context, dependencies)
    },
    {
      jobType: 'ARCHIVE_PUBLISH',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: ARCHIVE_COVERAGE_DEFINITION_VERSION,
      parsePayload: (payload) => archiveImportV2PayloadSchema.parse(payload),
      execute: (context) => executeArchivePublish(context, dependencies)
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
  const maxMediaAttempts = dependencies.config.maxMediaAttempts ?? DEFAULT_MAX_MEDIA_ATTEMPTS
  let finalizationStarted = false
  let inheritedDiagnosticsComplete = true
  const archiveImportId = context.payload.archiveImportId
  let checkpoints: ArchiveDownloadCheckpoints | undefined

  try {
    throwIfAborted(context.signal)
    const { archiveImport, mediaConcurrency } = await startArchiveImport(context, dependencies, now())
    inheritedDiagnosticsComplete = false
    await freezeInheritedArchiveFailures(context, archiveImport)
    inheritedDiagnosticsComplete = true
    const prepared = await prepareDownloadGeneration(context, dependencies, archiveImport)
    const { stagingDirectory, existingManifestDigest } = prepared
    const preparedCounts = await synchronizeArchiveCounts(context, archiveImportId)
    archiveImport.completedItems = preparedCounts.completed
    const provider = dependencies.providers.get(archiveImport.providerKey)
    const controller = linkedAbortController(context.signal)
    const transferMeter = new ArchiveTransferMeter(archiveImport.id, mediaConcurrency, archiveImport.totalItems, {
      completedBytes: archiveImport.items.reduce(
        (sum, item) => sum + (item.status === 'COMPLETED' ? (item.byteCount ?? 0n) : 0n),
        0n
      ),
      completedItems: archiveImport.completedItems,
      failedItems: archiveImport.failedItems
    })
    const saves = new ArchiveDownloadCheckpoints(context, archiveImport)
    checkpoints = saves
    const progressUpdate = () => {
      const telemetry = transferMeter.sample(now())
      return {
        progress: archiveProgress(telemetry.completedItems, telemetry.totalItems),
        stage: 'DOWNLOADING',
        message: `已下载 ${telemetry.completedItems}/${telemetry.totalItems}`,
        data: telemetry,
        persistenceMode: 'REALTIME' as const,
        forcePersistence: true
      }
    }
    const transferReporter = startArchiveTransferReporter({
      meter: transferMeter,
      controller,
      now,
      intervalMs: DOWNLOAD_SAVE_INTERVAL_MS,
      report: () => saves.save(progressUpdate),
      flush: () => saves.save(progressUpdate)
    })

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
              checkpoints: saves,
              progressUpdate,
              dependencies,
              archiveImport,
              item,
              provider,
              stagingDirectory,
              signal: controller.signal,
              mediaConcurrency,
              transferMeter,
              maxMediaAttempts,
              executionToken: context.job.executionToken,
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

        if (retryItems.length === 0 || round >= maxMediaAttempts) break
        await sleep(backoffWithJitter(round, random), controller.signal)
        roundItems = retryItems.sort((left, right) => left.pageIndex - right.pageIndex)
        round += 1
      }
    } finally {
      try {
        await transferReporter.stop()
      } finally {
        controller.dispose()
      }
    }

    throwIfAborted(context.signal)
    const counts = await synchronizeArchiveCounts(context, archiveImportId)
    if (counts.failed > 0) {
      await markDownloadDrained(context, now())
      finalizationStarted = true
      return finalizeArchiveFailure(context, archiveImportId, counts, now(), {
        code: 'PARTIAL_FAILURE',
        message: `归档导入部分失败：已完成 ${counts.completed}/${archiveImport.totalItems}，失败 ${counts.failed}`
      })
    }
    if (counts.pending > 0 || counts.downloading > 0) {
      throw new ArchiveExecutorError('MEDIA_INVALID', '归档导入仍有未完成的媒体检查点', {
        recoverable: true
      })
    }

    const completed = await context.mutateInTransaction<ArchiveTransaction, LoadedArchiveItem[]>(async (transaction) =>
      transaction.archiveImportItem.findMany({ where: { archiveImportId }, orderBy: { pageIndex: 'asc' } })
    )
    if (completed.length !== archiveImport.totalItems || completed.some((item) => item.status !== 'COMPLETED')) {
      throw new ArchiveExecutorError('MEDIA_INVALID', '归档导入检查点不完整', {
        recoverable: true
      })
    }
    await context.progress({ progress: 93, stage: 'VERIFYING', message: '校验归档完整性' })
    await context.mutateInTransaction<ArchiveTransaction>((transaction) =>
      assertArchiveDownloadGeneration(transaction, {
        archiveImport,
        jobId: context.job.id,
        token: context.job.executionToken
      })
    )
    await validateArchiveStoredMedia(stagingDirectory, completed)
    throwIfAborted(context.signal)
    const digest =
      existingManifestDigest ??
      (await writeArchiveManifest(stagingDirectory, {
        ...buildManifest(archiveImport, completed, now()),
        generationToken: context.job.executionToken
      }))
    throwIfAborted(context.signal)
    await markDownloadDrained(context, now())
    finalizationStarted = true
    return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
      if (await finalizeRequestedArchiveControl(scope, context, archiveImportId, now())) return
      await handoffArchivePhase(scope, context, 'PUBLISH', now(), { token: context.job.executionToken, digest })
    })
  } catch (error) {
    if (finalizationStarted) throw error
    await markDownloadDrained(context, now()).catch(() => undefined)
    // 如果当前执行已被触发“先清理暂存再重试”，返回 RELEASE，避免把清理需求误记为任务失败。
    if (error instanceof ArchiveCleanupRequestedError) {
      return releaseArchiveImportForCleanup(context, archiveImportId)
    }
    return handleArchiveExecutionFailure(
      context,
      archiveImportId,
      error,
      dependencies,
      now(),
      inheritedDiagnosticsComplete,
      checkpoints
    )
  }
}

async function startArchiveImport(
  context: ArchiveExecutorContext,
  dependencies: ArchiveExecutorDependencies,
  startedAt: Date
): Promise<{ archiveImport: LoadedArchiveImport; mediaConcurrency: number }> {
  return context.mutateInTransaction<
    ArchiveTransaction,
    { archiveImport: LoadedArchiveImport; mediaConcurrency: number }
  >(async (transaction) => {
    const mediaConcurrency = await freezeArchiveMediaConcurrency(transaction, dependencies.config.mediaConcurrency)
    const archiveImport = await transaction.archiveImport.findUnique({
      where: { id: context.payload.archiveImportId },
      include: { items: { orderBy: { pageIndex: 'asc' } } }
    })
    if (!archiveImport || archiveImport.systemJobId !== context.job.id) {
      throw new ArchiveExecutorError('STATE_CONFLICT', '归档导入载荷未绑定到当前任务')
    }
    if (archiveImport.phase !== (context.job.type === 'ARCHIVE_PUBLISH' ? 'PUBLISH' : 'DOWNLOAD')) {
      throw new ArchiveExecutorError('STATE_CONFLICT', '归档阶段与执行任务不匹配')
    }
    await assertArchiveSourceSnapshot(transaction, archiveImport)
    await assertArchiveImportNotDeleted(transaction, archiveImport)
    // 优先尊重 cleanupRequestedAt 门禁：清理未完成前不得再次启动下载流程，否则状态与文件会互相覆盖。
    if (archiveImport.cleanupRequestedAt) throw new ArchiveCleanupRequestedError()
    if (!['PENDING', 'RUNNING'].includes(archiveImport.status)) {
      throw new ArchiveExecutorError('STATE_CONFLICT', '归档导入当前状态不允许启动')
    }
    const registeredStagingPath =
      archiveImport.phase === 'DOWNLOAD'
        ? await registerArchiveDownloadGeneration(transaction, context, archiveImport, dependencies.config.scanRoot)
        : null
    await transaction.archiveImportItem.updateMany({
      where: { archiveImportId: archiveImport.id, status: 'DOWNLOADING' },
      data: { status: 'PENDING', startedAt: null, finishedAt: null }
    })
    const completedItems = archiveImport.items.filter((item) => item.status === 'COMPLETED').length
    const failedItems = archiveImport.items.filter((item) => item.status === 'FAILED').length
    const changed = await transaction.archiveImport.updateMany({
      where: {
        id: archiveImport.id,
        systemJobId: context.job.id,
        status: { in: ['PENDING', 'RUNNING'] },
        cleanupRequestedAt: null
      },
      data: {
        status: 'RUNNING',
        ...(registeredStagingPath
          ? {
              generationToken: context.job.executionToken,
              stagingPath: registeredStagingPath,
              sealedManifestSha256: null
            }
          : {}),
        startedAt: archiveImport.startedAt ?? startedAt,
        finishedAt: null,
        retainUntil: null,
        errorCode: null,
        errorMessage: null,
        completedItems,
        failedItems
      }
    })
    if (changed.count !== 1) {
      const latest = await transaction.archiveImport.findUnique({ where: { id: archiveImport.id } })
      if (latest?.systemJobId === context.job.id && latest.status === 'PENDING' && latest.cleanupRequestedAt) {
        throw new ArchiveCleanupRequestedError()
      }
      throw new ArchiveExecutorError('STATE_CONFLICT', '归档导入的启动状态已变化')
    }
    dependencies.logger?.info('archive.execution_started', { archiveImportId: archiveImport.id, jobId: context.job.id })
    const startedArchiveImport: LoadedArchiveImport = {
      ...archiveImport,
      status: 'RUNNING',
      completedItems,
      failedItems,
      items: archiveImport.items.map((item) =>
        item.status === 'DOWNLOADING'
          ? { ...item, status: 'PENDING' as const, startedAt: null, finishedAt: null }
          : item
      )
    }
    return { archiveImport: startedArchiveImport, mediaConcurrency }
  })
}

export async function freezeArchiveMediaConcurrency(
  transaction: ArchiveTransaction,
  configuredMediaConcurrency?: number
): Promise<number> {
  if (configuredMediaConcurrency !== undefined) {
    return archiveMediaConcurrencySchema.parse(configuredMediaConcurrency)
  }
  await transaction.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
    ARCHIVE_MEDIA_CONCURRENCY_ADVISORY_LOCK_KEY
  )
  const setting = await transaction.setting.findUnique({
    where: { key: ARCHIVE_MEDIA_CONCURRENCY_SETTING_KEY },
    select: { value: true }
  })
  const parsed = archiveMediaConcurrencySchema.safeParse(setting?.value ?? ARCHIVE_MEDIA_CONCURRENCY_DEFAULT)
  return parsed.success ? parsed.data : ARCHIVE_MEDIA_CONCURRENCY_DEFAULT
}

async function releaseArchiveImportForCleanup(
  context: ArchiveExecutorContext,
  archiveImportId: string
): Promise<JobExecutionOutcome<ArchiveExecutionResult>> {
  return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
    const archiveImport = await scope.transaction.archiveImport.findUnique({ where: { id: archiveImportId } })
    if (
      !archiveImport ||
      archiveImport.systemJobId !== context.job.id ||
      archiveImport.status !== 'PENDING' ||
      !archiveImport.cleanupRequestedAt
    ) {
      throw new ArchiveExecutorError('STATE_CONFLICT', '归档清理的释放状态已变化', {
        recoverable: true
      })
    }
    await scope.release('归档导入恢复前将先执行清理')
  })
}

class ArchiveCleanupRequestedError extends ArchiveExecutorError {
  constructor() {
    super('STATE_CONFLICT', '归档导入执行前必须先完成清理', { recoverable: true })
  }
}

async function downloadArchiveItem(input: {
  checkpoints: ArchiveDownloadCheckpoints
  progressUpdate: () => ExecutionProgressUpdate
  executionToken: string
  dependencies: ArchiveExecutorDependencies
  archiveImport: LoadedArchiveImport
  item: ArchiveMediaItem
  provider: ArchiveMediaProvider
  stagingDirectory: string
  signal: AbortSignal
  maxMediaAttempts: number
  mediaConcurrency: number
  transferMeter: ArchiveTransferMeter
  now: () => Date
}): Promise<ItemAttemptResult> {
  throwIfAborted(input.signal)
  const attempt = input.item.attempts + 1
  input.checkpoints.set(input.item.id, {
    status: 'DOWNLOADING',
    attempts: attempt,
    lastDownloadUrl: null,
    lastDownloadAt: null,
    lastDownloadAttempt: null,
    startedAt: input.now(),
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    errorStage: null,
    remoteHost: null
  })
  input.transferMeter.startItem({
    itemId: input.item.id,
    pageIndex: input.item.pageIndex,
    expectedFilename: input.item.expectedFilename,
    attempt
  })

  let mediaStored = false
  try {
    const remote = await input.provider.openMedia(toProviderMediaItem(input.item), {
      quality: input.archiveImport.selectedQuality,
      reloadMedia: attempt > 1,
      signal: input.signal,
      maxConcurrentDownloads: input.mediaConcurrency,
      onPhase: (phase) => input.transferMeter.markPhase(input.item.id, phase)
    })
    // The response can fail while its observation is committed, before the
    // storage consumer attaches its stream error handler.
    let remoteStreamError = remote.stream.errored ?? undefined
    const captureRemoteError = (error: Error) => {
      remoteStreamError ??= error
    }
    remote.stream.on('error', captureRemoteError)
    remote.stream.once('close', () => remote.stream.removeListener('error', captureRemoteError))
    input.transferMeter.beginDownload(input.item.id, remote.contentLength)
    const abortRemoteStream = () =>
      remote.stream.destroy(
        input.signal.reason instanceof Error
          ? input.signal.reason
          : new ArchiveExecutorError('CANCELLED', '归档执行已取消')
      )
    if (input.signal.aborted) abortRemoteStream()
    else input.signal.addEventListener('abort', abortRemoteStream, { once: true })
    let stored
    try {
      const downloadUrl = observedDownloadUrl(remote.downloadUrl)
      if (downloadUrl !== null) {
        input.checkpoints.set(input.item.id, {
          lastDownloadUrl: downloadUrl,
          lastDownloadAt: input.now(),
          lastDownloadAttempt: attempt
        })
      }
      throwIfAborted(input.signal)
      if (remoteStreamError) {
        throw new ArchiveExecutorError('REMOTE_RESPONSE_INVALID', '远端归档媒体响应后连接中断', {
          cause: remoteStreamError,
          recoverable: true,
          stage: 'MEDIA_STREAM',
          remoteHost: remote.remoteHost
        })
      }
      stored = await storeArchiveRemoteMedia({
        remote,
        stagingDirectory: input.stagingDirectory,
        index: input.item.pageIndex,
        expectedFilename: input.item.expectedFilename,
        signal: input.signal,
        ...(input.dependencies.config.maxMediaBytes === undefined
          ? {}
          : { maxBytes: input.dependencies.config.maxMediaBytes }),
        partialKey: input.executionToken,
        onChunk: (byteLength) => input.transferMeter.addChunk(input.item.id, byteLength),
        onStreamComplete: () => input.transferMeter.markVerifying(input.item.id)
      })
    } finally {
      input.signal.removeEventListener('abort', abortRemoteStream)
      if (!remote.stream.destroyed) remote.stream.destroy()
    }
    mediaStored = true
    input.checkpoints.set(input.item.id, {
      status: 'COMPLETED',
      stagedPath: stored.relativePath,
      stagedGenerationPath: input.archiveImport.stagingPath,
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
    })
    input.transferMeter.complete(input.item.id, stored.byteCount)
    await input.checkpoints.saveIfFull(input.progressUpdate)
    return { kind: 'COMPLETED' }
  } catch (error) {
    const classified = toArchiveExecutorError(error)
    if (mediaStored || input.signal.aborted) {
      input.transferMeter.fail(input.item.id, false)
      throw input.signal.aborted ? (input.signal.reason ?? classified) : classified
    }
    const retry = isRetryableItemFailure(classified) && attempt < input.maxMediaAttempts
    const terminalItemFailure = !retry && !classified.pause
    input.transferMeter.fail(input.item.id, terminalItemFailure)
    input.checkpoints.set(
      input.item.id,
      {
        status: terminalItemFailure ? 'FAILED' : 'PENDING',
        errorCode: classified.code,
        errorMessage: classified.message,
        errorStage: classified.stage,
        remoteHost: classified.remoteHost,
        finishedAt: terminalItemFailure ? input.now() : null
      },
      terminalItemFailure
        ? {
            key: `archive-item:${input.item.id}`,
            scope: 'ITEM',
            targetType: 'ARCHIVE_MEDIA',
            targetId: input.item.id,
            targetLabel: `第 ${input.item.pageIndex + 1} 页 · ${input.item.expectedFilename}`,
            stage: classified.stage ?? 'DOWNLOADING',
            code: classified.code,
            message: classified.message,
            error: classified,
            remoteHost: classified.remoteHost,
            httpStatus: classified.httpStatus,
            itemAttempt: attempt
          }
        : undefined
    )
    await input.checkpoints.saveIfFull(input.progressUpdate)
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
  now: Date,
  diagnosticComplete = true,
  checkpoints?: ArchiveDownloadCheckpoints
): Promise<JobExecutionOutcome<ArchiveExecutionResult>> {
  if (checkpoints) {
    const finalize = context.finalizeInTransaction
    context = {
      ...context,
      finalizeInTransaction: <TTransaction extends QueueSqlExecutor>(
        operation: (scope: FencedExecutionTransaction<TTransaction>) => Promise<void>
      ) =>
        finalize<TTransaction>(async (scope) => {
          await checkpoints.saveOnStop(scope.transaction as unknown as ArchiveTransaction)
          return operation(scope)
        })
    }
  }
  const interruption = interruptionReason(context.signal.reason)
  if (context.signal.aborted && interruption === 'CANCEL_REQUESTED') {
    return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
      if (await finalizeRequestedArchiveControl(scope, context, archiveImportId, now)) return
      const counts = await readCounts(scope.transaction, archiveImportId)
      await finishArchiveImport(scope.transaction, {
        archiveImportId,
        status: 'CANCELLED',
        counts,
        now,
        errorCode: 'CANCELLED',
        errorMessage: '归档导入已取消'
      })
      await scope.cancel('归档导入已取消')
    })
  }
  if (context.signal.aborted && interruption === 'PAUSE_REQUESTED') {
    return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
      if (await finalizeRequestedArchiveControl(scope, context, archiveImportId, now)) return
      await pauseOrReleaseArchiveImport(scope.transaction, archiveImportId, 'PAUSED')
      await scope.pause({ reason: 'USER_REQUESTED', message: '归档导入已暂停' })
    })
  }
  if (context.signal.aborted && interruption === 'SHUTDOWN') {
    return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
      if (await finalizeRequestedArchiveControl(scope, context, archiveImportId, now)) return
      await pauseOrReleaseArchiveImport(scope.transaction, archiveImportId, 'PENDING')
      await scope.release('归档后台任务进程已停止，导入将在恢复后继续')
    })
  }
  if (context.signal.aborted) throw context.signal.reason ?? error

  const classified = toArchiveExecutorError(error)
  dependencies.logger?.error('archive.execution_failed', classified, { archiveImportId, code: classified.code })
  return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
    // A control request can change the queue row to PAUSING/CANCELLING before the
    // dispatcher propagates its AbortSignal. Ordinary checkpoint transactions
    // reject that controlled execution, so re-read the locked queue state here
    // before classifying the checkpoint error as a business failure.
    if (await finalizeRequestedArchiveControl(scope, context, archiveImportId, now)) return
    if (classified.code === 'STATE_CONFLICT') {
      const current = await scope.transaction.archiveImport.findUnique({ where: { id: archiveImportId } })
      // Respect a paused domain record left by an older control endpoint. Do not
      // attempt an illegal PAUSED -> FAILED transition or stop the dispatcher.
      if (current?.systemJobId === context.job.id && current.status === 'PAUSED') {
        await scope.pause({ reason: 'ACTION_REQUIRED', message: '归档记录仍为暂停状态，请从归档详情继续' })
        return
      }
      if (
        !current ||
        current.systemJobId !== context.job.id ||
        ['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.status)
      ) {
        await scope.fail({
          diagnostic: extractJobDiagnostic(classified),
          errorCode: 'STATE_CONFLICT',
          error: classified.message,
          message: classified.message
        })
        return
      }
    }
    const counts = await readCounts(scope.transaction, archiveImportId)
    if (classified.pause) {
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
      if (changed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', '归档暂停状态已变化')
      await context.recordDiagnostic?.(scope.transaction, {
        key: 'task:action-required',
        scope: 'TASK',
        stage: classified.stage ?? undefined,
        error: classified
      })
      await scope.pause({
        reason: 'ACTION_REQUIRED',
        message: classified.message,
        data: {
          errorCode: classified.code,
          decisionCode: classified.decisionCode
        }
      })
      return
    }
    await finishArchiveImport(scope.transaction, {
      archiveImportId,
      status: 'FAILED',
      counts,
      now,
      errorCode: classified.code,
      errorMessage: classified.message
    })
    await scope.fail({
      diagnostic: extractJobDiagnostic(classified),
      diagnosticComplete,
      errorCode: mapArchiveJobErrorCode(classified.code),
      error: classified.message,
      message: classified.message
    })
  })
}

const INHERITED_DIAGNOSTIC_BATCH_SIZE = 100

async function freezeInheritedArchiveFailures(context: ArchiveExecutorContext, archiveImport: LoadedArchiveImport) {
  if (!context.recordDiagnostic) return
  const inheritedIds = archiveImport.items.filter((item) => item.status === 'FAILED').map((item) => item.id)
  for (let offset = 0; offset < inheritedIds.length; offset += INHERITED_DIAGNOSTIC_BATCH_SIZE) {
    throwIfAborted(context.signal)
    const ids = inheritedIds.slice(offset, offset + INHERITED_DIAGNOSTIC_BATCH_SIZE)
    await context.mutateInTransaction<ArchiveTransaction>(async (transaction) => {
      // Read the durable evidence again under the execution fence; retries may have reset old failures.
      const failed = await transaction.archiveImportItem.findMany({
        where: { archiveImportId: archiveImport.id, id: { in: ids }, status: 'FAILED' },
        orderBy: { pageIndex: 'asc' },
        take: INHERITED_DIAGNOSTIC_BATCH_SIZE
      })
      for (const item of failed) {
        await context.recordDiagnostic!(transaction, {
          key: `archive-item:${item.id}`,
          scope: 'ITEM',
          origin: 'INHERITED',
          targetType: 'ARCHIVE_MEDIA',
          targetId: item.id,
          targetLabel: `第 ${item.pageIndex + 1} 页 · ${item.expectedFilename}`,
          stage: item.errorStage ?? 'DOWNLOADING',
          code: item.errorCode ?? 'PARTIAL_FAILURE',
          message: item.errorMessage ?? '此前执行遗留的媒体失败检查点',
          remoteHost: item.remoteHost,
          itemAttempt: item.attempts
        })
      }
    })
  }
}

async function finalizeArchiveFailure(
  context: ArchiveExecutorContext,
  archiveImportId: string,
  counts: ArchiveItemCounts,
  now: Date,
  error: { code: string; message: string }
) {
  return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
    if (await finalizeRequestedArchiveControl(scope, context, archiveImportId, now)) return
    await finishArchiveImport(scope.transaction, {
      archiveImportId,
      status: 'FAILED',
      counts,
      now,
      errorCode: error.code,
      errorMessage: error.message
    })
    await scope.fail({
      diagnostic: extractJobDiagnostic(error),
      errorCode: mapArchiveJobErrorCode(error.code),
      error: error.message,
      message: error.message
    })
  })
}

async function finalizeRequestedArchiveControl(
  scope: FencedExecutionTransaction<ArchiveTransaction>,
  context: ArchiveExecutorContext,
  archiveImportId: string,
  now: Date
): Promise<boolean> {
  if (scope.executionStatus !== 'RUNNING') {
    const current = await scope.transaction.archiveImport.findUnique({ where: { id: archiveImportId } })
    if (current?.generationToken && current.phase === 'DOWNLOAD') {
      await scope.transaction.archiveStagingGeneration.updateMany({
        where: { token: context.job.executionToken, jobId: context.job.id, archiveImportId },
        data: { drainedAt: now }
      })
    }
  }
  if (scope.executionStatus === 'CANCELLING') {
    const counts = await readCounts(scope.transaction, archiveImportId)
    await finishArchiveImport(scope.transaction, {
      archiveImportId,
      status: 'CANCELLED',
      counts,
      now,
      errorCode: 'CANCELLED',
      errorMessage: '归档导入已取消'
    })
    await scope.cancel('归档导入已取消')
    return true
  }
  if (scope.executionStatus === 'PAUSING') {
    await pauseOrReleaseArchiveImport(scope.transaction, archiveImportId, 'PAUSED')
    await scope.pause({ reason: 'USER_REQUESTED', message: '归档导入已暂停' })
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
  const archiveImport = await transaction.archiveImport.findUnique({
    where: { id: input.archiveImportId },
    select: { providerKey: true, externalId: true, canonicalUrl: true }
  })
  if (!archiveImport) throw new ArchiveExecutorError('STATE_CONFLICT', '归档导入在状态转换前已不存在')
  await lockArchiveUploaderCatalogIdentities(transaction, [
    {
      providerKey: archiveImport.providerKey,
      externalId: archiveImport.externalId,
      canonicalUrls: [archiveImport.canonicalUrl]
    }
  ])
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
  if (changed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', '归档终止状态已变化')
  await transaction.archiveUploaderCatalogItem.updateMany({
    where: {
      OR: [
        { lastArchiveImportId: input.archiveImportId },
        { providerKey: archiveImport.providerKey, externalId: archiveImport.externalId }
      ]
    },
    data: {
      lastArchiveImportId: input.archiveImportId,
      lastOutcome: input.status,
      lastOutcomeAt: input.now,
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage
    }
  })
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
  if (changed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', '归档生命周期状态已变化')
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

function relationshipValues(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const relationships = (value as Record<string, unknown>).relationships
  return Array.isArray(relationships) ? relationships : []
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new ArchiveExecutorError('CANCELLED', '归档执行意外中断')
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  await delay(milliseconds, undefined, { signal })
}

function validateDependencies(dependencies: ArchiveExecutorDependencies): void {
  if (!dependencies.config.scanRoot.trim()) throw new Error('归档执行器需要配置扫描根目录')
  for (const [name, value] of [
    ['mediaConcurrency', dependencies.config.mediaConcurrency],
    ['maxMediaAttempts', dependencies.config.maxMediaAttempts],
    ['maxMediaBytes', dependencies.config.maxMediaBytes]
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`归档执行器配置 ${name} 必须是正安全整数`)
    }
  }
}

function observedDownloadUrl(value: string | undefined): string | null {
  if (!value || value.trim() !== value) return null
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password
      ? value
      : null
  } catch {
    return null
  }
}

async function executeLegacyArchiveHandoff(context: ArchiveExecutorContext, dependencies: ArchiveExecutorDependencies) {
  const now = (dependencies.now ?? (() => new Date()))()
  return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
    if (await finalizeRequestedArchiveControl(scope, context, context.payload.archiveImportId, now)) return
    await handoffArchivePhase(scope, context, 'DOWNLOAD', now)
  })
}

async function executeArchivePublish(
  context: ArchiveExecutorContext,
  dependencies: ArchiveExecutorDependencies
): Promise<JobExecutionOutcome<ArchiveExecutionResult>> {
  const now = dependencies.now ?? (() => new Date())
  let finalizationStarted = false
  let publicationClaimAttempted = false
  try {
    throwIfAborted(context.signal)
    const { archiveImport } = await startArchiveImport(context, dependencies, now())
    if (!archiveImport.generationToken || !archiveImport.sealedManifestSha256) {
      throw new ArchiveExecutorError('STATE_CONFLICT', '归档发布缺少封存代')
    }
    const paths = buildArchiveStoragePaths({
      scanRoot: dependencies.config.scanRoot,
      archiveImportId: archiveImport.id,
      providerKey: archiveImport.providerKey,
      creatorBucket: archiveImport.creatorBucket,
      externalId: archiveImport.externalId,
      generationToken: archiveImport.generationToken
    })
    paths.stagingRelativePath = archiveImport.stagingPath
    paths.stagingAbsolutePath = path.resolve(dependencies.config.scanRoot, archiveImport.stagingPath)
    const mediaDirectory = await resolveExecutorMediaDirectory({
      context,
      sourceRoot: dependencies.config.sourceMediaRoot ?? dependencies.config.scanRoot,
      archiveRoot: dependencies.config.scanRoot,
      location: 'archive',
      relativeDirectory: paths.finalRelativePath
    })
    const replacedArtworkId = await context.mutateInTransaction<ArchiveTransaction, number | null>(
      async (transaction) => {
        const current = await transaction.archiveImport.findUniqueOrThrow({ where: { id: archiveImport.id } })
        assertArchiveSourceUnchanged(current, archiveImport)
        await lockArchiveSourcePublication(transaction, { ...archiveImport, directory: mediaDirectory })
        const generation = await transaction.archiveStagingGeneration.findUnique({
          where: { token: archiveImport.generationToken! }
        })
        if (
          current.systemJobId !== context.job.id ||
          current.phase !== 'PUBLISH' ||
          current.cleanupRequestedAt ||
          current.generationToken !== archiveImport.generationToken ||
          !generation?.sealedAt ||
          !generation.drainedAt ||
          generation.cleanedAt ||
          generation.manifestSha256 !== archiveImport.sealedManifestSha256
        ) {
          throw new ArchiveExecutorError('STATE_CONFLICT', '封存代不允许发布')
        }
        await assertArchiveImportNotDeleted(transaction, current)
        const source = await transaction.artworkExternalRef.findUnique({
          where: { providerKey_externalId: { providerKey: current.providerKey, externalId: current.externalId } },
          include: { artwork: true }
        })
        if (source && (source.artwork.deletedAt || source.artwork.archiveLifecycleState !== 'ACTIVE')) {
          throw new ArchiveExecutorError('STATE_CONFLICT', '归档作品已不再活动')
        }
        await assertArchiveCompletionBase(transaction, current)
        return source?.artworkId ?? null
      }
    )
    await context.progress({ progress: 97, stage: 'PUBLISHING', message: '归档入库中' })
    const finalAlreadyPublished = await pathExists(paths.finalAbsolutePath)
    const sourceDirectory = finalAlreadyPublished ? paths.finalAbsolutePath : paths.stagingAbsolutePath
    await readArchiveManifestDigest(sourceDirectory, archiveImport.sealedManifestSha256)
    throwIfAborted(context.signal)
    publicationClaimAttempted = true
    const recoveredWrite = finalAlreadyPublished
      ? await recoverCompletedArchivePublicationWrite({
          context,
          directory: mediaDirectory,
          paths,
          archiveImport,
          expectedArtworkId: replacedArtworkId,
          now: now()
        })
      : null
    const mediaWrite =
      recoveredWrite ??
      (await beginExecutorMediaWrite({
        context: {
          ...context,
          mutateInTransaction: <TTransaction extends QueueSqlExecutor, TResult = void>(
            operation: (transaction: TTransaction) => Promise<TResult>
          ) =>
            context.mutateInTransaction<ArchiveTransaction, TResult>(async (transaction) => {
              const current = await transaction.archiveImport.findUniqueOrThrow({ where: { id: archiveImport.id } })
              assertArchiveSourceUnchanged(current, archiveImport)
              await lockArchiveSourcePublication(transaction, { ...archiveImport, directory: mediaDirectory })
              if (
                current.systemJobId !== context.job.id ||
                current.phase !== 'PUBLISH' ||
                current.cleanupRequestedAt ||
                current.generationToken !== archiveImport.generationToken
              ) {
                throw new ArchiveExecutorError('STATE_CONFLICT', '归档发布绑定在声明建立前已变化')
              }
              await assertArchiveCompletionBase(transaction, current)
              return operation(transaction as unknown as TTransaction)
            })
        },
        directory: mediaDirectory,
        scope: { kind: 'DIRECTORY' },
        sessionId: `archive-publish:${archiveImport.id}`,
        now: now(),
        artworkIds: replacedArtworkId === null ? [] : [replacedArtworkId]
      }))
    if (!recoveredWrite) await prepareArchiveRevisionDirectory(paths, archiveImport.sealedManifestSha256)
    throwIfAborted(context.signal)
    finalizationStarted = true
    return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
      if (await finalizeRequestedArchiveControl(scope, context, archiveImport.id, now())) {
        // Publication only staged a new immutable revision; the previously registered bytes are unchanged.
        await publishExecutorMediaWrite(scope.transaction, mediaWrite, 'verified-rollback', async () => undefined)
        return
      }
      const current = await scope.transaction.archiveImport.findUniqueOrThrow({ where: { id: archiveImport.id } })
      assertArchiveSourceUnchanged(current, archiveImport)
      await lockArchiveSourcePublication(scope.transaction, { ...archiveImport, directory: mediaDirectory })
      if (
        current.systemJobId !== context.job.id ||
        current.phase !== 'PUBLISH' ||
        current.cleanupRequestedAt ||
        current.generationToken !== archiveImport.generationToken
      ) {
        throw new ArchiveExecutorError('STATE_CONFLICT', '归档发布绑定已变化')
      }
      const result = await publishExecutorMediaWrite(scope.transaction, mediaWrite, 'committed', (transaction) =>
        publishArchiveImportInTransaction(
          transaction,
          archiveImport.id,
          paths,
          now(),
          context.payload.defaultTagIds,
          replacedArtworkId
        )
      )
      await finalizeArchivePublication(scope, context.job.id, result, now())
    })
  } catch (error) {
    if (finalizationStarted) throw error
    if (publicationClaimAttempted) {
      context.logger.error('archive.publication_recovery_required', error, {
        archiveImportId: context.payload.archiveImportId
      })
      return context.finalizeInTransaction<ArchiveTransaction>(async (scope) => {
        // Unknown file outcomes keep the original PUBLISH identity; an expired cancelling lease will be paused.
        if (scope.executionStatus === 'CANCELLING') throw error
        await pauseOrReleaseArchiveImport(scope.transaction, context.payload.archiveImportId, 'PAUSED')
        await scope.pause({
          reason: 'ACTION_REQUIRED',
          message: '归档发布声明未完成，请停写核对并授权恢复原 PUBLISH 任务',
          data: { errorCode: 'CONTENT_WRITE_RECOVERY_REQUIRED' }
        })
      })
    }
    if (error instanceof ArchiveCleanupRequestedError) {
      return releaseArchiveImportForCleanup(context, context.payload.archiveImportId)
    }
    return handleArchiveExecutionFailure(context, context.payload.archiveImportId, error, dependencies, now())
  }
}
