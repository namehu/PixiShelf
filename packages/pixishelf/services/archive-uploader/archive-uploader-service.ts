import { createHash, randomUUID } from 'node:crypto'
import { archiveUploaderScanPayloadSchema, JOB_DEFINITION_VERSION } from '@pixishelf/job-contracts'
import { Prisma, type PrismaClient } from '@pixishelf/db'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ArchiveError } from '@/services/archive/errors'
import { archiveWireErrorMessage, redactArchiveUrl } from '@/services/archive/archive-redaction'
import { createArchiveIntakeSubmissionInTransaction } from '@/services/archive-intake/archive-intake-service'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'
import { cancelJobCommand } from '@/services/background-task/job-command-service'
import { writeJobEvent } from '@/services/background-task/job-event-service'

const PROVIDER_KEY = 'e-hentai'
const ACTIVE_RUN_STATUSES = ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'] as const
const ACTIONABLE_CLASSIFICATIONS = ['NEW', 'POSSIBLE_UPDATE', 'REPLACEMENT'] as const
const SCAN_RESULT_LIMIT = 100
const SOURCE_LOCK_NAMESPACE = 20_260_902
const DISPOSITION_LOCK_NAMESPACE = 20_260_903
const THUMBNAIL_HOST_SUFFIXES = ['e-hentai.org', 'ehgt.org', 'hath.network'] as const

