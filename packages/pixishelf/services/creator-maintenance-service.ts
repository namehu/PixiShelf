import 'server-only'
import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient, creatorFingerprint } from '@pixishelf/db'
import {
  creatorMaintenanceInputSchema,
  workerCapabilitySchema,
  type CreatorMaintenanceInput
} from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import { creatorReviewSummary } from '@/lib/creator-review-summary'
import { enqueueSingletonManualJobWithResult, isCentralDispatcherCutoverEnabled } from '@/services/background-task'
import { WORKER_HEARTBEAT_STALE_AFTER_MS } from '@/services/background-task/worker-heartbeat'

const database = prisma as unknown as PrismaClient
async function assertReady() {
  if (!isCentralDispatcherCutoverEnabled()) throw new Error('中央 Worker 调度尚未启用')
  const workers = await database.workerInstance.findMany({
    where: { status: 'READY', heartbeatAt: { gte: new Date(Date.now() - WORKER_HEARTBEAT_STALE_AFTER_MS) } },
    select: { capabilities: true }
  })
  const ready = workers.some(
    (worker) =>
      Array.isArray(worker.capabilities) &&
      worker.capabilities.some((entry) => {
        const parsed = workerCapabilitySchema.safeParse(entry)
        return (
          parsed.success &&
          parsed.data.jobType === 'CREATOR_MAINTENANCE' &&
          parsed.data.executionLane === 'BACKGROUND_WRITER' &&
          parsed.data.definitionVersions.includes(1)
        )
      })
  )
  if (!ready) throw new Error('请先启动支持创作者整理的 READY Worker')
}

export async function prepareCreatorMaintenance(requestedByUserId: string, value: CreatorMaintenanceInput) {
  const input = creatorMaintenanceInputSchema.parse(value)
  await assertReady()
  const planId = randomUUID()
  const queued = await enqueueSingletonManualJobWithResult(
    {
      type: 'CREATOR_MAINTENANCE',
      triggerSource: 'MANUAL',
      requestedByUserId,
      priority: 99,
      maxAttempts: 3,
      payload: { planId, phase: 'PREVIEW' }
    },
    {
      client: database,
      afterEnqueue: async ({ transaction, job, reused }) => {
        if (reused) return
        const maximum = await transaction.artwork.aggregate({ _max: { id: true } })
        await transaction.creatorMaintenancePlan.create({
          data: {
            id: planId,
            requestedBy: requestedByUserId,
            command: input.command,
            input: input as Prisma.InputJsonValue,
            fingerprint: creatorFingerprint(input),
            maximumArtworkId: maximum._max.id ?? 0,
            systemJobId: job.id
          }
        })
      }
    }
  )
  return { planId, jobId: queued.job.id }
}

export async function startCreatorMaintenance(requestedByUserId: string, planId: string, fingerprint: string) {
  await assertReady()
  const queued = await enqueueSingletonManualJobWithResult(
    {
      type: 'CREATOR_MAINTENANCE',
      triggerSource: 'MANUAL',
      requestedByUserId,
      priority: 99,
      maxAttempts: 3,
      payload: { planId, phase: 'APPLY' }
    },
    {
      client: database,
      afterEnqueue: async ({ transaction, job, reused }) => {
        if (reused) return
        const plan = await transaction.creatorMaintenancePlan.findUniqueOrThrow({ where: { id: planId } })
        if (plan.status !== 'READY' || plan.fingerprint !== fingerprint) throw new Error('预览尚未就绪或已执行，请刷新')
        await transaction.creatorMaintenancePlan.update({
          where: { id: planId },
          data: { status: 'APPLYING', systemJobId: job.id }
        })
      }
    }
  )
  return { planId, jobId: queued.job.id }
}

export async function getCreatorMaintenance(planId: string, afterId = 0) {
  const plan = await database.creatorMaintenancePlan.findUniqueOrThrow({ where: { id: planId } })
  const [job, counts, items] = await Promise.all([
    database.systemJob.findFirst({
      where: { type: 'CREATOR_MAINTENANCE', payload: { path: ['planId'], equals: planId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, progress: true, message: true, error: true }
    }),
    database.creatorMaintenanceItem.groupBy({ by: ['status'], where: { planId }, _count: true }),
    database.creatorMaintenanceItem.findMany({
      where: { planId, id: { gt: afterId } },
      orderBy: { id: 'asc' },
      take: 51
    })
  ])
  return {
    plan: { id: plan.id, command: plan.command, status: plan.status, fingerprint: plan.fingerprint },
    job,
    counts,
    items: items.slice(0, 50).map((item) => {
      const payload =
        item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload) ? item.payload : {}
      const result = item.result && typeof item.result === 'object' && !Array.isArray(item.result) ? item.result : {}
      return {
        id: item.id,
        artworkId: item.artworkId,
        status: item.status,
        review: creatorReviewSummary(plan.command, item.payload),
        payload: {
          title: typeof payload.title === 'string' ? payload.title : null,
          sourceName: typeof payload.sourceName === 'string' ? payload.sourceName : null,
          targetName: typeof payload.targetName === 'string' ? payload.targetName : null,
          affected: typeof payload.affected === 'number' ? payload.affected : undefined,
          mappingId: typeof payload.mappingId === 'string' ? payload.mappingId : null,
          description: typeof payload.description === 'string' ? payload.description : ''
        },
        result: {
          reason: typeof result.reason === 'string' ? result.reason : '',
          previousArtistId: typeof result.previousArtistId === 'number' ? result.previousArtistId : undefined
        }
      }
    }),
    nextCursor: items.length > 50 ? items[49]!.id : null
  }
}

export async function listCreatorMaintenance() {
  return database.creatorMaintenancePlan.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, command: true, status: true, createdAt: true }
  })
}

export async function getCreatorMapping(id: string) {
  return database.artistSourceTagMapping.findUniqueOrThrow({ where: { id } })
}

export async function listCreatorMappings(search: string, afterId?: string) {
  const mappings = await database.artistSourceTagMapping.findMany({
    where: {
      ...(search
        ? {
            OR: [
              { sourceName: { contains: search, mode: 'insensitive' } },
              { artist: { name: { contains: search, mode: 'insensitive' } } }
            ]
          }
        : {})
    },
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
    orderBy: { id: 'asc' },
    take: 51,
    include: { artist: true, _count: { select: { evidence: true } } }
  })
  return { items: mappings.slice(0, 50), nextCursor: mappings.length > 50 ? mappings[49]!.id : null }
}
