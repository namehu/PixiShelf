import { prisma } from '@/lib/prisma'
import { assertLegacyBackgroundExecutionAllowed } from '@/services/background-task/dispatcher-cutover'
import { JobStatus, Prisma } from '@prisma/client'

const MEDIA_SCAN_JOB_TYPES = ['SCAN', 'LOCAL_DIRECTORY_IMPORT']
const MEDIA_ROOT_WRITE_JOB_TYPES = ['SCAN', 'LOCAL_DIRECTORY_IMPORT', 'MIGRATION', 'PENDING_REPLACE']
const MEDIA_SCAN_ADVISORY_LOCK_ID = 728341
const MEDIA_MAINTENANCE_JOB_TYPES = ['WEBP_ANIMATION_SCAN', 'VIDEO_MEDIA_PROBE', 'VIDEO_CHAPTER_PREVIEW_GENERATION']
const RUNNING_ONLY_MEDIA_MAINTENANCE_JOB_TYPES = ['VIDEO_KEYFRAME_GENERATION']
const MEDIA_MAINTENANCE_ADVISORY_LOCK_ID = 728342
const VIDEO_PROCESSING_ADVISORY_LOCK_ID = 728344
const AUDIT_MAINTENANCE_JOB_TYPES = ['SCAN_RUN_RETENTION_CLEANUP', 'TRIGGER_LOG_RETENTION_CLEANUP']
const AUDIT_MAINTENANCE_ADVISORY_LOCK_ID = 728343
const SCAN_RUN_RETENTION_CLEANUP_JOB_TYPE = 'SCAN_RUN_RETENTION_CLEANUP'
const TRIGGER_LOG_RETENTION_CLEANUP_JOB_TYPE = 'TRIGGER_LOG_RETENTION_CLEANUP'
const VIDEO_CHAPTER_PREVIEW_GENERATION_JOB_TYPE = 'VIDEO_CHAPTER_PREVIEW_GENERATION'
const VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE = 'VIDEO_STREAMING_OPTIMIZATION'
const VIDEO_STREAMING_OPTIMIZATION_ACTIVE_STATUSES = [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING]
const VIDEO_STREAMING_OPTIMIZATION_TERMINAL_STATUSES = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]
export const VIDEO_STREAMING_OPTIMIZATION_QUEUE_CAPACITY = 100

async function createMutexJob(input: {
  type: string
  mutexJobTypes: string[]
  advisoryLockId: number
  message: string
  conflictMessage: string
  runningOnlyMutexJobTypes?: string[]
  targetImageId?: number
  targetPath?: string
  mode?: string
}) {
  assertLegacyBackgroundExecutionAllowed(input.type)
  // 使用事务内的会话级咨询锁保证“状态检查+创建”是原子操作，避免并发工作进程重复获取同一互斥队列。
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', input.advisoryLockId)

    const activeJob = await tx.systemJob.findFirst({
      where: input.runningOnlyMutexJobTypes?.length
        ? {
            OR: [
              {
                type: { in: input.mutexJobTypes },
                status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
              },
              {
                type: { in: input.runningOnlyMutexJobTypes },
                status: { in: [JobStatus.RUNNING, JobStatus.PAUSING, JobStatus.CANCELLING] }
              }
            ]
          }
        : {
            type: { in: input.mutexJobTypes },
            status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
          }
    })

    if (activeJob) {
      throw new Error(input.conflictMessage)
    }

    return tx.systemJob.create({
      data: {
        type: input.type,
        status: JobStatus.RUNNING,
        message: input.message,
        progress: 0,
        ...(input.targetImageId !== undefined ? { targetImageId: input.targetImageId } : {}),
        ...(input.targetPath !== undefined ? { targetPath: input.targetPath } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {})
      }
    })
  })
}

