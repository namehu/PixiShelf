import path from 'node:path'
import { scanVisualSearch } from './visual-search.ts'
import { VisualSearchWorker } from './visual-search-worker.ts'
import { scanBatchedVisualVersions } from './visual-batches.ts'
import { scanVisualVersions } from './visual-pipeline.ts'
import { randomUUID } from 'node:crypto'
import {
  assertArtworkDedupExecution,
  assertArtworkDedupCacheDirectories,
  ARTWORK_DEDUP_RELATION_CACHE_VERSION,
  buildArtworkDedupCandidates,
  buildArtworkDedupGroups,
  buildArtworkDedupRelationsPage,
  buildArtworkDedupPartialPage,
  claimArtworkDedupReader,
  readArtworkDedupItemsPage,
  recordArtworkDedupReaderOwner,
  refreshArtworkDedupCounts,
  releaseArtworkDedupReader,
  saveArtworkDedupItem,
  updateArtworkDedupRun,
  type ArtworkDedupExecution,
  type Prisma,
  type PrismaClient
} from '@pixishelf/db'
import {
  artworkDedupScanPayloadSchema,
  artworkDedupPerformanceSummarySchema,
  type ArtworkDedupPerformanceSummary,
  type ArtworkDedupProgressData,
  type ArtworkDedupProgressPhase,
  type ArtworkDedupScanPayload
} from '@pixishelf/job-contracts'
import type { ExecutionContext, ExecutorDefinition, EnqueuedChildJob, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { MediaContentFileError, resolveMediaContentRoots } from '../media-content/roots.ts'
import { throwIfAborted } from '../scan/bounded.ts'
import { ARTWORK_DEDUP_LIMITS as limits } from './limits.ts'
import { DedupItemError, hashArtwork, statArtwork, type DedupTransaction } from './pipeline.ts'
import {
  ControlledDedupReader,
  DedupReaderError,
  DedupReaderSupervisor,
  type DedupReaderOptions,
  type ReaderMetrics
} from './reader.ts'
import { releaseExitedDedupReader } from './reader-latch.ts'
import { rootBindings, sameRootBindings } from './root-bindings.ts'
import {
  advanceArtworkDedupPerformance,
  artworkDedupPerformanceLogDue,
  artworkDedupProgress,
  createArtworkDedupPerformance,
  type ArtworkDedupPerformanceDelta,
  type ArtworkDedupPerformanceLogReason
} from './telemetry.ts'
import { addDedupDatabaseMeasurement, emptyDedupDatabaseMeasurement, measureDedupDatabase } from './executor-telemetry.ts'

type Tx = Prisma.TransactionClient & QueueSqlExecutor
type Run = Prisma.ArtworkDedupRunGetPayload<Record<string, never>>
export interface ArtworkDedupDependencies {
  database: PrismaClient
  sourceRoot: string
  archiveRoot: string
  readerOptions: DedupReaderOptions
  supervisor?: DedupReaderSupervisor
  now?: () => number
  sliceMs?: number
  sliceBytes?: bigint
  searchCache?: {
    runId?: string
    worker?: VisualSearchWorker | undefined
    built?: boolean
    lastTelemetry?: Pick<ArtworkDedupPerformanceSummary, 'phase' | 'updatedAt'> | undefined
  }
  onMeasurement?: (value: ReaderMetrics & { runId: string; elapsedMs: number; transactions: number }) => void
}
export function createArtworkDedupExecutor(dependencies: ArtworkDedupDependencies, definitionVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 = 1): ExecutorDefinition {
  const supervisor = dependencies.supervisor ?? new DedupReaderSupervisor(dependencies.readerOptions)
  const searchCache = dependencies.searchCache ?? {}
  return {
    jobType: 'ARTWORK_DEDUP_SCAN',
    definitionVersion,
    executionLane: 'BACKGROUND_WRITER',
    progressPolicy: 'STANDARD',
    parsePayload: (value) => artworkDedupScanPayloadSchema.parse(value),
    execute: (context: ExecutionContext<ArtworkDedupScanPayload, EnqueuedChildJob>) =>
      executeArtworkDedup(context, { ...dependencies, supervisor, searchCache })
  } as ExecutorDefinition
}

export async function executeArtworkDedup(
  context: ExecutionContext<ArtworkDedupScanPayload, EnqueuedChildJob>,
  dependencies: ArtworkDedupDependencies
) {
  const now = dependencies.now ?? Date.now
  const started = now()
  const startedWall = performance.now()
  const execution: ArtworkDedupExecution = { ...context.payload, jobId: context.job.id }
  const v2 = context.job.definitionVersion >= 8
  const searchCache = dependencies.searchCache ?? {}
  const measured = emptyDedupDatabaseMeasurement()
  let pendingReads = emptyDedupDatabaseMeasurement()
  let savedMeasurement = emptyDedupDatabaseMeasurement()
  let savedActiveMs = 0
  let schedulingAccounted = false
  type PendingTelemetry = { summary: ArtworkDedupPerformanceSummary; measurement: typeof measured; progress: ArtworkDedupProgressData; activeMs: number }
  let pendingTelemetry: PendingTelemetry | undefined
  let latestProgress = context.job.progressData?.kind === 'artwork-dedup' ? context.job.progressData : null
  let finalLogReason: ArtworkDedupPerformanceLogReason = 'CHECKPOINT'
  const emitPerformance = (summary: ArtworkDedupPerformanceSummary, reason: ArtworkDedupPerformanceLogReason = 'CHECKPOINT') => {
    if (!artworkDedupPerformanceLogDue(searchCache.lastTelemetry ?? null, summary, reason)) return
    context.logger.info('artwork-dedup.performance', { reason, ...summary })
    searchCache.lastTelemetry = { phase: summary.phase, updatedAt: summary.updatedAt }
  }
  const writePerformanceEvent = async (tx: Prisma.TransactionClient, summary: ArtworkDedupPerformanceSummary, reason: ArtworkDedupPerformanceLogReason = 'CHECKPOINT') => {
    if (!artworkDedupPerformanceLogDue(searchCache.lastTelemetry ?? null, summary, reason)) return
    await tx.systemJobEvent.create({ data: {
      jobId: execution.jobId,
      type: searchCache.lastTelemetry?.phase === summary.phase ? 'job.progress' : 'job.stage_changed',
      level: 'INFO', attempt: context.job.attempt, workerId: context.job.workerId,
      stage: summary.phase, progress: null, message: '重复检测性能汇总',
      data: { reason, ...summary } as unknown as Prisma.InputJsonValue
    } })
  }
  const saveTelemetry = async (tx: Prisma.TransactionClient, run: Run, options: {
    phase?: ArtworkDedupProgressPhase
    completed?: number | null
    total?: number | null
    unit?: ArtworkDedupProgressData['unit']
    waitReason?: ArtworkDedupProgressData['waitReason']
    delta?: ArtworkDedupPerformanceDelta
    reason?: ArtworkDedupPerformanceLogReason
  } = {}) => {
    if (!v2) return
    const updatedAt = new Date(now()).toISOString()
    const previous = run.performanceSummary === null ? null : artworkDedupPerformanceSummarySchema.parse(run.performanceSummary)
    const phase = options.phase ?? (run.stage === 'VISUAL'
      ? run.visualCheckpoint === null ? 'FEATURES' : previous?.phase ?? 'INDEX'
      : run.stage === 'GROUP' || run.stage === 'MATCH' ? 'PAIR' : run.stage === 'DONE' ? 'PUBLISH' : 'ORIGINALS')
    const base = previous ?? createArtworkDedupPerformance({
      runId: run.id, jobId: execution.jobId, protocolVersion: context.job.definitionVersion,
      searchVersion: run.visualSearchVersion, inputDigest: run.visualInputDigest, phase, updatedAt
    })
    const delta = options.delta
    const activeMs = performance.now() - startedWall
    const availableAt = context.job.availableAt.getTime()
    const schedulingDurations = schedulingAccounted ? {} : {
      queue: Math.max(0, started - availableAt),
      ...(context.job.progressData?.kind === 'artwork-dedup' && context.job.progressData.waitReason === 'SCHEDULER'
          ? { cooldown: Math.max(0, availableAt - Date.parse(context.job.progressData.updatedAt)) }
          : {})
    }
    const summary = advanceArtworkDedupPerformance(base, {
      ...delta, updatedAt, phase, complete: options.reason === 'COMPLETED',
      progress: { originals: run.hashedMedia + run.cacheHitMedia, ...delta?.progress },
      counters: {
        ...delta?.counters,
        readBytes: Number(run.readBytes) - (base.counters.readBytes ?? 0),
        dbLoadCalls: measured.dbLoadCalls - savedMeasurement.dbLoadCalls,
        dbValidationCalls: measured.dbValidationCalls - savedMeasurement.dbValidationCalls,
        dbWriteCalls: measured.dbWriteCalls - savedMeasurement.dbWriteCalls,
        transactions: measured.transactions - savedMeasurement.transactions
      },
      durationsMs: {
        ...delta?.durationsMs,
        ...schedulingDurations,
        dbLoad: measured.dbLoadMs - savedMeasurement.dbLoadMs,
        dbValidation: measured.dbValidationMs - savedMeasurement.dbValidationMs,
        dbWrite: measured.dbWriteMs - savedMeasurement.dbWriteMs,
        transactionWall: measured.transactionWallMs - savedMeasurement.transactionWallMs,
        active: activeMs - savedActiveMs
      }
    })
    const progress = artworkDedupProgress({
      phase,
      completed: options.completed !== undefined ? options.completed : phase === 'ORIGINALS'
        ? run.stage === 'STAT' ? run.statMedia : run.hashedMedia + run.cacheHitMedia
        : phase === 'VISUAL' ? summary.progress.queryCompleted : phase === 'FEATURES' ? latestProgress?.phase === 'FEATURES' ? latestProgress.completed : null : null,
      total: options.total !== undefined ? options.total : phase === 'VISUAL' ? summary.progress.queryTotal : phase === 'FEATURES' && latestProgress?.phase === 'FEATURES' ? latestProgress.total : null,
      unit: options.unit ?? (phase === 'PAIR' ? 'pairs' : phase === 'ORIGINALS' ? 'media' : 'images'),
      waitReason: options.waitReason ?? null,
      uncheckedMedia: summary.progress.uncheckedMedia,
      updatedAt
    })
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { performanceSummary: summary as unknown as Prisma.InputJsonValue } })
    await tx.systemJob.update({ where: { id: execution.jobId }, data: { progressData: progress as unknown as Prisma.InputJsonValue, stage: run.stage } })
    await writePerformanceEvent(tx, summary, options.reason)
    pendingTelemetry = { summary, measurement: { ...measured }, progress, activeMs }
    if (options.reason) finalLogReason = options.reason
  }
  let transactions = 0
  const transaction: DedupTransaction = async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
    transactions++
    const current = emptyDedupDatabaseMeasurement()
    const began = performance.now()
    pendingTelemetry = undefined
    try {
      const result = await context.mutateInTransaction<Tx, T>((tx) => operation(v2 ? measureDedupDatabase(tx, current, 'validation') : tx))
      if (v2) {
        current.transactions = 1
        current.transactionWallMs = performance.now() - began
        addDedupDatabaseMeasurement(measured, current)
        addDedupDatabaseMeasurement(measured, pendingReads)
        pendingReads = emptyDedupDatabaseMeasurement()
        const committed = pendingTelemetry as PendingTelemetry | undefined
        if (committed) {
          savedMeasurement = committed.measurement
          savedActiveMs = committed.activeMs
          schedulingAccounted = true
          latestProgress = committed.progress
          emitPerformance(committed.summary)
        }
      }
      return result
    } catch (error) {
      pendingReads = emptyDedupDatabaseMeasurement()
      pendingTelemetry = undefined
      throw error
    }
  }
  const closeSearch = async () => {
    const worker = searchCache.worker
    searchCache.worker = undefined
    searchCache.built = false
    await worker?.close()
  }
  const abortSearch = () => { void closeSearch() }
  context.signal.addEventListener('abort', abortSearch, { once: true })
  let pureCompute = false
  let keepSearch = false
  let reader: ControlledDedupReader | undefined
  let claimed = false
  let failure: unknown
  let done = false
  const readerToken = randomUUID()
  let bytesAtStart = 0n
  let progressPending: Promise<void> | undefined
  let progressFailure: unknown
  try {
    throwIfAborted(context.signal)
    if (searchCache.runId !== execution.runId) searchCache.lastTelemetry = undefined
    const initial = await transaction(async (tx) => {
      const run = await assertArtworkDedupExecution(tx, execution)
      await saveTelemetry(tx, run)
      return run
    })
    bytesAtStart = initial.readBytes
    let stage = initial.stage
    pureCompute = context.job.definitionVersion >= 8 && initial.stage === 'VISUAL' && initial.visualCheckpoint !== null
    if (searchCache.runId !== execution.runId) {
      await searchCache.worker?.close(); searchCache.worker = undefined; searchCache.built = false; searchCache.runId = execution.runId
    }
    if (!pureCompute) {
      await releaseExitedDedupReader(dependencies.database, dependencies.readerOptions)
      await transaction((tx) => claimArtworkDedupReader(tx, { execution, readerToken }))
      claimed = true
      reader = (dependencies.supervisor ?? new DedupReaderSupervisor(dependencies.readerOptions)).create()
      let lastProgress = initial.lastProgressAt?.getTime() ?? started
      reader.onProgress = (metrics) => {
        if (progressPending || now() - lastProgress < limits.progressMs || context.signal.aborted) return
        lastProgress = now()
        progressPending = context
          .progress({
            progress: v2 ? 0 : Math.min(99, Math.floor((initial.processedArtworks / Math.max(1, initial.artworkCount)) * 100)),
            stage,
            message: '正在检测原媒体',
            data: {
              runId: execution.runId,
              readBytes: (bytesAtStart + metrics.bytesRead).toString(),
              inspectedMedia: metrics.inspections
            }
          })
          .catch(async (error: unknown) => {
            progressFailure = error
            await reader!.close(error instanceof Error ? error : new Error('Progress persistence failed'))
          })
          .finally(() => {
            progressPending = undefined
          })
        void progressPending.catch(() => undefined)
      }
      const owner = await reader.start(context.signal)
      await transaction((tx) => recordArtworkDedupReaderOwner(tx, { execution, readerToken, owner }))
    }
    throwIfAborted(context.signal)
    const inventory = await transaction((tx) =>
      tx.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' }, select: { rootIdentity: true } })
    )
    const resolveRoots = (input: Parameters<typeof resolveMediaContentRoots>[0]) => reader ? reader.resolveRoots({ operation: 'roots', ...input }, context.signal) : resolveMediaContentRoots(input)
    const roots = await resolveRoots(
      {
        sourceRoot: dependencies.sourceRoot,
        archiveRoot: dependencies.archiveRoot,
        expectedPixivRootIdentity: inventory?.rootIdentity ?? null
      }
    )
    const bindings = rootBindings(roots)
    await transaction(async (tx) => {
      const current = await assertArtworkDedupExecution(tx, execution)
      if (current.rootBindings === null) {
        // A missing binding must not authorize a new mapping for older persisted evidence.
        if (
          current.stage !== 'STAT' ||
          current.statMedia !== 0 ||
          current.hashedMedia !== 0 ||
          current.cacheHitMedia !== 0 ||
          current.readBytes !== 0n ||
          current.retryReadBytes !== 0n ||
          (await tx.artworkDedupItem.findFirst({
            where: { runId: current.id, status: { not: 'PENDING' } },
            select: { artworkId: true }
          })) ||
          (await tx.artworkDedupMedia.findFirst({ where: { runId: current.id }, select: { imageId: true } }))
        )
          throw new MediaContentFileError('ROOT_CHANGED', 'ROOT_CHANGED')
        await tx.artworkDedupRun.update({ where: { id: current.id }, data: { rootBindings: bindings } })
      } else if (!sameRootBindings(current.rootBindings, bindings)) {
        throw new MediaContentFileError('ROOT_CHANGED', 'ROOT_CHANGED')
      }
    })
    const shouldYield = () =>
      now() - started >= (dependencies.sliceMs ?? (pureCompute ? 10_000 : limits.sliceMs)) ||
      (reader?.metrics.bytesRead ?? 0n) >= (dependencies.sliceBytes ?? limits.sliceBytes)
    const pipeline = {
      execution,
      transaction,
      roots,
      reader: reader!,
      read: async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
        const current = emptyDedupDatabaseMeasurement()
        const result = await operation(v2 ? measureDedupDatabase(dependencies.database, current, 'load') : dependencies.database)
        addDedupDatabaseMeasurement(pendingReads, current)
        return result
      },
      onPerformance: v2 ? emitPerformance : undefined,
      onPerformanceSnapshot: v2 ? writePerformanceEvent : undefined,
      onFeatureBatch: v2 ? async (tx: Prisma.TransactionClient, delta: {
        decodedImages: number; ownFeatureHits: number; contentFeatureHits: number; readBytes: number;
        featureMs: number; completed: number; total: number; uncheckedMedia: number
      }) => {
        const run = await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: execution.runId } })
        await saveTelemetry(tx, run, {
          phase: 'FEATURES', completed: delta.completed, total: delta.total, unit: 'media',
          delta: { updatedAt: new Date(now()).toISOString(), progress: { uncheckedMedia: delta.uncheckedMedia },
            counters: { decodedImages: delta.decodedImages, ownFeatureHits: delta.ownFeatureHits, contentFeatureHits: delta.contentFeatureHits },
            durationsMs: { feature: delta.featureMs } }
        })
      } : undefined,
      visualSearchV2: context.job.definitionVersion >= 8,
      searchWorker: searchCache.worker,
      searchCache,
      signal: context.signal,
      forceRead: initial.mode === 'FULL',
      mixedVisualMedia: context.job.definitionVersion >= 7,
      shouldYield
    }
    while (!shouldYield()) {
      throwIfAborted(context.signal)
      if (stage === 'STAT' || stage === 'HASH') {
        const items = await transaction((tx) =>
          readArtworkDedupItemsPage(tx, {
            execution,
            limit: 1,
            statuses: stage === 'STAT' ? ['PENDING', 'STATTING'] : ['HASHING']
          })
        )
        const item = items[0]
        if (item) {
          try {
            const completed = stage === 'STAT' ? await statArtwork(pipeline, item) : await hashArtwork(pipeline, item)
            if (!completed) break
          } catch (error) {
            if (context.signal.aborted) throw error
            const local =
              error instanceof DedupItemError ||
              (error instanceof MediaContentFileError && error.code !== 'ROOT_CHANGED')
            if (!local) throw error
            await transaction((tx) =>
              saveArtworkDedupItem(tx, {
                execution,
                artworkId: item.artworkId,
                data: {
                  status: error instanceof DedupItemError || error.code === 'FILE_CHANGED' ? 'CHANGED' : 'FAILED',
                  errorCode: error.code
                }
              })
            )
          }
          continue
        }
        stage = stage === 'STAT' ? 'CANDIDATES' : 'GROUP'
        await transaction(async (tx) => {
          const run = await updateArtworkDedupRun(tx, { execution, data: { stage } })
          await saveTelemetry(tx, run)
        })
      }
      if (stage === 'CANDIDATES') {
        await transaction(async (tx) => {
          const run = await buildArtworkDedupCandidates(tx, { execution })
          await saveTelemetry(tx, run)
        })
        stage = 'HASH'
      }
      if (stage === 'GROUP') {
        await transaction(async (tx) => {
          const run = await buildArtworkDedupGroups(tx, { execution, prepareRelations: true })
          await saveTelemetry(tx, run)
        })
        stage = 'MATCH'
      }
      if (stage === 'MATCH') {
        if (!(await transaction((tx) => buildArtworkDedupRelationsPage(tx, { execution })))) continue
        if (context.job.definitionVersion >= 4 && !(await transaction(tx => buildArtworkDedupPartialPage(tx, { execution })))) continue
        stage = initial.includeSuspectedVersions ? 'VISUAL' : 'DONE'
        await transaction(async tx => {
          const run = await updateArtworkDedupRun(tx, { execution, data: { stage } })
          await saveTelemetry(tx, run)
        })
      }
      if (stage === 'VISUAL') {
        if (context.job.definitionVersion >= 8 && !searchCache.worker) {
          const entrypoint = dependencies.readerOptions.entrypoint.endsWith('.cjs')
            ? path.join(path.dirname(dependencies.readerOptions.entrypoint), 'artwork-dedup-visual-search.cjs')
            : path.join(path.dirname(dependencies.readerOptions.entrypoint), 'visual-search-thread.ts')
          searchCache.worker = new VisualSearchWorker(entrypoint, dependencies.readerOptions.execArgv)
          pipeline.searchWorker = searchCache.worker
        }
        if (!(await (context.job.definitionVersion >= 8 ? scanVisualSearch(pipeline) : context.job.definitionVersion >= 5 ? scanBatchedVisualVersions(pipeline, undefined, context.job.definitionVersion >= 6) : scanVisualVersions(pipeline)))) break
        stage = 'DONE'
      }
      if (stage === 'DONE') {
        done = true
        break
      }
    }
    const verified = await resolveRoots(
      {
        sourceRoot: dependencies.sourceRoot,
        archiveRoot: dependencies.archiveRoot,
        expectedPixivRootIdentity: inventory?.rootIdentity ?? null
      }
    )
    if (!sameRootBindings(bindings, rootBindings(verified)))
      throw new MediaContentFileError('ROOT_CHANGED', 'ROOT_CHANGED')
    keepSearch = !done && !context.signal.aborted
  } catch (error) {
    failure = error
  } finally {
    context.signal.removeEventListener('abort', abortSearch)
    if (!keepSearch || failure || context.signal.aborted) {
      await closeSearch()
    }
    if (reader) reader.onProgress = undefined
    try {
      await progressPending
    } catch (error) {
      failure = error
    }
    failure ??= progressFailure
    let closed = !reader
    if (reader) {
      try {
        await reader.close()
        closed = true
      } catch (error) {
        failure = error
      }
    }
    if (claimed) {
      // Cleanup is token CAS only; a lost lease never authorizes content publication.
      try {
        const cleanupMeasurement = emptyDedupDatabaseMeasurement()
        const cleanupStarted = performance.now()
        await dependencies.database.$transaction((tx) =>
          releaseArtworkDedupReader(v2 ? measureDedupDatabase(tx, cleanupMeasurement, 'validation') : tx, { execution, readerToken, blocked: !closed })
        )
        if (v2) {
          cleanupMeasurement.transactions = 1
          cleanupMeasurement.transactionWallMs = performance.now() - cleanupStarted
          addDedupDatabaseMeasurement(measured, cleanupMeasurement)
        }
      } catch (error) {
        failure = error
      }
    }
    if (reader)
      dependencies.onMeasurement?.({
        ...reader.metrics,
        runId: execution.runId,
        elapsedMs: now() - started,
        transactions
      })
    if (failure) await closeSearch()
  }
  pendingTelemetry = undefined
  const outcome = await context.finalizeInTransaction<Tx>(async (originalScope) => {
    const scope = v2 ? { ...originalScope, transaction: measureDedupDatabase(originalScope.transaction, measured, 'validation') } : originalScope
    if (v2) {
      measured.transactions++
      addDedupDatabaseMeasurement(measured, pendingReads)
      pendingReads = emptyDedupDatabaseMeasurement()
    }
    const run = await assertArtworkDedupExecution(scope.transaction, execution, { allowControl: true })
    const uncommittedBytes = (reader?.metrics.bytesRead ?? 0n) - (run.readBytes - bytesAtStart)
    if (uncommittedBytes > 0n)
      await updateArtworkDedupRun(scope.transaction, {
        execution,
        allowControl: true,
        data: { retryReadBytes: { increment: uncommittedBytes } }
      })
    if (failure instanceof DedupReaderError && failure.code === 'READER_CLOSE_FAILED') {
      await updateArtworkDedupRun(scope.transaction, {
        execution,
        allowControl: true,
        data: { errorCode: 'READER_CLOSE_FAILED' }
      })
      if (scope.executionStatus === 'CANCELLING') throw failure
      await saveTelemetry(scope.transaction, run, { waitReason: 'USER_PAUSED', reason: 'PAUSED' })
      await scope.pause({ reason: 'ACTION_REQUIRED', message: '读取进程尚未确认退出，请检查存储并完成恢复处理' })
      return
    }
    if (scope.executionStatus === 'CANCELLING') {
      await closeSearch()
      await saveTelemetry(scope.transaction, run, { reason: 'CANCELLED' })
      await scope.cancel('检测已取消，已提交的文件指纹保留')
      return
    }
    if (scope.executionStatus === 'PAUSING') {
      await closeSearch()
      await saveTelemetry(scope.transaction, run, { waitReason: 'USER_PAUSED', reason: 'PAUSED' })
      await scope.pause({ reason: 'USER_REQUESTED', message: '检测已暂停，继续时恢复原范围' })
      return
    }
    if (context.signal.aborted) {
      await saveTelemetry(scope.transaction, run, { waitReason: 'SCHEDULER' })
      await scope.release('检测等待 Worker 恢复')
      return
    }
    if (failure instanceof DedupReaderError && failure.code === 'VISUAL_TIMEOUT') {
      // This error is delivered only after confirmed child exit. Preserve original
      // results, then yield: a new reader must revalidate root bindings before DONE.
      await scope.transaction.artworkDedupVisualPair.deleteMany({ where: { runId: execution.runId, relationKind: 'VISUAL' } })
      await scope.transaction.artworkDedupRun.update({ where: { id: run.id }, data: {
        stage: 'DONE', visualStatus: 'INCOMPLETE', visualBudgetWaiting: false, visualIncompleteReasons: [...new Set([...run.visualIncompleteReasons, 'VISUAL_TIME_BUDGET'])]
      } })
      failure = undefined
    }
    if (done && !failure && !(await assertArtworkDedupCacheDirectories(scope.transaction, execution.runId)))
      failure = new MediaContentFileError('ROOT_CHANGED', 'Relation cache directory changed')
    if (failure) {
      await closeSearch()
      await scope.transaction.artworkDedupVisualPair.deleteMany({ where: { runId: execution.runId } })
      await scope.transaction.artworkDedupRelation.deleteMany({ where: { runId: execution.runId } })
      await scope.transaction.artworkDedupGroup.deleteMany({ where: { runId: execution.runId } })
      await updateArtworkDedupRun(scope.transaction, { execution, data: { groupCount: 0, duplicateArtworks: 0 } })
      const code =
        failure instanceof MediaContentFileError
          ? failure.code
          : failure instanceof DedupReaderError
            ? failure.code
            : 'DETECTION_ENVIRONMENT'
      await updateArtworkDedupRun(scope.transaction, { execution, data: { errorCode: code } })
      await saveTelemetry(scope.transaction, run, { reason: 'FAILED' })
      await scope.fail({
        errorCode: 'INTERNAL_ERROR',
        error: code,
        message: '检测因存储或执行环境异常停止，请检查后重试'
      })
      return
    }
    if (run.visualBudgetWaiting) {
      await closeSearch()
      await saveTelemetry(scope.transaction, run, { waitReason: 'VISUAL_COMPARISON_BUDGET', reason: 'PAUSED' })
      await scope.pause({ reason: 'ACTION_REQUIRED', message: '本轮疑似版本比较已达上限，继续后会接着检查。' })
      return
    }
    if (done) {
      const result = await buildArtworkDedupGroups(scope.transaction, { execution })
      if (context.job.definitionVersion >= 4 && result.completeArtworks === result.artworkCount)
        await scope.transaction.artworkDedupRun.update({ where: { id: result.id }, data: { relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION } })
      const unchecked = result.changedArtworks + result.failedArtworks + result.skippedArtworks
      await saveTelemetry(scope.transaction, result, { phase: 'COMPLETED', reason: 'COMPLETED', completed: null, total: null, unit: 'artworks' })
      await scope.complete({
        result: {
          runId: execution.runId,
          groups: result.groupCount,
          checked: result.completeArtworks,
          processed: result.processedArtworks,
          changed: result.changedArtworks,
          failed: result.failedArtworks,
          skipped: result.skippedArtworks
        },
        message: unchecked > 0
          ? `检查结束，${result.completeArtworks} 部完成，${unchecked} 部未完成检查`
          : result.visualStatus === 'INCOMPLETE'
            ? '原件检查完成，疑似版本检查未完成'
            : '检测完成'
      })
      return
    }
    const progress = await refreshArtworkDedupCounts(scope.transaction, { execution })
    const shouldPublish = !progress.lastProgressAt || now() - progress.lastProgressAt.getTime() >= limits.progressMs
    if (v2) {
      await saveTelemetry(scope.transaction, progress, { waitReason: 'SCHEDULER' })
    } else if (shouldPublish) {
      await updateArtworkDedupRun(scope.transaction, { execution, data: { lastProgressAt: new Date(now()) } })
      await scope.transaction.systemJob.update({
        where: { id: context.job.id },
        data: {
          progress: Math.min(99, Math.floor((progress.processedArtworks / Math.max(1, progress.artworkCount)) * 100)),
          stage: progress.stage,
          message: `正在检测 · 已处理 ${progress.processedArtworks} / ${progress.artworkCount}`
        }
      })
    }
    await scope.retry({
      availableAt: new Date(now() + (v2 && !(reader?.metrics.reads || reader?.metrics.bytesRead) ? 0 : limits.cooldownMs)),
      errorCode: 'RESOURCE_BUSY',
      error: 'Detection yielded',
      message: '检测已保存检查点，等待继续',
      preserveAttempt: true,
      schedulingYield: true
    })
  })
  const committed = pendingTelemetry as PendingTelemetry | undefined
  if (committed) emitPerformance(committed.summary, finalLogReason)
  return outcome
}
