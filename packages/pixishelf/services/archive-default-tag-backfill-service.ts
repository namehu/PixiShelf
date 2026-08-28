import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getSystemSettings } from '@/services/setting.service'
import {
  cancelJobCommand,
  enqueueSingletonManualJobWithResult,
  isCentralDispatcherCutoverEnabled
} from '@/services/background-task'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'
import { WORKER_HEARTBEAT_STALE_AFTER_MS } from '@/services/background-task/worker-heartbeat'
import {
  ACTIVE_JOB_STATUSES,
  archiveDefaultTagBackfillCheckpointSchema,
  archiveDefaultTagBackfillPayloadSchema,
  archiveDefaultTagBackfillResultSchema,
  EXECUTION_LANES,
  JOB_DEFINITION_VERSION,
  workerCapabilitySchema
} from '@pixishelf/job-contracts'
import type { Prisma, PrismaClient } from '@pixishelf/db'

export const ARCHIVE_DEFAULT_TAG_BACKFILL_JOB_TYPE = 'ARCHIVE_DEFAULT_TAG_BACKFILL' as const
export const ARCHIVE_DEFAULT_TAG_BACKFILL_PRIORITY = 99

const TARGET_WHERE = {
  createdVia: 'URL_ARCHIVE' as const,
  deletedAt: null,
  archiveLifecycleState: 'ACTIVE' as const
}

const jobStatusSelect = {
  id: true,
  status: true,
  progress: true,
  stage: true,
  message: true,
  result: true,
  error: true,
  createdAt: true,
  finishedAt: true
} as const

export class ArchiveDefaultTagBackfillServiceError extends Error {
  constructor(
    readonly code: 'NO_DEFAULT_TAGS' | 'NO_MISSING_RELATIONS' | 'STALE_PREVIEW' | 'WORKER_UNAVAILABLE',
    message: string
  ) {
    super(message)
  }
}

export async function previewArchiveDefaultTagBackfill(
  options: {
    database?: PrismaClient
    settings?: { archive_default_tag_ids: number[] }
  } = {}
) {
  const database = options.database ?? (prisma as unknown as PrismaClient)
  const settings = options.settings ?? (await getSystemSettings())
  const configuredTagIds = [...new Set(settings.archive_default_tag_ids)].sort((left, right) => left - right)
  const [maximum, tags] = await Promise.all([
    database.artwork.aggregate({ where: TARGET_WHERE, _max: { id: true } }),
    configuredTagIds.length
      ? database.tag.findMany({
          where: { id: { in: configuredTagIds } },
          orderBy: { id: 'asc' },
          select: { id: true }
        })
      : Promise.resolve([])
  ])
  const targetMaxArtworkId = maximum._max.id ?? 0
  const validTagIds = tags.map(({ id }) => id)
  const validTagIdSet = new Set(validTagIds)
  const unavailableTagIds = configuredTagIds.filter((id) => !validTagIdSet.has(id))
  const targetWhere = { ...TARGET_WHERE, id: { lte: targetMaxArtworkId } }
  const [targetArtworkCount, existingRelations] = await Promise.all([
    database.artwork.count({ where: targetWhere }),
    validTagIds.length
      ? database.artworkTag.count({
          where: {
            tagId: { in: validTagIds },
            artwork: targetWhere
          }
        })
      : Promise.resolve(0)
  ])
  const missingRelations = Math.max(0, targetArtworkCount * validTagIds.length - existingRelations)
  const snapshot = {
    configuredTagIds,
    validTagIds,
    unavailableTagIds,
    targetMaxArtworkId,
    targetArtworkCount,
    existingRelations,
    missingRelations
  }
  return {
    ...snapshot,
    snapshotDigest: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  }
}

