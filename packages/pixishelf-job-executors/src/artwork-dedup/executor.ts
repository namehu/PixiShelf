import { randomUUID } from 'node:crypto'
import {
  assertArtworkDedupExecution,
  buildArtworkDedupCandidates,
  buildArtworkDedupGroups,
  buildArtworkDedupRelationsPage,
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
import { artworkDedupScanPayloadSchema, type ArtworkDedupScanPayload } from '@pixishelf/job-contracts'
import type { ExecutionContext, ExecutorDefinition, EnqueuedChildJob, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { MediaContentFileError } from '../media-content/roots.ts'
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

type Tx = Prisma.TransactionClient & QueueSqlExecutor
export interface ArtworkDedupDependencies {
  database: PrismaClient
  sourceRoot: string
  archiveRoot: string
  readerOptions: DedupReaderOptions
  supervisor?: DedupReaderSupervisor
  now?: () => number
  sliceMs?: number
  sliceBytes?: bigint
  onMeasurement?: (value: ReaderMetrics & { runId: string; elapsedMs: number; transactions: number }) => void
}
export function createArtworkDedupExecutor(dependencies: ArtworkDedupDependencies, definitionVersion: 1 | 2 = 1): ExecutorDefinition {
  const supervisor = dependencies.supervisor ?? new DedupReaderSupervisor(dependencies.readerOptions)
  return {
    jobType: 'ARTWORK_DEDUP_SCAN',
    definitionVersion,
    executionLane: 'BACKGROUND_WRITER',
    progressPolicy: 'STANDARD',
    parsePayload: (value) => artworkDedupScanPayloadSchema.parse(value),
    execute: (context: ExecutionContext<ArtworkDedupScanPayload, EnqueuedChildJob>) =>
      executeArtworkDedup(context, { ...dependencies, supervisor })
  } as ExecutorDefinition
}

export async function executeArtworkDedup(
  context: ExecutionContext<ArtworkDedupScanPayload, EnqueuedChildJob>,
  dependencies: ArtworkDedupDependencies
) {
  const now = dependencies.now ?? Date.now
  const started = now()
  const execution: ArtworkDedupExecution = { ...context.payload, jobId: context.job.id }
  let transactions = 0
  const transaction: DedupTransaction = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => {
    transactions++
    return context.mutateInTransaction<Tx, T>((tx) => operation(tx))
  }
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
    const initial = await transaction((tx) => assertArtworkDedupExecution(tx, execution))
    bytesAtStart = initial.readBytes
    let stage = initial.stage
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
          progress: Math.min(99, Math.floor((initial.processedArtworks / Math.max(1, initial.artworkCount)) * 100)),
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
    throwIfAborted(context.signal)
    const inventory = await transaction((tx) =>
      tx.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' }, select: { rootIdentity: true } })
    )
    const roots = await reader.resolveRoots(
      {
        operation: 'roots',
        sourceRoot: dependencies.sourceRoot,
        archiveRoot: dependencies.archiveRoot,
        expectedPixivRootIdentity: inventory?.rootIdentity ?? null
      },
      context.signal
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
      now() - started >= (dependencies.sliceMs ?? limits.sliceMs) ||
      reader!.metrics.bytesRead >= (dependencies.sliceBytes ?? limits.sliceBytes)
    const pipeline = {
      execution,
      transaction,
      roots,
      reader,
      signal: context.signal,
      forceRead: initial.mode === 'FULL',
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
        await transaction((tx) => updateArtworkDedupRun(tx, { execution, data: { stage } }))
      }
      if (stage === 'CANDIDATES') {
        await transaction((tx) => buildArtworkDedupCandidates(tx, { execution }))
        stage = 'HASH'
      }
      if (stage === 'GROUP') {
        await transaction((tx) => buildArtworkDedupGroups(tx, { execution, prepareRelations: true }))
        stage = 'MATCH'
      }
      if (stage === 'MATCH') {
        if (!(await transaction((tx) => buildArtworkDedupRelationsPage(tx, { execution })))) continue
        stage = 'DONE'
      }
      if (stage === 'DONE') {
        done = true
        break
      }
    }
    const verified = await reader.resolveRoots(
      {
        operation: 'roots',
        sourceRoot: dependencies.sourceRoot,
        archiveRoot: dependencies.archiveRoot,
        expectedPixivRootIdentity: inventory?.rootIdentity ?? null
      },
      context.signal
    )
    if (!sameRootBindings(bindings, rootBindings(verified)))
      throw new MediaContentFileError('ROOT_CHANGED', 'ROOT_CHANGED')
  } catch (error) {
    failure = error
  } finally {
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
        await dependencies.database.$transaction((tx) =>
          releaseArtworkDedupReader(tx, { execution, readerToken, blocked: !closed })
        )
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
  }
  return context.finalizeInTransaction<Tx>(async (scope) => {
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
      await scope.pause({ reason: 'ACTION_REQUIRED', message: '读取进程尚未确认退出，请检查存储并完成恢复处理' })
      return
    }
    if (scope.executionStatus === 'CANCELLING') {
      await scope.cancel('检测已取消，已提交的文件指纹保留')
      return
    }
    if (scope.executionStatus === 'PAUSING') {
      await scope.pause({ reason: 'USER_REQUESTED', message: '检测已暂停，继续时恢复原范围' })
      return
    }
    if (context.signal.aborted) {
      await scope.release('检测等待 Worker 恢复')
      return
    }
    if (failure) {
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
      await scope.fail({
        errorCode: 'INTERNAL_ERROR',
        error: code,
        message: '检测因存储或执行环境异常停止，请检查后重试'
      })
      return
    }
    if (done) {
      const result = await buildArtworkDedupGroups(scope.transaction, { execution })
      await scope.complete({
        result: { runId: execution.runId, groups: result.groupCount, checked: result.processedArtworks },
        message: '检测完成'
      })
      return
    }
    const progress = await refreshArtworkDedupCounts(scope.transaction, { execution })
    const shouldPublish = !progress.lastProgressAt || now() - progress.lastProgressAt.getTime() >= limits.progressMs
    if (shouldPublish) {
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
      availableAt: new Date(now() + limits.cooldownMs),
      errorCode: 'RESOURCE_BUSY',
      error: 'Detection yielded',
      message: '检测已保存检查点，等待继续',
      preserveAttempt: true,
      schedulingYield: true
    })
  })
}
