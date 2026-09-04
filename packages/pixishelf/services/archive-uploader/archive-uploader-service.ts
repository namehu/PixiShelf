import { createHash, randomUUID } from 'node:crypto'
import {
  ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE,
  archiveUploaderIdentityLockKey,
  archiveUploaderUidLockKey,
  archiveUploaderScanPayloadSchema,
  JOB_DEFINITION_VERSION
} from '@pixishelf/job-contracts'
import { Prisma, type PrismaClient } from '@pixishelf/db'
import {
  createDefaultArchiveMediaProviderRegistry,
  GovernedArchiveProviderRegistry,
  PostgresArchiveProviderGovernor,
  type ArchiveUploaderProviderRegistry
} from '@pixishelf/job-executors'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ArchiveError, type ArchiveErrorCode } from '@/services/archive/errors'
import { archiveWireErrorMessage, redactArchiveUrl } from '@/services/archive/archive-redaction'
import { createArchiveIntakeSubmissionInTransaction } from '@/services/archive-intake/archive-intake-service'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'
import { cancelJobCommand } from '@/services/background-task/job-command-service'
import { writeJobEvent } from '@/services/background-task/job-event-service'
import {
  ARCHIVE_UPLOADER_CATALOG_VIEWS,
  getArchiveUploaderCatalogCounts,
  listArchiveUploaderCatalogState,
  type ArchiveUploaderCatalogStateRow
} from './archive-uploader-catalog-state'

const PROVIDER_KEY = 'e-hentai'
const ACTIVE_RUN_STATUSES = ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'] as const
const SCAN_RESULT_LIMIT = 100
const SOURCE_LOCK_NAMESPACE = 20_260_902
const THUMBNAIL_HOST_SUFFIXES = ['e-hentai.org', 'ehgt.org', 'hath.network'] as const

const sourceIdSchema = z.string().trim().min(1).max(128)
const runIdSchema = z.string().trim().min(1).max(128)
const scanItemCursorSchema = z
  .object({
    sortAt: z.coerce.date(),
    lastSeenAt: z.coerce.date(),
    id: z.string().trim().min(1).max(128)
  })
  .strict()
const ignoredItemCursorSchema = z
  .object({
    ignoredAt: z.coerce.date(),
    id: z.string().trim().min(1).max(128)
  })
  .strict()
const scanItemIdsSchema = z
  .array(z.string().trim().min(1).max(128))
  .min(1)
  .max(SCAN_RESULT_LIMIT)
  .transform((values) => [...new Set(values)])

export const createArchiveUploaderSourceSchema = z
  .object({
    identityKind: z.enum(['NAME', 'UID']),
    identityValue: z.string().trim().min(1).max(180)
  })
  .strict()

export const listArchiveUploaderSourcesSchema = z.object({ includeArchived: z.boolean().default(true) }).strict()

export const getArchiveUploaderSourceSchema = z.object({ sourceId: sourceIdSchema }).strict()

export const listArchiveUploaderScanItemsSchema = z
  .object({
    sourceId: sourceIdSchema,
    view: z.enum(ARCHIVE_UPLOADER_CATALOG_VIEWS).default('ACTIONABLE'),
    cursor: scanItemCursorSchema.nullish(),
    limit: z.number().int().min(1).max(SCAN_RESULT_LIMIT).default(50),
    direction: z.literal('forward').optional()
  })
  .strict()

export const listArchiveUploaderIgnoredItemsSchema = z
  .object({
    cursor: ignoredItemCursorSchema.nullish(),
    limit: z.number().int().min(1).max(SCAN_RESULT_LIMIT).default(50),
    direction: z.literal('forward').optional()
  })
  .strict()

export const setArchiveUploaderSourceArchivedSchema = z
  .object({ sourceId: sourceIdSchema, archived: z.boolean() })
  .strict()

export const setArchiveUploaderUidSchema = z
  .object({ sourceId: sourceIdSchema, uploaderUid: z.string().trim().min(1).max(20) })
  .strict()

export const matchArchiveUploaderUidSchema = z.object({ sourceId: sourceIdSchema }).strict()

export const triggerArchiveUploaderScanSchema = z
  .object({ sourceId: sourceIdSchema, mode: z.enum(['LATEST', 'HISTORY']) })
  .strict()

export const cancelArchiveUploaderScanSchema = z.object({ sourceId: sourceIdSchema, runId: runIdSchema }).strict()

export const createArchiveUploaderSubmissionAttemptSchema = z
  .object({
    sourceId: sourceIdSchema,
    itemIds: scanItemIdsSchema
  })
  .strict()

export const addArchiveUploaderScanItemsSchema = createArchiveUploaderSubmissionAttemptSchema.extend({
  submissionAttemptId: z.string().uuid()
})

export const ignoreArchiveUploaderScanItemsSchema = z
  .object({ sourceId: sourceIdSchema, itemIds: scanItemIdsSchema })
  .strict()

