import { createHash, randomUUID } from 'node:crypto'
import { archiveResolveItemPayloadSchema, JOB_DEFINITION_VERSION } from '@pixishelf/job-contracts'
import { Prisma, type PrismaClient } from '@pixishelf/db'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { archiveProviderRegistry } from '@/services/archive/provider-registry'
import {
  archiveRequestFingerprint,
  runArchiveBulkOperation,
  type ArchiveBulkTargetResult
} from '@/services/archive/archive-bulk-operation'
import { ArchiveError } from '@/services/archive/errors'
import { redactArchiveText, redactArchiveUrl } from '@/services/archive/archive-redaction'
import { writeJobEvent } from '@/services/background-task/job-event-service'

const ACTIVE_INTAKE_STATUSES = ['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'] as const
const INTAKE_CAPACITY = 1_000
const INTAKE_CREATE_LIMIT = 100
const BULK_TARGET_LIMIT = 100
const INTAKE_CAPACITY_LOCK_NAMESPACE = 20_260_820
const INTAKE_IDEMPOTENCY_LOCK_NAMESPACE = 20_260_821
const RESOLVE_QUEUE_ID = 'archive-resolve'

const intakeStatusSchema = z.enum([
  'QUEUED',
  'RESOLVING',
  'RETRY_WAIT',
  'READY',
  'STALE',
  'FAILED',
  'ENQUEUED',
  'CANCELLED',
  'DUPLICATE'
])

export const createArchiveIntakeSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(180),
    urls: z.array(z.string().max(2_048)).min(1).max(INTAKE_CREATE_LIMIT)
  })
  .strict()

export const archiveIntakeListSchema = z
  .object({
    view: z.enum(['ACTIVE', 'FAILED', 'ENQUEUED', 'CANCELLED']).default('ACTIVE'),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    submissionId: z.string().min(1).max(128).optional(),
    providerKey: z.string().trim().min(1).max(50).optional(),
    search: z.string().trim().min(1).max(500).optional()
  })
  .strict()

export const archiveIntakeManySchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(180),
    itemIds: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(BULK_TARGET_LIMIT)
      .transform((values) => [...new Set(values)])
  })
  .strict()

export interface ArchiveIntakeServiceDependencies {
  database?: PrismaClient
  now?: () => Date
  uuid?: () => string
  validateUrl?: (url: string) => void
}

