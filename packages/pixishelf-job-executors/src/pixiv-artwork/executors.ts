import { Prisma, type PrismaClient } from '@pixishelf/db'
import {
  JOB_DEFINITION_VERSION,
  PIXIV_ARTWORK_ENRICHMENT_BATCH_LIMIT,
  pixivArtworkEnrichmentPayloadSchema,
  type JobErrorCode,
  type PixivArtworkEnrichmentPayload
} from '@pixishelf/job-contracts'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  ExecutorDefinition,
  FencedExecutionTransaction,
  JobExecutionOutcome,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { replacePixivSourceTags } from '../scan/pixiv-publisher.ts'
import {
  PIXIV_AI_GENERATED_TAG,
  reconcilePixivAiGeneratedTag,
  resolvePixivAiGenerated
} from './ai-derived-tag.ts'
import { fetchPixivArtworkMetadata, PixivArtworkRequestError } from './client.ts'
import { PixivArtworkSnapshotError, storePixivArtworkSnapshot, storePixivArtworkSyncReport } from './storage.ts'
import {
  buildPixivArtworkSyncReport,
  type PixivArtworkSyncTrackedState
} from './sync-report.ts'

const PROVIDER_KEY = 'pixiv'
const CHILD_QUEUE_PRIORITY = 900
const ERROR_MESSAGE_LIMIT = 2_000

type PixivArtworkTransaction = Prisma.TransactionClient & QueueSqlExecutor

const TRACKED_ARTWORK_SELECT = {
  title: true,
  description: true,
  titleOverridden: true,
  descriptionOverridden: true,
  bookmarkCount: true,
  isAiGenerated: true,
  originalUrl: true,
  size: true,
  sourceDate: true,
  sourceUrl: true,
  thumbnailUrl: true,
  xRestrict: true,
  pixivAiType: true,
  pixivType: true,
  sanityLevel: true
} as const

type TrackedArtwork = Prisma.ArtworkGetPayload<{ select: typeof TRACKED_ARTWORK_SELECT }>