export const restoreArchiveUploaderIgnoredItemsSchema = z.object({ ignoredItemIds: scanItemIdsSchema }).strict()

export interface ArchiveUploaderServiceDependencies {
  database?: PrismaClient
  now?: () => Date
  uuid?: () => string
  uploaderProviders?: ArchiveUploaderProviderRegistry
}

export async function createArchiveUploaderSubmissionAttempt(
  input: z.input<typeof createArchiveUploaderSubmissionAttemptSchema>,
  dependencies: Pick<ArchiveUploaderServiceDependencies, 'uuid'> = {}
) {
  createArchiveUploaderSubmissionAttemptSchema.parse(input)
  return { submissionAttemptId: (dependencies.uuid ?? randomUUID)() }
}

export async function createArchiveUploaderSource(
  input: z.input<typeof createArchiveUploaderSourceSchema>,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = createArchiveUploaderSourceSchema.parse(input)
  const identity = normalizeUploaderIdentity(parsed.identityKind, parsed.identityValue)
  const database = getDatabase(dependencies)
  try {
    const source = await database.archiveUploaderSource.create({
      data: {
        providerKey: PROVIDER_KEY,
        identityKind: parsed.identityKind,
        identityValue: identity.value,
        normalizedIdentity: identity.normalized,
        uploaderUid: parsed.identityKind === 'UID' ? identity.value : null,
        displayName: parsed.identityKind === 'UID' ? `UID ${identity.value}` : identity.value
      },
      select: sourceWireSelect
    })
    return serializeSource(source)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ArchiveError('STATE_CONFLICT', '该上传者来源已经存在；若已归档，请直接重新启用')
    }
    throw error
  }
}

export async function listArchiveUploaderSources(
  input: z.input<typeof listArchiveUploaderSourcesSchema>,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = listArchiveUploaderSourcesSchema.parse(input)
  const database = getDatabase(dependencies)
  const sources = await database.archiveUploaderSource.findMany({
    where: parsed.includeArchived ? undefined : { status: 'ACTIVE' },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    select: {
      ...sourceWireSelect,
      runs: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: runSummarySelect }
    }
  })
  const countsBySource = await getArchiveUploaderCatalogCounts(
    database,
    sources.map(({ id }) => id)
  )
  return sources.map(({ runs, ...source }) => ({
    ...serializeSource(source),
    latestRun: runs[0] ? serializeRunSummary(runs[0]) : null,
    catalogCounts: countsBySource.get(source.id) ?? emptyCatalogCounts()
  }))
}

export async function getArchiveUploaderSource(
  input: z.input<typeof getArchiveUploaderSourceSchema>,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = getArchiveUploaderSourceSchema.parse(input)
  const database = getDatabase(dependencies)
  const source = await database.archiveUploaderSource.findUnique({
    where: { id: parsed.sourceId },
    select: {
      ...sourceWireSelect,
      runs: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10, select: runSummarySelect }
    }
  })
  if (!source) throw new ArchiveError('STATE_CONFLICT', '上传者来源不存在')
  const { runs, ...wireSource } = source
  const counts = await getArchiveUploaderCatalogCounts(database, [source.id])
  return {
    source: { ...serializeSource(wireSource), catalogCounts: counts.get(source.id) ?? emptyCatalogCounts() },
    runs: runs.map(serializeRunSummary)
  }
}

export async function listArchiveUploaderScanItems(
  input: z.input<typeof listArchiveUploaderScanItemsSchema>,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = listArchiveUploaderScanItemsSchema.parse(input)
  const database = getDatabase(dependencies)
  const source = await database.archiveUploaderSource.findUnique({
    where: { id: parsed.sourceId },
    select: { id: true }
  })
  if (!source) throw new ArchiveError('STATE_CONFLICT', '上传者来源不存在')
  const result = await listArchiveUploaderCatalogState(database, parsed)
  return {
    items: result.items.map(serializeCatalogItem),
    nextCursor: result.nextCursor
  }
}

export async function listArchiveUploaderIgnoredItems(
  input: z.input<typeof listArchiveUploaderIgnoredItemsSchema>,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = listArchiveUploaderIgnoredItemsSchema.parse(input)
  const rows = await getDatabase(dependencies).archiveUploaderIgnoredItem.findMany({
    where: parsed.cursor
      ? {
          OR: [
            { ignoredAt: { lt: parsed.cursor.ignoredAt } },
            { ignoredAt: parsed.cursor.ignoredAt, id: { lt: parsed.cursor.id } }
          ]
        }
      : undefined,
    orderBy: [{ ignoredAt: 'desc' }, { id: 'desc' }],
    take: parsed.limit + 1,
    select: ignoredItemWireSelect
  })
  const hasMore = rows.length > parsed.limit
  const visible = hasMore ? rows.slice(0, parsed.limit) : rows
  const last = visible.at(-1)
  return {
    items: visible.map(serializeIgnoredItem),
    nextCursor: hasMore && last ? { ignoredAt: last.ignoredAt, id: last.id } : null
  }
}

