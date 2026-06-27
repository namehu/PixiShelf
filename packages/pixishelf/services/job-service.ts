import { prisma } from '@/lib/prisma'
import { JobStatus, Prisma } from '@prisma/client'

const MEDIA_SCAN_JOB_TYPES = ['SCAN', 'LOCAL_DIRECTORY_IMPORT']
const MEDIA_SCAN_ADVISORY_LOCK_ID = 728341
const SCAN_RUN_RETENTION_CLEANUP_JOB_TYPE = 'SCAN_RUN_RETENTION_CLEANUP'

async function createMediaScanJob(type: 'SCAN' | 'LOCAL_DIRECTORY_IMPORT', message: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', MEDIA_SCAN_ADVISORY_LOCK_ID)

    const activeJob = await tx.systemJob.findFirst({
      where: {
        type: { in: MEDIA_SCAN_JOB_TYPES },
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
      }
    })

    if (activeJob) {
      throw new Error('Media scan job already in progress')
    }

    return tx.systemJob.create({
      data: {
        type,
        status: JobStatus.RUNNING,
        message,
        progress: 0
      }
    })
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

/**
 * 尝试创建一个迁移任务
 */
export async function createMigrationJob() {
  return await prisma.$transaction(async (tx) => {
    // 检查是否有正在运行或正在取消的迁移任务
    const activeJob = await tx.systemJob.findFirst({
      where: {
        type: 'MIGRATION',
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.PAUSED, JobStatus.CANCELLING] }
      }
    })

    if (activeJob) {
      throw new Error('Migration already in progress')
    }

    return await tx.systemJob.create({
      data: {
        type: 'MIGRATION',
        status: JobStatus.RUNNING,
        message: '初始化迁移...',
        progress: 0
      }
    })
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
  return await prisma.$transaction(async (tx) => {
    const activeJob = await tx.systemJob.findFirst({
      where: {
        type: 'WEBP_ANIMATION_SCAN',
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
      }
    })

    if (activeJob) {
      throw new Error('WebP animation scan job already in progress')
    }

    return await tx.systemJob.create({
      data: {
        type: 'WEBP_ANIMATION_SCAN',
        status: JobStatus.RUNNING,
        message: '初始化...',
        progress: 0
      }
    })
  })
}

/**
 * 尝试创建一个视频媒体探测任务
 */
export async function createVideoMediaProbeJob() {
  return await prisma.$transaction(async (tx) => {
    const activeJob = await tx.systemJob.findFirst({
      where: {
        type: 'VIDEO_MEDIA_PROBE',
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
      }
    })

    if (activeJob) {
      throw new Error('Video media probe job already in progress')
    }

    return await tx.systemJob.create({
      data: {
        type: 'VIDEO_MEDIA_PROBE',
        status: JobStatus.RUNNING,
        message: '初始化...',
        progress: 0
      }
    })
  })
}

/**
 * 尝试创建一个扫描历史保留策略清理任务
 */
export async function createScanRunRetentionCleanupJob() {
  return await prisma.$transaction(async (tx) => {
    const activeJob = await tx.systemJob.findFirst({
      where: {
        type: SCAN_RUN_RETENTION_CLEANUP_JOB_TYPE,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
      }
    })

    if (activeJob) {
      throw new Error('Scan run retention cleanup job is already running')
    }

    return await tx.systemJob.create({
      data: {
        type: SCAN_RUN_RETENTION_CLEANUP_JOB_TYPE,
        status: JobStatus.RUNNING,
        message: '正在清理扫描历史...',
        progress: 0
      }
    })
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
    data: { progress, message }
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
      result: result as Prisma.InputJsonValue
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
      error
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
      message: '已取消'
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
