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
import { ACTIVE_JOB_STATUSES, PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT } from '@pixishelf/job-contracts'
import type { Prisma, PrismaClient } from '@pixishelf/db'

const JOB_TYPE = 'PIXIV_ARTIST_ENRICHMENT' as const
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

export async function getPixivArtistEnrichmentSummary() {
  const [candidateCount, statusGroups, activeJob, latestBatch] = await Promise.all([
    prisma.artistExternalRef.count({ where: { providerKey: PROVIDER_KEY, status: null } }),
    prisma.artistExternalRef.groupBy({
      by: ['status'],
      where: { providerKey: PROVIDER_KEY, status: { not: null } },
      _count: { _all: true }
    }),
    prisma.systemJob.findFirst({
      where: { type: JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, parentJobId: true, status: true, progress: true, stage: true, message: true, createdAt: true }
    }),
    prisma.systemJob.findFirst({
      // 单项重试不应覆盖管理弹窗正在恢复的最近一次逻辑批次。
      where: {
        type: JOB_TYPE,
        parentJobId: null,
        payload: { path: ['mode'], equals: 'DISCOVER' }
      },
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
    })
  ])
  const childGroups = latestBatch
    ? await prisma.systemJob.groupBy({ by: ['status'], where: { parentJobId: latestBatch.id }, _count: { _all: true } })
    : []
  const providerCounts = { SUCCESS: 0, PARTIAL: 0, NO_DATA: 0, FAILED: 0 }
  for (const group of statusGroups) {
    if (group.status) providerCounts[group.status] = group._count._all
  }
  const childCounts = Object.fromEntries(childGroups.map((group) => [group.status, group._count._all]))
  const totalChildren = childGroups.reduce((total, group) => total + group._count._all, 0)
  const completedChildren = childGroups.reduce(
    (total, group) =>
      total + (['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(group.status) ? group._count._all : 0),
    0
  )
  return {
    candidateCount,
    eligibleCount: candidateCount + Object.values(providerCounts).reduce((total, count) => total + count, 0),
    providerCounts,
    activeJob,
    latestBatch,
    children: { total: totalChildren, completed: completedChildren, byStatus: childCounts }
  }
}

export async function startPixivArtistEnrichment(
  requestedByUserId: string,
  artistIds?: number[],
  refreshExisting = false
) {
  const selectedArtistIds = artistIds ? [...new Set(artistIds)].sort((left, right) => left - right) : undefined
  if (selectedArtistIds && selectedArtistIds.length > PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT) {
    throw new Error(`一次最多选择 ${PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT} 个艺术家`)
  }
  return enqueueSingletonManualJobWithResult({
    type: JOB_TYPE,
    triggerSource: 'MANUAL',
    requestedByUserId,
    priority: 80,
    maxAttempts: 3,
    payload: selectedArtistIds?.length
      ? {
          mode: 'DISCOVER',
          force: true,
          artistIds: selectedArtistIds,
          ...(refreshExisting ? { refreshExisting: true } : {})
        }
      : { mode: 'DISCOVER', force: false, ...(refreshExisting ? { refreshExisting: true } : {}) }
  })
}

export async function retryPixivArtistEnrichment(artistId: number, requestedByUserId: string) {
  return prisma.$transaction(async (transaction) => {
    const commandTransaction = transaction as unknown as Prisma.TransactionClient
    await lockSingletonJobType(commandTransaction, JOB_TYPE)
    const active = await transaction.systemJob.findFirst({
      where: { type: JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
      select: { id: true }
    })
    if (active) throw new Error('已有 Pixiv 艺术家补全任务正在运行，请等待当前任务结束')
    const ref = await transaction.artistExternalRef.findUnique({
      where: { artistId_providerKey: { artistId, providerKey: PROVIDER_KEY } },
      select: { id: true, artistId: true, externalId: true }
    })
    if (!ref || !/^[1-9][0-9]*$/.test(ref.externalId)) throw new Error('该艺术家没有已确认的 Pixiv 身份')
    return enqueueJob(
      {
        type: JOB_TYPE,
        triggerSource: 'MANUAL',
        requestedByUserId,
        priority: 70,
        maxAttempts: 3,
        idempotencyKey: `pixiv-artist:manual:${artistId}:${randomUUID()}`,
        payload: {
          mode: 'ARTIST',
          artistId,
          expectedExternalRefId: ref.id,
          expectedPixivUserId: ref.externalId,
          force: true
        }
      },
      { $transaction: async (operation) => operation(commandTransaction) }
    )
  })
}

export async function cancelPixivArtistEnrichment(
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
  // 先停止发现父任务。enqueueChild 会锁定并要求父任务仍为 RUNNING，因此父任务取消提交后，
  // 子任务集合已经封闭，可以在下一事务中一次性取消而不会漏掉并发新建项。
  if (root && ACTIVE_JOB_STATUSES.has(root.status) && root.status !== 'CANCELLING') {
    if (await cancelIfStillActive(root.id, database)) affectedCount += 1
  }
  affectedCount += await cancelActiveBatchChildren(batchId, database)

  return { batchId, affectedCount, job: await getJobById(selectedJob.id, database) }
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
        throw new BackgroundTaskError('CONCURRENT_MODIFICATION', 'Pixiv artist queued jobs changed while cancelling')
      }
    }

    if (interrupt.length > 0) {
      const updated = await transaction.systemJob.updateMany({
        where: { id: { in: interrupt.map((job) => job.id) }, status: { in: [...INTERRUPT_CANCEL_STATUSES] } },
        data: { status: 'CANCELLING', cancelRequestedAt: timestamp }
      })
      if (updated.count !== interrupt.length) {
        throw new BackgroundTaskError('CONCURRENT_MODIFICATION', 'Pixiv artist running jobs changed while cancelling')
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