async function createMediaRootWriteJob(input: {
  type: 'SCAN' | 'LOCAL_DIRECTORY_IMPORT' | 'MIGRATION' | 'PENDING_REPLACE'
  message: string
  conflictMessage: string
  targetPath?: string
  mode?: string
  onCreated?: (tx: PendingReplaceJobSetupClient, job: { id: string }) => Promise<void>
}) {
  assertLegacyBackgroundExecutionAllowed(input.type)
  // 媒体根目录写操作互斥在同一锁下，覆盖扫描、导入、迁移、替换四类高危写任务，防止磁盘路径并发冲突与快照不一致。
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', MEDIA_SCAN_ADVISORY_LOCK_ID)

    const activeJob = await tx.systemJob.findFirst({
      where: {
        type: { in: MEDIA_ROOT_WRITE_JOB_TYPES },
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.PAUSED, JobStatus.CANCELLING] }
      }
    })

    if (activeJob) {
      throw new Error(input.conflictMessage)
    }

    const job = await tx.systemJob.create({
      data: {
        type: input.type,
        status: JobStatus.RUNNING,
        message: input.message,
        progress: 0,
        attempt: 1,
        heartbeatAt: new Date(),
        ...(input.targetPath ? { targetPath: input.targetPath } : {}),
        ...(input.mode ? { mode: input.mode } : {})
      }
    })
    if (input.onCreated) {
      await input.onCreated(tx as unknown as PendingReplaceJobSetupClient, job)
    }
    return job
  })
}

export interface PendingReplaceJobSetupClient {
  pendingReplaceItem: {
    updateMany(args: Prisma.PendingReplaceItemUpdateManyArgs): PromiseLike<{ count: number }>
  }
  pendingReplaceBatch: {
    update(args: Prisma.PendingReplaceBatchUpdateArgs): PromiseLike<unknown>
  }
}

async function createMediaScanJob(type: 'SCAN' | 'LOCAL_DIRECTORY_IMPORT', message: string) {
  return createMediaRootWriteJob({
    type,
    message,
    conflictMessage: 'Media scan job already in progress'
  })
}

/**
 * 尝试创建一个扫描任务（分布式锁）
 * 确保同一时间只有一个活跃的扫描任务
 */
export async function createScanJob() {
  return createMediaScanJob('SCAN', '初始化...')
}

export async function createLocalDirectoryImportJob() {
  return createMediaScanJob('LOCAL_DIRECTORY_IMPORT', '正在准备本地目录导入...')
}

export async function createPendingReplaceJob(
  targetPath: string,
  mode: 'BATCH' | 'RESTORE' | 'CLEANUP' = 'BATCH',
  onCreated?: (tx: PendingReplaceJobSetupClient, job: { id: string }) => Promise<void>
) {
  return createMediaRootWriteJob({
    type: 'PENDING_REPLACE',
    message:
      mode === 'RESTORE' ? '正在恢复旧媒体...' : mode === 'CLEANUP' ? '正在清理替换备份...' : '正在准备批量替换...',
    conflictMessage: 'Media root write job already in progress',
    targetPath,
    mode,
    onCreated
  })
}

/**
 * 尝试创建一个迁移任务
 */
export async function createMigrationJob() {
  return createMediaRootWriteJob({
    type: 'MIGRATION',
    message: '初始化迁移...',
    conflictMessage: 'Migration already in progress'
  })
}

/**
 * 获取当前活跃的迁移任务
 */
export async function getActiveMigrationJob() {
  return await prisma.systemJob.findFirst({
    where: {
      type: 'MIGRATION',
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.PAUSED, JobStatus.CANCELLING] }
    },
    orderBy: { createdAt: 'desc' }
  })
}