const sourceIdSchema = z.string().trim().min(1).max(128)
const runIdSchema = z.string().trim().min(1).max(128)
const scanItemCursorSchema = z
  .object({
    sortAt: z.coerce.date(),
    createdAt: z.coerce.date(),
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

export const triggerArchiveUploaderScanSchema = z
  .object({ sourceId: sourceIdSchema, mode: z.enum(['LATEST', 'HISTORY']) })
  .strict()

export const cancelArchiveUploaderScanSchema = z.object({ sourceId: sourceIdSchema, runId: runIdSchema }).strict()

export const addArchiveUploaderScanItemsSchema = z
  .object({
    sourceId: sourceIdSchema,
    submissionAttemptId: z.string().uuid(),
    itemIds: scanItemIdsSchema
  })
  .strict()

export const ignoreArchiveUploaderScanItemsSchema = z
  .object({ sourceId: sourceIdSchema, itemIds: scanItemIdsSchema })
  .strict()

export const restoreArchiveUploaderIgnoredItemsSchema = z.object({ ignoredItemIds: scanItemIdsSchema }).strict()

export interface ArchiveUploaderServiceDependencies {
  database?: PrismaClient
  now?: () => Date
  uuid?: () => string
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
  const sources = await getDatabase(dependencies).archiveUploaderSource.findMany({
    where: parsed.includeArchived ? undefined : { status: 'ACTIVE' },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    select: {
      ...sourceWireSelect,
      runs: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: runSummarySelect }
    }
  })
  return sources.map(({ runs, ...source }) => ({
    ...serializeSource(source),
    latestRun: runs[0] ? serializeRunSummary(runs[0]) : null
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
  return {
    source: serializeSource(wireSource),
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

  const cursorCondition = parsed.cursor
    ? Prisma.sql`WHERE (
        "sortAt" < ${parsed.cursor.sortAt}
        OR ("sortAt" = ${parsed.cursor.sortAt} AND "createdAt" < ${parsed.cursor.createdAt})
        OR (
          "sortAt" = ${parsed.cursor.sortAt}
          AND "createdAt" = ${parsed.cursor.createdAt}
          AND "id" < ${parsed.cursor.id}
        )
      )`
    : Prisma.empty
  const rows = await database.$queryRaw<AggregatedScanItemWire[]>(Prisma.sql`
    WITH "latestScanItems" AS (
      SELECT DISTINCT ON (item."providerKey", item."externalId")
        item."id",
        item."externalId",
        item."canonicalUrl",
        item."title",
        item."thumbnailUrl",
        item."uploaderName",
        item."postedAt",
        item."classification",
        item."intakeItemId",
        item."createdAt",
        COALESCE(item."postedAt", item."createdAt") AS "sortAt"
      FROM "archive_uploader_scan_items" AS item
      INNER JOIN "archive_uploader_scan_runs" AS run ON run."id" = item."runId"
      LEFT JOIN "archive_uploader_ignored_items" AS ignored
        ON ignored."providerKey" = item."providerKey"
        AND ignored."externalId" = item."externalId"
      WHERE run."sourceId" = ${parsed.sourceId}
        AND run."status" = 'COMPLETED'::"ArchiveUploaderScanRunStatus"
        AND ignored."id" IS NULL
      ORDER BY item."providerKey", item."externalId", item."createdAt" DESC, item."id" DESC
    )
    SELECT
      "id",
      "externalId",
      "canonicalUrl",
      "title",
      "thumbnailUrl",
      "uploaderName",
      "postedAt",
      "classification",
      "intakeItemId",
      "createdAt",
      "sortAt"
    FROM "latestScanItems"
    ${cursorCondition}
    ORDER BY "sortAt" DESC, "createdAt" DESC, "id" DESC
    LIMIT ${parsed.limit + 1}
  `)
  const hasMore = rows.length > parsed.limit
  const visible = hasMore ? rows.slice(0, parsed.limit) : rows
  const last = visible.at(-1)
  return {
    items: visible.map(serializeAggregatedScanItem),
    nextCursor: hasMore && last ? { sortAt: last.sortAt, createdAt: last.createdAt, id: last.id } : null
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
        message: 'Uploader scan queued',
        data: { sourceId: source.id, scanRunId: runId, mode: parsed.mode }
      })
      const run = await transaction.archiveUploaderScanRun.create({
        data: {
          id: runId,
          sourceId: source.id,
          systemJobId: jobId,
          mode: parsed.mode,
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

    const candidates = await transaction.archiveUploaderScanItem.findMany({
      where: {
        id: { in: parsed.itemIds },
        run: { sourceId: source.id, status: 'COMPLETED' }
      },
      orderBy: { id: 'asc' },
      select: dispositionScanItemSelect
    })
    assertAllDispositionItemsFound(candidates, parsed.itemIds)
    await lockDispositionItems(transaction, candidates)
    const items = await transaction.archiveUploaderScanItem.findMany({
      where: {
        id: { in: parsed.itemIds },
        run: { sourceId: source.id, status: 'COMPLETED' }
      },
      orderBy: { id: 'asc' },
      select: dispositionScanItemSelect
    })
    assertAllDispositionItemsFound(items, parsed.itemIds)
    const unavailable = items.find(
      (item) => item.intakeItemId || !ACTIONABLE_CLASSIFICATIONS.includes(item.classification as never)
    )
    if (unavailable) {
      throw new ArchiveError('STATE_CONFLICT', '只能忽略尚未处理的新归档、可能更新或替代版本')
    }

    const uniqueItems = [...new Map(items.map((item) => [dispositionKey(item), item] as const)).values()]
    const globallyLinkedItem = await transaction.archiveUploaderScanItem.findFirst({
      where: {
        intakeItemId: { not: null },
        OR: uniqueItems.map((item) => ({ providerKey: item.providerKey, externalId: item.externalId }))
      },
      select: { id: true }
    })
    if (globallyLinkedItem) {
      throw new ArchiveError('STATE_CONFLICT', '所选画廊已从其他扫描记录加入收件箱，不能再全局忽略')
    }
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
    const candidates = await transaction.archiveUploaderScanItem.findMany({
      where: {
        id: { in: parsed.itemIds },
        run: { sourceId: parsed.sourceId, status: 'COMPLETED' }
      },
      orderBy: { id: 'asc' },
      select: dispositionScanItemSelect
    })
    assertAllDispositionItemsFound(candidates, parsed.itemIds)
    await lockDispositionItems(transaction, candidates)
    const items = await transaction.archiveUploaderScanItem.findMany({
      where: {
        id: { in: parsed.itemIds },
        run: { sourceId: parsed.sourceId, status: 'COMPLETED' }
      },
      orderBy: { id: 'asc' },
      select: dispositionScanItemSelect
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
    const unavailable = items.find(
      (item) =>
        (!existingAttempt && item.intakeItemId) || !ACTIONABLE_CLASSIFICATIONS.includes(item.classification as never)
    )
    if (unavailable) throw new ArchiveError('STATE_CONFLICT', '只能添加尚未处理的新归档、可能更新或替代版本')
    if (!existingAttempt) {
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
      select: { id: true, submittedUrl: true }
    })
    const intakeByUrl = new Map(intakeItems.map((item) => [item.submittedUrl, item.id]))
    for (const item of items) {
      const intakeItemId = intakeByUrl.get(item.canonicalUrl)
      if (!intakeItemId) continue
      await transaction.archiveUploaderScanItem.updateMany({
        where: { id: item.id, intakeItemId: null },
        data: { intakeItemId }
      })
    }
    return submission
  })
}

function assertAllDispositionItemsFound(items: DispositionScanItem[], itemIds: string[]) {
  if (items.length !== itemIds.length) {
    throw new ArchiveError('STATE_CONFLICT', '部分扫描结果不存在或不属于该上传者来源')
  }
}

async function lockDispositionItems(transaction: Prisma.TransactionClient, items: DispositionScanItem[]) {
  const keys = [...new Set(items.map(dispositionKey))].sort()
  for (const key of keys) {
    await transaction.$queryRaw<{ lock: string }[]>(
      Prisma.sql`SELECT pg_advisory_xact_lock(${DISPOSITION_LOCK_NAMESPACE}::integer, hashtext(${key}::text))::text AS "lock"`
    )
  }
}

function dispositionKey(item: Pick<DispositionScanItem, 'providerKey' | 'externalId'>) {
  return `${item.providerKey}\n${item.externalId}`
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
  status: true,
  itemCount: true,
  newCount: true,
  activeCount: true,
  archivedCount: true,
  possibleUpdateCount: true,
  replacementCount: true,
  startedAt: true,
  finishedAt: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.ArchiveUploaderScanRunSelect

const scanItemWireSelect = {
  id: true,
  externalId: true,
  canonicalUrl: true,
  title: true,
  thumbnailUrl: true,
  uploaderName: true,
  postedAt: true,
  classification: true,
  intakeItemId: true,
  createdAt: true
} satisfies Prisma.ArchiveUploaderScanItemSelect

const dispositionScanItemSelect = {
  id: true,
  providerKey: true,
  externalId: true,
  canonicalUrl: true,
  title: true,
  thumbnailUrl: true,
  uploaderName: true,
  postedAt: true,
  classification: true,
  intakeItemId: true
} satisfies Prisma.ArchiveUploaderScanItemSelect

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
type ScanItemWire = Prisma.ArchiveUploaderScanItemGetPayload<{ select: typeof scanItemWireSelect }>
type DispositionScanItem = Prisma.ArchiveUploaderScanItemGetPayload<{ select: typeof dispositionScanItemSelect }>
type AggregatedScanItemWire = ScanItemWire & { sortAt: Date }
type IgnoredItemWire = Prisma.ArchiveUploaderIgnoredItemGetPayload<{ select: typeof ignoredItemWireSelect }>
type RunSummaryWire = Prisma.ArchiveUploaderScanRunGetPayload<{ select: typeof runSummarySelect }>

function serializeSource(source: SourceWire) {
  const { incrementalCursor, historyCursor, ...wire } = source
  return {
    ...wire,
    hasPendingLatest: incrementalCursor !== null,
    canContinueHistory: historyCursor !== null,
    lastErrorMessage: archiveWireErrorMessage(source.lastErrorCode, source.lastErrorMessage)
  }
}

function serializeScanItem(item: ScanItemWire) {
  const { canonicalUrl, thumbnailUrl, ...rest } = item
  return {
    ...rest,
    thumbnailUrl: safeArchiveUploaderThumbnailUrl(thumbnailUrl),
    displayUrl: redactArchiveUrl(canonicalUrl)
  }
}

function serializeAggregatedScanItem(item: AggregatedScanItemWire) {
  return serializeScanItem({
    id: item.id,
    externalId: item.externalId,
    canonicalUrl: item.canonicalUrl,
    title: item.title,
    thumbnailUrl: item.thumbnailUrl,
    uploaderName: item.uploaderName,
    postedAt: item.postedAt,
    classification: item.classification,
    intakeItemId: item.intakeItemId,
    createdAt: item.createdAt
  })
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

function getDatabase(dependencies: ArchiveUploaderServiceDependencies) {
  return dependencies.database ?? (prisma as unknown as PrismaClient)
}

async function lockSource(transaction: Prisma.TransactionClient, sourceId: string) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${SOURCE_LOCK_NAMESPACE}::integer, hashtext(${sourceId}::text))::text AS "lock"`
  )
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}
