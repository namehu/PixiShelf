import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import {
  cancelJobCommand,
  enqueueJob,
  enqueueSingletonManualJobWithResult,
  getJobById,
  lockSingletonJobType
} from '@/services/background-task'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'
import { WORKER_HEARTBEAT_STALE_AFTER_MS } from '@/services/background-task/worker-heartbeat'
import {
  ACTIVE_JOB_STATUSES,
  EXECUTION_LANES,
  JOB_DEFINITION_VERSION,
  PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT,
  workerCapabilitySchema
} from '@pixishelf/job-contracts'
import { Prisma, type PrismaClient } from '@pixishelf/db'

const JOB_TYPE = 'PIXIV_SERIES_RECONCILIATION' as const
const PROVIDER_KEY = 'pixiv'
const CANCEL_CONCURRENCY_RETRY_LIMIT = 3
const CANCEL_EVENT_CHUNK_SIZE = 500
const DIRECT_CANCEL_STATUSES = ['PENDING', 'RETRY_WAIT', 'PAUSED'] as const
const INTERRUPT_CANCEL_STATUSES = ['RUNNING', 'PAUSING'] as const
const DIRECT_CANCEL_STATUS_SET = new Set<string>(DIRECT_CANCEL_STATUSES)
const INTERRUPT_CANCEL_STATUS_SET = new Set<string>(INTERRUPT_CANCEL_STATUSES)

interface ActiveBatchChild {
  id: string
  status: string
  attempt: number
}

