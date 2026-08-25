import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@pixishelf/db'
import {
  JOB_DEFINITION_VERSION,
  PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT,
  pixivArtistEnrichmentPayloadSchema,
  type JobErrorCode,
  type PixivArtistEnrichmentPayload
} from '@pixishelf/job-contracts'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  ExecutorDefinition,
  FencedExecutionTransaction,
  JobExecutionOutcome,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { fetchPixivArtistMetadata, PixivArtistRequestError, type NormalizedPixivArtistMetadata } from './client.ts'
import { PixivArtistImageError, storePixivArtistImage } from './storage.ts'

const PROVIDER_KEY = 'pixiv'
const CHILD_QUEUE_PRIORITY = 900
const ERROR_MESSAGE_LIMIT = 2_000

type PixivArtistTransaction = Prisma.TransactionClient & QueueSqlExecutor

export interface PixivArtistExecutorDependencies {
  database: PrismaClient
  pixivDataRoot: string
  fetchImpl?: typeof fetch
  now?: () => Date
  random?: () => number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export function createPixivArtistExecutorRegistrations(
  dependencies: PixivArtistExecutorDependencies
): ExecutorDefinition[] {
  if (!dependencies.pixivDataRoot.trim()) throw new Error('Pixiv artist pixivDataRoot is required')
  const definition: ExecutorDefinition<PixivArtistEnrichmentPayload> = {
    jobType: 'PIXIV_ARTIST_ENRICHMENT',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: JOB_DEFINITION_VERSION,
    parsePayload: (payload) => pixivArtistEnrichmentPayloadSchema.parse(payload),
    execute: (context) => executePixivArtistEnrichment(context, dependencies)
  }
  return [definition as ExecutorDefinition]
}

async function executePixivArtistEnrichment(
  context: ExecutionContext<PixivArtistEnrichmentPayload, EnqueuedChildJob>,
  dependencies: PixivArtistExecutorDependencies
): Promise<JobExecutionOutcome> {
  return context.payload.mode === 'DISCOVER'
    ? executeDiscovery(context, dependencies)
    : executeArtist(context, dependencies)
}

async function executeDiscovery(
  context: ExecutionContext<PixivArtistEnrichmentPayload, EnqueuedChildJob>,
  dependencies: PixivArtistExecutorDependencies
): Promise<JobExecutionOutcome> {
  if (context.payload.mode !== 'DISCOVER') throw new Error('Expected a Pixiv artist discovery payload')
  const payload = context.payload
  const refreshExisting = payload.refreshExisting === true
  try {
    await context.progress({ progress: 5, stage: 'DISCOVERING', message: '正在发现可从 Pixiv 补全的艺术家...' })
    const refs = await dependencies.database.artistExternalRef.findMany({
      where: {
        providerKey: PROVIDER_KEY,
        externalId: { not: '' },
        ...(payload.force || refreshExisting ? {} : { status: null }),
        ...(payload.artistIds ? { artistId: { in: payload.artistIds } } : {})
      },
      orderBy:
        refreshExisting && !payload.artistIds
          ? [{ lastAttemptAt: { sort: 'asc', nulls: 'first' } }, { artistId: 'asc' }]
          : { artistId: 'asc' },
      take: PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT,
      select: { id: true, artistId: true, externalId: true }
    })
    let enqueued = 0
    let reused = 0
    for (const ref of refs) {
      throwIfAborted(context.signal)
      if (!/^[1-9][0-9]*$/.test(ref.externalId)) continue
      const child = await context.enqueueChild({
        type: 'PIXIV_ARTIST_ENRICHMENT',
        payload: {
          mode: 'ARTIST',
          artistId: ref.artistId,
          expectedExternalRefId: ref.id,
          expectedPixivUserId: ref.externalId,
          force: payload.force,
          ...(refreshExisting ? { refreshExisting: true } : {})
        },
        queuePriority: CHILD_QUEUE_PRIORITY,
        idempotencyKey: `pixiv-artist:${context.job.id}:artist:${ref.artistId}:v1`
      })
      if (child.created) enqueued += 1
      else reused += 1
    }
    return {
      kind: 'completed',
      result: { discovered: refs.length, enqueued, reused },
      message: `艺术家${refreshExisting ? '刷新' : '补全'}发现完成：${refs.length} 个候选，创建 ${enqueued} 个任务`
    }
  } catch (error) {
    if (context.signal.aborted) return { kind: 'released', message: 'Pixiv 艺术家发现已停止，等待恢复' }
    return retryOrFail(context, dependencies, classifyFailure(error), 'Pixiv 艺术家发现失败')
  }
}

async function executeArtist(
  context: ExecutionContext<PixivArtistEnrichmentPayload, EnqueuedChildJob>,
  dependencies: PixivArtistExecutorDependencies
): Promise<JobExecutionOutcome> {
  if (context.payload.mode !== 'ARTIST') throw new Error('Expected a Pixiv artist item payload')
  const payload = context.payload
  const refreshExisting = payload.refreshExisting === true
  const now = dependencies.now ?? (() => new Date())
  try {
    const eligible = await dependencies.database.artistExternalRef.findFirst({
      where: {
        id: payload.expectedExternalRefId,
        artistId: payload.artistId,
        providerKey: PROVIDER_KEY,
        externalId: payload.expectedPixivUserId
      },
      select: { artist: { select: { avatar: true, backgroundImg: true } } }
    })
    if (!eligible) {
      return { kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: '艺术家 Pixiv 身份已不存在或发生变化' }
    }

    await context.progress({
      progress: 10,
      stage: 'THROTTLING',
      message: `准备查询 Pixiv 用户 ${payload.expectedPixivUserId}`
    })
    await randomizedDelay(context.signal, dependencies)
    throwIfAborted(context.signal)
    await context.progress({ progress: 30, stage: 'FETCHING', message: '正在查询 Pixiv 艺术家资料' })
    const normalized = await fetchPixivArtistMetadata({
      pixivUserId: payload.expectedPixivUserId,
      signal: context.signal,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      ...(dependencies.now ? { now: dependencies.now } : {})
    })
    const payloadHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
    const stored: { avatar: string | null; background: string | null } = { avatar: null, background: null }
    const imageFailures: Failure[] = []
    const downloads: Array<{ kind: 'avatar' | 'background'; url: string }> = []
    if ((refreshExisting || isEmpty(eligible.artist.avatar)) && normalized.avatarUrl)
      downloads.push({ kind: 'avatar', url: normalized.avatarUrl })
    if ((refreshExisting || isEmpty(eligible.artist.backgroundImg)) && normalized.backgroundUrl) {
      downloads.push({ kind: 'background', url: normalized.backgroundUrl })
    }
    for (const [index, download] of downloads.entries()) {
      await context.progress({
        progress: 55 + Math.floor((index / Math.max(1, downloads.length)) * 30),
        stage: 'DOWNLOADING_IMAGE',
        message: download.kind === 'avatar' ? '正在保存 Pixiv 艺术家头像' : '正在保存 Pixiv 艺术家背景图'
      })
      try {
        stored[download.kind] = await storePixivArtistImage({
          imageUrl: download.url,
          pixivUserId: payload.expectedPixivUserId,
          kind: download.kind,
          pixivDataRoot: dependencies.pixivDataRoot,
          signal: context.signal,
          ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {})
        })
      } catch (error) {
        if (context.signal.aborted) throw error
        imageFailures.push(classifyFailure(error))
      }
    }

    const checkedAt = now()
    const hasRemoteData = Object.values(normalized).some((value) => value !== null)
    const status = imageFailures.length > 0 ? 'PARTIAL' : hasRemoteData ? 'SUCCESS' : 'NO_DATA'
    return context.finalizeInTransaction<PixivArtistTransaction>(async (scope) => {
      if (await finalizeControl(scope)) return
      const ref = await scope.transaction.artistExternalRef.findFirst({
        where: {
          id: payload.expectedExternalRefId,
          artistId: payload.artistId,
          providerKey: PROVIDER_KEY,
          externalId: payload.expectedPixivUserId
        },
        select: { id: true, artist: { select: { id: true, avatar: true, backgroundImg: true } } }
      })
      if (!ref) {
        await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '艺术家 Pixiv 身份在写入前已变更' })
        return
      }

      const update: Prisma.ArtistUpdateInput = {}
      const appliedFields: string[] = []
      const skippedConcurrentFields: string[] = []
      if (canPublishImage(refreshExisting, eligible.artist.avatar, ref.artist.avatar) && stored.avatar) {
        update.avatar = stored.avatar
        appliedFields.push('avatar')
      } else if (refreshExisting && stored.avatar && eligible.artist.avatar !== ref.artist.avatar) {
        skippedConcurrentFields.push('avatar')
      }
      if (
        canPublishImage(refreshExisting, eligible.artist.backgroundImg, ref.artist.backgroundImg) &&
        stored.background
      ) {
        update.backgroundImg = stored.background
        appliedFields.push('backgroundImg')
      } else if (refreshExisting && stored.background && eligible.artist.backgroundImg !== ref.artist.backgroundImg) {
        skippedConcurrentFields.push('backgroundImg')
      }
      if (Object.keys(update).length > 0) {
        await scope.transaction.artist.update({ where: { id: ref.artist.id }, data: update })
      }
      const firstFailure = imageFailures[0]
      await scope.transaction.artistExternalRef.update({
        where: { id: ref.id },
        data: {
          ...(normalized.sourceName ? { sourceName: normalized.sourceName } : {}),
          status,
          normalizedPayload: {
            sourceName: normalized.sourceName,
            avatarAvailable: normalized.avatarUrl !== null,
            backgroundAvailable: normalized.backgroundUrl !== null,
            avatarFile: stored.avatar,
            backgroundFile: stored.background,
            refreshExisting,
            skippedConcurrentFields
          },
          payloadHash,
          lastAttemptAt: checkedAt,
          lastSuccessAt: checkedAt,
          lastErrorCode: firstFailure?.code ?? null,
          lastError: firstFailure?.message ?? null,
          lastSystemJobId: context.job.id
        }
      })
      await scope.complete({
        result: { artistId: ref.artist.id, status, appliedFields, skippedConcurrentFields, payloadHash },
        message:
          status === 'PARTIAL'
            ? 'Pixiv 艺术家资料已读取，部分图片保存失败'
            : `Pixiv 艺术家${refreshExisting ? '刷新' : '补全'}完成`
      })
    })
  } catch (error) {
    if (context.signal.aborted) {
      return context.finalizeInTransaction<PixivArtistTransaction>(async (scope) => {
        if (await finalizeControl(scope)) return
        await scope.release('Pixiv 艺术家补全已停止，等待恢复')
      })
    }
    const failure = classifyFailure(error)
    const attemptedAt = now()
    await context.mutateInTransaction<PixivArtistTransaction>(async (transaction) => {
      await transaction.artistExternalRef.updateMany({
        where: {
          id: payload.expectedExternalRefId,
          artistId: payload.artistId,
          providerKey: PROVIDER_KEY,
          externalId: payload.expectedPixivUserId
        },
        data: {
          status: 'FAILED',
          lastAttemptAt: attemptedAt,
          lastErrorCode: failure.code,
          lastError: failure.message,
          lastSystemJobId: context.job.id
        }
      })
    })
    return retryOrFail(context, dependencies, failure, 'Pixiv 艺术家补全失败')
  }
}

