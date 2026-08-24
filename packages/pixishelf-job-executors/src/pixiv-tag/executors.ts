import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@pixishelf/db'
import {
  JOB_DEFINITION_VERSION,
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
const DISCOVERY_PAGE_SIZE = 200
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
  let cursor = 0
  let discovered = 0
  let enqueued = 0
  let reused = 0
  try {
    await context.progress({ progress: 1, stage: 'DISCOVERING', message: '正在发现可从 Pixiv 补全的标签...' })
    while (true) {
      throwIfAborted(context.signal)
      const page = await dependencies.database.tag.findMany({
        where: {
          id: { gt: cursor },
          namespace: 'general',
          isSystem: false,
          artworkTags: {
            some: {
              provenance: 'SOURCE',
              sourceRef: { is: { providerKey: PROVIDER_KEY } }
            }
          },
          ...(payload.force ? {} : { externalMetadata: { none: { providerKey: PROVIDER_KEY } } })
        },
        orderBy: { id: 'asc' },
        take: DISCOVERY_PAGE_SIZE,
        select: { id: true, name: true }
      })
      if (page.length === 0) break
      cursor = page.at(-1)!.id
      discovered += page.length

      for (const tag of page) {
        throwIfAborted(context.signal)
        const child = await context.enqueueChild({
          type: 'PIXIV_TAG_ENRICHMENT',
          payload: { mode: 'TAG', tagId: tag.id, expectedName: tag.name, force: payload.force },
          queuePriority: CHILD_QUEUE_PRIORITY,
          idempotencyKey: `pixiv-tag:${context.job.id}:tag:${tag.id}:v1`
        })
        if (child.created) enqueued += 1
        else reused += 1
      }
      await context.progress({
        progress: Math.min(95, 5 + Math.floor(discovered / DISCOVERY_PAGE_SIZE) * 5),
        stage: 'DISCOVERING',
        message: `已发现 ${discovered} 个标签，创建 ${enqueued} 个补全任务`,
        data: { discovered, enqueued, reused }
      })
      if (page.length < DISCOVERY_PAGE_SIZE) break
    }
    return {
      kind: 'completed',
      result: { discovered, enqueued, reused },
      message: `标签发现完成：${discovered} 个候选，创建 ${enqueued} 个补全任务`
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
      select: { id: true }
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
    if (normalized.imageUrl) {
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
    // 网络阶段结束后重新读取标签，并在 fencing 事务内只填空字段；用户或其他来源的新值永远优先。
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
      const fillsZh = isEmpty(tag.name_zh) && normalized.nameZh !== null
      const fillsEn = isEmpty(tag.name_en) && normalized.nameEn !== null
      if (fillsZh) {
        update.name_zh = normalized.nameZh
        appliedFields.push('name_zh')
      }
      if (fillsEn) {
        update.name_en = normalized.nameEn
        appliedFields.push('name_en')
      }
      if (isEmpty(tag.abstract) && normalized.abstract !== null) {
        update.abstract = normalized.abstract
        appliedFields.push('abstract')
      }
      if (isEmpty(tag.image) && storedImage !== null) {
        update.image = storedImage
        appliedFields.push('image')
      }
      if ((fillsZh || fillsEn) && tag.translateType === 'NONE') update.translateType = 'PIXIV'
      if (Object.keys(update).length > 0) await scope.transaction.tag.update({ where: { id: tag.id }, data: update })

      // 文本成功而封面失败仍记录 PARTIAL，下一次显式重试可以只补上尚缺的封面。
      await scope.transaction.tagExternalMetadata.upsert({
        where: { tagId_providerKey: { tagId: tag.id, providerKey: PROVIDER_KEY } },
        create: {
          tagId: tag.id,
          providerKey: PROVIDER_KEY,
          lookupKey: payload.expectedName,
          status,
          normalizedPayload: toNormalizedJson(normalized, storedImage),
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
          normalizedPayload: toNormalizedJson(normalized, storedImage),
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
          payloadHash,
          imageStored: storedImage !== null
        },
        message: status === 'PARTIAL' ? 'Pixiv 标签文本已补全，封面保存失败' : 'Pixiv 标签补全完成'
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

function toNormalizedJson(payload: NormalizedPixivTagMetadata, storedImage: string | null): Prisma.InputJsonObject {
  return {
    nameZh: payload.nameZh,
    nameEn: payload.nameEn,
    abstract: payload.abstract,
    imageAvailable: payload.imageUrl !== null,
    imageFile: storedImage
  }
}

function isEmpty(value: string | null) {
  return value === null || value.trim().length === 0
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
