import { Prisma } from '@pixishelf/db'
import {
  DISCOVERY_BATCH_JOB_TYPE,
  parseDiscoveryBatchCheckpoint,
  TERMINAL_JOB_STATUSES
} from '@pixishelf/job-contracts'

const clearLease = { workerId: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null }

/** Lock parent before child, matching the fenced coordinator's lock order. */
export async function controlDiscoveryBatch(
  tx: Prisma.TransactionClient,
  jobId: string,
  command: 'PAUSE' | 'RESUME' | 'CANCEL',
  now = new Date(),
  knownTarget?: { id: string; type: string; parentJobId: string | null }
) {
  const target =
    knownTarget ??
    (await tx.systemJob.findUnique({ where: { id: jobId }, select: { id: true, type: true, parentJobId: true } }))
  if (!target) return null
  const parentId = target.type === DISCOVERY_BATCH_JOB_TYPE ? target.id : target.parentJobId
  if (!parentId) return null
  const parent = await tx.systemJob.findUnique({ where: { id: parentId }, select: { type: true } })
  if (parent?.type !== DISCOVERY_BATCH_JOB_TYPE) return null
  await tx.$queryRaw(Prisma.sql`SELECT id FROM system_jobs WHERE id = ${parentId} FOR UPDATE`)
  const job = await tx.systemJob.findUniqueOrThrow({ where: { id: parentId } })
  const terminal = TERMINAL_JOB_STATUSES.has(job.status)
  if (terminal && command !== 'CANCEL') return parentId
  const checkpoint = parseDiscoveryBatchCheckpoint(job.result)
  if (checkpoint.control === 'CANCEL' && !terminal) return parentId
  if (checkpoint.childJobId) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM system_jobs WHERE id = ${checkpoint.childJobId} FOR UPDATE`)
  }
  const child = checkpoint.childJobId ? await tx.systemJob.findUnique({ where: { id: checkpoint.childJobId } }) : null
  const childExecuting = child && ['RUNNING', 'PAUSING', 'CANCELLING'].includes(child.status)
  if (command === 'RESUME' && childExecuting && checkpoint.control === 'PAUSE') {
    throw new Error('当前轮次尚未结束，请等待暂停完成')
  }
  checkpoint.control = command === 'RESUME' ? 'RUN' : command
  if (child && !TERMINAL_JOB_STATUSES.has(child.status)) {
    let status: 'PAUSED' | 'PENDING' | 'CANCELLED' | 'CANCELLING' | undefined
    if (command === 'PAUSE' && !childExecuting) status = 'PAUSED'
    if (command === 'RESUME' && child.status === 'PAUSED') status = 'PENDING'
    if (command === 'CANCEL') status = childExecuting ? 'CANCELLING' : 'CANCELLED'
    if (status) {
      await tx.systemJob.update({
        where: { id: child.id },
        data: {
          status,
          ...(childExecuting ? {} : clearLease),
          ...(status === 'PENDING'
            ? { availableAt: now, pauseRequestedAt: null, maxAttempts: Math.max(child.maxAttempts, child.attempt + 1) }
            : {}),
          ...(status === 'PAUSED' ? { pauseRequestedAt: now } : {}),
          ...(command === 'CANCEL' ? { cancelRequestedAt: now, finishedAt: status === 'CANCELLED' ? now : null } : {})
        }
      })
      if (!childExecuting)
        await tx.archiveUploaderScanRun.updateMany({
          where: { systemJobId: child.id },
          data: {
            status: status as 'PENDING' | 'PAUSED' | 'CANCELLED',
            finishedAt: status === 'CANCELLED' ? now : null
          }
        })
      await tx.systemJobEvent.create({
        data: {
          jobId: child.id,
          type: command === 'CANCEL' ? 'job.cancel_requested' : command === 'PAUSE' ? 'job.paused' : 'job.queued',
          attempt: child.attempt,
          message: '批次控制已应用到当前扫描'
        }
      })
    }
  }
  if (terminal) return parentId
  // A running parent holds the same row lock until its fenced transaction commits.
  // If it has not entered that transaction yet, its control flag is read on entry.
  const executing = ['RUNNING', 'PAUSING', 'CANCELLING'].includes(job.status)
  await tx.systemJob.update({
    where: { id: job.id },
    data: {
      result: checkpoint,
      ...(command === 'RESUME' ? { maxAttempts: Math.max(job.maxAttempts, job.attempt + 1) } : {}),
      ...(executing ? {} : { ...clearLease, status: command === 'PAUSE' ? 'PAUSED' : 'PENDING', availableAt: now }),
      pauseRequestedAt: command === 'PAUSE' ? now : null,
      message:
        command === 'PAUSE' ? '正在暂停：等待当前轮次结束' : command === 'CANCEL' ? '正在取消批次' : '批次继续执行'
    }
  })
  await tx.systemJobEvent.create({
    data: {
      jobId: job.id,
      type: command === 'PAUSE' ? 'job.pause_requested' : command === 'CANCEL' ? 'job.cancel_requested' : 'job.queued',
      attempt: job.attempt,
      message: command === 'PAUSE' ? '批次已请求在轮次边界暂停' : command === 'CANCEL' ? '批次已请求取消' : '批次已继续'
    }
  })
  return parentId
}
