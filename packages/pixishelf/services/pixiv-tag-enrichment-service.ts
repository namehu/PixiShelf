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
import { Prisma } from '@pixishelf/db'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'

const JOB_TYPE = 'PIXIV_TAG_ENRICHMENT' as const
const PROVIDER_KEY = 'pixiv'
const CANCEL_CONCURRENCY_RETRY_LIMIT = 3

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
  const [candidateCount, statusGroups, activeJob, latestBatch] = await Promise.all([
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
    candidateCount,
    providerCounts,
    activeJob,
    latestBatch,
    children: { total: totalChildren, completed: completedChildren, byStatus: childCounts }
  }
}

export async function startPixivTagEnrichment(requestedByUserId: string, tagIds?: number[]) {
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
      ? { mode: 'DISCOVER', force: true, tagIds: selectedTagIds }
      : { mode: 'DISCOVER', force: false }
  })
}

export async function cancelPixivTagEnrichment(requestedJobId?: string) {
  const selectedJob = requestedJobId
    ? await prisma.systemJob.findUnique({
        where: { id: requestedJobId, type: JOB_TYPE },
        select: { id: true, parentJobId: true, status: true }
      })
    : await prisma.systemJob.findFirst({
        where: { type: JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, parentJobId: true, status: true }
      })

  if (!selectedJob) return { batchId: null, affectedCount: 0, job: null }

  const batchId = selectedJob.parentJobId ?? selectedJob.id
  const activeJobs = await prisma.systemJob.findMany({
    where: {
      type: JOB_TYPE,
      status: { in: [...ACTIVE_JOB_STATUSES] },
      OR: [{ id: batchId }, { parentJobId: batchId }]
    },
    orderBy: [{ parentJobId: 'asc' }, { createdAt: 'asc' }],
    select: { id: true }
  })

  // Cancel the discovery parent first. enqueueChild requires a RUNNING parent, so no new
  // children can appear while the remaining queued/running children are being cancelled.
  const root = activeJobs.find((job) => job.id === batchId)
  let affectedCount = 0
  if (root && (await cancelIfStillActive(root.id))) affectedCount += 1

  const children = activeJobs.filter((job) => job.id !== batchId)
  for (let offset = 0; offset < children.length; offset += 10) {
    const results = await Promise.all(children.slice(offset, offset + 10).map((job) => cancelIfStillActive(job.id)))
    affectedCount += results.filter(Boolean).length
  }

  return { batchId, affectedCount, job: await getJobById(selectedJob.id) }
}

async function cancelIfStillActive(jobId: string) {
  for (let attempt = 1; attempt <= CANCEL_CONCURRENCY_RETRY_LIMIT; attempt += 1) {
    try {
      await cancelJobCommand({ jobId })
      return true
    } catch (error) {
      const current = await prisma.systemJob.findUnique({ where: { id: jobId }, select: { status: true } })
      if (!current || !ACTIVE_JOB_STATUSES.has(current.status)) return false
      if (error instanceof BackgroundTaskError && error.code === 'CONCURRENT_MODIFICATION') continue
      throw error
    }
  }

  throw new BackgroundTaskError('CONCURRENT_MODIFICATION', 'Background job kept changing while cancelling the batch')
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