export async function getLatestMigrationJob() {
  return await prisma.systemJob.findFirst({
    where: {
      type: 'MIGRATION'
    },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * 获取当前活跃的扫描任务
 */
export async function getActiveScanJob() {
  return await prisma.systemJob.findFirst({
    where: {
      type: 'SCAN',
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
    },
    orderBy: { createdAt: 'desc' }
  })
}

export async function getActiveLocalDirectoryImportJob() {
  return prisma.systemJob.findFirst({
    where: {
      type: 'LOCAL_DIRECTORY_IMPORT',
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
    },
    orderBy: { createdAt: 'desc' }
  })
}

export async function getLatestLocalDirectoryImportJob() {
  return prisma.systemJob.findFirst({
    where: { type: 'LOCAL_DIRECTORY_IMPORT' },
    orderBy: { createdAt: 'desc' }
  })
}

export async function getActivePendingReplaceJob() {
  return getActiveJobByType('PENDING_REPLACE')
}

export async function getLatestPendingReplaceJob() {
  return prisma.systemJob.findFirst({
    where: { type: 'PENDING_REPLACE' },
    orderBy: { createdAt: 'desc' }
  })
}

export async function getMediaScanActivity() {
  const jobs = await getActiveJobsByTypes(MEDIA_SCAN_JOB_TYPES)
  return {
    scan: jobs.find((job) => job.type === 'SCAN') ?? null,
    localImport: jobs.find((job) => job.type === 'LOCAL_DIRECTORY_IMPORT') ?? null
  }
}

/**
 * 尝试创建一个元数据源补全任务
 */
export async function createRefillMetaSourceJob() {
  assertLegacyBackgroundExecutionAllowed('REFILL_META_SOURCE')
  return await prisma.$transaction(async (tx) => {
    // 检查是否有正在运行或正在取消的任务
    const activeJob = await tx.systemJob.findFirst({
      where: {
        type: 'REFILL_META_SOURCE',
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
      }
    })

    if (activeJob) {
      throw new Error('Refill meta source job already in progress')
    }

    return await tx.systemJob.create({
      data: {
        type: 'REFILL_META_SOURCE',
        status: JobStatus.RUNNING,
        message: '初始化...',
        progress: 0
      }
    })
  })
}

/**
 * 尝试创建一个媒体派生标签同步任务
 */
export async function createMediaDerivedTagSyncJob() {
  assertLegacyBackgroundExecutionAllowed('MEDIA_DERIVED_TAG_SYNC')
  return await prisma.$transaction(async (tx) => {
    const activeJob = await tx.systemJob.findFirst({
      where: {
        type: 'MEDIA_DERIVED_TAG_SYNC',
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
      }
    })

    if (activeJob) {
      throw new Error('Media derived tag sync job already in progress')
    }

    return await tx.systemJob.create({
      data: {
        type: 'MEDIA_DERIVED_TAG_SYNC',
        status: JobStatus.RUNNING,
        message: '初始化...',
        progress: 0
      }
    })
  })
}

/**
 * 尝试创建一个 WebP 动静态识别任务
 */
export async function createWebpAnimationScanJob() {
  return createMutexJob({
    type: 'WEBP_ANIMATION_SCAN',
    mutexJobTypes: MEDIA_MAINTENANCE_JOB_TYPES,
    runningOnlyMutexJobTypes: RUNNING_ONLY_MEDIA_MAINTENANCE_JOB_TYPES,
    advisoryLockId: MEDIA_MAINTENANCE_ADVISORY_LOCK_ID,
    message: '初始化...',
    conflictMessage: 'Media maintenance job already in progress'
  })
}

/**
 * 尝试创建一个视频媒体探测任务
 */
export async function createVideoMediaProbeJob() {
  return createMutexJob({
    type: 'VIDEO_MEDIA_PROBE',
    mutexJobTypes: MEDIA_MAINTENANCE_JOB_TYPES,
    runningOnlyMutexJobTypes: RUNNING_ONLY_MEDIA_MAINTENANCE_JOB_TYPES,
    advisoryLockId: MEDIA_MAINTENANCE_ADVISORY_LOCK_ID,
    message: '初始化...',
    conflictMessage: 'Media maintenance job already in progress'
  })
}

/**
 * 尝试创建一个视频章节截图生成任务
 */
export async function createVideoChapterPreviewGenerationJob() {
  return createMutexJob({
    type: VIDEO_CHAPTER_PREVIEW_GENERATION_JOB_TYPE,
    mutexJobTypes: MEDIA_MAINTENANCE_JOB_TYPES,
    runningOnlyMutexJobTypes: RUNNING_ONLY_MEDIA_MAINTENANCE_JOB_TYPES,
    advisoryLockId: MEDIA_MAINTENANCE_ADVISORY_LOCK_ID,
    message: '正在准备章节截图...',
    conflictMessage: 'Media maintenance job already in progress'
  })
}

export async function enqueueVideoStreamingOptimizationJob(input: { imageId: number; path: string }) {
  assertLegacyBackgroundExecutionAllowed(VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_PROCESSING_ADVISORY_LOCK_ID)

    const existingJob = await tx.systemJob.findFirst({
      where: {
        type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE,
        targetImageId: input.imageId,
        status: { in: VIDEO_STREAMING_OPTIMIZATION_ACTIVE_STATUSES }
      },
      orderBy: { createdAt: 'desc' }
    })

    if (existingJob) {
      let queuePosition: number | null = null
      if (existingJob.status === JobStatus.PENDING) {
        const pendingJobs = await tx.systemJob.findMany({
          where: { type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE, status: JobStatus.PENDING },
          select: { id: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        })
        const pendingIndex = pendingJobs.findIndex((job) => job.id === existingJob.id)
        queuePosition = pendingIndex >= 0 ? pendingIndex + 1 : null
      }
      return {
        job: existingJob,
        reused: true,
        queuePosition
      }
    }

    const activeCount = await tx.systemJob.count({
      where: {
        type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE,
        status: { in: VIDEO_STREAMING_OPTIMIZATION_ACTIVE_STATUSES }
      }
    })
    if (activeCount >= VIDEO_STREAMING_OPTIMIZATION_QUEUE_CAPACITY) {
      throw new Error(`Video optimization queue is full (${VIDEO_STREAMING_OPTIMIZATION_QUEUE_CAPACITY})`)
    }

    const pendingCount = await tx.systemJob.count({
      where: { type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE, status: JobStatus.PENDING }
    })
    const job = await tx.systemJob.create({
      data: {
        type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE,
        status: JobStatus.PENDING,
        message: '等待 MP4 无损播放优化...',
        progress: 0,
        targetImageId: input.imageId,
        targetPath: input.path,
        mode: 'REMUX_FASTSTART'
      }
    })

    return { job, reused: false, queuePosition: pendingCount + 1 }
  })
}

export async function claimNextVideoStreamingOptimizationJob() {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_PROCESSING_ADVISORY_LOCK_ID)

    const activeJob = await tx.systemJob.findFirst({
      where: {
        type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE,
        status: { in: [JobStatus.RUNNING, JobStatus.CANCELLING] }
      }
    })
    if (activeJob) return null

    const nextJob = await tx.systemJob.findFirst({
      where: { type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE, status: JobStatus.PENDING },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
    if (!nextJob) return null

    const now = new Date()
    return tx.systemJob.update({
      where: { id: nextJob.id },
      data: {
        status: JobStatus.RUNNING,
        message: '正在准备 MP4 无损播放优化...',
        progress: 1,
        startedAt: now,
        heartbeatAt: now,
        attempt: { increment: 1 },
        error: null,
        finishedAt: null
      }
    })
  })
}

export async function cancelVideoStreamingOptimizationJob(jobId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_PROCESSING_ADVISORY_LOCK_ID)
    const job = await tx.systemJob.findUnique({ where: { id: jobId } })
    if (!job || job.type !== VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE) return null

    if (job.status === JobStatus.PENDING) {
      return {
        changed: true,
        job: await tx.systemJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.CANCELLED,
            message: '排队任务已取消',
            finishedAt: new Date()
          }
        })
      }
    }

    if (job.status === JobStatus.RUNNING) {
      return {
        changed: true,
        job: await tx.systemJob.update({
          where: { id: job.id },
          data: { status: JobStatus.CANCELLING, message: '正在取消...', heartbeatAt: new Date() }
        })
      }
    }

    return { changed: false, job }
  })
}