export async function createArchiveIntakeSubmission(
  input: z.input<typeof createArchiveIntakeSchema>,
  requestedByUserId: string,
  dependencies: ArchiveIntakeServiceDependencies = {}
) {
  const parsed = createArchiveIntakeSchema.parse(input)
  const database = getDatabase(dependencies)
  const now = dependencies.now ?? (() => new Date())
  const uuid = dependencies.uuid ?? randomUUID
  const rawUrls = parsed.urls.map((url) => url.trim()).filter(Boolean)
  if (rawUrls.length === 0) throw new ArchiveError('INVALID_URL', '至少需要一个非空归档链接')
  const requestHash = archiveRequestFingerprint({ urls: rawUrls })

  return database.$transaction(async (transaction) => {
    await lockKey(transaction, INTAKE_IDEMPOTENCY_LOCK_NAMESPACE, parsed.idempotencyKey)
    const existing = await transaction.archiveIntakeSubmission.findUnique({
      where: { idempotencyKey: parsed.idempotencyKey }
    })
    if (existing) {
      if (existing.requestHash !== requestHash || existing.requestedByUserId !== requestedByUserId) {
        throw new ArchiveError('STATE_CONFLICT', '该幂等键已绑定到不同的归档链接提交')
      }
      return serializeSubmission(transaction, existing.id)
    }

    await lockKey(transaction, INTAKE_CAPACITY_LOCK_NAMESPACE, RESOLVE_QUEUE_ID)
    let remainingCapacity =
      INTAKE_CAPACITY -
      (await transaction.archiveIntakeItem.count({ where: { status: { in: [...ACTIVE_INTAKE_STATUSES] } } }))
    const timestamp = now()
    const submission = await transaction.archiveIntakeSubmission.create({
      data: {
        id: uuid(),
        idempotencyKey: parsed.idempotencyKey,
        requestHash,
        requestedByUserId,
        rawCount: rawUrls.length,
        acceptedCount: 0,
        invalidCount: 0,
        duplicateCount: 0,
        rejectedCount: 0,
        createdAt: timestamp
      }
    })

    let acceptedCount = 0
    let invalidCount = 0
    let duplicateCount = 0
    let rejectedCount = 0
    const firstSeen = new Map<string, string | null>()

    for (const submittedUrl of rawUrls) {
      if (firstSeen.has(submittedUrl)) {
        duplicateCount += 1
        continue
      }
      firstSeen.set(submittedUrl, null)

      try {
        validateSubmittedUrl(submittedUrl, dependencies.validateUrl)
      } catch {
        invalidCount += 1
        continue
      }

      const normalizedUrlHash = hashSubmittedUrl(submittedUrl)
      const duplicate = await transaction.archiveIntakeItem.findFirst({
        where: { normalizedUrlHash, status: { in: [...ACTIVE_INTAKE_STATUSES] } },
        orderBy: { queueOrder: 'asc' },
        select: { id: true, submittedUrl: true }
      })
      if (duplicate?.submittedUrl === submittedUrl) {
        const duplicateId = uuid()
        await transaction.archiveIntakeItem.create({
          data: {
            id: duplicateId,
            submissionId: submission.id,
            submittedUrl,
            normalizedUrlHash,
            status: 'DUPLICATE',
            duplicateOfItemId: duplicate.id,
            finishedAt: timestamp,
            retryable: false,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        })
        firstSeen.set(submittedUrl, duplicateId)
        duplicateCount += 1
        continue
      }

      if (remainingCapacity <= 0) {
        rejectedCount += 1
        continue
      }

      const itemId = uuid()
      const jobId = uuid()
      await transaction.systemJob.create({
        data: {
          id: jobId,
          type: 'ARCHIVE_RESOLVE_ITEM',
          executionLane: 'ARCHIVE_RESOLVE',
          definitionVersion: JOB_DEFINITION_VERSION,
          status: 'PENDING',
          triggerSource: 'MANUAL',
          requestedByUserId,
          idempotencyKey: `archive-intake:${itemId}:resolve:1`,
          payload: archiveResolveItemPayloadSchema.parse({ intakeItemId: itemId }),
          queuePriority: 10,
          effectivePriority: 10,
          availableAt: timestamp,
          maxAttempts: 3,
          progress: 0,
          message: '等待归档解析 Worker...'
        }
      })
      await transaction.archiveIntakeItem.create({
        data: {
          id: itemId,
          submissionId: submission.id,
          submittedUrl,
          normalizedUrlHash,
          status: 'QUEUED',
          currentSystemJobId: jobId,
          availableAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      })
      await writeJobEvent(transaction, {
        jobId,
        type: 'job.queued',
        attempt: 0,
        message: 'Archive intake item queued',
        data: { intakeItemId: itemId, priority: 10 }
      })
      firstSeen.set(submittedUrl, itemId)
      acceptedCount += 1
      remainingCapacity -= 1
    }

    if (rawUrls.length !== acceptedCount + invalidCount + duplicateCount + rejectedCount) {
      throw new ArchiveError('INTERNAL', '归档链接提交计数不一致')
    }
    await transaction.archiveIntakeSubmission.update({
      where: { id: submission.id },
      data: { acceptedCount, invalidCount, duplicateCount, rejectedCount }
    })
    return serializeSubmission(transaction, submission.id)
  })
}

export async function listArchiveIntakeItems(
  input: z.input<typeof archiveIntakeListSchema>,
  dependencies: ArchiveIntakeServiceDependencies = {}
) {
  const parsed = archiveIntakeListSchema.parse(input)
  const database = getDatabase(dependencies)
  const now = (dependencies.now ?? (() => new Date()))()
  const cursor = parsed.cursor ? decodeCursor(parsed.cursor, parsed.view) : null
  const statuses = statusesForView(parsed.view)
  const active = parsed.view === 'ACTIVE'
  const filters: Prisma.ArchiveIntakeItemWhereInput[] = []
  if (parsed.search) {
    filters.push({
      OR: [
        { submittedUrl: { contains: parsed.search, mode: 'insensitive' } },
        { canonicalUrl: { contains: parsed.search, mode: 'insensitive' } },
        { resolvedTitle: { contains: parsed.search, mode: 'insensitive' } },
        { externalId: { contains: parsed.search, mode: 'insensitive' } }
      ]
    })
  }
  if (cursor) {
    filters.push(
      active
        ? {
            OR: [
              { queueOrder: { gt: BigInt(cursor.sortValue) } },
              { queueOrder: BigInt(cursor.sortValue), id: { gt: cursor.id } }
            ]
          }
        : {
            OR: [
              { updatedAt: { lt: new Date(cursor.sortValue) } },
              { updatedAt: new Date(cursor.sortValue), id: { lt: cursor.id } }
            ]
          }
    )
  }
  const where: Prisma.ArchiveIntakeItemWhereInput = {
    status: { in: statuses },
    ...(parsed.submissionId ? { submissionId: parsed.submissionId } : {}),
    ...(parsed.providerKey ? { providerKey: parsed.providerKey } : {}),
    ...(filters.length ? { AND: filters } : {})
  }
  const rows = await database.archiveIntakeItem.findMany({
    where,
    orderBy: active ? [{ queueOrder: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: parsed.limit + 1,
    select: intakeItemWireSelect
  })
  const hasMore = rows.length > parsed.limit
  const visible = hasMore ? rows.slice(0, parsed.limit) : rows
  const last = visible.at(-1)
  return {
    items: visible.map((item) => serializeIntakeItem(item, now)),
    nextCursor:
      hasMore && last
        ? encodeCursor(parsed.view, active ? last.queueOrder.toString() : last.updatedAt.toISOString(), last.id)
        : null
  }
}

export async function getArchiveIntakeSummary(dependencies: ArchiveIntakeServiceDependencies = {}) {
  const database = getDatabase(dependencies)
  const now = (dependencies.now ?? (() => new Date()))()
  const [groups, expiredReadyCount, current, oldest, recentFailedCount, control] = await Promise.all([
    database.archiveIntakeItem.groupBy({ by: ['status'], _count: { _all: true } }),
    database.archiveIntakeItem.count({ where: { status: 'READY', expiresAt: { lte: now } } }),
    database.archiveIntakeItem.findFirst({
      where: { status: 'RESOLVING' },
      orderBy: { queueOrder: 'asc' },
      select: intakeItemWireSelect
    }),
    database.archiveIntakeItem.findFirst({
      where: { status: { in: ['QUEUED', 'RETRY_WAIT'] } },
      orderBy: { queueOrder: 'asc' },
      select: { createdAt: true }
    }),
    database.archiveIntakeItem.count({
      where: { status: 'FAILED', updatedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1_000) } }
    }),
    database.archiveResolveQueueControl.findUnique({ where: { id: RESOLVE_QUEUE_ID } })
  ])
  const counts = Object.fromEntries(intakeStatusSchema.options.map((status) => [status, 0])) as Record<
    z.infer<typeof intakeStatusSchema>,
    number
  >
  for (const group of groups) counts[group.status] = group._count._all
  counts.READY -= expiredReadyCount
  counts.STALE += expiredReadyCount
  const activeCount = ACTIVE_INTAKE_STATUSES.reduce((total, status) => total + counts[status], 0)
  return {
    counts,
    activeCount,
    capacity: INTAKE_CAPACITY,
    remainingCapacity: Math.max(0, INTAKE_CAPACITY - activeCount),
    queuedCount: counts.QUEUED + counts.RETRY_WAIT,
    recentFailedCount,
    oldestWaitingAt: oldest?.createdAt ?? null,
    currentItem: current ? serializeIntakeItem(current, now) : null,
    paused: control?.paused ?? false,
    pausedAt: control?.pausedAt ?? null
  }
}

export async function setArchiveIntakePaused(
  paused: boolean,
  requestedByUserId: string,
  dependencies: ArchiveIntakeServiceDependencies = {}
) {
  const database = getDatabase(dependencies)
  const timestamp = (dependencies.now ?? (() => new Date()))()
  return database.archiveResolveQueueControl.upsert({
    where: { id: RESOLVE_QUEUE_ID },
    create: {
      id: RESOLVE_QUEUE_ID,
      paused,
      pausedAt: paused ? timestamp : null,
      pausedBy: paused ? requestedByUserId : null
    },
    update: {
      paused,
      pausedAt: paused ? timestamp : null,
      pausedBy: paused ? requestedByUserId : null
    },
    select: { paused: true, pausedAt: true, updatedAt: true }
  })
}

export async function cancelArchiveIntakeMany(
  input: z.input<typeof archiveIntakeManySchema>,
  requestedByUserId: string,
  dependencies: ArchiveIntakeServiceDependencies = {}
) {
  const parsed = archiveIntakeManySchema.parse(input)
  const database = getDatabase(dependencies)
  const now = dependencies.now ?? (() => new Date())
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.idempotencyKey,
      requestedByUserId,
      commandType: 'CANCEL',
      targetType: 'INTAKE_ITEM',
      targetIds: parsed.itemIds
    },
    (transaction, itemId) => cancelIntakeItem(transaction, itemId, now()),
    { database, now }
  )
}

