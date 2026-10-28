import { randomUUID } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import {
  Prisma,
  ArtworkDedupConflictError,
  artworkDedupActiveStatuses,
  freezeArtworkDedupRun,
  lockArtworkDedupRun,
  resetArtworkDedupVisualWork
} from '@pixishelf/db'
import {
  artworkDedupRunDtoSchema,
  ARTWORK_DEDUP_SCAN_DEFINITION_VERSION,
  type ArtworkDedupControlAction,
  type ArtworkDedupRunDto
} from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import { writeJobEvent } from './background-task/job-event-service'
import { WORKER_HEARTBEAT_STALE_AFTER_MS } from './background-task/worker-heartbeat'

interface Database {
  $transaction<T>(body: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>
}
type Run = Prisma.ArtworkDedupRunGetPayload<Record<string, never>>
export function assertArtworkDedupAccount(userId: string, expectedUserId: string) {
  if (userId !== expectedUserId) throw new TRPCError({ code: 'FORBIDDEN', message: '账户已变化，请刷新后重试' })
}
function conflict(message = '检查状态已变化，请刷新后重试'): never {
  throw new TRPCError({ code: 'CONFLICT', message })
}
async function mapped<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ArtworkDedupConflictError) {
      throw new TRPCError({
        code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'CONFLICT',
        message: error.code === 'NOT_FOUND' ? '未找到艺术家或检查记录' : '已有活动检查或请求状态已变化'
      })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') conflict()
    throw error
  }
}
function controls(run: Run): ArtworkDedupControlAction[] {
  if (run.readerState === 'BLOCKED') return []
  switch (run.status) {
    case 'PENDING':
    case 'RETRY_WAIT':
    case 'RUNNING':
      return ['pause', 'cancel']
    case 'PAUSING':
      return ['cancel']
    case 'PAUSED':
      return run.readerToken ? [] : ['resume', 'cancel']
    case 'FAILED':
    case 'CANCELLED':
      return run.readerToken ? [] : ['retry']
    default:
      return []
  }
}
async function dto(tx: Prisma.TransactionClient, run: Run): Promise<ArtworkDedupRunDto> {
  const artist = await tx.artist.findUnique({ where: { id: run.artistId }, select: { name: true } })
  const lastCompleted =
    run.status === 'COMPLETED'
      ? null
      : await tx.artworkDedupRun.findFirst({
          where: { artistId: run.artistId, status: 'COMPLETED' },
          orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
          select: { id: true, version: true, finishedAt: true, groupCount: true }
        })
  const job = run.jobId
    ? await tx.systemJob.findUnique({ where: { id: run.jobId }, select: { definitionVersion: true } })
    : null
  return artworkDedupRunDtoSchema.parse({
    includesContainment: (job?.definitionVersion ?? 1) >= 2,
    includesPartial: (job?.definitionVersion ?? 1) >= 4,
    visualStatus: run.visualStatus,
    pauseReason: run.status === 'PAUSED' && run.visualBudgetWaiting ? 'VISUAL_COMPARISON_BUDGET' : null,
    visualIncompleteReasons: run.visualIncompleteReasons,
    lastCompletedRun: lastCompleted
      ? {
          runId: lastCompleted.id,
          version: lastCompleted.version,
          finishedAt: lastCompleted.finishedAt?.toISOString() ?? null,
          groupCount: lastCompleted.groupCount
        }
      : null,
    runId: run.id,
    artistId: run.artistId,
    artistName: artist?.name ?? '艺术家已移除',
    jobId: run.jobId,
    version: run.version,
    executionVersion: run.executionVersion,
    status: run.status,
    stage: run.stage,
    mode: run.mode,
    frozenAt: run.frozenAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    counts: {
      artworks: run.artworkCount,
      processedArtworks: run.processedArtworks,
      completeArtworks: run.completeArtworks,
      changedArtworks: run.changedArtworks,
      failedArtworks: run.failedArtworks,
      skippedArtworks: run.skippedArtworks,
      groups: run.groupCount,
      duplicateArtworks: run.duplicateArtworks,
      statMedia: run.statMedia,
      hashedMedia: run.hashedMedia,
      cacheHitMedia: run.cacheHitMedia,
      readBytes: run.readBytes.toString()
    },
    allowedControls: controls(run),
    failure:
      (run.readerToken && ['FAILED', 'PAUSED', 'CANCELLED'].includes(run.status)) || run.readerState === 'BLOCKED'
        ? { code: 'READER_RECOVERY_REQUIRED', message: '读取进程尚未确认退出，需要离线恢复处理' }
        : run.errorCode
          ? {
              code: run.errorCode === 'ROOT_CHANGED' ? 'ROOT_CHANGED' : 'DETECTION_FAILED',
              message:
                run.errorCode === 'ROOT_CHANGED'
                  ? '媒体根目录不可用或身份已变化，请核对存储后重试'
                  : '本次检查未能完成，已提交的证据已保留'
            }
          : null
  })
}
async function createJob(tx: Prisma.TransactionClient, run: Run) {
  const workers = await tx.workerInstance.findMany({
    where: { status: 'READY', heartbeatAt: { gte: new Date(Date.now() - WORKER_HEARTBEAT_STALE_AFTER_MS) } },
    orderBy: { heartbeatAt: 'desc' },
    take: 20,
    select: { capabilities: true }
  })
  if (
    !workers.some(
      ({ capabilities }) =>
        Array.isArray(capabilities) &&
        capabilities.some(
          (entry) =>
            entry !== null &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            entry.jobType === 'ARTWORK_DEDUP_SCAN' &&
            entry.executionLane === 'BACKGROUND_WRITER' &&
            Array.isArray(entry.definitionVersions) &&
            entry.definitionVersions.includes(ARTWORK_DEDUP_SCAN_DEFINITION_VERSION)
        )
    )
  ) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '需要升级并启动支持本次检查的 Worker 后再开始检查' })
  }
  const job = await tx.systemJob.create({
    data: {
      id: randomUUID(),
      type: 'ARTWORK_DEDUP_SCAN',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: ARTWORK_DEDUP_SCAN_DEFINITION_VERSION,
      triggerSource: 'SYSTEM',
      queuePriority: 900,
      effectivePriority: 900,
      maxAttempts: 3,
      requestedByUserId: run.requestedBy,
      payload: { runId: run.id, executionVersion: run.executionVersion },
      idempotencyKey: `artwork-dedup:${run.id}:${run.executionVersion}`
    }
  })
  const updated = await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: job.id, status: 'PENDING' } })
  await writeJobEvent(tx, { jobId: job.id, type: 'job.queued', message: '重复作品检查已排队', data: { runId: run.id } })
  return updated
}
export async function startArtworkDedup(
  userId: string,
  input: {
    artistId: number
    expectedUserId: string
    idempotencyKey: string
    mode: 'INCREMENTAL' | 'FULL'
    includeSuspectedVersions?: boolean
  },
  database: Database = prisma as unknown as Database
) {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  return mapped(() =>
    database.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(80432031,hashtext(${JSON.stringify([userId, input.idempotencyKey])}))::text`
      )
      const result = await freezeArtworkDedupRun(tx, {
        artistId: input.artistId,
        requestedBy: userId,
        idempotencyKey: input.idempotencyKey,
        mode: input.mode,
        includeSuspectedVersions: input.includeSuspectedVersions ?? false
      })
      return dto(tx, result.created ? await createJob(tx, result.run) : result.run)
    })
  )
}
export async function getArtworkDedupRun(
  userId: string,
  input: { runId?: string; artistId?: number; expectedUserId: string },
  database: Database = prisma as unknown as Database
) {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  return database.$transaction(async (tx) => {
    const run = input.runId
      ? await tx.artworkDedupRun.findUnique({ where: { id: input.runId } })
      : ((await tx.artworkDedupRun.findFirst({
          where: { artistId: input.artistId, status: { in: [...artworkDedupActiveStatuses] } },
          orderBy: { frozenAt: 'desc' }
        })) ??
        (await tx.artworkDedupRun.findFirst({
          where: { artistId: input.artistId },
          orderBy: [{ frozenAt: 'desc' }, { id: 'desc' }]
        })))
    return run ? dto(tx, run) : null
  })
}
export async function controlArtworkDedup(
  userId: string,
  input: {
    runId: string
    expectedUserId: string
    expectedVersion: number
    idempotencyKey: string
    action: ArtworkDedupControlAction
  },
  database: Database = prisma as unknown as Database
) {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  return mapped(() =>
    database.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(80432031,hashtext(${JSON.stringify([userId, input.idempotencyKey])}))::text`
      )
      const prior = await tx.artworkDedupCommand.findUnique({
        where: { requestedBy_idempotencyKey: { requestedBy: userId, idempotencyKey: input.idempotencyKey } }
      })
      if (prior) {
        if (
          prior.runId !== input.runId ||
          prior.action !== input.action ||
          prior.expectedVersion !== input.expectedVersion
        ) {
          conflict('幂等键已用于其他请求')
        }
        return dto(tx, await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: prior.runId } }))
      }
      const before = await tx.artworkDedupRun.findUnique({ where: { id: input.runId } })
      if (!before?.jobId) throw new ArtworkDedupConflictError('NOT_FOUND')
      // Same resource -> job -> domain lock order as queue execution/finalization.
      await tx.$queryRaw(
        Prisma.sql`SELECT "resourceKey" FROM job_resource_leases WHERE "resourceKey"='lane/background-writer' FOR UPDATE`
      )
      await tx.$queryRaw(Prisma.sql`SELECT id FROM system_jobs WHERE id=${before.jobId} FOR UPDATE`)
      let run = await lockArtworkDedupRun(tx, input.runId)
      if (
        run.jobId !== before.jobId ||
        run.version !== input.expectedVersion ||
        !controls(run).includes(input.action)
      ) {
        conflict()
      }
      const job = await tx.systemJob.findUniqueOrThrow({ where: { id: run.jobId! } })
      if (job.status !== run.status) conflict()
      const now = new Date()
      if (input.action === 'retry') {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(80432029,${run.artistId}::integer)::text`)
        if (
          await tx.artworkDedupRun.findFirst({
            where: { artistId: run.artistId, status: { in: [...artworkDedupActiveStatuses] }, id: { not: run.id } },
            select: { id: true }
          })
        ) {
          conflict('该艺术家已有活动检查')
        }
        await tx.artworkDedupVisualPair.deleteMany({ where: { runId: run.id } })
        await tx.artworkDedupRelation.deleteMany({ where: { runId: run.id } })
        await tx.artworkDedupGroup.deleteMany({ where: { runId: run.id } })
        await resetArtworkDedupVisualWork(tx, run.id)
        await tx.artworkDedupMedia.deleteMany({ where: { runId: run.id } })
        await tx.artworkDedupItem.updateMany({
          where: { runId: run.id },
          data: {
            status: 'PENDING',
            snapshotRevision: null,
            mediaEpoch: null,
            memberCount: null,
            afterImageId: 0,
            sizeDigest: null,
            contentSha256: null,
            membersSignature: null,
            visualSignature: null,
            errorCode: null
          }
        })
        run = await tx.artworkDedupRun.update({
          where: { id: run.id },
          data: {
            executionVersion: { increment: 1 },
            version: { increment: 1 },
            stage: 'STAT',
            visualStatus: run.includeSuspectedVersions ? 'PENDING' : 'NOT_REQUESTED',
            visualIncompleteReasons: [],
            visualAfterImageId: 0,
            relationCacheVersion: null,
            visualCandidatePairs: [],
            originalReusedPairs: 0,
            originalComparedPairs: 0,
            visualComparisonRound: 0,
            visualRoundStartComparisons: 0,
            visualBudgetWaiting: false,
            visualReusedComparisons: 0,
            visualComparedComparisons: 0,
            relationAfterArtworkId: 0,
            relationAfterCandidateId: 0,
            partialAfterArtworkId: 0,
            partialAfterCandidateId: 0,
            finishedAt: null,
            errorCode: null,
            processedArtworks: 0,
            completeArtworks: 0,
            changedArtworks: 0,
            failedArtworks: 0,
            skippedArtworks: 0,
            groupCount: 0,
            duplicateArtworks: 0
          }
        })
        run = await createJob(tx, run)
      } else {
        if (input.action === 'resume' && run.visualBudgetWaiting) {
          if (job.definitionVersion !== 6 || run.visualComparisonRound < 1) conflict()
          run = await tx.artworkDedupRun.update({ where: { id: run.id }, data: {
            visualComparisonRound: { increment: 1 },
            visualRoundStartComparisons: run.visualReusedComparisons + run.visualComparedComparisons,
            visualBudgetWaiting: false
          } })
        }
        const direct = ['PENDING', 'RETRY_WAIT', 'PAUSED'].includes(job.status)
        const status =
          input.action === 'resume'
            ? 'PENDING'
            : input.action === 'pause'
              ? direct
                ? 'PAUSED'
                : 'PAUSING'
              : direct
                ? 'CANCELLED'
                : 'CANCELLING'
        await tx.systemJob.update({
          where: { id: job.id },
          data: {
            status,
            ...(input.action === 'pause' ? { pauseRequestedAt: now } : {}),
            ...(input.action === 'cancel' ? { cancelRequestedAt: now } : {}),
            ...(input.action === 'resume'
              ? {
                  pauseRequestedAt: null,
                  cancelRequestedAt: null,
                  finishedAt: null,
                  availableAt: now,
                  maxAttempts: Math.max(job.maxAttempts, job.attempt + 1)
                }
              : {}),
            ...(direct && input.action === 'cancel' ? { finishedAt: now } : {}),
            ...(direct ? { workerId: null, leaseToken: null, leaseExpiresAt: null } : {}),
            queuePriority: 900,
            effectivePriority: 900,
            triggerSource: 'SYSTEM'
          }
        })
        if (direct) await tx.jobResourceLease.deleteMany({ where: { ownerJobId: job.id } })
        await writeJobEvent(tx, {
          jobId: job.id,
          type:
            input.action === 'resume'
              ? 'job.queued'
              : input.action === 'pause'
                ? direct
                  ? 'job.paused'
                  : 'job.pause_requested'
                : direct
                  ? 'job.cancelled'
                  : 'job.cancel_requested',
          attempt: job.attempt,
          message: '重复作品检查控制已更新',
          data: { runId: run.id, action: input.action }
        })
        run = await tx.artworkDedupRun.findUniqueOrThrow({ where: { id: run.id } })
      }
      await tx.artworkDedupCommand.create({
        data: {
          runId: run.id,
          requestedBy: userId,
          idempotencyKey: input.idempotencyKey,
          expectedVersion: input.expectedVersion,
          action: input.action,
          resultingVersion: run.version
        }
      })
      return dto(tx, run)
    })
  )
}
export async function listArtworkDedupGroups(
  userId: string,
  input: { runId: string; expectedUserId: string; cursor?: string; limit: number },
  database: Database = prisma as unknown as Database
) {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  return database.$transaction(async (tx) => {
    const run = await tx.artworkDedupRun.findUnique({ where: { id: input.runId }, select: { status: true } })
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: '未找到检查记录' })
    if (run.status !== 'COMPLETED') return { items: [], nextCursor: null }
    const groups = await tx.artworkDedupGroup.findMany({
      where: { runId: input.runId, ...(input.cursor ? { id: { gt: input.cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: input.limit + 1,
      select: {
        id: true,
        memberCount: true,
        fileCount: true,
        members: { orderBy: { artworkId: 'asc' }, take: 3, select: { artworkId: true } }
      }
    })
    const page = groups.slice(0, input.limit)
    const artworks = await tx.artwork.findMany({
      where: { id: { in: page.flatMap((g) => g.members.map((m) => m.artworkId)) } },
      select: { id: true, title: true }
    })
    const titles = new Map(artworks.map((a) => [a.id, a.title]))
    return {
      items: page.map((g) => ({
        id: g.id,
        memberCount: g.memberCount,
        fileCount: g.fileCount.toString(),
        members: g.members.map((m) => ({ artworkId: m.artworkId, title: titles.get(m.artworkId) ?? '作品已移除' }))
      })),
      nextCursor: groups.length > input.limit ? page.at(-1)!.id : null
    }
  })
}