export async function recoverStaleVideoStreamingOptimizationJobs(staleBefore: Date) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', VIDEO_PROCESSING_ADVISORY_LOCK_ID)
    const staleJobs = await tx.systemJob.findMany({
      where: {
        type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE,
        status: { in: [JobStatus.RUNNING, JobStatus.CANCELLING] },
        OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, updatedAt: { lt: staleBefore } }]
      }
    })
    if (staleJobs.length === 0) return []

    const finishedAt = new Date()
    await tx.systemJob.updateMany({
      where: { id: { in: staleJobs.map((job) => job.id) } },
      data: {
        status: JobStatus.FAILED,
        message: '服务中断，任务已停止',
        error: 'Video optimization was interrupted by a service restart',
        finishedAt
      }
    })

    return staleJobs
  })
}

/**
 * 尝试创建一个扫描历史保留策略清理任务
 */
export async function createScanRunRetentionCleanupJob() {
  return createMutexJob({
    type: SCAN_RUN_RETENTION_CLEANUP_JOB_TYPE,
    mutexJobTypes: AUDIT_MAINTENANCE_JOB_TYPES,
    advisoryLockId: AUDIT_MAINTENANCE_ADVISORY_LOCK_ID,
    message: '正在清理扫描历史...',
    conflictMessage: 'Audit maintenance job already in progress'
  })
}