export async function retryArchiveIntakeMany(
  input: z.input<typeof archiveIntakeManySchema>,
  requestedByUserId: string,
  dependencies: ArchiveIntakeServiceDependencies = {}
) {
  const parsed = archiveIntakeManySchema.parse(input)
  const database = getDatabase(dependencies)
  const now = dependencies.now ?? (() => new Date())
  const uuid = dependencies.uuid ?? randomUUID
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.idempotencyKey,
      requestedByUserId,
      commandType: 'RETRY',
      targetType: 'INTAKE_ITEM',
      targetIds: parsed.itemIds
    },
    (transaction, itemId) => retryIntakeItem(transaction, itemId, requestedByUserId, now(), uuid),
    { database, now },
    (transaction, itemId, error) => recoverRetryRace(transaction, itemId, error)
  )
}

async function cancelIntakeItem(
  transaction: Prisma.TransactionClient,
  itemId: string,
  timestamp: Date
): Promise<ArchiveBulkTargetResult> {
  const item = await transaction.archiveIntakeItem.findUnique({
    where: { id: itemId },
    include: { currentSystemJob: true }
  })
  if (!item) return { result: 'SKIPPED', code: 'NOT_FOUND', message: '收件项目不存在' }
  if (item.status === 'CANCELLED') return { result: 'REUSED', relatedId: item.id, message: '收件项目已取消' }
  if (!['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'].includes(item.status)) {
    return { result: 'SKIPPED', code: 'INVALID_STATE', message: `状态 ${item.status} 不允许取消` }
  }

  const running = item.status === 'RESOLVING'
  if (
    item.currentSystemJob &&
    !['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(item.currentSystemJob.status)
  ) {
    const nextStatus = running ? 'CANCELLING' : 'CANCELLED'
    const changedJob = await transaction.systemJob.updateMany({
      where: { id: item.currentSystemJob.id, status: item.currentSystemJob.status },
      data: {
        status: nextStatus,
        cancelRequestedAt: timestamp,
        ...(running
          ? {}
          : {
              finishedAt: timestamp,
              workerId: null,
              leaseToken: null,
              leaseExpiresAt: null,
              heartbeatAt: null
            })
      }
    })
    if (changedJob.count !== 1) {
      throw new ArchiveError('STATE_CONFLICT', '解析任务状态已改变')
    }
    await writeJobEvent(transaction, {
      jobId: item.currentSystemJob.id,
      type: 'job.cancel_requested',
      level: 'WARN',
      attempt: item.currentSystemJob.attempt,
      message: 'Archive intake cancellation requested'
    })
    if (!running) {
      await writeJobEvent(transaction, {
        jobId: item.currentSystemJob.id,
        type: 'job.cancelled',
        level: 'WARN',
        attempt: item.currentSystemJob.attempt,
        message: 'Archive intake cancelled before execution'
      })
    }
  }
  const changedItem = await transaction.archiveIntakeItem.updateMany({
    where: { id: item.id, status: item.status },
    data: running
      ? { cancelRequestedAt: timestamp }
      : { status: 'CANCELLED', cancelRequestedAt: timestamp, finishedAt: timestamp, retryable: false }
  })
  if (changedItem.count !== 1) throw new ArchiveError('STATE_CONFLICT', '收件项目状态已改变')
  return { result: 'APPLIED', relatedId: item.id }
}

async function retryIntakeItem(
  transaction: Prisma.TransactionClient,
  itemId: string,
  requestedByUserId: string,
  timestamp: Date,
  uuid: () => string
): Promise<ArchiveBulkTargetResult> {
  const item = await transaction.archiveIntakeItem.findUnique({
    where: { id: itemId },
    include: { currentSystemJob: true }
  })
  if (!item) return { result: 'SKIPPED', code: 'NOT_FOUND', message: '收件项目不存在' }
  const retryStatus = effectiveStatus(item, timestamp)
  if (!['FAILED', 'CANCELLED', 'STALE'].includes(retryStatus)) {
    return { result: 'SKIPPED', code: 'INVALID_STATE', message: `状态 ${item.status} 不允许重试` }
  }
  if (retryStatus === 'FAILED' || retryStatus === 'CANCELLED') {
    await lockKey(transaction, INTAKE_CAPACITY_LOCK_NAMESPACE, RESOLVE_QUEUE_ID)
    const activeCount = await transaction.archiveIntakeItem.count({
      where: { status: { in: [...ACTIVE_INTAKE_STATUSES] } }
    })
    if (activeCount >= INTAKE_CAPACITY) {
      return { result: 'SKIPPED', code: 'CAPACITY_EXCEEDED', message: '归档收件箱活动项目已达上限' }
    }
  }
  const activeDuplicate = await findActiveRetryDuplicate(transaction, item)
  if (activeDuplicate) {
    return {
      result: 'CONFLICT',
      relatedId: activeDuplicate.id,
      code: 'ACTIVE_DUPLICATE',
      message: '相同链接已有活动收件项目'
    }
  }

  const jobId = uuid()
  await transaction.systemJob.create({
    data: {
      id: jobId,
      type: 'ARCHIVE_RESOLVE_ITEM',
      executionLane: 'ARCHIVE_RESOLVE',
      definitionVersion: JOB_DEFINITION_VERSION,
      status: 'PENDING',
      triggerSource: 'RETRY',
      requestedByUserId,
      parentJobId: item.currentSystemJobId,
      payload: archiveResolveItemPayloadSchema.parse({ intakeItemId: item.id }),
      queuePriority: 10,
      effectivePriority: 10,
      availableAt: timestamp,
      maxAttempts: 3,
      message: '等待重新解析归档链接...'
    }
  })
  const changed = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "archive_intake_items"
    SET "currentSystemJobId" = ${jobId},
        "status" = 'QUEUED',
        "queueOrder" = nextval(pg_get_serial_sequence('archive_intake_items', 'queueOrder')),
        "attempts" = 0,
        "availableAt" = ${timestamp},
        "cancelRequestedAt" = NULL,
        "startedAt" = NULL,
        "finishedAt" = NULL,
        "resolutionKind" = NULL,
        "activeArchiveImportId" = NULL,
        "errorCode" = NULL,
        "errorMessage" = NULL,
        "errorStage" = NULL,
        "retryable" = NULL,
        "updatedAt" = ${timestamp}
    WHERE "id" = ${item.id}
      AND "status" = ${item.status}::"ArchiveIntakeStatus"
    RETURNING "id"
  `)
  if (changed.length !== 1) throw new ArchiveError('STATE_CONFLICT', '收件项目状态已改变')
  await writeJobEvent(transaction, {
    jobId,
    type: 'job.queued',
    attempt: 0,
    message: 'Archive intake item manually requeued',
    data: { intakeItemId: item.id, retryOfJobId: item.currentSystemJobId }
  })
  return { result: 'APPLIED', relatedId: jobId }
}

async function recoverRetryRace(
  transaction: Prisma.TransactionClient,
  itemId: string,
  error: unknown
): Promise<ArchiveBulkTargetResult | null> {
  if (!isUniqueConstraintError(error)) return null
  const item = await transaction.archiveIntakeItem.findUnique({ where: { id: itemId } })
  if (!item) return null
  const activeDuplicate = await findActiveRetryDuplicate(transaction, item)
  return activeDuplicate
    ? {
        result: 'CONFLICT',
        relatedId: activeDuplicate.id,
        code: 'ACTIVE_DUPLICATE',
        message: '同一链接或作品已有活动收件项目'
      }
    : null
}

function findActiveRetryDuplicate(
  transaction: Prisma.TransactionClient,
  item: {
    id: string
    normalizedUrlHash: string
    submittedUrl: string
    providerKey: string | null
    externalId: string | null
  }
) {
  return transaction.archiveIntakeItem.findFirst({
    where: {
      id: { not: item.id },
      status: { in: [...ACTIVE_INTAKE_STATUSES] },
      OR: [
        { normalizedUrlHash: item.normalizedUrlHash, submittedUrl: item.submittedUrl },
        ...(item.providerKey && item.externalId ? [{ providerKey: item.providerKey, externalId: item.externalId }] : [])
      ]
    },
    select: { id: true }
  })
}

const intakeItemWireSelect = {
  id: true,
  submissionId: true,
  submittedUrl: true,
  queueOrder: true,
  status: true,
  attempts: true,
  availableAt: true,
  startedAt: true,
  finishedAt: true,
  providerKey: true,
  externalId: true,
  canonicalUrl: true,
  resolvedTitle: true,
  thumbnailUrl: true,
  pageCount: true,
  resolutionKind: true,
  duplicateOfItemId: true,
  activeArchiveImportId: true,
  selectedQuality: true,
  resolvedAt: true,
  expiresAt: true,
  archiveImportId: true,
  errorCode: true,
  errorMessage: true,
  errorStage: true,
  retryable: true,
  supersedesItemId: true,
  currentSystemJobId: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.ArchiveIntakeItemSelect

type IntakeItemWire = Prisma.ArchiveIntakeItemGetPayload<{ select: typeof intakeItemWireSelect }>

function serializeIntakeItem(item: IntakeItemWire, now: Date) {
  return {
    ...item,
    submittedUrl: redactArchiveUrl(item.submittedUrl),
    canonicalUrl: item.canonicalUrl ? redactArchiveUrl(item.canonicalUrl) : null,
    thumbnailUrl: safeThumbnailUrl(item.thumbnailUrl),
    status: effectiveStatus(item, now),
    queueOrder: item.queueOrder.toString(),
    errorMessage: redactArchiveText(item.errorMessage)
  }
}

async function serializeSubmission(transaction: Prisma.TransactionClient, submissionId: string) {
  const submission = await transaction.archiveIntakeSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { items: { orderBy: [{ queueOrder: 'asc' }, { id: 'asc' }], select: intakeItemWireSelect } }
  })
  const now = new Date()
  return {
    id: submission.id,
    rawCount: submission.rawCount,
    acceptedCount: submission.acceptedCount,
    invalidCount: submission.invalidCount,
    duplicateCount: submission.duplicateCount,
    rejectedCount: submission.rejectedCount,
    createdAt: submission.createdAt,
    items: submission.items.map((item) => serializeIntakeItem(item, now))
  }
}

function validateSubmittedUrl(url: string, customValidator?: (url: string) => void) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (error) {
    throw new ArchiveError('INVALID_URL', '作品链接格式无效', { cause: error })
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new ArchiveError('INVALID_URL', '归档链接必须使用不含用户凭据的 HTTPS URL')
  }
  if (customValidator) customValidator(url)
  else archiveProviderRegistry.getForUrl(url)
}

export function hashSubmittedUrl(url: string) {
  return createHash('sha256').update(url.trim()).digest('hex')
}

function safeThumbnailUrl(input: string | null): string | null {
  if (!input) return null
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function effectiveStatus(item: { status: string; expiresAt: Date | null }, now: Date) {
  return item.status === 'READY' && item.expiresAt && item.expiresAt <= now ? 'STALE' : item.status
}

function statusesForView(
  view: z.infer<typeof archiveIntakeListSchema>['view']
): Array<z.infer<typeof intakeStatusSchema>> {
  switch (view) {
    case 'ACTIVE':
      return [...ACTIVE_INTAKE_STATUSES]
    case 'FAILED':
      return ['FAILED']
    case 'ENQUEUED':
      return ['ENQUEUED']
    case 'CANCELLED':
      return ['CANCELLED', 'DUPLICATE']
  }
}

interface IntakeCursor {
  version: 1
  view: z.infer<typeof archiveIntakeListSchema>['view']
  sortValue: string
  id: string
}

function encodeCursor(view: IntakeCursor['view'], sortValue: string, id: string) {
  return Buffer.from(JSON.stringify({ version: 1, view, sortValue, id } satisfies IntakeCursor)).toString('base64url')
}

function decodeCursor(value: string, expectedView: IntakeCursor['view']): IntakeCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as IntakeCursor
    if (
      parsed.version !== 1 ||
      parsed.view !== expectedView ||
      typeof parsed.sortValue !== 'string' ||
      typeof parsed.id !== 'string' ||
      !parsed.id
    ) {
      throw new Error('Invalid cursor')
    }
    if (expectedView === 'ACTIVE') BigInt(parsed.sortValue)
    else if (Number.isNaN(new Date(parsed.sortValue).getTime())) throw new Error('Invalid cursor date')
    return parsed
  } catch (error) {
    throw new ArchiveError('INVALID_URL', '归档收件箱分页游标无效', { cause: error })
  }
}

function getDatabase(dependencies: ArchiveIntakeServiceDependencies) {
  return dependencies.database ?? (prisma as unknown as PrismaClient)
}

async function lockKey(transaction: Prisma.TransactionClient, namespace: number, value: string) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${namespace}::integer, hashtext(${value}::text))::text AS "lock"`
  )
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

export { ACTIVE_INTAKE_STATUSES, INTAKE_CAPACITY, INTAKE_CREATE_LIMIT, BULK_TARGET_LIMIT }
