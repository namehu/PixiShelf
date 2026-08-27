import { prisma } from '@/lib/prisma'
import {
  cancelJobCommand,
  enqueueSingletonManualJobWithResult,
  listJobs
} from '@/services/background-task'
import { WORKER_HEARTBEAT_STALE_AFTER_MS } from '@/services/background-task/worker-heartbeat'
import {
  ACTIVE_JOB_STATUSES,
  EXECUTION_LANES,
  JOB_DEFINITION_VERSION,
  workerCapabilitySchema,
  type PixivAiDerivedTagSyncPayload
} from '@pixishelf/job-contracts'
import type { PrismaClient } from '@pixishelf/db'

export const PIXIV_AI_DERIVED_TAG_SYNC_JOB_TYPE = 'PIXIV_AI_DERIVED_TAG_SYNC' as const

export async function startPixivAiDerivedTagSync(
  requestedByUserId: string,
  payload: PixivAiDerivedTagSyncPayload,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  if (!(await hasReadyPixivAiDerivedTagWorker(database))) {
    throw new Error('当前没有支持 Pixiv AI 标签校准的新版本 READY Worker，请先部署并确认 Worker capability')
  }
  return enqueueSingletonManualJobWithResult({
    type: PIXIV_AI_DERIVED_TAG_SYNC_JOB_TYPE,
    triggerSource: 'MANUAL',
    requestedByUserId,
    priority: 10,
    maxAttempts: 3,
    payload
  })
}

export async function getLatestPixivAiDerivedTagSyncJob() {
  const jobs = await listJobs({ types: [PIXIV_AI_DERIVED_TAG_SYNC_JOB_TYPE], limit: 1 })
  return jobs.items[0] ?? null
}

export async function cancelPixivAiDerivedTagSync() {
  const jobs = await listJobs({
    types: [PIXIV_AI_DERIVED_TAG_SYNC_JOB_TYPE],
    statuses: [...ACTIVE_JOB_STATUSES],
    limit: 1
  })
  const job = jobs.items[0]
  if (!job) return { success: false, message: 'No active job' }
  await cancelJobCommand({ jobId: job.id })
  return { success: true, jobId: job.id }
}

export async function hasReadyPixivAiDerivedTagWorker(database: PrismaClient) {
  const now = new Date()
  const workers = await database.workerInstance.findMany({
    where: {
      status: 'READY',
      heartbeatAt: { gte: new Date(now.getTime() - WORKER_HEARTBEAT_STALE_AFTER_MS) }
    },
    orderBy: { heartbeatAt: 'desc' },
    take: 20,
    select: { capabilities: true }
  })
  return workers.some((worker) => supportsPixivAiDerivedTagSync(worker.capabilities))
}

export function supportsPixivAiDerivedTagSync(value: unknown) {
  if (!Array.isArray(value)) return false
  return value.some((entry) => {
    const capability = workerCapabilitySchema.safeParse(entry)
    return (
      capability.success &&
      capability.data.jobType === PIXIV_AI_DERIVED_TAG_SYNC_JOB_TYPE &&
      capability.data.executionLane === EXECUTION_LANES.BACKGROUND_WRITER &&
      capability.data.definitionVersions.includes(JOB_DEFINITION_VERSION)
    )
  })
}
