import { prisma } from '@/lib/prisma'
import { ACTIVE_JOB_STATUSES, TERMINAL_JOB_STATUSES } from '@pixishelf/job-contracts'
import { JobStatus, Prisma } from '@prisma/client'
import { projectJobTarget } from './background-task/job-target'
import { latestMediaJobs } from './background-task/media-job-query'

const ALL_ACTIVE_JOB_STATUSES = [...ACTIVE_JOB_STATUSES] as JobStatus[]

const MEDIA_SCAN_JOB_TYPES = ['SCAN', 'LOCAL_DIRECTORY_IMPORT']
const VIDEO_CHAPTER_PREVIEW_GENERATION_JOB_TYPE = 'VIDEO_CHAPTER_PREVIEW_GENERATION'
const VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE = 'VIDEO_STREAMING_OPTIMIZATION'
const VIDEO_STREAMING_OPTIMIZATION_ACTIVE_STATUSES = [...ACTIVE_JOB_STATUSES]
const VIDEO_STREAMING_OPTIMIZATION_TERMINAL_STATUSES = [...TERMINAL_JOB_STATUSES]
export const VIDEO_STREAMING_OPTIMIZATION_QUEUE_CAPACITY = 100

export interface PendingReplaceJobSetupClient {
  pendingReplaceItem: {
    updateMany(args: Prisma.PendingReplaceItemUpdateManyArgs): PromiseLike<{ count: number }>
  }
  pendingReplaceBatch: {
    update(args: Prisma.PendingReplaceBatchUpdateArgs): PromiseLike<unknown>
  }
}

/**
 * 获取当前活跃的迁移任务
 */
