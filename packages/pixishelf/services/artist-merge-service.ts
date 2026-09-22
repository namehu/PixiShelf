import 'server-only'
import { PrismaClient, artistMergeBlockers, captureArtistMerge, lockCreatorCatalog, mergeJson } from '@pixishelf/db'
import { workerCapabilitySchema } from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import { enqueueSingletonManualJobWithResult, isCentralDispatcherCutoverEnabled } from '@/services/background-task'
import { WORKER_HEARTBEAT_STALE_AFTER_MS } from '@/services/background-task/worker-heartbeat'

const database = prisma as unknown as PrismaClient
type MergeSummary = Awaited<ReturnType<typeof captureArtistMerge>>['summary']

async function assertReady() {
  if (!isCentralDispatcherCutoverEnabled()) throw new Error('中央 Worker 调度尚未启用')
  const workers = await database.workerInstance.findMany({
    where: { status: 'READY', heartbeatAt: { gte: new Date(Date.now() - WORKER_HEARTBEAT_STALE_AFTER_MS) } },
    select: { capabilities: true }
  })
  if (
    !workers.some(
      (worker) =>
        Array.isArray(worker.capabilities) &&
        worker.capabilities.some((entry) => {
          const parsed = workerCapabilitySchema.safeParse(entry)
          return (
            parsed.success &&
            parsed.data.jobType === 'ARTIST_MERGE' &&
            parsed.data.executionLane === 'BACKGROUND_WRITER' &&
            parsed.data.definitionVersions.includes(1)
          )
        })
    )
  ) {
    throw new Error('请先启动支持艺术家合并的 READY Worker')
  }
}

export async function previewArtistMerge(requestedBy: string, sourceArtistId: number, targetArtistId: number) {
  return database.$transaction(
    async (tx) => {
      await lockCreatorCatalog(tx)
      const current = await captureArtistMerge(tx, sourceArtistId, targetArtistId)
      const blockers = await artistMergeBlockers(tx, [sourceArtistId, targetArtistId])
      const plan = await tx.artistMerge.create({
        data: {
          requestedBy,
          sourceArtistId,
          targetArtistId,
          fingerprint: current.fingerprint,
          summary: mergeJson(current.summary),
          before: mergeJson(current.before)
        }
      })
      return { previewId: plan.id, fingerprint: plan.fingerprint, summary: current.summary, blockers }
    },
    { timeout: 30000 }
  )
}

export async function submitArtistMerge(requestedByUserId: string, previewId: string, fingerprint: string) {
  const existing = await database.artistMerge.findUniqueOrThrow({ where: { id: previewId } })
  if (existing.fingerprint !== fingerprint) throw new Error('预览不匹配，请重新预览')
  if (existing.systemJobId) return { mergeId: existing.id, jobId: existing.systemJobId }
  await assertReady()
  const queued = await enqueueSingletonManualJobWithResult(
    {
      type: 'ARTIST_MERGE',
      requestedByUserId,
      triggerSource: 'MANUAL',
      priority: 99,
      maxAttempts: 3,
      payload: { mergeId: previewId }
    },
    {
      client: database,
      afterEnqueue: async ({ transaction: tx, job, reused }) => {
        await lockCreatorCatalog(tx)
        const plan = await tx.artistMerge.findUniqueOrThrow({ where: { id: previewId } })
        if (reused && plan.systemJobId === job.id) return
        if (plan.status !== 'READY' || plan.fingerprint !== fingerprint) throw new Error('预览已执行或发生变化，请刷新')
        const current = await captureArtistMerge(tx, plan.sourceArtistId, plan.targetArtistId)
        if (current.fingerprint !== fingerprint) throw new Error('艺术家资料或绑定已变化，请重新预览')
        if (current.summary.conflicts.length) throw new Error(current.summary.conflicts.join('；'))
        if ((await artistMergeBlockers(tx, [plan.sourceArtistId, plan.targetArtistId], job.id)).length) {
          throw new Error('存在相关未结束任务，请重新预览并处理阻塞项')
        }
        await tx.artistMerge.update({
          where: { id: plan.id },
          data: { requestedBy: requestedByUserId, status: 'QUEUED', systemJobId: job.id }
        })
      }
    }
  ).catch(async (error: unknown) => {
    // A concurrent identical request may have finished while this caller waited
    // for the singleton lock. Its durable receipt still makes this submission idempotent.
    const committed = await database.artistMerge.findUnique({ where: { id: previewId } })
    if (committed?.systemJobId && committed.fingerprint === fingerprint) {
      return { job: { id: committed.systemJobId } }
    }
    throw error
  })
  return { mergeId: previewId, jobId: queued.job.id }
}

export async function getArtistMerge(mergeId: string) {
  const plan = await database.artistMerge.findUniqueOrThrow({
    where: { id: mergeId },
    select: { id: true, status: true, summary: true, systemJobId: true, completedAt: true }
  })
  const job = plan.systemJobId
    ? await database.systemJob.findUnique({
        where: { id: plan.systemJobId },
        select: { id: true, status: true, message: true, error: true }
      })
    : null
  return { ...plan, summary: plan.summary as unknown as MergeSummary, job }
}

export async function listArtistMerges() {
  const plans = await database.artistMerge.findMany({
    where: { systemJobId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, summary: true, status: true, createdAt: true }
  })
  return plans.map((plan) => ({ ...plan, summary: plan.summary as unknown as MergeSummary }))
}