export async function setArchiveUploaderSourceArchived(
  input: z.input<typeof setArchiveUploaderSourceArchivedSchema>,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = setArchiveUploaderSourceArchivedSchema.parse(input)
  const database = getDatabase(dependencies)
  return database.$transaction(async (transaction) => {
    await lockSource(transaction, parsed.sourceId)
    const source = await transaction.archiveUploaderSource.findUnique({ where: { id: parsed.sourceId } })
    if (!source) throw new ArchiveError('STATE_CONFLICT', '上传者来源不存在')
    if (parsed.archived) {
      const activeRun = await transaction.archiveUploaderScanRun.findFirst({
        where: { sourceId: source.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
        select: { id: true }
      })
      if (activeRun) throw new ArchiveError('STATE_CONFLICT', '扫描任务仍在活动中，完成或取消后才能归档来源')
    }
    const status = parsed.archived ? 'ARCHIVED' : 'ACTIVE'
    if (source.status === status) return { id: source.id, status }
    const changed = await transaction.archiveUploaderSource.update({ where: { id: source.id }, data: { status } })
    return { id: changed.id, status: changed.status }
  })
}

export async function setArchiveUploaderUid(
  input: z.input<typeof setArchiveUploaderUidSchema>,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = setArchiveUploaderUidSchema.parse(input)
  const uploaderUid = normalizeUploaderIdentity('UID', parsed.uploaderUid).value
  const database = getDatabase(dependencies)
  const now = dependencies.now ?? (() => new Date())

  try {
    return await database.$transaction(async (transaction) => {
      await lockSource(transaction, parsed.sourceId)
      const source = await transaction.archiveUploaderSource.findUnique({ where: { id: parsed.sourceId } })
      if (!source) throw new ArchiveError('STATE_CONFLICT', '上传者来源不存在')
      if (source.uploaderUid === uploaderUid) {
        return { outcome: 'UNCHANGED' as const, sourceId: source.id, uploaderUid }
      }

      const activeRun = await transaction.archiveUploaderScanRun.findFirst({
        where: { sourceId: source.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
        select: { id: true }
      })
      if (activeRun) throw new ArchiveError('STATE_CONFLICT', '扫描任务仍在活动中，完成或取消后才能修改上传者 UID')

      await lockUploaderUid(transaction, source.providerKey, uploaderUid)

      const conflict = await transaction.archiveUploaderSource.findFirst({
        where: { providerKey: source.providerKey, uploaderUid, id: { not: source.id } },
        select: { id: true }
      })
      if (conflict) {
        return {
          outcome: 'CONFLICT' as const,
          sourceId: source.id,
          conflictingSourceId: conflict.id,
          uploaderUid
        }
      }

      const placeholderDisplayName =
        source.identityKind === 'UID' && source.displayName === `UID ${source.identityValue}`
      const changed = await transaction.archiveUploaderSource.update({
        where: { id: source.id },
        data: {
          uploaderUid,
          uidRevalidationRequiredAt: now(),
          ...(source.identityKind === 'UID'
            ? {
                identityValue: uploaderUid,
                normalizedIdentity: uploaderUid,
                ...(placeholderDisplayName ? { displayName: `UID ${uploaderUid}` } : {})
              }
            : {}),
          latestSeenExternalId: null,
          incrementalCursor: null,
          incrementalHeadExternalId: null,
          historyCursor: null,
          lastScanAt: null,
          lastSuccessAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastRunId: null
        },
        select: sourceWireSelect
      })
      return { outcome: 'UPDATED' as const, sourceId: changed.id, uploaderUid, source: serializeSource(changed) }
    })
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const source = await database.archiveUploaderSource.findUnique({
      where: { id: parsed.sourceId },
      select: { id: true, providerKey: true }
    })
    if (!source) throw new ArchiveError('STATE_CONFLICT', '上传者来源不存在')
    const conflict = await database.archiveUploaderSource.findFirst({
      where: { providerKey: source.providerKey, uploaderUid, id: { not: source.id } },
      select: { id: true }
    })
    if (conflict) {
      return {
        outcome: 'CONFLICT' as const,
        sourceId: source.id,
        conflictingSourceId: conflict.id,
        uploaderUid
      }
    }
    throw new ArchiveError('STATE_CONFLICT', '上传者 UID 修改发生冲突，请刷新后重试')
  }
}

export async function matchArchiveUploaderUid(
  input: z.input<typeof matchArchiveUploaderUidSchema>,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = matchArchiveUploaderUidSchema.parse(input)
  const database = getDatabase(dependencies)
  const source = await database.archiveUploaderSource.findUnique({
    where: { id: parsed.sourceId },
    select: {
      id: true,
      providerKey: true,
      identityKind: true,
      identityValue: true,
      uploaderUid: true,
      displayName: true,
      runs: {
        where: { status: { in: [...ACTIVE_RUN_STATUSES] } },
        take: 1,
        select: { id: true }
      }
    }
  })
  if (!source) throw new ArchiveError('STATE_CONFLICT', '上传者来源不存在')
  if (source.runs.length > 0) {
    throw new ArchiveError('STATE_CONFLICT', '扫描任务仍在活动中，完成或取消后才能自动匹配上传者 UID')
  }

  const uploaderName =
    source.identityKind === 'NAME'
      ? source.identityValue
      : source.displayName === `UID ${source.identityValue}`
        ? null
        : source.displayName
  if (!uploaderName) {
    throw new ArchiveError('STATE_CONFLICT', '当前来源还没有可验证的上传者名称，请先完成一次 UID 扫描')
  }

  let result
  try {
    const providers =
      dependencies.uploaderProviders ??
      new GovernedArchiveProviderRegistry(
        createDefaultArchiveMediaProviderRegistry(),
        new PostgresArchiveProviderGovernor(database)
      )
    result = await providers.getUploaderScanner(source.providerKey).scanUploader({
      identityKind: 'NAME',
      identityValue: uploaderName,
      cursor: null,
      stopAtExternalId: null,
      limit: 1
    })
  } catch (error) {
    throw translateUploaderProviderError(error)
  }

  const uploaderUid = result.discoveredUploaderUid
  const matchedItem = result.items[0]
  if (!uploaderUid || !matchedItem?.uploaderName) {
    throw new ArchiveError('REMOTE_NOT_FOUND', '没有找到可验证的上传者 UID；你仍可手动填写')
  }
  const conflict = await database.archiveUploaderSource.findFirst({
    where: { providerKey: source.providerKey, uploaderUid, id: { not: source.id } },
    select: { id: true }
  })
  if (conflict) {
    return {
      outcome: 'CONFLICT' as const,
      sourceId: source.id,
      conflictingSourceId: conflict.id,
      uploaderUid,
      uploaderName: matchedItem.uploaderName,
      evidenceExternalId: matchedItem.externalId
    }
  }
  return {
    outcome: 'MATCHED' as const,
    sourceId: source.id,
    uploaderUid,
    uploaderName: matchedItem.uploaderName,
    evidenceExternalId: matchedItem.externalId
  }
}

export async function triggerArchiveUploaderScan(
  input: z.input<typeof triggerArchiveUploaderScanSchema>,
  requestedByUserId: string,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = triggerArchiveUploaderScanSchema.parse(input)
  const database = getDatabase(dependencies)
  const now = dependencies.now ?? (() => new Date())
  const uuid = dependencies.uuid ?? randomUUID
  try {
    return await database.$transaction(async (transaction) => {
      await lockSource(transaction, parsed.sourceId)
      const source = await transaction.archiveUploaderSource.findUnique({ where: { id: parsed.sourceId } })
      if (!source) throw new ArchiveError('STATE_CONFLICT', '上传者来源不存在')
      if (source.status !== 'ACTIVE') throw new ArchiveError('STATE_CONFLICT', '请先重新启用该上传者来源')
      const activeRun = await transaction.archiveUploaderScanRun.findFirst({
        where: { sourceId: source.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
        select: { id: true }
      })
      if (activeRun) throw new ArchiveError('STATE_CONFLICT', '该上传者已有活动扫描任务')

      const cursorBefore = parsed.mode === 'HISTORY' ? source.historyCursor : source.incrementalCursor
      if (parsed.mode === 'HISTORY' && !cursorBefore) {
        throw new ArchiveError('STATE_CONFLICT', '当前没有更早的扫描页可继续')
      }
      const searchIdentityKind = source.uploaderUid ? ('UID' as const) : source.identityKind
      const searchIdentityValue = source.uploaderUid ?? source.identityValue
      const timestamp = now()
      const runId = uuid()
      const jobId = uuid()
      const payload = archiveUploaderScanPayloadSchema.parse({ scanRunId: runId })
      await transaction.systemJob.create({
        data: {
          id: jobId,
          type: 'ARCHIVE_UPLOADER_SCAN',
          executionLane: 'ARCHIVE_RESOLVE',
          definitionVersion: JOB_DEFINITION_VERSION,
          status: 'PENDING',
          triggerSource: 'MANUAL',
          requestedByUserId,
          idempotencyKey: `archive-uploader-scan:${runId}`,
          payload,
          queuePriority: 20,
          effectivePriority: 20,
          availableAt: timestamp,
          maxAttempts: 3,
          message: '等待扫描 E-Hentai 上传者...'
        }
      })
      await writeJobEvent(transaction, {
        jobId,
        type: 'job.queued',
        attempt: 0,
        message: '上传者扫描已加入队列',
        data: { sourceId: source.id, scanRunId: runId, mode: parsed.mode }
      })
      const run = await transaction.archiveUploaderScanRun.create({
        data: {
          id: runId,
          sourceId: source.id,
          systemJobId: jobId,
          mode: parsed.mode,
          searchIdentityKind,
          searchIdentityValue,
          cursorBefore
        },
        select: runSummarySelect
      })
      await transaction.archiveUploaderSource.update({ where: { id: source.id }, data: { lastRunId: run.id } })
      return run
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ArchiveError('STATE_CONFLICT', '该上传者已有活动扫描任务')
    throw error
  }
}

export async function cancelArchiveUploaderScan(
  input: z.input<typeof cancelArchiveUploaderScanSchema>,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = cancelArchiveUploaderScanSchema.parse(input)
  const database = getDatabase(dependencies)
  const run = await database.archiveUploaderScanRun.findFirst({
    where: { id: parsed.runId, sourceId: parsed.sourceId },
    select: { id: true, systemJobId: true, status: true }
  })
  if (!run) throw new ArchiveError('STATE_CONFLICT', '扫描任务不存在或不属于该上传者来源')
  if (run.status === 'CANCELLED') return { id: run.id, status: 'CANCELLED' as const }
  if (!ACTIVE_RUN_STATUSES.includes(run.status as (typeof ACTIVE_RUN_STATUSES)[number])) {
    throw new ArchiveError('STATE_CONFLICT', '扫描任务已经结束，请刷新页面查看最新状态')
  }
  try {
    const job = await cancelJobCommand({ jobId: run.systemJobId }, database)
    return { id: run.id, status: job.status }
  } catch (error) {
    if (error instanceof BackgroundTaskError) {
      throw new ArchiveError('STATE_CONFLICT', '扫描任务状态已经变化，请刷新页面后重试')
    }
    throw error
  }
}

export async function ignoreArchiveUploaderScanItems(
  input: z.input<typeof ignoreArchiveUploaderScanItemsSchema>,
  ignoredByUserId: string,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = ignoreArchiveUploaderScanItemsSchema.parse(input)
  const database = getDatabase(dependencies)
  return database.$transaction(async (transaction) => {
    const source = await transaction.archiveUploaderSource.findUnique({
      where: { id: parsed.sourceId },
      select: { id: true, displayName: true }
    })
    if (!source) throw new ArchiveError('STATE_CONFLICT', '上传者来源不存在')

    const candidates = await transaction.archiveUploaderCatalogItem.findMany({
      where: { id: { in: parsed.itemIds }, sourceId: source.id },
      orderBy: { id: 'asc' },
      select: dispositionCatalogItemSelect
    })
    assertAllDispositionItemsFound(candidates, parsed.itemIds)
    await lockDispositionItems(transaction, candidates)
    const items = await transaction.archiveUploaderCatalogItem.findMany({
      where: { id: { in: parsed.itemIds }, sourceId: source.id },
      orderBy: { id: 'asc' },
      select: dispositionCatalogItemSelect
    })
    assertAllDispositionItemsFound(items, parsed.itemIds)
    await assertCatalogItemsActionable(transaction, items)

    const uniqueItems = [...new Map(items.map((item) => [dispositionKey(item), item] as const)).values()]
    const created = await transaction.archiveUploaderIgnoredItem.createMany({
      data: uniqueItems.map((item) => ({
        providerKey: item.providerKey,
        externalId: item.externalId,
        sourceId: source.id,
        sourceDisplayName: source.displayName,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        uploaderName: item.uploaderName,
        postedAt: item.postedAt,
        ignoredByUserId
      })),
      skipDuplicates: true
    })
    const ignoredItems = await transaction.archiveUploaderIgnoredItem.findMany({
      where: {
        OR: uniqueItems.map((item) => ({ providerKey: item.providerKey, externalId: item.externalId }))
      },
      orderBy: { id: 'asc' },
      select: { id: true }
    })
    return {
      ignoredItemIds: ignoredItems.map(({ id }) => id),
      ignoredCount: uniqueItems.length,
      createdCount: created.count,
      reusedCount: uniqueItems.length - created.count
    }
  })
}

export async function restoreArchiveUploaderIgnoredItems(
  input: z.input<typeof restoreArchiveUploaderIgnoredItemsSchema>,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = restoreArchiveUploaderIgnoredItemsSchema.parse(input)
  const deleted = await getDatabase(dependencies).archiveUploaderIgnoredItem.deleteMany({
    where: { id: { in: parsed.ignoredItemIds } }
  })
  return { restoredCount: deleted.count }
}

export async function addArchiveUploaderScanItems(
  input: z.input<typeof addArchiveUploaderScanItemsSchema>,
  requestedByUserId: string,
  dependencies: ArchiveUploaderServiceDependencies = {}
) {
  const parsed = addArchiveUploaderScanItemsSchema.parse(input)
  const database = getDatabase(dependencies)
  return database.$transaction(async (transaction) => {
    const candidates = await transaction.archiveUploaderCatalogItem.findMany({
      where: { id: { in: parsed.itemIds }, sourceId: parsed.sourceId },
      orderBy: { id: 'asc' },
      select: dispositionCatalogItemSelect
    })
    assertAllDispositionItemsFound(candidates, parsed.itemIds)
    await lockDispositionItems(transaction, candidates)
    const items = await transaction.archiveUploaderCatalogItem.findMany({
      where: { id: { in: parsed.itemIds }, sourceId: parsed.sourceId },
      orderBy: { id: 'asc' },
      select: dispositionCatalogItemSelect
    })
    assertAllDispositionItemsFound(items, parsed.itemIds)

    const digest = createHash('sha256')
      .update(`${parsed.sourceId}\n${[...parsed.itemIds].sort().join('\n')}`)
      .digest('hex')
    const idempotencyKey = `uploader-scan:${digest}:${parsed.submissionAttemptId}`
    const existingAttempt = await transaction.archiveIntakeSubmission.findUnique({
      where: { idempotencyKey },
      select: { id: true }
    })
    if (!existingAttempt) {
      await assertCatalogItemsActionable(transaction, items)
      const ignoredItem = await transaction.archiveUploaderIgnoredItem.findFirst({
        where: {
          OR: items.map((item) => ({ providerKey: item.providerKey, externalId: item.externalId }))
        },
        select: { id: true }
      })
      if (ignoredItem) throw new ArchiveError('STATE_CONFLICT', '所选扫描结果已被忽略，请先从全局已忽略中恢复')
    }

    const submission = await createArchiveIntakeSubmissionInTransaction(
      {
        idempotencyKey,
        urls: items.map(({ canonicalUrl }) => canonicalUrl)
      },
      requestedByUserId,
      transaction,
      { now: dependencies.now, uuid: dependencies.uuid }
    )
    const intakeItems = await transaction.archiveIntakeItem.findMany({
      where: { submissionId: submission.id },
      select: { id: true, submittedUrl: true, status: true, updatedAt: true }
    })
    const intakeByUrl = new Map(intakeItems.map((item) => [item.submittedUrl, item]))
    const outcomeAt = (dependencies.now ?? (() => new Date()))()
    for (const item of items) {
      const intakeItem = intakeByUrl.get(item.canonicalUrl)
      if (!intakeItem) continue
      const duplicate = intakeItem.status === 'DUPLICATE'
      await transaction.archiveUploaderCatalogItem.updateMany({
        where: { providerKey: item.providerKey, externalId: item.externalId },
        data: {
          lastIntakeItemId: intakeItem.id,
          lastArchiveImportId: null,
          lastOutcome: duplicate ? 'DUPLICATE' : 'SUBMITTED',
          lastOutcomeAt: duplicate ? intakeItem.updatedAt : outcomeAt,
          lastErrorCode: duplicate ? 'ACTIVE_DUPLICATE' : null,
          lastErrorMessage: duplicate ? '相同链接已有活动收件项目' : null
        }
      })
    }
    return submission
  })
}

function assertAllDispositionItemsFound(items: DispositionCatalogItem[], itemIds: string[]) {
  if (items.length !== itemIds.length) {
    throw new ArchiveError('STATE_CONFLICT', '部分扫描结果不存在或不属于该上传者来源')
  }
}

async function assertCatalogItemsActionable(transaction: Prisma.TransactionClient, items: DispositionCatalogItem[]) {
  if (
    items.some((item) => item.lastOutcome !== null && item.lastOutcome !== 'ARCHIVED' && item.lastIntakeItemId !== null)
  ) {
    throw new ArchiveError('STATE_CONFLICT', '该画廊已经进入过收件流程；请前往收件箱处理当前结果')
  }
  const identities = items.map((item) => ({ providerKey: item.providerKey, externalId: item.externalId }))
  const canonicalUrls = items.map(({ canonicalUrl }) => canonicalUrl)
  const authoritativeTerminalFilters: Prisma.ArchiveIntakeItemWhereInput[] = items.map((item) => ({
    status: { in: ['FAILED', 'CANCELLED', 'DUPLICATE'] },
    updatedAt: item.lastOutcomeAt ? { gt: item.lastOutcomeAt } : undefined,
    OR: [
      { providerKey: item.providerKey, externalId: item.externalId },
      { submittedUrl: item.canonicalUrl },
      { canonicalUrl: item.canonicalUrl }
    ]
  }))
  const [references, activeIntake, terminalIntake, activeImports] = await Promise.all([
    transaction.artworkExternalRef.findMany({
      where: { OR: identities },
      select: { providerKey: true, externalId: true }
    }),
    transaction.archiveIntakeItem.findFirst({
      where: {
        status: { in: ['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'] },
        OR: [...identities, { submittedUrl: { in: canonicalUrls } }, { canonicalUrl: { in: canonicalUrls } }]
      },
      select: { id: true }
    }),
    transaction.archiveIntakeItem.findFirst({
      where: { OR: authoritativeTerminalFilters },
      select: { id: true }
    }),
    transaction.archiveImport.findFirst({
      where: {
        status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] },
        OR: identities
      },
      select: { id: true }
    })
  ])
  const referenceKeys = new Set(references.map(dispositionKey))
  const hasInvalidRecommendation = items.some((item) => {
    const archived = referenceKeys.has(dispositionKey(item))
    return archived && item.classification !== 'POSSIBLE_UPDATE'
  })
  if (activeIntake || terminalIntake || activeImports || hasInvalidRecommendation) {
    throw new ArchiveError(
      'STATE_CONFLICT',
      '只能处理尚未提交的新归档、检测到变化或替代版本；活动和异常任务请前往收件箱处理'
    )
  }
}

async function lockDispositionItems(transaction: Prisma.TransactionClient, items: DispositionCatalogItem[]) {
  const keys = [...new Set(items.map(dispositionKey))].sort()
  for (const key of keys) {
    await transaction.$queryRaw<{ lock: string }[]>(
      Prisma.sql`SELECT pg_advisory_xact_lock(${ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE}::integer, hashtext(${key}::text))::text AS "lock"`
    )
  }
}

function dispositionKey(item: Pick<DispositionCatalogItem, 'providerKey' | 'externalId'>) {
  return archiveUploaderIdentityLockKey(item.providerKey, item.externalId)
}

function normalizeUploaderIdentity(kind: 'NAME' | 'UID', input: string) {
  if (kind === 'UID') {
    if (!/^\d{1,20}$/.test(input) || BigInt(input) <= 0n) {
      throw new ArchiveError('INVALID_URL', '上传者 UID 必须是正整数')
    }
    const value = BigInt(input).toString(10)
    return { value, normalized: value }
  }
  const value = input.normalize('NFKC').trim()
  // oxlint-disable-next-line no-control-regex -- 查询身份不能包含控制字符或查询引号
  if (!value || /["\u0000-\u001f\u007f]/.test(value)) throw new ArchiveError('INVALID_URL', '上传者名称无效')
  return { value, normalized: value.toLocaleLowerCase('en-US') }
}

const sourceWireSelect = {
  id: true,
  providerKey: true,
  identityKind: true,
  identityValue: true,
  uploaderUid: true,
  uidRevalidationRequiredAt: true,
  displayName: true,
  status: true,
  latestSeenExternalId: true,
  incrementalCursor: true,
  historyCursor: true,
  lastScanAt: true,
  lastSuccessAt: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.ArchiveUploaderSourceSelect

const runSummarySelect = {
  id: true,
  systemJobId: true,
  mode: true,
  searchIdentityKind: true,
  searchIdentityValue: true,
  status: true,
  itemCount: true,
  newCount: true,
  activeCount: true,
  archivedCount: true,
  possibleUpdateCount: true,
  replacementCount: true,
  stopReason: true,
  startedAt: true,
  finishedAt: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.ArchiveUploaderScanRunSelect

const dispositionCatalogItemSelect = {
  id: true,
  sourceId: true,
  providerKey: true,
  externalId: true,
  canonicalUrl: true,
  title: true,
  thumbnailUrl: true,
  uploaderName: true,
  postedAt: true,
  classification: true,
  lastIntakeItemId: true,
  lastOutcome: true,
  lastOutcomeAt: true
} satisfies Prisma.ArchiveUploaderCatalogItemSelect

const ignoredItemWireSelect = {
  id: true,
  providerKey: true,
  externalId: true,
  sourceDisplayName: true,
  title: true,
  thumbnailUrl: true,
  uploaderName: true,
  postedAt: true,
  ignoredAt: true
} satisfies Prisma.ArchiveUploaderIgnoredItemSelect

type SourceWire = Prisma.ArchiveUploaderSourceGetPayload<{ select: typeof sourceWireSelect }>
type DispositionCatalogItem = Prisma.ArchiveUploaderCatalogItemGetPayload<{
  select: typeof dispositionCatalogItemSelect
}>
type IgnoredItemWire = Prisma.ArchiveUploaderIgnoredItemGetPayload<{ select: typeof ignoredItemWireSelect }>
type RunSummaryWire = Prisma.ArchiveUploaderScanRunGetPayload<{ select: typeof runSummarySelect }>

function serializeSource(source: SourceWire) {
  const { incrementalCursor, historyCursor, ...wire } = source
  const hasCompletedScan = source.lastSuccessAt !== null
  const uidBindingState = source.uploaderUid
    ? source.uidRevalidationRequiredAt
      ? ('REVALIDATION_REQUIRED' as const)
      : ('BOUND' as const)
    : ('UNBOUND' as const)
  return {
    ...wire,
    uidBindingState,
    hasPendingLatest: incrementalCursor !== null,
    canContinueHistory: historyCursor !== null,
    latestCoverage: !hasCompletedScan
      ? ('NOT_SCANNED' as const)
      : incrementalCursor
        ? ('HAS_MORE' as const)
        : ('CURRENT' as const),
    historyCoverage: !hasCompletedScan
      ? ('NOT_SCANNED' as const)
      : historyCursor
        ? ('HAS_MORE' as const)
        : ('EXHAUSTED' as const),
    lastErrorMessage: archiveWireErrorMessage(source.lastErrorCode, source.lastErrorMessage)
  }
}

function serializeCatalogItem(item: ArchiveUploaderCatalogStateRow) {
  const { canonicalUrl, thumbnailUrl, changeReasons, errorMessage, ...rest } = item
  return {
    ...rest,
    actionable: item.workflowBucket === 'ACTIONABLE',
    changeReasons: serializeChangeReasons(changeReasons),
    errorMessage: archiveWireErrorMessage(item.errorCode ?? null, errorMessage ?? null),
    thumbnailUrl: safeArchiveUploaderThumbnailUrl(thumbnailUrl),
    displayUrl: redactArchiveUrl(canonicalUrl)
  }
}

function serializeIgnoredItem(item: IgnoredItemWire) {
  return { ...item, thumbnailUrl: safeArchiveUploaderThumbnailUrl(item.thumbnailUrl) }
}

export function safeArchiveUploaderThumbnailUrl(input: string | null): string | null {
  if (!input) return null
  try {
    const url = new URL(input)
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !THUMBNAIL_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
    ) {
      return null
    }
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function serializeRunSummary(run: RunSummaryWire) {
  return { ...run, errorMessage: archiveWireErrorMessage(run.errorCode, run.errorMessage) }
}

function serializeChangeReasons(value: Prisma.JsonValue): Array<{ code: string; label: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const code = 'field' in entry && typeof entry.field === 'string' ? entry.field : null
    const label = 'message' in entry && typeof entry.message === 'string' ? entry.message : null
    return code && label ? [{ code, label }] : []
  })
}

function emptyCatalogCounts() {
  return { actionable: 0, processing: 0, archived: 0, attention: 0, total: 0 }
}

function getDatabase(dependencies: ArchiveUploaderServiceDependencies) {
  return dependencies.database ?? (prisma as unknown as PrismaClient)
}

async function lockSource(transaction: Prisma.TransactionClient, sourceId: string) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${SOURCE_LOCK_NAMESPACE}::integer, hashtext(${sourceId}::text))::text AS "lock"`
  )
}

async function lockUploaderUid(transaction: Prisma.TransactionClient, providerKey: string, uploaderUid: string) {
  const key = archiveUploaderUidLockKey(providerKey, uploaderUid)
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE}::integer, hashtext(${key}::text))::text AS "lock"`
  )
}

function translateUploaderProviderError(error: unknown): ArchiveError {
  if (!(error instanceof Error)) {
    return new ArchiveError('INTERNAL', '自动匹配上传者 UID 失败', { cause: error })
  }
  const candidate = error as Error & {
    code?: unknown
    recoverable?: unknown
    retryAfterMs?: unknown
    stage?: unknown
    remoteHost?: unknown
  }
  const code = isArchiveErrorCode(candidate.code) ? candidate.code : 'INTERNAL'
  return new ArchiveError(code, candidate.message, {
    cause: error,
    recoverable: candidate.recoverable === true,
    retryAfterMs: typeof candidate.retryAfterMs === 'number' ? candidate.retryAfterMs : null,
    remoteHost: typeof candidate.remoteHost === 'string' ? candidate.remoteHost : null
  })
}

function isArchiveErrorCode(value: unknown): value is ArchiveErrorCode {
  return [
    'INVALID_URL',
    'UNSUPPORTED_PROVIDER',
    'SSRF_BLOCKED',
    'REMOTE_NOT_FOUND',
    'REMOTE_RATE_LIMITED',
    'REMOTE_QUOTA_EXCEEDED',
    'REMOTE_FORBIDDEN',
    'REMOTE_RESPONSE_INVALID',
    'ORIGINAL_UNAVAILABLE',
    'DOWNLOAD_TOO_LARGE',
    'MEDIA_INVALID',
    'STORAGE_FULL',
    'CANCELLED',
    'PAUSED',
    'LEASE_LOST',
    'WORKER_STOPPED',
    'STATE_CONFLICT',
    'PARTIAL_FAILURE',
    'INTERNAL'
  ].includes(String(value))
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}
