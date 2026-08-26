import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import {
  cancelJobCommand,
  enqueueJob,
  enqueueSingletonManualJobWithResult,
  getJobById,
  lockSingletonJobType
} from '@/services/background-task'
import { ACTIVE_JOB_STATUSES, PIXIV_TAG_ENRICHMENT_BATCH_LIMIT } from '@pixishelf/job-contracts'
import type { Prisma, PrismaClient } from '@pixishelf/db'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'

const JOB_TYPE = 'PIXIV_TAG_ENRICHMENT' as const
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

export const pixivTagCandidateWhere = {
  namespace: 'general',
  isSystem: false,
  artworkTags: {
    some: {
      provenance: 'SOURCE',
      sourceRef: { is: { providerKey: PROVIDER_KEY } }
    }
  }
} satisfies Prisma.TagWhereInput

// 候选条件固定为“非系统 general 标签 + Pixiv SOURCE 关联”，避免把手工或其他来源标签送入 Pixiv 查询。

export async function getPixivTagEnrichmentSummary() {
  const [eligibleCount, candidateCount, statusGroups, activeJob, latestBatch] = await Promise.all([
    prisma.tag.count({ where: pixivTagCandidateWhere }),
    prisma.tag.count({
      where: {
        ...pixivTagCandidateWhere,
        externalMetadata: { none: { providerKey: PROVIDER_KEY } }
      }
    }),
    prisma.tagExternalMetadata.groupBy({
      by: ['status'],
      where: { providerKey: PROVIDER_KEY },
      _count: { _all: true }
    }),
    prisma.systemJob.findFirst({
      where: { type: JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, parentJobId: true, status: true, progress: true, stage: true, message: true, createdAt: true }
    }),
    prisma.systemJob.findFirst({
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
    ? await prisma.systemJob.groupBy({
        by: ['status'],
        where: { parentJobId: latestBatch.id },
        _count: { _all: true }
      })
    : []

  const providerCounts = { SUCCESS: 0, PARTIAL: 0, NO_DATA: 0, FAILED: 0 }
  for (const group of statusGroups) providerCounts[group.status] = group._count._all
  const childCounts = Object.fromEntries(childGroups.map((group) => [group.status, group._count._all]))
  const totalChildren = childGroups.reduce((total, group) => total + group._count._all, 0)
  const completedChildren = childGroups.reduce(
    (total, group) =>
      total + (['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(group.status) ? group._count._all : 0),
    0
  )

  return {
    eligibleCount,
    candidateCount,
    providerCounts,
    activeJob,
    latestBatch,
    children: { total: totalChildren, completed: completedChildren, byStatus: childCounts }
  }
}

export async function startPixivTagEnrichment(
  requestedByUserId: string,
  tagIds?: number[],
  refreshExisting = false
) {
  const selectedTagIds = tagIds ? [...new Set(tagIds)].sort((left, right) => left - right) : undefined
  if (selectedTagIds && selectedTagIds.length > PIXIV_TAG_ENRICHMENT_BATCH_LIMIT) {
    throw new Error(`一次最多选择 ${PIXIV_TAG_ENRICHMENT_BATCH_LIMIT} 个标签`)
  }

  // 发现任务按 ID 分页，并把当时的 tagId/name 固化到可重试子任务；执行前仍会重新校验来源关系。
  return enqueueSingletonManualJobWithResult({
    type: JOB_TYPE,
    triggerSource: 'MANUAL',
    requestedByUserId,
    priority: 80,
    maxAttempts: 3,
    payload: selectedTagIds?.length
      ? { mode: 'DISCOVER', force: true, tagIds: selectedTagIds, ...(refreshExisting ? { refreshExisting: true } : {}) }
      : { mode: 'DISCOVER', force: false, ...(refreshExisting ? { refreshExisting: true } : {}) }
  })
}

export async function cancelPixivTagEnrichment(
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
  // Stop the discovery parent first. enqueueChild locks and requires a RUNNING parent, so after
  // this command commits the child set is closed and can be cancelled atomically without gaps.
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
    // The parent is already stopped above. Lock every still-active direct child so a Worker claim
    // cannot slip between the queued and running state transitions.
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
        throw new BackgroundTaskError('CONCURRENT_MODIFICATION', 'Pixiv tag queued jobs changed while cancelling')
      }
    }

    if (interrupt.length > 0) {
      const updated = await transaction.systemJob.updateMany({
        where: { id: { in: interrupt.map((job) => job.id) }, status: { in: [...INTERRUPT_CANCEL_STATUSES] } },
        data: { status: 'CANCELLING', cancelRequestedAt: timestamp }
      })
      if (updated.count !== interrupt.length) {
        throw new BackgroundTaskError('CONCURRENT_MODIFICATION', 'Pixiv tag running jobs changed while cancelling')
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

export async function retryPixivTagEnrichment(tagId: number, requestedByUserId: string) {
  return prisma.$transaction(async (transaction) => {
    const commandTransaction = transaction as unknown as Prisma.TransactionClient
    // 锁与活动任务检查必须在同一事务中，防止批处理和手动重试同时写同一个标签。
    await lockSingletonJobType(commandTransaction, JOB_TYPE)
    const active = await transaction.systemJob.findFirst({
      where: { type: JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true }
    })
    if (active) throw new Error('已有 Pixiv 标签补全任务正在运行，请等待当前任务结束')

    const tag = await transaction.tag.findFirst({
      where: { id: tagId, ...pixivTagCandidateWhere },
      select: { id: true, name: true }
    })
    if (!tag) throw new Error('该标签不存在或不属于可补全的 Pixiv 来源标签')

    return enqueueJob(
      {
        type: JOB_TYPE,
        triggerSource: 'MANUAL',
        requestedByUserId,
        priority: 70,
        maxAttempts: 3,
        idempotencyKey: `pixiv-tag:manual:${tag.id}:${randomUUID()}`,
        payload: { mode: 'TAG', tagId: tag.id, expectedName: tag.name, force: true }
      },
      { $transaction: async (operation) => operation(commandTransaction) }
    )
  })
}
