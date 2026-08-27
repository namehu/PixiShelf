import { Prisma, type PrismaClient } from '@pixishelf/db'
import {
  JOB_DEFINITION_VERSION,
  PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT,
  pixivSeriesReconciliationPayloadSchema,
  type JobErrorCode,
  type PixivSeriesReconciliationPayload
} from '@pixishelf/job-contracts'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  ExecutorDefinition,
  FencedExecutionTransaction,
  JobExecutionOutcome,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'

import {
  fetchPixivArtworkMetadata,
  PixivArtworkRequestError,
  type NormalizedPixivArtworkSeries
} from '../pixiv-artwork/client.ts'
import {
  observePixivSeriesState,
  reconcilePixivArtworkSeries
} from '../pixiv-artwork/series-sync.ts'
import { storePixivArtworkSnapshot } from '../pixiv-artwork/storage.ts'
import {
  PixivSeriesSnapshotReadError,
  readPixivSeriesObservationFromSnapshot
} from './snapshot-reader.ts'

const PROVIDER_KEY = 'pixiv'
const CHILD_QUEUE_PRIORITY = 900
const ERROR_MESSAGE_LIMIT = 2_000

type PixivSeriesTransaction = Prisma.TransactionClient & QueueSqlExecutor

export interface PixivSeriesExecutorDependencies {
  database: PrismaClient
  pixivDataRoot: string
  fetchImpl?: typeof fetch
  now?: () => Date
  random?: () => number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export function createPixivSeriesExecutorRegistrations(
  dependencies: PixivSeriesExecutorDependencies
): ExecutorDefinition[] {
  if (!dependencies.pixivDataRoot.trim()) throw new Error('Pixiv series pixivDataRoot is required')
  const definition: ExecutorDefinition<PixivSeriesReconciliationPayload> = {
    jobType: 'PIXIV_SERIES_RECONCILIATION',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: JOB_DEFINITION_VERSION,
    parsePayload: (payload) => pixivSeriesReconciliationPayloadSchema.parse(payload),
    execute: (context) => executePixivSeriesReconciliation(context, dependencies)
  }
  return [definition as ExecutorDefinition]
}

async function executePixivSeriesReconciliation(
  context: ExecutionContext<PixivSeriesReconciliationPayload, EnqueuedChildJob>,
  dependencies: PixivSeriesExecutorDependencies
): Promise<JobExecutionOutcome> {
  return context.payload.mode === 'DISCOVER'
    ? executeDiscovery(context, dependencies)
    : executeArtwork(context, dependencies)
}

async function executeDiscovery(
  context: ExecutionContext<PixivSeriesReconciliationPayload, EnqueuedChildJob>,
  dependencies: PixivSeriesExecutorDependencies
): Promise<JobExecutionOutcome> {
  if (context.payload.mode !== 'DISCOVER') throw new Error('Expected a Pixiv series discovery payload')
  const payload = context.payload
  const candidateWhere = {
    providerKey: PROVIDER_KEY,
    externalId: { not: '' },
    artwork: { deletedAt: null },
    ...(!payload.refreshExisting && !payload.artworkIds ? { seriesSyncStatus: null } : {}),
    ...(payload.artworkIds ? { artworkId: { in: payload.artworkIds } } : {})
  } satisfies Prisma.ArtworkExternalRefWhereInput
  const orderedByAttempt = payload.refreshExisting && !payload.artworkIds
  const candidateOrder: Prisma.ArtworkExternalRefOrderByWithRelationInput[] = orderedByAttempt
    ? [{ seriesLastAttemptAt: { sort: 'asc', nulls: 'first' } }, { artworkId: 'asc' }]
    : [{ artworkId: 'asc' }]
  let cursor: { artworkId: number; seriesLastAttemptAt: Date | null } | undefined
  let pageCount = 0
  let discovered = 0
  let enqueued = 0
  let reused = 0

  try {
    await context.progress({ progress: 1, stage: 'DISCOVERING', message: '正在发现可认领 Pixiv 系列的作品...' })
    const totalCandidates = await dependencies.database.artworkExternalRef.count({ where: candidateWhere })
    while (true) {
      throwIfAborted(context.signal)
      const cursorWhere: Prisma.ArtworkExternalRefWhereInput | undefined = cursor
        ? orderedByAttempt
          ? cursor.seriesLastAttemptAt === null
            ? {
                OR: [
                  { seriesLastAttemptAt: null, artworkId: { gt: cursor.artworkId } },
                  { seriesLastAttemptAt: { not: null } }
                ]
              }
            : {
                OR: [
                  { seriesLastAttemptAt: { gt: cursor.seriesLastAttemptAt } },
                  { seriesLastAttemptAt: cursor.seriesLastAttemptAt, artworkId: { gt: cursor.artworkId } }
                ]
              }
          : { artworkId: { gt: cursor.artworkId } }
        : undefined
      const refs = await dependencies.database.artworkExternalRef.findMany({
        where: cursorWhere ? { AND: [candidateWhere, cursorWhere] } : candidateWhere,
        orderBy: candidateOrder,
        take: PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT,
        select: { id: true, artworkId: true, externalId: true, seriesLastAttemptAt: true }
      })
      if (refs.length === 0) break
      pageCount += 1
      const lastRef = refs.at(-1)!
      cursor = { artworkId: lastRef.artworkId, seriesLastAttemptAt: lastRef.seriesLastAttemptAt }
      discovered += refs.length
      for (const ref of refs) {
        throwIfAborted(context.signal)
        if (!/^[1-9][0-9]*$/.test(ref.externalId)) continue
        const child = await context.enqueueChild({
          type: 'PIXIV_SERIES_RECONCILIATION',
          payload: {
            mode: 'ARTWORK',
            artworkId: ref.artworkId,
            expectedExternalRefId: ref.id,
            expectedPixivArtworkId: ref.externalId,
            refreshExisting: payload.refreshExisting
          },
          queuePriority: CHILD_QUEUE_PRIORITY,
          idempotencyKey: `pixiv-series:${context.job.id}:artwork:${ref.artworkId}:v1`
        })
        if (child.created) enqueued += 1
        else reused += 1
      }
      await context.progress({
        progress: totalCandidates > 0 ? Math.min(95, Math.max(1, Math.floor((discovered / totalCandidates) * 95))) : 95,
        stage: 'DISCOVERING',
        message: `已发现 ${discovered}/${totalCandidates} 个作品，创建 ${enqueued} 个系列核对任务`,
        data: { totalCandidates, pageCount, discovered, enqueued, reused }
      })
      if (discovered >= totalCandidates || refs.length < PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT) break
    }
    return {
      kind: 'completed',
      result: { totalCandidates, pageCount, discovered, enqueued, reused },
      message: `Pixiv 系列发现完成：${discovered} 个候选，创建 ${enqueued} 个任务`
    }
  } catch (error) {
    if (context.signal.aborted) return { kind: 'released', message: 'Pixiv 系列发现已停止，等待恢复' }
    return retryOrFail(context, dependencies, classifyFailure(error), 'Pixiv 系列发现失败')
  }
}

async function executeArtwork(
  context: ExecutionContext<PixivSeriesReconciliationPayload, EnqueuedChildJob>,
  dependencies: PixivSeriesExecutorDependencies
): Promise<JobExecutionOutcome> {
  if (context.payload.mode !== 'ARTWORK') throw new Error('Expected a Pixiv series artwork payload')
  const payload = context.payload
  const now = dependencies.now ?? (() => new Date())
  try {
    const ref = await dependencies.database.artworkExternalRef.findFirst({
      where: {
        id: payload.expectedExternalRefId,
        artworkId: payload.artworkId,
        providerKey: PROVIDER_KEY,
        externalId: payload.expectedPixivArtworkId,
        artwork: { deletedAt: null }
      },
      select: {
        id: true,
        onlineSnapshotHash: true,
        onlineSnapshotPath: true,
        artwork: { select: { externalRefs: { where: { providerKey: PROVIDER_KEY }, select: { id: true }, take: 2 } } }
      }
    })
    if (!ref || ref.artwork.externalRefs.length !== 1 || ref.artwork.externalRefs[0]?.id !== ref.id) {
      return { kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: '作品 Pixiv 身份已不存在或发生变化' }
    }

    await context.progress({ progress: 20, stage: 'READING_SNAPSHOT', message: '正在读取已有 Pixiv 作品快照' })
    let observation: NormalizedPixivArtworkSeries | null = null
    let fetchedSnapshot: { hash: string; relativePath: string; reused: boolean } | null = null
    if (ref.onlineSnapshotHash && ref.onlineSnapshotPath) {
      try {
        observation = (
          await readPixivSeriesObservationFromSnapshot({
            pixivDataRoot: dependencies.pixivDataRoot,
            pixivArtworkId: payload.expectedPixivArtworkId,
            snapshotHash: ref.onlineSnapshotHash,
            snapshotPath: ref.onlineSnapshotPath
          })
        ).series
      } catch (error) {
        if (!(error instanceof PixivSeriesSnapshotReadError)) throw error
      }
    }

    const checkedAt = now()
    if (!observation) {
      await randomizedDelay(context.signal, dependencies)
      throwIfAborted(context.signal)
      await context.progress({ progress: 45, stage: 'FETCHING', message: '没有可用快照，正在查询 Pixiv 作品资料' })
      const response = await fetchPixivArtworkMetadata({
        pixivArtworkId: payload.expectedPixivArtworkId,
        signal: context.signal,
        ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
        ...(dependencies.now ? { now: dependencies.now } : {})
      })
      if (!response) observation = { state: 'UNKNOWN' }
      else {
        observation = response.normalized.series
        fetchedSnapshot = await storePixivArtworkSnapshot({
          pixivDataRoot: dependencies.pixivDataRoot,
          pixivArtworkId: payload.expectedPixivArtworkId,
          fetchedAt: checkedAt,
          response
        })
      }
    }

    const observedSeries =
      observation.state === 'PRESENT'
        ? await observePixivSeriesState(dependencies.database, observation.id, payload.artworkId)
        : null
    await context.progress({ progress: 80, stage: 'PUBLISHING', message: '正在更新系列来源和成员关系' })
    return context.finalizeInTransaction<PixivSeriesTransaction>(async (scope) => {
      if (await finalizeControl(scope)) return
      const locked = await scope.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT ref."id"
        FROM "artwork_external_refs" ref
        JOIN "Artwork" artwork ON artwork.id = ref."artworkId"
        WHERE ref.id = ${payload.expectedExternalRefId}
          AND ref."artworkId" = ${payload.artworkId}
          AND ref."providerKey" = ${PROVIDER_KEY}
          AND ref."externalId" = ${payload.expectedPixivArtworkId}
          AND artwork."deletedAt" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "artwork_external_refs" other_ref
            WHERE other_ref."artworkId" = artwork.id
              AND other_ref."providerKey" = ${PROVIDER_KEY}
              AND other_ref.id <> ref.id
          )
        FOR UPDATE OF ref, artwork
      `)
      if (locked.length !== 1) {
        await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '作品 Pixiv 身份在写入前已变更' })
        return
      }
      const result = await reconcilePixivArtworkSeries(scope.transaction, {
        artworkId: payload.artworkId,
        artworkExternalRefId: payload.expectedExternalRefId,
        observation,
        checkedAt,
        jobId: context.job.id,
        refreshExisting: payload.refreshExisting,
        observedSeries
      })
      if (fetchedSnapshot) {
        await scope.transaction.artworkExternalRef.update({
          where: { id: payload.expectedExternalRefId },
          data: {
            onlineSnapshotHash: fetchedSnapshot.hash,
            onlineSnapshotPath: fetchedSnapshot.relativePath,
            fetchedAt: checkedAt
          }
        })
      }
      await scope.complete({
        result: { artworkId: payload.artworkId, ...result, snapshotReused: fetchedSnapshot?.reused ?? true },
        message:
          result.status === 'PARTIAL'
            ? 'Pixiv 系列已核对，人工关系或不完整资料已保留'
            : result.status === 'NO_DATA'
              ? '作品当前没有 Pixiv 系列'
              : 'Pixiv 系列来源与成员关系已同步'
      })
    })
  } catch (error) {
    if (context.signal.aborted) {
      return context.finalizeInTransaction<PixivSeriesTransaction>(async (scope) => {
        if (await finalizeControl(scope)) return
        await scope.release('Pixiv 系列核对已停止，等待恢复')
      })
    }
    const failure = classifyFailure(error)
    const attemptedAt = now()
    await context.mutateInTransaction<PixivSeriesTransaction>(async (transaction) => {
      await transaction.artworkExternalRef.updateMany({
        where: {
          id: payload.expectedExternalRefId,
          artworkId: payload.artworkId,
          providerKey: PROVIDER_KEY,
          externalId: payload.expectedPixivArtworkId
        },
        data: {
          seriesSyncStatus: 'FAILED',
          seriesLastAttemptAt: attemptedAt,
          seriesLastErrorCode: failure.code,
          seriesLastError: failure.message,
          seriesLastSystemJobId: context.job.id
        }
      })
    })
    return retryOrFail(context, dependencies, failure, 'Pixiv 系列核对失败')
  }
}

async function finalizeControl(scope: FencedExecutionTransaction<PixivSeriesTransaction>) {
  if (scope.executionStatus === 'PAUSING') {
    await scope.pause({ reason: 'USER_REQUESTED', message: 'Pixiv 系列核对已暂停' })
    return true
  }
  if (scope.executionStatus === 'CANCELLING') {
    await scope.cancel('Pixiv 系列核对已取消')
    return true
  }
  return false
}

interface Failure {
  code: string
  message: string
  retryable: boolean
  retryAt?: Date
  jobErrorCode: JobErrorCode
}

function classifyFailure(error: unknown): Failure {
  const message = (error instanceof Error ? error.message : 'Unknown Pixiv series failure').slice(0, ERROR_MESSAGE_LIMIT)
  if (error instanceof PixivArtworkRequestError) {
    return {
      code: error.code,
      message,
      retryable: error.retryable,
      ...(error.retryAt ? { retryAt: error.retryAt } : {}),
      jobErrorCode:
        error.code === 'PIXIV_SCHEMA_CHANGED' || error.code === 'PIXIV_IDENTITY_MISMATCH'
          ? 'PRECONDITION_FAILED'
          : 'INTERNAL_ERROR'
    }
  }
  if (error instanceof PixivSeriesSnapshotReadError) {
    return { code: error.code, message, retryable: false, jobErrorCode: 'PRECONDITION_FAILED' }
  }
  return { code: 'PIXIV_SERIES_INTERNAL_ERROR', message, retryable: true, jobErrorCode: 'INTERNAL_ERROR' }
}

function retryOrFail(
  context: Pick<ExecutionContext, 'job'>,
  dependencies: Pick<PixivSeriesExecutorDependencies, 'now'>,
  failure: Failure,
  message: string
): JobExecutionOutcome {
  if (!failure.retryable || context.job.attempt >= context.job.maxAttempts) {
    return { kind: 'failed', errorCode: failure.jobErrorCode, error: failure.message, message }
  }
  const now = dependencies.now?.() ?? new Date()
  const exponentialRetry = new Date(now.getTime() + Math.min(1_800_000, 15_000 * 2 ** Math.max(0, context.job.attempt - 1)))
  return {
    kind: 'retry',
    availableAt: failure.retryAt && failure.retryAt > exponentialRetry ? failure.retryAt : exponentialRetry,
    errorCode: failure.jobErrorCode,
    error: failure.message,
    message: `${message}，等待重试`
  }
}

async function randomizedDelay(signal: AbortSignal, dependencies: PixivSeriesExecutorDependencies) {
  const milliseconds = 750 + Math.floor((dependencies.random ?? Math.random)() * 1_001)
  if (dependencies.sleep) return dependencies.sleep(milliseconds, signal)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      reject(signal.reason instanceof Error ? signal.reason : new Error('Pixiv series reconciliation interrupted'))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Pixiv series reconciliation interrupted')
}