async function finalizeControl(scope: FencedExecutionTransaction<PixivArtistTransaction>) {
  if (scope.executionStatus === 'PAUSING') {
    await scope.pause({ reason: 'USER_REQUESTED', message: 'Pixiv 艺术家补全已暂停' })
    return true
  }
  if (scope.executionStatus === 'CANCELLING') {
    await scope.cancel('Pixiv 艺术家补全已取消')
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
  const message = (error instanceof Error ? error.message : 'Unknown Pixiv artist enrichment failure').slice(
    0,
    ERROR_MESSAGE_LIMIT
  )
  if (error instanceof PixivArtistRequestError) {
    return {
      code: error.code,
      message,
      retryable: error.retryable,
      ...(error.retryAt ? { retryAt: error.retryAt } : {}),
      jobErrorCode: error.code === 'PIXIV_SCHEMA_CHANGED' ? 'PRECONDITION_FAILED' : 'INTERNAL_ERROR'
    }
  }
  if (error instanceof PixivArtistImageError) {
    return { code: error.code, message, retryable: false, jobErrorCode: 'PRECONDITION_FAILED' }
  }
  return { code: 'PIXIV_INTERNAL_ERROR', message, retryable: true, jobErrorCode: 'INTERNAL_ERROR' }
}

function retryOrFail(
  context: Pick<ExecutionContext, 'job'>,
  dependencies: Pick<PixivArtistExecutorDependencies, 'now'>,
  failure: Failure,
  message: string
): JobExecutionOutcome {
  if (!failure.retryable || context.job.attempt >= context.job.maxAttempts) {
    return { kind: 'failed', errorCode: failure.jobErrorCode, error: failure.message, message }
  }
  const now = dependencies.now?.() ?? new Date()
  const exponentialRetry = new Date(
    now.getTime() + Math.min(1_800_000, 15_000 * 2 ** Math.max(0, context.job.attempt - 1))
  )
  return {
    kind: 'retry',
    availableAt: failure.retryAt && failure.retryAt > exponentialRetry ? failure.retryAt : exponentialRetry,
    errorCode: failure.jobErrorCode,
    error: failure.message,
    message: `${message}，等待重试`
  }
}

function isEmpty(value: string | null) {
  return value === null || value.trim().length === 0
}

function canPublishImage(refreshExisting: boolean, observed: string | null, current: string | null) {
  return refreshExisting ? observed === current : isEmpty(current)
}

async function randomizedDelay(signal: AbortSignal, dependencies: PixivArtistExecutorDependencies) {
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
      reject(signal.reason instanceof Error ? signal.reason : new Error('Pixiv artist enrichment was interrupted'))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason instanceof Error ? signal.reason : new Error('Pixiv artist enrichment interrupted')
}
