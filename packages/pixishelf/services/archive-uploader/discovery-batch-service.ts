import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma, type PrismaClient } from '@pixishelf/db'
import {
  ACTIVE_JOB_STATUSES,
  DISCOVERY_BATCH_JOB_TYPE,
  discoveryBatchPayloadSchema,
  initialDiscoveryBatchCheckpoint,
  parseDiscoveryBatchCheckpoint
} from '@pixishelf/job-contracts'
import { controlDiscoveryBatch } from '@pixishelf/job-executors'
import { prisma } from '@/lib/prisma'
import { ArchiveError } from '@/services/archive/errors'
import { redactSensitiveText } from '@/services/background-task/job-serialization'

const database = () => prisma as unknown as PrismaClient
const sourceIds = z
  .array(z.string().min(1).max(128))
  .min(1)
  .transform((ids) => [...new Set(ids)])
export const startDiscoveryBatchSchema = z.object({ sourceIds, requestId: z.string().uuid() }).strict()
export const discoveryBatchIdSchema = z.object({ batchId: z.string().min(1).max(128) }).strict()
export const controlDiscoveryBatchSchema = discoveryBatchIdSchema
  .extend({ command: z.enum(['PAUSE', 'RESUME', 'CANCEL']) })
  .strict()
export const retryDiscoveryBatchSchema = discoveryBatchIdSchema.extend({ requestId: z.string().uuid() }).strict()