export async function getArchiveDefaultTagBackfillStatus(database: PrismaClient = prisma as unknown as PrismaClient) {
  const [activeJob, latestJob, capabilityAvailable] = await Promise.all([
    database.systemJob.findFirst({
      where: { type: ARCHIVE_DEFAULT_TAG_BACKFILL_JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: jobStatusSelect
    }),
    database.systemJob.findFirst({
      where: { type: ARCHIVE_DEFAULT_TAG_BACKFILL_JOB_TYPE },
      orderBy: { createdAt: 'desc' },
      select: jobStatusSelect
    }),
    isCentralDispatcherCutoverEnabled() ? hasReadyArchiveDefaultTagBackfillWorker(database) : Promise.resolve(false)
  ])
  return {
    capabilityAvailable,
    activeJob: serializeBackfillJob(activeJob),
    latestJob: serializeBackfillJob(latestJob)
  }
}

export async function startArchiveDefaultTagBackfill(input: {
  requestedByUserId: string
  snapshotDigest: string
  database?: PrismaClient
}) {
  const database = input.database ?? (prisma as unknown as PrismaClient)
  const activeJob = await findActiveJob(database)
  if (activeJob) return { jobId: activeJob.id, status: activeJob.status, reused: true }
  if (!isCentralDispatcherCutoverEnabled()) {
    throw new ArchiveDefaultTagBackfillServiceError(
      'WORKER_UNAVAILABLE',
      '中央 Worker 调度尚未启用，暂时不能补全历史归档标签'
    )
  }
  if (!(await hasReadyArchiveDefaultTagBackfillWorker(database))) {
    throw new ArchiveDefaultTagBackfillServiceError(
      'WORKER_UNAVAILABLE',
      '当前没有支持历史归档标签补全的 READY Worker，请先部署并确认 Worker capability'
    )
  }

  const preview = await previewArchiveDefaultTagBackfill({ database })
  if (preview.snapshotDigest !== input.snapshotDigest) {
    throw new ArchiveDefaultTagBackfillServiceError('STALE_PREVIEW', '历史归档或默认标签已经变化，请重新预览')
  }
  if (preview.configuredTagIds.length === 0 || preview.validTagIds.length === 0) {
    throw new ArchiveDefaultTagBackfillServiceError('NO_DEFAULT_TAGS', '请先选择并保存至少一个有效的归档默认标签')
  }
  if (preview.missingRelations === 0) {
    throw new ArchiveDefaultTagBackfillServiceError('NO_MISSING_RELATIONS', '历史归档作品已经包含当前默认标签')
  }

  const payload = archiveDefaultTagBackfillPayloadSchema.parse({
    defaultTagIds: preview.configuredTagIds,
    targetMaxArtworkId: preview.targetMaxArtworkId,
    targetArtworkCount: preview.targetArtworkCount,
    expectedExistingRelations: preview.existingRelations,
    expectedMissingRelations: preview.missingRelations,
    snapshotDigest: preview.snapshotDigest
  })

  try {
    const queued = await enqueueSingletonManualJobWithResult(
      {
        type: ARCHIVE_DEFAULT_TAG_BACKFILL_JOB_TYPE,
        triggerSource: 'MANUAL',
        requestedByUserId: input.requestedByUserId,
        priority: ARCHIVE_DEFAULT_TAG_BACKFILL_PRIORITY,
        maxAttempts: 3,
        payload
      },
      { client: database }
    )
    return { jobId: queued.job.id, status: queued.job.status, reused: queued.reused }
  } catch (error) {
    if (error instanceof BackgroundTaskError && error.code === 'ACTIVE_JOB_CONFLICT') {
      const racedJob = await findActiveJob(database)
      if (racedJob) return { jobId: racedJob.id, status: racedJob.status, reused: true }
    }
    throw error
  }
}

export async function cancelArchiveDefaultTagBackfill(
  jobId: string,
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const job = await database.systemJob.findUnique({
    where: { id: jobId, type: ARCHIVE_DEFAULT_TAG_BACKFILL_JOB_TYPE },
    select: { id: true, status: true }
  })
  if (!job || !ACTIVE_JOB_STATUSES.has(job.status)) return { success: false, jobId, status: job?.status ?? null }
  const cancelled = await cancelJobCommand({ jobId }, database)
  return { success: true, jobId: cancelled.id, status: cancelled.status }
}

export async function hasReadyArchiveDefaultTagBackfillWorker(database: PrismaClient, now: Date = new Date()) {
  const workers = await database.workerInstance.findMany({
    where: {
      status: 'READY',
      heartbeatAt: { gte: new Date(now.getTime() - WORKER_HEARTBEAT_STALE_AFTER_MS) }
    },
    orderBy: { heartbeatAt: 'desc' },
    take: 20,
    select: { capabilities: true }
  })
  return workers.some((worker) => supportsArchiveDefaultTagBackfill(worker.capabilities))
}

export function supportsArchiveDefaultTagBackfill(value: unknown) {
  if (!Array.isArray(value)) return false
  return value.some((entry) => {
    const capability = workerCapabilitySchema.safeParse(entry)
    return (
      capability.success &&
      capability.data.jobType === ARCHIVE_DEFAULT_TAG_BACKFILL_JOB_TYPE &&
      capability.data.executionLane === EXECUTION_LANES.BACKGROUND_WRITER &&
      capability.data.definitionVersions.includes(JOB_DEFINITION_VERSION)
    )
  })
}

async function findActiveJob(database: PrismaClient) {
  return database.systemJob.findFirst({
    where: { type: ARCHIVE_DEFAULT_TAG_BACKFILL_JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true }
  })
}

type BackfillJobRecord = Prisma.SystemJobGetPayload<{ select: typeof jobStatusSelect }>

function serializeBackfillJob(job: BackfillJobRecord | null) {
  if (!job) return null
  const checkpoint = archiveDefaultTagBackfillCheckpointSchema.safeParse(job.result)
  const result = archiveDefaultTagBackfillResultSchema.safeParse(job.result)
  return {
    ...job,
    checkpoint: checkpoint.success ? checkpoint.data : null,
    result: result.success ? result.data : null
  }
}
