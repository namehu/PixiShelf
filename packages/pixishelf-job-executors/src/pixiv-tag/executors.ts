import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@pixishelf/db'
import {
  JOB_DEFINITION_VERSION,
  PIXIV_TAG_ENRICHMENT_BATCH_LIMIT,
  pixivTagEnrichmentPayloadSchema,
  type JobErrorCode,
  type PixivTagEnrichmentPayload
} from '@pixishelf/job-contracts'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  ExecutorDefinition,
  FencedExecutionTransaction,
  JobExecutionOutcome,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { fetchPixivTagMetadata, PixivTagRequestError, type NormalizedPixivTagMetadata } from './client.ts'
import { PixivTagImageError, storePixivTagImage } from './storage.ts'

const PROVIDER_KEY = 'pixiv'
const CHILD_QUEUE_PRIORITY = 900
const ERROR_MESSAGE_LIMIT = 2_000

type PixivTagTransaction = Prisma.TransactionClient & QueueSqlExecutor

export interface PixivTagExecutorDependencies {
  database: PrismaClient
  pixivDataRoot: string
  fetchImpl?: typeof fetch
  now?: () => Date
  random?: () => number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export function createPixivTagExecutorRegistrations(dependencies: PixivTagExecutorDependencies): ExecutorDefinition[] {
  if (!dependencies.pixivDataRoot.trim()) throw new Error('Pixiv tag pixivDataRoot is required')
  const definition: ExecutorDefinition<PixivTagEnrichmentPayload> = {
    jobType: 'PIXIV_TAG_ENRICHMENT',
    // 封面发布属于持久化写操作，统一进入 BACKGROUND_WRITER，与其他媒体写入共享单 lane 串行约束。
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: JOB_DEFINITION_VERSION,
    parsePayload: (payload) => pixivTagEnrichmentPayloadSchema.parse(payload),
    execute: (context) => executePixivTagEnrichment(context, dependencies)
  }
  return [definition as ExecutorDefinition]
}

async function executePixivTagEnrichment(
  context: ExecutionContext<PixivTagEnrichmentPayload, EnqueuedChildJob>,
  dependencies: PixivTagExecutorDependencies
): Promise<JobExecutionOutcome> {
  if (context.payload.mode === 'DISCOVER') return executeDiscovery(context, dependencies)
  return executeTag(context, dependencies)
}

async function executeDiscovery(
  context: ExecutionContext<PixivTagEnrichmentPayload, EnqueuedChildJob>,
  dependencies: PixivTagExecutorDependencies
): Promise<JobExecutionOutcome> {
  if (context.payload.mode !== 'DISCOVER') throw new Error('Expected a Pixiv tag discovery payload')
  const payload = context.payload
  const refreshExisting = payload.refreshExisting === true
  let cursor = 0
  let discovered = 0
  let enqueued = 0
  let reused = 0
  let pageCount = 0
  try {
    await context.progress({ progress: 1, stage: 'DISCOVERING', message: '正在发现可从 Pixiv 补全的标签...' })
    const totalCandidates = await dependencies.database.tag.count({
      where: {
        namespace: 'general',
        isSystem: false,
        artworkTags: {
          some: {
            provenance: 'SOURCE',
            sourceRef: { is: { providerKey: PROVIDER_KEY } }
          }
        },
        ...(payload.tagIds ? { id: { in: payload.tagIds } } : {}),
        ...(payload.force || refreshExisting ? {} : { externalMetadata: { none: { providerKey: PROVIDER_KEY } } })
      }
    })
    while (true) {
      throwIfAborted(context.signal)
      const page = await dependencies.database.tag.findMany({
        where: {
          id: { gt: cursor, ...(payload.tagIds ? { in: payload.tagIds } : {}) },
          namespace: 'general',
          isSystem: false,
          artworkTags: {
            some: {
              provenance: 'SOURCE',
              sourceRef: { is: { providerKey: PROVIDER_KEY } }
            }
          },
          ...(payload.force || refreshExisting ? {} : { externalMetadata: { none: { providerKey: PROVIDER_KEY } } })
        },
        orderBy: { id: 'asc' },
        take: PIXIV_TAG_ENRICHMENT_BATCH_LIMIT,
        select: { id: true, name: true }
      })
      if (page.length === 0) break
      pageCount += 1
      cursor = page.at(-1)!.id
      discovered += page.length

      for (const tag of page) {
        throwIfAborted(context.signal)
        const child = await context.enqueueChild({
          type: 'PIXIV_TAG_ENRICHMENT',
          payload: {
            mode: 'TAG',
            tagId: tag.id,
            expectedName: tag.name,
            force: payload.force,
            ...(refreshExisting ? { refreshExisting: true } : {})
          },
          queuePriority: CHILD_QUEUE_PRIORITY,
          idempotencyKey: `pixiv-tag:${context.job.id}:tag:${tag.id}:v1`
        })
        if (child.created) enqueued += 1
        else reused += 1
      }
      await context.progress({
        progress: totalCandidates > 0 ? Math.min(95, Math.max(1, Math.floor((discovered / totalCandidates) * 95))) : 95,
        stage: 'DISCOVERING',
        message: `已发现 ${discovered}/${totalCandidates} 个标签，创建 ${enqueued} 个${refreshExisting ? '刷新' : '补全'}任务`,
        data: { totalCandidates, pageCount, discovered, enqueued, reused }
      })
      // 200 只是稳定的数据库分页大小；默认运行会物化发现阶段的全部候选。
      if (discovered >= totalCandidates || page.length < PIXIV_TAG_ENRICHMENT_BATCH_LIMIT) break
    }
    return {
      kind: 'completed',
      result: { totalCandidates, pageCount, discovered, enqueued, reused },
      message: `标签${refreshExisting ? '刷新' : '补全'}发现完成：${discovered} 个候选，创建 ${enqueued} 个任务`
    }
  } catch (error) {
    if (context.signal.aborted) return { kind: 'released', message: 'Pixiv 标签发现已停止，等待恢复' }
    return retryOrFail(context, dependencies, classifyFailure(error), 'Pixiv 标签发现失败')
  }
}

async function executeTag(
  context: ExecutionContext<PixivTagEnrichmentPayload, EnqueuedChildJob>,
  dependencies: PixivTagExecutorDependencies
): Promise<JobExecutionOutcome> {
  if (context.payload.mode !== 'TAG') throw new Error('Expected a Pixiv tag item payload')
  const payload = context.payload
  const refreshExisting = payload.refreshExisting === true
  const now = dependencies.now ?? (() => new Date())
  try {
    const eligible = await dependencies.database.tag.findFirst({
      where: {
        id: payload.tagId,
        name: payload.expectedName,
        namespace: 'general',
        isSystem: false,
        artworkTags: {
          some: { provenance: 'SOURCE', sourceRef: { is: { providerKey: PROVIDER_KEY } } }
        }
      },
      select: {
        id: true,
        name_zh: true,
        name_en: true,
        abstract: true,
        image: true,
        translateType: true
      }
    })
    if (!eligible) {
      return { kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: '标签已不存在或不再属于 Pixiv 来源' }
    }

    await context.progress({ progress: 10, stage: 'THROTTLING', message: `准备查询标签 ${payload.expectedName}` })
    await randomizedDelay(context.signal, dependencies)
    throwIfAborted(context.signal)
    await context.progress({ progress: 30, stage: 'FETCHING', message: `正在查询 Pixiv 标签 ${payload.expectedName}` })
    const normalized = await fetchPixivTagMetadata({
      tagName: payload.expectedName,
      signal: context.signal,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      ...(dependencies.now ? { now: dependencies.now } : {})
    })
    const payloadHash = hashNormalizedPayload(normalized)

    let storedImage: string | null = null
    let imageFailure: Failure | null = null
    if ((refreshExisting || isEmpty(eligible.image)) && normalized.imageUrl) {
      await context.progress({ progress: 65, stage: 'DOWNLOADING_IMAGE', message: '正在保存 Pixiv 标签封面' })
      try {
        storedImage = await storePixivTagImage({
          imageUrl: normalized.imageUrl,
          pixivDataRoot: dependencies.pixivDataRoot,
          signal: context.signal,
          ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {})
        })
      } catch (error) {
        if (context.signal.aborted) throw error
        imageFailure = classifyFailure(error)
      }
    }

    const checkedAt = now()
    const hasRemoteData = Object.values(normalized).some((value) => value !== null)
    const status = imageFailure ? 'PARTIAL' : hasRemoteData ? 'SUCCESS' : 'NO_DATA'
    // 网络阶段结束后重新读取标签；普通补全只填空，显式刷新也必须通过逐字段并发比较。
    return context.finalizeInTransaction<PixivTagTransaction>(async (scope) => {
      if (await finalizeControl(scope)) return
      const tag = await scope.transaction.tag.findFirst({
        where: {
          id: payload.tagId,
          name: payload.expectedName,
          namespace: 'general',
          isSystem: false,
          artworkTags: {
            some: { provenance: 'SOURCE', sourceRef: { is: { providerKey: PROVIDER_KEY } } }
          }
        },
        select: {
          id: true,
          name_zh: true,
          name_en: true,
          abstract: true,
          image: true,
          translateType: true
        }
      })
      if (!tag) {
        await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '标签在写入前已变更，未应用查询结果' })
        return
      }

      const update: Prisma.TagUpdateInput = {}
      const appliedFields: string[] = []
      const skippedConcurrentFields: string[] = []
      const translationsUnchanged =
        eligible.name_zh === tag.name_zh &&
        eligible.name_en === tag.name_en &&
        eligible.translateType === tag.translateType
      const publishesZh =
        normalized.nameZh !== null &&
        (refreshExisting ? translationsUnchanged : isEmpty(tag.name_zh))
      const publishesEn =
        normalized.nameEn !== null &&
        (refreshExisting ? translationsUnchanged : isEmpty(tag.name_en))
      if (publishesZh) {
        update.name_zh = normalized.nameZh
        appliedFields.push('name_zh')
      }
      if (publishesEn) {
        update.name_en = normalized.nameEn
        appliedFields.push('name_en')
      }
      if (
        refreshExisting &&
        !translationsUnchanged &&
        (normalized.nameZh !== null || normalized.nameEn !== null)
      ) {
        if (normalized.nameZh !== null) skippedConcurrentFields.push('name_zh')
        if (normalized.nameEn !== null) skippedConcurrentFields.push('name_en')
      }
      if (
        normalized.abstract !== null &&
        (refreshExisting ? eligible.abstract === tag.abstract : isEmpty(tag.abstract))
      ) {
        update.abstract = normalized.abstract
        appliedFields.push('abstract')
      } else if (refreshExisting && normalized.abstract !== null && eligible.abstract !== tag.abstract) {
        skippedConcurrentFields.push('abstract')
      }
      if (storedImage !== null && (refreshExisting ? eligible.image === tag.image : isEmpty(tag.image))) {
        update.image = storedImage
        appliedFields.push('image')
      } else if (refreshExisting && storedImage !== null && eligible.image !== tag.image) {
        skippedConcurrentFields.push('image')
      }
      if (publishesZh || publishesEn) {
        if (refreshExisting || tag.translateType === 'NONE') update.translateType = 'PIXIV'
      }
      if (Object.keys(update).length > 0) await scope.transaction.tag.update({ where: { id: tag.id }, data: update })

      // 只有本次确实需要写入封面且保存失败才是 PARTIAL；已有封面的普通补全不会重复下载。
      await scope.transaction.tagExternalMetadata.upsert({
        where: { tagId_providerKey: { tagId: tag.id, providerKey: PROVIDER_KEY } },
        create: {
          tagId: tag.id,
          providerKey: PROVIDER_KEY,
          lookupKey: payload.expectedName,
          status,
          normalizedPayload: toNormalizedJson(normalized, storedImage, refreshExisting, skippedConcurrentFields),
          payloadHash,
          lastAttemptAt: checkedAt,
          lastSuccessAt: checkedAt,
          lastErrorCode: imageFailure?.code ?? null,
          lastError: imageFailure?.message ?? null,
          lastSystemJobId: context.job.id
        },
        update: {
          lookupKey: payload.expectedName,
          status,
          normalizedPayload: toNormalizedJson(normalized, storedImage, refreshExisting, skippedConcurrentFields),
          payloadHash,
          lastAttemptAt: checkedAt,
          lastSuccessAt: checkedAt,
          lastErrorCode: imageFailure?.code ?? null,
          lastError: imageFailure?.message ?? null,
          lastSystemJobId: context.job.id
        }
      })
      await scope.complete({
        result: {
          tagId: tag.id,
          status,
          appliedFields,
          skippedConcurrentFields,
          payloadHash,
          imageStored: storedImage !== null
        },
        message:
          status === 'PARTIAL'
            ? `Pixiv 标签${refreshExisting ? '刷新' : '补全'}完成，封面保存失败`
            : `Pixiv 标签${refreshExisting ? '刷新' : '补全'}完成`
      })
    })
  } catch (error) {
    if (context.signal.aborted) {
      return context.finalizeInTransaction<PixivTagTransaction>(async (scope) => {
        if (await finalizeControl(scope)) return
        await scope.release('Pixiv 标签补全已停止，等待恢复')
      })
    }
    const failure = classifyFailure(error)
    const attemptedAt = now()
    await context.mutateInTransaction<PixivTagTransaction>(async (transaction) => {
      const tag = await transaction.tag.findFirst({
        where: { id: payload.tagId, name: payload.expectedName },
        select: { id: true }
      })
      if (!tag) return
      await transaction.tagExternalMetadata.upsert({
        where: { tagId_providerKey: { tagId: tag.id, providerKey: PROVIDER_KEY } },
        create: {
          tagId: tag.id,
          providerKey: PROVIDER_KEY,
          lookupKey: payload.expectedName,
          status: 'FAILED',
          lastAttemptAt: attemptedAt,
          lastErrorCode: failure.code,
          lastError: failure.message,
          lastSystemJobId: context.job.id
        },
        update: {
          lookupKey: payload.expectedName,
          status: 'FAILED',
          lastAttemptAt: attemptedAt,
          lastErrorCode: failure.code,
          lastError: failure.message,
          lastSystemJobId: context.job.id
        }
      })
    })
    return retryOrFail(context, dependencies, failure, 'Pixiv 标签补全失败')
  }
}