export async function getPixivSeriesReconciliationSummary(
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const [candidateRows, eligibleRows, statusGroups, activeJob, latestBatch, capabilityAvailable] = await Promise.all([
    countEligibleRefs(database, true),
    countEligibleRefs(database, false),
    database.$queryRaw<Array<{ status: 'SUCCESS' | 'PARTIAL' | 'NO_DATA' | 'FAILED'; count: bigint }>>(Prisma.sql`
      SELECT ref."seriesSyncStatus"::text AS "status", COUNT(*)::bigint AS "count"
      FROM "artwork_external_refs" AS ref
      JOIN "Artwork" AS artwork ON artwork."id" = ref."artworkId" AND artwork."deletedAt" IS NULL
      WHERE ref."providerKey" = ${PROVIDER_KEY}
        AND ref."externalId" ~ '^[1-9][0-9]*$'
        AND ref."seriesSyncStatus" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "artwork_external_refs" AS other_ref
          WHERE other_ref."artworkId" = ref."artworkId"
            AND other_ref."providerKey" = ${PROVIDER_KEY}
            AND other_ref."id" <> ref."id"
        )
      GROUP BY ref."seriesSyncStatus"
    `),
    database.systemJob.findFirst({
      where: { type: JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, parentJobId: true, status: true, progress: true, stage: true, message: true, createdAt: true }
    }),
    database.systemJob.findFirst({
      where: { type: JOB_TYPE, parentJobId: null, payload: { path: ['mode'], equals: 'DISCOVER' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        progress: true,
        stage: true,
        message: true,
        result: true,
        error: true,
        createdAt: true,
        finishedAt: true
      }
    }),
    hasReadyPixivSeriesWorker(database)
  ])
  const childGroups = latestBatch
    ? await database.systemJob.groupBy({
        by: ['status'],
        where: { parentJobId: latestBatch.id },
        _count: { _all: true }
      })
    : []
  const providerCounts = { SUCCESS: 0, PARTIAL: 0, NO_DATA: 0, FAILED: 0 }
  for (const group of statusGroups) providerCounts[group.status] = Number(group.count)
  const childCounts = Object.fromEntries(childGroups.map((group) => [group.status, group._count._all]))
  const totalChildren = childGroups.reduce((total, group) => total + group._count._all, 0)
  const completedChildren = childGroups.reduce(
    (total, group) =>
      total + (['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(group.status) ? group._count._all : 0),
    0
  )
  return {
    candidateCount: Number(candidateRows[0]?.count ?? 0),
    eligibleCount: Number(eligibleRows[0]?.count ?? 0),
    providerCounts,
    capabilityAvailable,
    activeJob,
    latestBatch,
    children: { total: totalChildren, completed: completedChildren, byStatus: childCounts }
  }
}

export async function startPixivSeriesReconciliation(
  requestedByUserId: string,
  artworkIds?: number[],
  refreshExisting = false
) {
  const selectedArtworkIds = artworkIds ? [...new Set(artworkIds)].sort((left, right) => left - right) : undefined
  if (selectedArtworkIds && selectedArtworkIds.length > PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT) {
    throw new Error(`一次最多选择 ${PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT} 个作品`)
  }
  await assertReadyPixivSeriesWorker(prisma as unknown as PrismaClient)
  return enqueueSingletonManualJobWithResult({
    type: JOB_TYPE,
    triggerSource: 'MANUAL',
    requestedByUserId,
    priority: 85,
    maxAttempts: 3,
    payload: {
      mode: 'DISCOVER',
      refreshExisting,
      ...(selectedArtworkIds?.length ? { artworkIds: selectedArtworkIds } : {})
    }
  })
}

export async function retryPixivSeriesReconciliation(artworkId: number, requestedByUserId: string) {
  return prisma.$transaction(async (transaction) => {
    const commandTransaction = transaction as unknown as Prisma.TransactionClient
    await lockSingletonJobType(commandTransaction, JOB_TYPE)
    await assertReadyPixivSeriesWorker(transaction as unknown as PrismaClient)
    const active = await transaction.systemJob.findFirst({
      where: { type: JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
      select: { id: true }
    })
    if (active) throw new Error('已有 Pixiv 系列核对任务正在运行，请等待当前任务结束')
    const refs = await transaction.artworkExternalRef.findMany({
      where: { artworkId, providerKey: PROVIDER_KEY, artwork: { deletedAt: null } },
      take: 2,
      select: { id: true, artworkId: true, externalId: true }
    })
    const ref = refs.length === 1 ? refs[0] : null
    if (!ref || !/^[1-9][0-9]*$/.test(ref.externalId)) throw new Error('该作品没有唯一且有效的 Pixiv 身份')
    return enqueueJob(
      {
        type: JOB_TYPE,
        triggerSource: 'MANUAL',
        requestedByUserId,
        priority: 75,
        maxAttempts: 3,
        idempotencyKey: `pixiv-series:manual:${artworkId}:${randomUUID()}`,
        payload: {
          mode: 'ARTWORK',
          artworkId,
          expectedExternalRefId: ref.id,
          expectedPixivArtworkId: ref.externalId,
          refreshExisting: true
        }
      },
      { $transaction: async (operation) => operation(commandTransaction) }
    )
  })
}

export async function cancelPixivSeriesReconciliation(
  requestedJobId?: string,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const selectedJob = requestedJobId
    ? await database.systemJob.findUnique({
        where: { id: requestedJobId, type: JOB_TYPE },
        select: { id: true, parentJobId: true, status: true }
      })
    : await database.systemJob.findFirst({
        where: { type: JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, parentJobId: true, status: true }
      })
  if (!selectedJob) return { batchId: null, affectedCount: 0, job: null }
  const batchId = selectedJob.parentJobId ?? selectedJob.id
  const root =
    selectedJob.id === batchId
      ? selectedJob
      : await database.systemJob.findUnique({
          where: { id: batchId, type: JOB_TYPE },
          select: { id: true, parentJobId: true, status: true }
        })
  let affectedCount = 0
  if (root && ACTIVE_JOB_STATUSES.has(root.status) && root.status !== 'CANCELLING') {
    if (await cancelIfStillActive(root.id, database)) affectedCount += 1
  }
  affectedCount += await cancelActiveBatchChildren(batchId, database)
  return { batchId, affectedCount, job: await getJobById(selectedJob.id, database) }
}

function countEligibleRefs(database: PrismaClient, uncheckedOnly: boolean) {
  return database.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS "count"
    FROM "artwork_external_refs" AS ref
    JOIN "Artwork" AS artwork ON artwork."id" = ref."artworkId" AND artwork."deletedAt" IS NULL
    WHERE ref."providerKey" = ${PROVIDER_KEY}
      AND ref."externalId" ~ '^[1-9][0-9]*$'
      ${uncheckedOnly ? Prisma.sql`AND ref."seriesSyncStatus" IS NULL` : Prisma.empty}
      AND NOT EXISTS (
        SELECT 1 FROM "artwork_external_refs" AS other_ref
        WHERE other_ref."artworkId" = ref."artworkId"
          AND other_ref."providerKey" = ${PROVIDER_KEY}
          AND other_ref."id" <> ref."id"
      )
  `)
}

async function assertReadyPixivSeriesWorker(database: PrismaClient) {
  if (!(await hasReadyPixivSeriesWorker(database))) {
    throw new Error('当前没有支持 Pixiv 系列核对的新版本 READY Worker，请先部署并确认 Worker capability')
  }
}

async function hasReadyPixivSeriesWorker(database: PrismaClient) {
  const now = new Date()
  const workers = await database.workerInstance.findMany({
    where: { status: 'READY', heartbeatAt: { gte: new Date(now.getTime() - WORKER_HEARTBEAT_STALE_AFTER_MS) } },
    orderBy: { heartbeatAt: 'desc' },
    take: 20,
    select: { capabilities: true }
  })
  return workers.some((worker) => supportsPixivSeriesReconciliation(worker.capabilities))
}

function supportsPixivSeriesReconciliation(value: unknown) {
  if (!Array.isArray(value)) return false
  return value.some((entry) => {
    const capability = workerCapabilitySchema.safeParse(entry)
    return (
      capability.success &&
      capability.data.jobType === JOB_TYPE &&
      capability.data.executionLane === EXECUTION_LANES.BACKGROUND_WRITER &&
      capability.data.definitionVersions.includes(JOB_DEFINITION_VERSION)
    )
  })
}

async function cancelIfStillActive(jobId: string, database: PrismaClient) {
  for (let attempt = 1; attempt <= CANCEL_CONCURRENCY_RETRY_LIMIT; attempt += 1) {
    try {
      await cancelJobCommand({ jobId }, database)
      return true
    } catch (error) {
      const current = await database.systemJob.findUnique({ where: { id: jobId }, select: { status: true } })
      if (!current || !ACTIVE_JOB_STATUSES.has(current.status)) return false
      if (error instanceof BackgroundTaskError && error.code === 'CONCURRENT_MODIFICATION') continue
      throw error
    }
  }
  throw new BackgroundTaskError('CONCURRENT_MODIFICATION', 'Background job kept changing while cancelling the batch')
}

async function cancelActiveBatchChildren(batchId: string, database: PrismaClient) {
  return database.$transaction(async (transaction) => {
    const timestamp = new Date()
    const activeChildren = await transaction.$queryRaw<ActiveBatchChild[]>`
      SELECT "id", "status"::text AS "status", "attempt"
      FROM "system_jobs"
      WHERE "type" = ${JOB_TYPE}
        AND "parentJobId" = ${batchId}
        AND "status" IN ('PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING')
      ORDER BY "createdAt" ASC, "id" ASC
      FOR UPDATE
    `
    const direct = activeChildren.filter((job) => DIRECT_CANCEL_STATUS_SET.has(job.status))
    const interrupt = activeChildren.filter((job) => INTERRUPT_CANCEL_STATUS_SET.has(job.status))
    if (direct.length > 0) {
      const updated = await transaction.systemJob.updateMany({
        where: { id: { in: direct.map((job) => job.id) }, status: { in: [...DIRECT_CANCEL_STATUSES] } },
        data: {
          status: 'CANCELLED',
          cancelRequestedAt: timestamp,
          finishedAt: timestamp,
          workerId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null
        }
      })
      if (updated.count !== direct.length) {
        throw new BackgroundTaskError('CONCURRENT_MODIFICATION', 'Pixiv series queued jobs changed while cancelling')
      }
    }
    if (interrupt.length > 0) {
      const updated = await transaction.systemJob.updateMany({
        where: { id: { in: interrupt.map((job) => job.id) }, status: { in: [...INTERRUPT_CANCEL_STATUSES] } },
        data: { status: 'CANCELLING', cancelRequestedAt: timestamp }
      })
      if (updated.count !== interrupt.length) {
        throw new BackgroundTaskError('CONCURRENT_MODIFICATION', 'Pixiv series running jobs changed while cancelling')
      }
    }
    const directIds = new Set(direct.map((job) => job.id))
    const events: Prisma.SystemJobEventCreateManyInput[] = []
    for (const job of [...direct, ...interrupt]) {
      events.push({
        jobId: job.id,
        type: 'job.cancel_requested',
        level: 'INFO',
        attempt: job.attempt,
        message: 'Cancellation requested'
      })
      if (directIds.has(job.id)) {
        events.push({
          jobId: job.id,
          type: 'job.cancelled',
          level: 'INFO',
          attempt: job.attempt,
          message: 'Queued job cancelled before execution'
        })
      }
    }
    for (let offset = 0; offset < events.length; offset += CANCEL_EVENT_CHUNK_SIZE) {
      await transaction.systemJobEvent.createMany({ data: events.slice(offset, offset + CANCEL_EVENT_CHUNK_SIZE) })
    }
    return direct.length + interrupt.length
  })
}