export async function getActiveMigrationJob() {
  return await prisma.systemJob
    .findFirst({
      where: {
        type: 'MIGRATION',
        status: { in: ALL_ACTIVE_JOB_STATUSES }
      },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

export async function getLatestMigrationJob() {
  return await prisma.systemJob
    .findFirst({
      where: {
        type: 'MIGRATION'
      },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

/**
 * 获取当前活跃的扫描任务
 */
export async function getActiveScanJob() {
  return await prisma.systemJob
    .findFirst({
      where: {
        type: 'SCAN',
        status: { in: ALL_ACTIVE_JOB_STATUSES }
      },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

export async function getActiveLocalDirectoryImportJob() {
  return prisma.systemJob
    .findFirst({
      where: {
        type: 'LOCAL_DIRECTORY_IMPORT',
        status: { in: ALL_ACTIVE_JOB_STATUSES }
      },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

export async function getLatestLocalDirectoryImportJob() {
  return prisma.systemJob
    .findFirst({
      where: { type: 'LOCAL_DIRECTORY_IMPORT' },
      orderBy: { createdAt: 'desc' },
      include: {
        scanRun: {
          select: {
            id: true,
            totalArtworks: true,
            succeededArtworks: true,
            skippedArtworks: true,
            failedArtworks: true,
            newImages: true,
            durationMs: true,
            errorMessage: true
          }
        }
      }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

export async function getActivePendingReplaceJob() {
  return getActiveJobByType('PENDING_REPLACE')
}

export async function getLatestPendingReplaceJob() {
  return prisma.systemJob
    .findFirst({
      where: { type: 'PENDING_REPLACE' },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

export async function getMediaScanActivity() {
  const jobs = await getActiveJobsByTypes(MEDIA_SCAN_JOB_TYPES)
  return {
    scan: jobs.find((job) => job.type === 'SCAN') ?? null,
    localImport: jobs.find((job) => job.type === 'LOCAL_DIRECTORY_IMPORT') ?? null
  }
}

/**
 * 获取当前活跃的元数据源补全任务
 */
export async function getActiveRefillMetaSourceJob() {
  return await prisma.systemJob
    .findFirst({
      where: {
        type: 'REFILL_META_SOURCE',
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
      },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

/**
 * 获取最近一次媒体派生标签同步任务
 */
export async function getLatestMediaDerivedTagSyncJob() {
  return await prisma.systemJob
    .findFirst({
      where: {
        type: 'MEDIA_DERIVED_TAG_SYNC'
      },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

/**
 * 获取最近一次 WebP 动静态识别任务
 */
export async function getLatestWebpAnimationScanJob() {
  return await prisma.systemJob
    .findFirst({
      where: {
        type: 'WEBP_ANIMATION_SCAN'
      },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

/**
 * 获取最近一次视频媒体探测任务
 */
export async function getLatestVideoMediaProbeJob() {
  return await prisma.systemJob
    .findFirst({
      where: {
        type: 'VIDEO_MEDIA_PROBE'
      },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

export async function getLatestVideoChapterPreviewGenerationJob() {
  return await prisma.systemJob
    .findFirst({
      where: { type: VIDEO_CHAPTER_PREVIEW_GENERATION_JOB_TYPE },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

export async function getLatestVideoStreamingOptimizationJob() {
  return await prisma.systemJob
    .findFirst({
      where: { type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

export async function getLatestVideoStreamingOptimizationJobsByImageIds(imageIds: number[]) {
  if (!imageIds.length) return []
  const [jobs, pending] = await Promise.all([
    latestMediaJobs('VIDEO_STREAMING_OPTIMIZATION', imageIds),
    prisma.systemJob.findMany({
      where: { type: 'VIDEO_STREAMING_OPTIMIZATION', status: JobStatus.PENDING },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
  ])
  const positions = new Map(pending.map((job, index) => [job.id, index + 1]))
  return jobs.map((job) => ({ ...job, queuePosition: positions.get(job.id) ?? null }))
}

export async function listVideoStreamingOptimizationQueue(recentLimit = 20) {
  const [activeRecords, recentRecords] = await Promise.all([
    prisma.systemJob.findMany({
      where: {
        type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE,
        status: { in: VIDEO_STREAMING_OPTIMIZATION_ACTIVE_STATUSES }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    }),
    prisma.systemJob.findMany({
      where: {
        type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE,
        status: { in: VIDEO_STREAMING_OPTIMIZATION_TERMINAL_STATUSES }
      },
      orderBy: { updatedAt: 'desc' },
      take: recentLimit,
      include: {
        failureAcknowledgement: { select: { jobId: true } }
      }
    })
  ])
  const activeJobs = activeRecords.map(projectJobTarget)
  const recentJobs = recentRecords.map(projectJobTarget)
  const pendingIds = activeJobs.filter((job) => job.status === JobStatus.PENDING).map((job) => job.id)
  const pendingPositions = new Map(pendingIds.map((id, index) => [id, index + 1]))
  const activeTargetImageIds = new Set(
    activeJobs.flatMap((job) => (job.targetImageId === null ? [] : [job.targetImageId]))
  )
  const latestTerminalJobIdsByImageId = new Map<number, string>()

  for (const job of recentJobs) {
    if (job.targetImageId !== null && !latestTerminalJobIdsByImageId.has(job.targetImageId)) {
      latestTerminalJobIdsByImageId.set(job.targetImageId, job.id)
    }
  }

  const recent = recentJobs.map(({ failureAcknowledgement, ...job }) => {
    const hasActiveSuccessor = job.targetImageId !== null && activeTargetImageIds.has(job.targetImageId)
    const isLatestTerminalJob =
      job.targetImageId === null || latestTerminalJobIdsByImageId.get(job.targetImageId) === job.id
    const failureNeedsAttention =
      job.status === JobStatus.FAILED && failureAcknowledgement === null && isLatestTerminalJob && !hasActiveSuccessor

    return {
      ...job,
      queuePosition: null as number | null,
      failureNeedsAttention,
      retryAllowed:
        job.definitionVersion === 1 &&
        job.targetImageId !== null &&
        isLatestTerminalJob &&
        !hasActiveSuccessor &&
        (job.status === JobStatus.CANCELLED || failureNeedsAttention)
    }
  })

  return {
    capacity: VIDEO_STREAMING_OPTIMIZATION_QUEUE_CAPACITY,
    active: activeJobs.map((job) => ({ ...job, queuePosition: pendingPositions.get(job.id) ?? null })),
    failureAttentionCount: recent.filter((job) => job.failureNeedsAttention).length,
    recent
  }
}

export async function getActiveJobByType(type: string) {
  return await prisma.systemJob
    .findFirst({
      where: {
        type,
        status: { in: ALL_ACTIVE_JOB_STATUSES }
      },
      orderBy: { createdAt: 'desc' }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}

export async function getActiveJobsByTypes(types: string[]) {
  if (types.length === 0) return []

  return await prisma.systemJob
    .findMany({
      where: {
        type: { in: types },
        status: { in: ALL_ACTIVE_JOB_STATUSES }
      },
      orderBy: { createdAt: 'desc' }
    })
    .then((jobs) => jobs.map(projectJobTarget))
}

/**
 * 获取任务详情
 */
export async function getJob(jobId: string) {
  return await prisma.systemJob
    .findUnique({
      where: { id: jobId }
    })
    .then((job) => (job ? projectJobTarget(job) : null))
}