/**
 * 尝试创建一个触发器日志保留策略清理任务
 */
export async function createTriggerLogRetentionCleanupJob() {
  return createMutexJob({
    type: TRIGGER_LOG_RETENTION_CLEANUP_JOB_TYPE,
    mutexJobTypes: AUDIT_MAINTENANCE_JOB_TYPES,
    advisoryLockId: AUDIT_MAINTENANCE_ADVISORY_LOCK_ID,
    message: '正在清理触发器日志...',
    conflictMessage: 'Audit maintenance job already in progress'
  })
}

/**
 * 获取当前活跃的元数据源补全任务
 */
export async function getActiveRefillMetaSourceJob() {
  return await prisma.systemJob.findFirst({
    where: {
      type: 'REFILL_META_SOURCE',
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
    },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * 获取最近一次媒体派生标签同步任务
 */
export async function getLatestMediaDerivedTagSyncJob() {
  return await prisma.systemJob.findFirst({
    where: {
      type: 'MEDIA_DERIVED_TAG_SYNC'
    },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * 获取最近一次 WebP 动静态识别任务
 */
export async function getLatestWebpAnimationScanJob() {
  return await prisma.systemJob.findFirst({
    where: {
      type: 'WEBP_ANIMATION_SCAN'
    },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * 获取最近一次视频媒体探测任务
 */
export async function getLatestVideoMediaProbeJob() {
  return await prisma.systemJob.findFirst({
    where: {
      type: 'VIDEO_MEDIA_PROBE'
    },
    orderBy: { createdAt: 'desc' }
  })
}

export async function getLatestVideoChapterPreviewGenerationJob() {
  return await prisma.systemJob.findFirst({
    where: { type: VIDEO_CHAPTER_PREVIEW_GENERATION_JOB_TYPE },
    orderBy: { createdAt: 'desc' }
  })
}

export async function getLatestVideoStreamingOptimizationJob() {
  return await prisma.systemJob.findFirst({
    where: { type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE },
    orderBy: { createdAt: 'desc' }
  })
}

export async function getLatestVideoStreamingOptimizationJobsByImageIds(imageIds: number[]) {
  if (imageIds.length === 0) return []

  const latestKeys = await prisma.systemJob.groupBy({
    by: ['targetImageId'],
    where: {
      type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE,
      targetImageId: { in: imageIds }
    },
    _max: { createdAt: true }
  })
  const latestTargets = latestKeys.flatMap((item) =>
    item.targetImageId !== null && item._max.createdAt
      ? [{ targetImageId: item.targetImageId, createdAt: item._max.createdAt }]
      : []
  )
  if (latestTargets.length === 0) return []

  const [jobs, pendingJobs] = await Promise.all([
    prisma.systemJob.findMany({
      where: {
        type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE,
        OR: latestTargets
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.systemJob.findMany({
      where: { type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE, status: JobStatus.PENDING },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
  ])
  const pendingPositions = new Map(pendingJobs.map((job, index) => [job.id, index + 1]))
  const latestByImageId = new Map<number, (typeof jobs)[number]>()

  for (const job of jobs) {
    if (job.targetImageId !== null && !latestByImageId.has(job.targetImageId)) {
      latestByImageId.set(job.targetImageId, job)
    }
  }

  return [...latestByImageId.values()].map((job) => ({
    ...job,
    queuePosition: pendingPositions.get(job.id) ?? null
  }))
}

export async function listVideoStreamingOptimizationQueue(recentLimit = 20) {
  const [activeJobs, recentJobs] = await Promise.all([
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
      take: recentLimit
    })
  ])
  const pendingIds = activeJobs.filter((job) => job.status === JobStatus.PENDING).map((job) => job.id)
  const pendingPositions = new Map(pendingIds.map((id, index) => [id, index + 1]))

  return {
    capacity: VIDEO_STREAMING_OPTIMIZATION_QUEUE_CAPACITY,
    active: activeJobs.map((job) => ({ ...job, queuePosition: pendingPositions.get(job.id) ?? null })),
    recent: recentJobs.map((job) => ({ ...job, queuePosition: null as number | null }))
  }
}

export async function deleteExpiredVideoStreamingOptimizationJobs(olderThan: Date) {
  return prisma.systemJob.deleteMany({
    where: {
      type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE,
      status: { in: VIDEO_STREAMING_OPTIMIZATION_TERMINAL_STATUSES },
      OR: [{ finishedAt: { lt: olderThan } }, { finishedAt: null, updatedAt: { lt: olderThan } }]
    }
  })
}

export async function hasPendingVideoStreamingOptimizationJobs() {
  return (
    (await prisma.systemJob.count({
      where: { type: VIDEO_STREAMING_OPTIMIZATION_JOB_TYPE, status: JobStatus.PENDING }
    })) > 0
  )
}

export async function touchJobHeartbeat(jobId: string, attempt?: number) {
  return prisma.systemJob.updateMany({
    where: {
      id: jobId,
      ...(attempt === undefined ? {} : { attempt }),
      status: { in: [JobStatus.RUNNING, JobStatus.CANCELLING] }
    },
    data: { heartbeatAt: new Date() }
  })
}

export async function hasPendingReplaceJobLease(jobId: string, attempt: number) {
  return (
    (await prisma.systemJob.count({
      where: {
        id: jobId,
        type: 'PENDING_REPLACE',
        attempt,
        status: { in: [JobStatus.RUNNING, JobStatus.CANCELLING] }
      }
    })) === 1
  )
}

export async function claimStalePendingReplaceJob(jobId: string, staleBefore: Date) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', MEDIA_SCAN_ADVISORY_LOCK_ID)
    const claimed = await tx.systemJob.updateMany({
      where: {
        id: jobId,
        type: 'PENDING_REPLACE',
        status: { in: [JobStatus.RUNNING, JobStatus.CANCELLING] },
        OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, updatedAt: { lt: staleBefore } }]
      },
      data: {
        status: JobStatus.CANCELLING,
        message: '正在回收服务中断的替换任务...',
        heartbeatAt: new Date(),
        attempt: { increment: 1 }
      }
    })
    if (claimed.count !== 1) return null
    return tx.systemJob.findUnique({ where: { id: jobId }, select: { id: true, attempt: true } })
  })
}

type PendingReplaceJobFinalization =
  | { status: 'COMPLETED'; result: unknown }
  | { status: 'FAILED'; error: string }
  | { status: 'CANCELLED' }

export async function finalizePendingReplaceJob(
  jobId: string,
  attempt: number,
  finalization: PendingReplaceJobFinalization,
  onFinalized?: (tx: PendingReplaceJobSetupClient) => Promise<void>
) {
  return prisma.$transaction(async (tx) => {
    const now = new Date()
    const data: Prisma.SystemJobUpdateManyMutationInput =
      finalization.status === 'COMPLETED'
        ? {
            status: JobStatus.COMPLETED,
            progress: 100,
            message: '完成',
            result: finalization.result as Prisma.InputJsonValue,
            heartbeatAt: now,
            finishedAt: now
          }
        : finalization.status === 'FAILED'
          ? {
              status: JobStatus.FAILED,
              error: finalization.error,
              heartbeatAt: now,
              finishedAt: now
            }
          : {
              status: JobStatus.CANCELLED,
              message: '已取消',
              heartbeatAt: now,
              finishedAt: now
            }
    const finalized = await tx.systemJob.updateMany({
      where: {
        id: jobId,
        type: 'PENDING_REPLACE',
        attempt,
        status: { in: [JobStatus.RUNNING, JobStatus.CANCELLING] }
      },
      data
    })
    if (finalized.count !== 1) return false
    if (onFinalized) await onFinalized(tx as unknown as PendingReplaceJobSetupClient)
    return true
  })
}

export async function getActiveJobByType(type: string) {
  return await prisma.systemJob.findFirst({
    where: {
      type,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.PAUSED, JobStatus.CANCELLING] }
    },
    orderBy: { createdAt: 'desc' }
  })
}

export async function getActiveJobsByTypes(types: string[]) {
  if (types.length === 0) return []

  return await prisma.systemJob.findMany({
    where: {
      type: { in: types },
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.PAUSED, JobStatus.CANCELLING] }
    },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * 获取任务详情
 */
export async function getJob(jobId: string) {
  return await prisma.systemJob.findUnique({
    where: { id: jobId }
  })
}

/**
 * 更新进度
 * 会检查任务是否已被标记为取消
 */
export async function updateProgress(jobId: string, progress: number, message: string) {
  // 检查是否被标记为取消
  const current = await prisma.systemJob.findUnique({
    where: { id: jobId },
    select: { status: true }
  })

  // 如果任务不存在或已被取消/完成/失败，则停止更新
  if (!current) {
    throw new Error('Job not found')
  }

  if (current.status === JobStatus.CANCELLING) {
    // 如果正在取消中，不再更新进度，但也不抛出错误，以免干扰主流程
    return
  }

  if (current.status === JobStatus.PAUSED) {
    return
  }

  // 如果任务已经结束，也不再更新
  if ([JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED].includes(current.status as any)) {
    return
  }

  await prisma.systemJob.update({
    where: { id: jobId },
    data: { progress, message, heartbeatAt: new Date() }
  })
}

/**
 * 完成任务
 */
export async function completeJob(jobId: string, result: any) {
  await prisma.systemJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      progress: 100,
      message: '完成',
      result: result as Prisma.InputJsonValue,
      heartbeatAt: new Date(),
      finishedAt: new Date()
    }
  })
}

/**
 * 标记失败
 */
export async function failJob(jobId: string, error: string) {
  await prisma.systemJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      error,
      heartbeatAt: new Date(),
      finishedAt: new Date()
    }
  })
}

