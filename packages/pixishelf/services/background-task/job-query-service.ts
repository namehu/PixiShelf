import { prisma } from '@/lib/prisma'
import { JOB_STATUS_VALUES, JOB_TYPE_VALUES, type JobStatus } from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import { z } from 'zod'
import { systemJobWireSelect, toJobDto, toWorkerHealthDto, workerInstanceWireSelect } from './job-serialization'
import { isWorkerHeartbeatFresh } from './worker-heartbeat'

type JobQueryClient = Pick<Prisma.TransactionClient, 'systemJob' | 'workerInstance'>

function queryClient(client?: JobQueryClient) {
  return client ?? (prisma as unknown as JobQueryClient)
}

export const listJobsInputSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(30),
  types: z.array(z.enum(JOB_TYPE_VALUES)).max(JOB_TYPE_VALUES.length).optional(),
  statuses: z.array(z.enum(JOB_STATUS_VALUES)).max(JOB_STATUS_VALUES.length).optional(),
  triggerSources: z
    .array(z.enum(['MANUAL', 'SCHEDULE', 'SYSTEM', 'RETRY', 'LEGACY']))
    .max(5)
    .optional()
})

export async function listJobs(input: z.input<typeof listJobsInputSchema>, client?: JobQueryClient) {
  const parsed = listJobsInputSchema.parse(input)
  const records = await queryClient(client).systemJob.findMany({
    where: {
      definitionVersion: { gte: 1 },
      ...(parsed.types?.length ? { type: { in: parsed.types } } : {}),
      ...(parsed.statuses?.length ? { status: { in: parsed.statuses } } : {}),
      ...(parsed.triggerSources?.length ? { triggerSource: { in: parsed.triggerSources } } : {})
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: parsed.limit + 1,
    ...(parsed.cursor ? { cursor: { id: parsed.cursor }, skip: 1 } : {}),
    select: systemJobWireSelect
  })
  const hasMore = records.length > parsed.limit
  const visible = hasMore ? records.slice(0, parsed.limit) : records
  return {
    items: visible.map(toJobDto),
    nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null
  }
}

// lane 级状态依赖 worker 心跳，保留 now 注入便于在测试中冻结时间，避免偶发 heartbeat 边界抖动导致断言不稳。
export async function getJobDashboard(client?: JobQueryClient, now: () => Date = () => new Date()) {
  const database = queryClient(client)
  const dashboardVisibleWhere = {
    definitionVersion: { gte: 1 },
    NOT: {
      OR: [
        { type: 'PIXIV_TAG_ENRICHMENT', parentJobId: { not: null } },
        { type: 'PIXIV_ARTIST_ENRICHMENT', parentJobId: { not: null } }
      ]
    }
  } satisfies Prisma.SystemJobWhereInput
  const [groups, running, recent, workers, activeCollapsedPixivBatches] = await Promise.all([
    database.systemJob.groupBy({
      by: ['status'],
      where: dashboardVisibleWhere,
      _count: { _all: true }
    }),
    database.systemJob.findMany({
      where: { definitionVersion: { gte: 1 }, status: { in: ['RUNNING', 'PAUSING', 'CANCELLING'] } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: 2,
      select: systemJobWireSelect
    }),
    database.systemJob.findMany({
      where: dashboardVisibleWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: systemJobWireSelect
    }),
    database.workerInstance.findMany({ orderBy: { heartbeatAt: 'desc' }, select: workerInstanceWireSelect }),
    database.systemJob.findMany({
      where: {
        definitionVersion: { gte: 1 },
        type: { in: ['PIXIV_TAG_ENRICHMENT', 'PIXIV_ARTIST_ENRICHMENT'] },
        parentJobId: { not: null },
        status: { in: ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] },
        parentJob: {
          is: { status: { notIn: ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] } }
        }
      },
      select: { type: true },
      distinct: ['type']
    })
  ])

  // 仅采用新鲜 worker 心跳，过期 presence 不会影响 READY/DRAINING 判定。
  const counts = Object.fromEntries(JOB_STATUS_VALUES.map((status) => [status, 0])) as Record<JobStatus, number>
  for (const group of groups) counts[group.status] = group._count._all
  // Pixiv enrichment jobs fan out internally, but the operator started one batch. Count each active batch once.
  counts.RUNNING += activeCollapsedPixivBatches.length
  const runningJobs = running.map(toJobDto)
  const workerDtos = workers.map(toWorkerHealthDto)
  const timestamp = now()
  const freshWorkers = workerDtos.filter((worker) => isWorkerHeartbeatFresh(worker.heartbeatAt, timestamp))
  const laneNames = ['ARCHIVE_RESOLVE', 'BACKGROUND_WRITER'] as const
  const lanes = laneNames.map((executionLane) => {
    const runningJob = runningJobs.find((job) => job.executionLane === executionLane) ?? null
    // 状态优先级：先看是否有运行中的 job；否则看是否有 fresh 的 READY/STOPPING worker，最后才是 ERROR。
    const ready = freshWorkers.some(
      (worker) =>
        worker.status === 'READY' &&
        worker.capabilities.some((capability) => capability.executionLane === executionLane)
    )
    const draining = freshWorkers.some(
      (worker) =>
        worker.status === 'STOPPING' &&
        worker.capabilities.some((capability) => capability.executionLane === executionLane)
    )
    return {
      executionLane,
      status: runningJob
        ? ('RUNNING' as const)
        : ready
          ? ('READY' as const)
          : draining
            ? ('DRAINING' as const)
            : ('ERROR' as const),
      runningJob
    }
  })
  return {
    counts,
    queuedCount: counts.PENDING + counts.RETRY_WAIT,
    activeCount: counts.RUNNING + counts.PAUSING + counts.CANCELLING,
    runningJob: runningJobs[0] ?? null,
    runningJobs,
    lanes,
    recentJobs: recent.map(toJobDto),
    workers: workerDtos
  }
}

export async function getJobById(jobId: string, client?: JobQueryClient) {
  const parsedId = z.string().min(1).parse(jobId)
  const record = await queryClient(client).systemJob.findUnique({
    where: { id: parsedId, definitionVersion: { gte: 1 } },
    select: systemJobWireSelect
  })
  return record ? toJobDto(record) : null
}
