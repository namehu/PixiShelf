import { prisma } from '@/lib/prisma'
import { JobStatus, Prisma } from '@prisma/client'

/**
 * 尝试创建一个扫描任务（分布式锁）
 * 确保同一时间只有一个活跃的扫描任务
 */
export async function createScanJob() {
  return await prisma.$transaction(async (tx) => {
    // 检查是否有正在运行或正在取消的任务
    const activeJob = await tx.systemJob.findFirst({
      where: {
        type: 'SCAN',
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
      }
    })

    if (activeJob) {
      throw new Error('Scan already in progress')
    }

    return await tx.systemJob.create({
      data: {
        type: 'SCAN',
        status: JobStatus.RUNNING,
        message: '初始化...',
        progress: 0
      }
    })
  })
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
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
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
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING] }
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
    throw new Error('Scan cancelled')
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

  if (current && [JobStatus.PENDING, JobStatus.RUNNING].includes(current.status as any)) {
    await prisma.systemJob.update({
      where: { id: jobId },
      data: { status: JobStatus.CANCELLING, message: '正在取消...' }
    })
  }
}