export interface PixivArtworkExecutorDependencies {
  database: PrismaClient
  pixivDataRoot: string
  fetchImpl?: typeof fetch
  now?: () => Date
  random?: () => number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export function createPixivArtworkExecutorRegistrations(
  dependencies: PixivArtworkExecutorDependencies
): ExecutorDefinition[] {
  if (!dependencies.pixivDataRoot.trim()) throw new Error('Pixiv artwork pixivDataRoot is required')
  const definition: ExecutorDefinition<PixivArtworkEnrichmentPayload> = {
    jobType: 'PIXIV_ARTWORK_ENRICHMENT',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: JOB_DEFINITION_VERSION,
    parsePayload: (payload) => pixivArtworkEnrichmentPayloadSchema.parse(payload),
    execute: (context) => executePixivArtworkEnrichment(context, dependencies)
  }
  return [definition as ExecutorDefinition]
}

async function executePixivArtworkEnrichment(
  context: ExecutionContext<PixivArtworkEnrichmentPayload, EnqueuedChildJob>,
  dependencies: PixivArtworkExecutorDependencies
): Promise<JobExecutionOutcome> {
  return context.payload.mode === 'DISCOVER'
    ? executeDiscovery(context, dependencies)
    : executeArtwork(context, dependencies)
}

async function executeDiscovery(
  context: ExecutionContext<PixivArtworkEnrichmentPayload, EnqueuedChildJob>,
  dependencies: PixivArtworkExecutorDependencies
): Promise<JobExecutionOutcome> {
  if (context.payload.mode !== 'DISCOVER') throw new Error('Expected a Pixiv artwork discovery payload')
  const payload = context.payload
  const candidateWhere = {
    providerKey: PROVIDER_KEY,
    externalId: { not: '' },
    artwork: { deletedAt: null },
    ...(!payload.refreshExisting && !payload.artworkIds ? { status: null } : {}),
    ...(payload.artworkIds ? { artworkId: { in: payload.artworkIds } } : {})
  } satisfies Prisma.ArtworkExternalRefWhereInput
  const orderedByAttempt = payload.refreshExisting && !payload.artworkIds
  const candidateOrder: Prisma.ArtworkExternalRefOrderByWithRelationInput[] = orderedByAttempt
    ? [{ lastAttemptAt: { sort: 'asc', nulls: 'first' } }, { artworkId: 'asc' }]
    : [{ artworkId: 'asc' }]
  let cursor: { artworkId: number; lastAttemptAt: Date | null } | undefined
  let pageCount = 0
  let discovered = 0
  let enqueued = 0
  let reused = 0

  try {
    await context.progress({ progress: 1, stage: 'DISCOVERING', message: '正在发现可从 Pixiv 同步的作品...' })
    const totalCandidates = await dependencies.database.artworkExternalRef.count({ where: candidateWhere })
    while (true) {
      throwIfAborted(context.signal)
      const cursorWhere: Prisma.ArtworkExternalRefWhereInput | undefined = cursor
        ? orderedByAttempt
          ? cursor.lastAttemptAt === null
            ? {
                OR: [{ lastAttemptAt: null, artworkId: { gt: cursor.artworkId } }, { lastAttemptAt: { not: null } }]
              }
            : {
                OR: [
                  { lastAttemptAt: { gt: cursor.lastAttemptAt } },
                  { lastAttemptAt: cursor.lastAttemptAt, artworkId: { gt: cursor.artworkId } }
                ]
              }
          : { artworkId: { gt: cursor.artworkId } }
        : undefined
      const refs = await dependencies.database.artworkExternalRef.findMany({
        where: cursorWhere ? { AND: [candidateWhere, cursorWhere] } : candidateWhere,
        orderBy: candidateOrder,
        take: PIXIV_ARTWORK_ENRICHMENT_BATCH_LIMIT,
        select: { id: true, artworkId: true, externalId: true, lastAttemptAt: true }
      })
      if (refs.length === 0) break
      pageCount += 1
      const lastRef = refs.at(-1)!
      cursor = { artworkId: lastRef.artworkId, lastAttemptAt: lastRef.lastAttemptAt }
      discovered += refs.length

      for (const ref of refs) {
        throwIfAborted(context.signal)
        if (!/^[1-9][0-9]*$/.test(ref.externalId)) continue
        const child = await context.enqueueChild({
          type: 'PIXIV_ARTWORK_ENRICHMENT',
          payload: {
            mode: 'ARTWORK',
            artworkId: ref.artworkId,
            expectedExternalRefId: ref.id,
            expectedPixivArtworkId: ref.externalId,
            adoptSourceText: payload.adoptSourceText
          },
          queuePriority: CHILD_QUEUE_PRIORITY,
          idempotencyKey: `pixiv-artwork:${context.job.id}:artwork:${ref.artworkId}:v1`
        })
        if (child.created) enqueued += 1
        else reused += 1
      }
      await context.progress({
        progress: totalCandidates > 0 ? Math.min(95, Math.max(1, Math.floor((discovered / totalCandidates) * 95))) : 95,
        stage: 'DISCOVERING',
        message: `已发现 ${discovered}/${totalCandidates} 个作品，创建 ${enqueued} 个同步任务`,
        data: { totalCandidates, pageCount, discovered, enqueued, reused }
      })
      if (discovered >= totalCandidates || refs.length < PIXIV_ARTWORK_ENRICHMENT_BATCH_LIMIT) break
    }
    return {
      kind: 'completed',
      result: { totalCandidates, pageCount, discovered, enqueued, reused },
      message: `Pixiv 作品同步发现完成：${discovered} 个候选，创建 ${enqueued} 个任务`
    }
  } catch (error) {
    if (context.signal.aborted) return { kind: 'released', message: 'Pixiv 作品同步发现已停止，等待恢复' }
    return retryOrFail(context, dependencies, classifyFailure(error), 'Pixiv 作品同步发现失败')
  }
}

async function executeArtwork(
  context: ExecutionContext<PixivArtworkEnrichmentPayload, EnqueuedChildJob>,
  dependencies: PixivArtworkExecutorDependencies
): Promise<JobExecutionOutcome> {
  if (context.payload.mode !== 'ARTWORK') throw new Error('Expected a Pixiv artwork item payload')
  const payload = context.payload
  const now = dependencies.now ?? (() => new Date())
  try {
    const observed = await dependencies.database.artworkExternalRef.findFirst({
      where: {
        id: payload.expectedExternalRefId,
        artworkId: payload.artworkId,
        providerKey: PROVIDER_KEY,
        externalId: payload.expectedPixivArtworkId,
        artwork: { deletedAt: null }
      },
      select: {
        artwork: {
          select: {
            title: true,
            description: true,
            titleOverridden: true,
            descriptionOverridden: true,
            externalRefs: { where: { providerKey: PROVIDER_KEY }, select: { id: true }, take: 2 }
          }
        }
      }
    })
    if (
      !observed ||
      observed.artwork.externalRefs.length !== 1 ||
      observed.artwork.externalRefs[0]?.id !== payload.expectedExternalRefId
    ) {
      return { kind: 'skipped', reason: 'PRECONDITION_NOT_MET', message: '作品 Pixiv 身份已不存在或发生变化' }
    }

    await context.progress({
      progress: 10,
      stage: 'THROTTLING',
      message: `准备查询 Pixiv 作品 ${payload.expectedPixivArtworkId}`
    })
    await randomizedDelay(context.signal, dependencies)
    throwIfAborted(context.signal)
    await context.progress({ progress: 30, stage: 'FETCHING', message: '正在查询 Pixiv 作品资料' })
    const response = await fetchPixivArtworkMetadata({
      pixivArtworkId: payload.expectedPixivArtworkId,
      signal: context.signal,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      ...(dependencies.now ? { now: dependencies.now } : {})
    })
    const checkedAt = now()
    if (!response) return finalizeNoData(context, payload, checkedAt)

    await context.progress({ progress: 60, stage: 'STORING_SNAPSHOT', message: '正在保存 Pixiv 作品资料快照' })
    const snapshot = await storePixivArtworkSnapshot({
      pixivDataRoot: dependencies.pixivDataRoot,
      pixivArtworkId: payload.expectedPixivArtworkId,
      fetchedAt: checkedAt,
      response
    })
    throwIfAborted(context.signal)
    await context.progress({ progress: 80, stage: 'PUBLISHING', message: '正在更新作品来源资料' })

    return context.finalizeInTransaction<PixivArtworkTransaction>(async (scope) => {
      if (await finalizeControl(scope)) return
      const locked = await scope.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT ref."id"
        FROM "artwork_external_refs" AS ref
        JOIN "Artwork" AS artwork ON artwork."id" = ref."artworkId"
        WHERE ref."id" = ${payload.expectedExternalRefId}
          AND ref."artworkId" = ${payload.artworkId}
          AND ref."providerKey" = ${PROVIDER_KEY}
          AND ref."externalId" = ${payload.expectedPixivArtworkId}
          AND artwork."deletedAt" IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "artwork_external_refs" AS other_ref
            WHERE other_ref."artworkId" = artwork."id"
              AND other_ref."providerKey" = ${PROVIDER_KEY}
              AND other_ref."id" <> ref."id"
          )
        FOR UPDATE OF ref, artwork
      `)
      if (locked.length !== 1) {
        await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '作品 Pixiv 身份在写入前已变更' })
        return
      }
      const ref = await scope.transaction.artworkExternalRef.findUnique({
        where: { id: payload.expectedExternalRefId },
        select: {
          id: true,
          artworkId: true,
          providerKey: true,
          externalId: true,
          onlineSnapshotHash: true,
          onlineSnapshotPath: true,
          artwork: {
            select: TRACKED_ARTWORK_SELECT
          }
        }
      })
      if (
        !ref ||
        ref.artworkId !== payload.artworkId ||
        ref.providerKey !== PROVIDER_KEY ||
        ref.externalId !== payload.expectedPixivArtworkId
      ) {
        await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '作品 Pixiv 身份在写入前已变更' })
        return
      }

      const metadata = response.normalized
      const isAiGenerated = resolvePixivAiGenerated(metadata.aiType, null)
      if (isAiGenerated === true && !metadata.tags.includes(PIXIV_AI_GENERATED_TAG.name)) {
        await reconcilePixivAiGeneratedTag(scope.transaction, {
          artworkId: ref.artworkId,
          sourceRefId: ref.id,
          sourceTags: metadata.tags,
          isAiGenerated
        })
      }
      const beforeState = toTrackedArtworkState(ref.artwork)
      const beforeTags = await listOwnedPixivSourceTags(scope.transaction, ref.artworkId, ref.id)
      const artworkUpdate: Prisma.ArtworkUpdateInput = {
        bookmarkCount: metadata.bookmarkCount,
        isAiGenerated,
        originalUrl: metadata.originalUrl,
        size: metadata.size,
        sourceDate: toDate(metadata.createDate ?? metadata.uploadDate),
        sourceUrl: metadata.canonicalUrl,
        thumbnailUrl: metadata.thumbnailUrl,
        xRestrict: metadata.xRestrict === null ? null : String(metadata.xRestrict),
        pixivAiType: metadata.aiType,
        pixivType: metadata.illustType,
        sanityLevel: metadata.sanityLevel
      }
      const appliedTextFields: string[] = []
      const skippedConcurrentFields: string[] = []
      if (payload.adoptSourceText) {
        if (
          metadata.title !== null &&
          ref.artwork.title === observed.artwork.title &&
          ref.artwork.titleOverridden === observed.artwork.titleOverridden
        ) {
          artworkUpdate.title = metadata.title
          artworkUpdate.titleOverridden = false
          appliedTextFields.push('title')
        } else if (metadata.title !== null) {
          skippedConcurrentFields.push('title')
        }
        if (
          ref.artwork.description === observed.artwork.description &&
          ref.artwork.descriptionOverridden === observed.artwork.descriptionOverridden
        ) {
          artworkUpdate.description = metadata.description
          artworkUpdate.descriptionLength = metadata.description?.length ?? 0
          artworkUpdate.descriptionOverridden = false
          appliedTextFields.push('description')
        } else {
          skippedConcurrentFields.push('description')
        }
      } else {
        if (!ref.artwork.titleOverridden && metadata.title !== null) {
          artworkUpdate.title = metadata.title
          appliedTextFields.push('title')
        }
        if (!ref.artwork.descriptionOverridden) {
          artworkUpdate.description = metadata.description
          artworkUpdate.descriptionLength = metadata.description?.length ?? 0
          appliedTextFields.push('description')
        }
      }

      await scope.transaction.artwork.update({ where: { id: ref.artworkId }, data: artworkUpdate })
      await replacePixivSourceTags(scope.transaction, ref.artworkId, ref.id, metadata.tags)
      await reconcilePixivAiGeneratedTag(scope.transaction, {
        artworkId: ref.artworkId,
        sourceRefId: ref.id,
        sourceTags: metadata.tags,
        isAiGenerated
      })
      const status = skippedConcurrentFields.length > 0 ? 'PARTIAL' : 'SUCCESS'
      const [afterArtwork, afterTags] = await Promise.all([
        scope.transaction.artwork.findUniqueOrThrow({ where: { id: ref.artworkId }, select: TRACKED_ARTWORK_SELECT }),
        listOwnedPixivSourceTags(scope.transaction, ref.artworkId, ref.id)
      ])
      const report = buildPixivArtworkSyncReport({
        jobId: context.job.id,
        artworkId: ref.artworkId,
        externalRefId: ref.id,
        pixivArtworkId: payload.expectedPixivArtworkId,
        checkedAt,
        refreshExisting: payload.adoptSourceText,
        status,
        beforeState,
        afterState: toTrackedArtworkState(afterArtwork),
        beforeTags,
        afterTags,
        protectedFields: skippedConcurrentFields as Array<'title' | 'description'>,
        beforeSnapshot:
          ref.onlineSnapshotHash && ref.onlineSnapshotPath
            ? { hash: ref.onlineSnapshotHash, path: ref.onlineSnapshotPath }
            : null,
        afterSnapshot: { hash: snapshot.hash, path: snapshot.relativePath }
      })
      await storePixivArtworkSyncReport({
        pixivDataRoot: dependencies.pixivDataRoot,
        pixivArtworkId: payload.expectedPixivArtworkId,
        jobId: context.job.id,
        report
      })
      await scope.transaction.artworkExternalRef.update({
        where: { id: ref.id },
        data: {
          canonicalUrl: metadata.canonicalUrl,
          locator: { artworkId: payload.expectedPixivArtworkId },
          status,
          lastAttemptAt: checkedAt,
          lastSuccessAt: checkedAt,
          lastErrorCode: null,
          lastError: null,
          lastSystemJobId: context.job.id,
          onlineSnapshotHash: snapshot.hash,
          onlineSnapshotPath: snapshot.relativePath,
          fetchedAt: checkedAt
        }
      })
      await scope.complete({
        result: {
          artworkId: ref.artworkId,
          status,
          appliedTextFields,
          skippedConcurrentFields,
          snapshotHash: snapshot.hash,
          snapshotPath: snapshot.relativePath,
          snapshotReused: snapshot.reused,
          tagCount: metadata.tags.length
        },
        message:
          status === 'PARTIAL'
            ? 'Pixiv 作品资料已同步；任务期间发生的人工文本修改已保留'
            : report.changeKind === 'UNCHANGED'
              ? 'Pixiv 作品资料同步完成，内容无变化'
              : report.changeKind === 'SNAPSHOT_ONLY'
                ? 'Pixiv 作品资料同步完成，仅远端快照发生变化'
                : 'Pixiv 作品资料同步完成并已记录变更'
      })
    })
  } catch (error) {
    if (context.signal.aborted) {
      return context.finalizeInTransaction<PixivArtworkTransaction>(async (scope) => {
        if (await finalizeControl(scope)) return
        await scope.release('Pixiv 作品同步已停止，等待恢复')
      })
    }
    const failure = classifyFailure(error)
    const attemptedAt = now()
    await context.mutateInTransaction<PixivArtworkTransaction>(async (transaction) => {
      await transaction.artworkExternalRef.updateMany({
        where: {
          id: payload.expectedExternalRefId,
          artworkId: payload.artworkId,
          providerKey: PROVIDER_KEY,
          externalId: payload.expectedPixivArtworkId
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
    return retryOrFail(context, dependencies, failure, 'Pixiv 作品同步失败')
  }
}

function finalizeNoData(
  context: ExecutionContext<PixivArtworkEnrichmentPayload, EnqueuedChildJob>,
  payload: Extract<PixivArtworkEnrichmentPayload, { mode: 'ARTWORK' }>,
  checkedAt: Date
): Promise<JobExecutionOutcome> {
  return context.finalizeInTransaction<PixivArtworkTransaction>(async (scope) => {
    if (await finalizeControl(scope)) return
    const locked = await scope.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT ref."id"
      FROM "artwork_external_refs" AS ref
      JOIN "Artwork" AS artwork ON artwork."id" = ref."artworkId"
      WHERE ref."id" = ${payload.expectedExternalRefId}
        AND ref."artworkId" = ${payload.artworkId}
        AND ref."providerKey" = ${PROVIDER_KEY}
        AND ref."externalId" = ${payload.expectedPixivArtworkId}
        AND artwork."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "artwork_external_refs" AS other_ref
          WHERE other_ref."artworkId" = artwork."id"
            AND other_ref."providerKey" = ${PROVIDER_KEY}
            AND other_ref."id" <> ref."id"
        )
      FOR UPDATE OF ref, artwork
    `)
    if (locked.length !== 1) {
      await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '作品 Pixiv 身份在写入前已变更' })
      return
    }
    const result = await scope.transaction.artworkExternalRef.updateMany({
      where: {
        id: payload.expectedExternalRefId,
        artworkId: payload.artworkId,
        providerKey: PROVIDER_KEY,
        externalId: payload.expectedPixivArtworkId
      },
      data: {
        status: 'NO_DATA',
        lastAttemptAt: checkedAt,
        lastSuccessAt: checkedAt,
        lastErrorCode: null,
        lastError: null,
        lastSystemJobId: context.job.id
      }
    })
    if (result.count !== 1) {
      await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '作品 Pixiv 身份在写入前已变更' })
      return
    }
    await scope.complete({
      result: { artworkId: payload.artworkId, status: 'NO_DATA' },
      message: 'Pixiv 未返回可同步的作品资料'
    })
  })
}

