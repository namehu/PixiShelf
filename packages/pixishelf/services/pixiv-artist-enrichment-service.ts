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
import { Prisma } from '@pixishelf/db'

const JOB_TYPE = 'PIXIV_ARTIST_ENRICHMENT' as const
const PROVIDER_KEY = 'pixiv'
const CANCEL_CONCURRENCY_RETRY_LIMIT = 3

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
      // DISCOVER 批次和单项重试都是一次独立的管理员操作；两者都需要在刷新后恢复完成状态。
      where: { type: JOB_TYPE, parentJobId: null },
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

export async function cancelPixivArtistEnrichment(requestedJobId?: string) {
  const selectedJob = requestedJobId
    ? await prisma.systemJob.findUnique({
        where: { id: requestedJobId, type: JOB_TYPE },
        select: { id: true, parentJobId: true }
      })
    : await prisma.systemJob.findFirst({
        where: { type: JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, parentJobId: true }
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
  let affectedCount = 0
  const root = activeJobs.find((job) => job.id === batchId)
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
