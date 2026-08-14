import { prisma } from '@/lib/prisma'
import { JOB_STATUS_VALUES, JOB_TYPE_VALUES, type JobStatus } from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import { z } from 'zod'
import { systemJobWireSelect, toJobDto, toWorkerHealthDto, workerInstanceWireSelect } from './job-serialization'

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

export async function getJobDashboard(client?: JobQueryClient) {
  const database = queryClient(client)
  const [groups, running, recent, workers] = await Promise.all([
    database.systemJob.groupBy({
      by: ['status'],
      where: { definitionVersion: { gte: 1 } },
      _count: { _all: true }
    }),
    database.systemJob.findFirst({
      where: { definitionVersion: { gte: 1 }, status: { in: ['RUNNING', 'PAUSING', 'CANCELLING'] } },
      orderBy: { startedAt: 'desc' },
      select: systemJobWireSelect
    }),
    database.systemJob.findMany({
      where: { definitionVersion: { gte: 1 } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: systemJobWireSelect
    }),
    database.workerInstance.findMany({ orderBy: { heartbeatAt: 'desc' }, select: workerInstanceWireSelect })
  ])

  const counts = Object.fromEntries(JOB_STATUS_VALUES.map((status) => [status, 0])) as Record<JobStatus, number>
  for (const group of groups) counts[group.status] = group._count._all
  return {
    counts,
    queuedCount: counts.PENDING + counts.RETRY_WAIT,
    activeCount: counts.RUNNING + counts.PAUSING + counts.CANCELLING,
    runningJob: running ? toJobDto(running) : null,
    recentJobs: recent.map(toJobDto),
    workers: workers.map(toWorkerHealthDto)
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