async function finalizeControl(scope: FencedExecutionTransaction<PixivArtworkTransaction>) {
  if (scope.executionStatus === 'PAUSING') {
    await scope.pause({ reason: 'USER_REQUESTED', message: 'Pixiv 作品同步已暂停' })
    return true
  }
  if (scope.executionStatus === 'CANCELLING') {
    await scope.cancel('Pixiv 作品同步已取消')
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
  const message = (error instanceof Error ? error.message : 'Unknown Pixiv artwork enrichment failure').slice(
    0,
    ERROR_MESSAGE_LIMIT
  )
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
  if (error instanceof PixivArtworkSnapshotError) {
    const retryable = ![
      'PIXIV_SNAPSHOT_PATH_INVALID',
      'PIXIV_SNAPSHOT_PATH_UNSAFE',
      'PIXIV_SNAPSHOT_TOO_LARGE',
      'PIXIV_SYNC_REPORT_PATH_INVALID',
      'PIXIV_SYNC_REPORT_PATH_UNSAFE',
      'PIXIV_SYNC_REPORT_IDENTITY_MISMATCH',
      'PIXIV_SYNC_REPORT_TOO_LARGE'
    ].includes(error.code)
    return { code: error.code, message, retryable, jobErrorCode: 'PRECONDITION_FAILED' }
  }
  return { code: 'PIXIV_ARTWORK_INTERNAL_ERROR', message, retryable: true, jobErrorCode: 'INTERNAL_ERROR' }
}

function retryOrFail(
  context: Pick<ExecutionContext, 'job'>,
  dependencies: Pick<PixivArtworkExecutorDependencies, 'now'>,
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

async function randomizedDelay(signal: AbortSignal, dependencies: PixivArtworkExecutorDependencies) {
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
      reject(signal.reason instanceof Error ? signal.reason : new Error('Pixiv artwork enrichment was interrupted'))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function toTrackedArtworkState(artwork: TrackedArtwork): PixivArtworkSyncTrackedState {
  return {
    title: artwork.title,
    description: artwork.description,
    titleOverridden: artwork.titleOverridden,
    descriptionOverridden: artwork.descriptionOverridden,
    bookmarkCount: artwork.bookmarkCount,
    isAiGenerated: artwork.isAiGenerated,
    originalUrl: artwork.originalUrl,
    size: artwork.size,
    sourceDate: artwork.sourceDate,
    sourceUrl: artwork.sourceUrl,
    thumbnailUrl: artwork.thumbnailUrl,
    xRestrict: artwork.xRestrict,
    pixivAiType: artwork.pixivAiType,
    pixivType: artwork.pixivType,
    sanityLevel: artwork.sanityLevel
  }
}

async function listOwnedPixivSourceTags(transaction: PixivArtworkTransaction, artworkId: number, sourceRefId: string) {
  const relations = await transaction.artworkTag.findMany({
    where: { artworkId, provenance: 'SOURCE', sourceRefId },
    select: { tag: { select: { name: true } } }
  })
  return relations.map((relation) => relation.tag.name)
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason instanceof Error ? signal.reason : new Error('Pixiv artwork enrichment interrupted')
}