export async function startDiscoveryBatch(
  input: z.input<typeof startDiscoveryBatchSchema>,
  userId: string,
  db = database()
) {
  const parsed = startDiscoveryBatchSchema.parse(input)
  return db.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(80432028::integer, hashtext('ARCHIVE_DISCOVERY_BATCH_SCAN'))::text`
    )
    const idempotencyKey = `discovery-batch-request:${parsed.requestId}`
    const existing = await tx.systemJob.findUnique({ where: { idempotencyKey } })
    if (existing) {
      const payload = discoveryBatchPayloadSchema.parse(existing.payload)
      if (
        existing.requestedByUserId !== userId ||
        JSON.stringify(payload.sources.map(({ id }) => id)) !== JSON.stringify(parsed.sourceIds)
      ) {
        throw new ArchiveError('STATE_CONFLICT', '请求标识已用于另一批扫描')
      }
      return { batchId: existing.id }
    }
    const active = await tx.systemJob.findFirst({
      where: { type: DISCOVERY_BATCH_JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } }
    })
    if (active) throw new ArchiveError('STATE_CONFLICT', '已有未结束的批量扫描，请先继续或取消该批次')
    // A coordinator that exhausted infrastructure retries must not strand its source lock.
    const orphaned = await tx.systemJob.findMany({
      where: {
        type: DISCOVERY_BATCH_JOB_TYPE,
        status: { in: ['FAILED', 'CANCELLED', 'COMPLETED', 'SKIPPED'] },
        childJobs: { some: { status: { in: [...ACTIVE_JOB_STATUSES] } } }
      },
      select: { id: true }
    })
    for (const orphan of orphaned) await controlDiscoveryBatch(tx, orphan.id, 'CANCEL')
    const records = await tx.archiveUploaderSource.findMany({
      where: { id: { in: parsed.sourceIds } },
      select: {
        id: true,
        displayName: true,
        status: true,
        runs: {
          where: { status: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'] } },
          take: 1,
          select: { id: true }
        }
      }
    })
    const recordsById = new Map(records.map((source) => [source.id, source]))
    const job = await tx.systemJob.create({
      data: {
        id: randomUUID(),
        type: DISCOVERY_BATCH_JOB_TYPE,
        executionLane: 'ARCHIVE_RESOLVE',
        definitionVersion: 1,
        status: 'PENDING',
        triggerSource: 'MANUAL',
        requestedByUserId: userId,
        idempotencyKey,
        payload: {
          sources: parsed.sourceIds.map((id) => {
            const source = recordsById.get(id)
            const skipReason = !source
              ? '来源已删除'
              : source.status !== 'ACTIVE'
                ? '来源已停用'
                : source.runs.length
                  ? '提交时该来源已有活动扫描'
                  : null
            return { id, name: source?.displayName ?? '已删除来源', ...(skipReason ? { skipReason } : {}) }
          })
        },
        result: initialDiscoveryBatchCheckpoint(),
        queuePriority: 20,
        effectivePriority: 20,
        maxAttempts: 3,
        message: '等待批量扫描最新及未完成历史'
      }
    })
    await tx.systemJobEvent.create({ data: { jobId: job.id, type: 'job.queued', message: '批量发现来源扫描已创建' } })
    return { batchId: job.id }
  })
}

export async function getDiscoveryBatch(batchId?: string, db = database()) {
  const job = batchId
    ? await db.systemJob.findFirst({ where: { id: batchId, type: DISCOVERY_BATCH_JOB_TYPE } })
    : ((await db.systemJob.findFirst({
        where: { type: DISCOVERY_BATCH_JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      })) ??
      (await db.systemJob.findFirst({
        where: { type: DISCOVERY_BATCH_JOB_TYPE },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      })))
  if (!job) return null
  const payload = discoveryBatchPayloadSchema.parse(job.payload)
  const state = parseDiscoveryBatchCheckpoint(job.result)
  const child = state.childJobId
    ? await db.systemJob.findUnique({
        where: { id: state.childJobId },
        select: { status: true, archiveUploaderScanRun: { select: { checkedCount: true } } }
      })
    : null
  const active = ACTIVE_JOB_STATUSES.has(job.status)
  const status = !active
    ? job.status
    : state.control === 'CANCEL'
      ? 'CANCELLING'
      : state.control === 'PAUSE'
        ? child && ['RUNNING', 'PAUSING', 'CANCELLING'].includes(child.status)
          ? 'PAUSING'
          : 'PAUSED'
        : child?.status === 'RUNNING'
          ? 'RUNNING'
          : job.status
  return {
    id: job.id,
    status,
    active,
    total: payload.sources.length,
    processed: state.index,
    sources: payload.sources.map((source) => ({ ...source, name: redactSensitiveText(source.name) ?? '' })),
    phase: state.phase,
    round: state.round,
    checkedCount: child?.archiveUploaderScanRun?.checkedCount ?? 0,
    currentSourceId: payload.sources[state.index]?.id ?? null,
    results: state.results.map((result) => ({ ...result, message: redactSensitiveText(result.message) ?? '' })),
    error: job.status === 'FAILED' ? redactSensitiveText(job.error) : null
  }
}

export async function commandDiscoveryBatch(input: z.input<typeof controlDiscoveryBatchSchema>, db = database()) {
  const parsed = controlDiscoveryBatchSchema.parse(input)
  return db.$transaction(async (tx) => {
    const id = await controlDiscoveryBatch(tx, parsed.batchId, parsed.command)
    if (!id) throw new ArchiveError('STATE_CONFLICT', '批次不存在')
    return { batchId: id }
  })
}

export async function retryDiscoveryBatch(
  input: z.input<typeof retryDiscoveryBatchSchema>,
  userId: string,
  db = database()
) {
  const parsed = retryDiscoveryBatchSchema.parse(input)
  const previous = await getDiscoveryBatch(parsed.batchId, db)
  if (!previous || previous.active) throw new ArchiveError('STATE_CONFLICT', '请等待批次结束后重试')
  const failed = previous.results.filter(({ status }) => status === 'FAILED').map(({ sourceId }) => sourceId)
  // An infrastructure failure may leave the current and remaining sources unfinished.
  if (previous.status === 'FAILED') failed.push(...previous.sources.slice(previous.processed).map(({ id }) => id))
  if (!failed.length) throw new ArchiveError('STATE_CONFLICT', '没有失败来源可重试')
  return startDiscoveryBatch({ sourceIds: failed, requestId: parsed.requestId }, userId, db)
}