/**
 * 标记已取消（最终状态）
 */
export async function markAsCancelled(jobId: string) {
  await prisma.systemJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.CANCELLED,
      message: '已取消',
      heartbeatAt: new Date(),
      finishedAt: new Date()
    }
  })
}

/**
 * 请求取消（中间状态）
 * 用户点击取消时调用此方法
 */
export async function cancelJob(jobId: string) {
  // 只有在运行中或挂起状态才能取消
  const current = await prisma.systemJob.findUnique({
    where: { id: jobId },
    select: { status: true }
  })

  if (current && [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.PAUSED].includes(current.status as any)) {
    await prisma.systemJob.update({
      where: { id: jobId },
      data: { status: JobStatus.CANCELLING, message: '正在取消...' }
    })
  }
}

export async function pauseJob(jobId: string) {
  const current = await prisma.systemJob.findUnique({
    where: { id: jobId },
    select: { status: true }
  })

  if (current && [JobStatus.RUNNING, JobStatus.PENDING].includes(current.status as any)) {
    await prisma.systemJob.update({
      where: { id: jobId },
      data: { status: JobStatus.PAUSED, message: '已暂停' }
    })
  }
}

export async function resumeJob(jobId: string) {
  const current = await prisma.systemJob.findUnique({
    where: { id: jobId },
    select: { status: true }
  })

  if (current && current.status === JobStatus.PAUSED) {
    await prisma.systemJob.update({
      where: { id: jobId },
      data: { status: JobStatus.RUNNING, message: '继续执行' }
    })
  }
}