async function finalizeControl(scope: FencedExecutionTransaction<PixivTagTransaction>) {
  if (scope.executionStatus === 'PAUSING') {
    await scope.pause({ reason: 'USER_REQUESTED', message: 'Pixiv 标签补全已暂停' })
    return true
  }
  if (scope.executionStatus === 'CANCELLING') {
    await scope.cancel('Pixiv 标签补全已取消')
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
  const rawMessage = error instanceof Error ? error.message : 'Unknown Pixiv tag enrichment failure'
  const message = rawMessage.slice(0, ERROR_MESSAGE_LIMIT)
  if (error instanceof PixivTagRequestError) {
    return {
      code: error.code,
      message,
      retryable: error.retryable,
      ...(error.retryAt ? { retryAt: error.retryAt } : {}),
      jobErrorCode: error.code === 'PIXIV_SCHEMA_CHANGED' ? 'PRECONDITION_FAILED' : 'INTERNAL_ERROR'
    }
  }
  if (error instanceof PixivTagImageError) {
    return { code: error.code, message, retryable: false, jobErrorCode: 'PRECONDITION_FAILED' }
  }
  return { code: 'PIXIV_INTERNAL_ERROR', message, retryable: true, jobErrorCode: 'INTERNAL_ERROR' }
}

function retryOrFail(
  context: Pick<ExecutionContext, 'job'>,
  dependencies: Pick<PixivTagExecutorDependencies, 'now'>,
  failure: Failure,
  message: string
): JobExecutionOutcome {
  // 退避与上游 Retry-After 取较晚者，避免限流时立即重试；不可重试错误直接终止。
  if (!failure.retryable || context.job.attempt >= context.job.maxAttempts) {
    return { kind: 'failed', errorCode: failure.jobErrorCode, error: failure.message, message }
  }
  const now = dependencies.now?.() ?? new Date()
  const exponentialRetry = new Date(
    now.getTime() + Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, context.job.attempt - 1))
  )
  return {
    kind: 'retry',
    availableAt: failure.retryAt && failure.retryAt > exponentialRetry ? failure.retryAt : exponentialRetry,
    errorCode: failure.jobErrorCode,
    error: failure.message,
    message: `${message}，等待重试`
  }
}

function hashNormalizedPayload(payload: NormalizedPixivTagMetadata) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function toNormalizedJson(
  payload: NormalizedPixivTagMetadata,
  storedImage: string | null,
  refreshExisting: boolean,
  skippedConcurrentFields: string[]
): Prisma.InputJsonObject {
  return {
    nameZh: payload.nameZh,
    nameEn: payload.nameEn,
    abstract: payload.abstract,
    imageAvailable: payload.imageUrl !== null,
    imageFile: storedImage,
    refreshExisting,
    skippedConcurrentFields
  }
}

function isEmpty(value: string | null | undefined) {
  return value == null || value.trim().length === 0
}

async function randomizedDelay(signal: AbortSignal, dependencies: PixivTagExecutorDependencies) {
  const random = dependencies.random ?? Math.random
  const milliseconds = 750 + Math.floor(random() * 1_001)
  if (dependencies.sleep) return dependencies.sleep(milliseconds, signal)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      reject(signal.reason instanceof Error ? signal.reason : new Error('Pixiv tag enrichment was interrupted'))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Pixiv tag enrichment was interrupted')
}
