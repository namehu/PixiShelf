import 'server-only'
import { Prisma } from '@pixishelf/db'
import { ARTWORK_SUMMARY_ALGORITHM_VERSION, artworkSummaryGroupsSchema, ACTIVE_JOB_STATUSES } from '@pixishelf/job-contracts'
import { TRPCError } from '@trpc/server'
import { prisma } from '@/lib/prisma'
import { enqueueJob } from '@/services/background-task'
import type { ArtworkSummaryDto } from '@/schemas/artwork-summary.dto'

export async function getArtworkSummary(artworkId: number): Promise<ArtworkSummaryDto> {
  const artwork = await prisma.artwork.findUnique({ where: { id: artworkId, deletedAt: null, archiveLifecycleState: 'ACTIVE' },
    select: { visualSummary: true } })
  if (!artwork) throw new TRPCError({ code: 'NOT_FOUND', message: '作品不存在' })
  const summary = artwork.visualSummary
  if (!summary) return { state: 'MISSING', generationId: null, groups: [], job: null, standalone: 0 }
  const job = summary.jobId ? await prisma.systemJob.findUnique({ where: { id: summary.jobId },
    select: { id: true, status: true, progress: true, result: true } }) : null
  const details = job?.result && typeof job.result === 'object' && !Array.isArray(job.result) ? job.result : {}
  const groups = artworkSummaryGroupsSchema.safeParse(summary.groups)
  const ready = summary.publishedRevision === summary.sourceRevision && !summary.replaceInProgress &&
    summary.algorithmVersion === ARTWORK_SUMMARY_ALGORITHM_VERSION && groups.success
  return { state: ready ? 'READY' : job && ACTIVE_JOB_STATUSES.has(job.status) ? 'BUILDING' : summary.generationId ? 'STALE' : 'MISSING',
    generationId: summary.generationId, groups: ready && groups.success ? groups.data : [],
    job: job ? { id: job.id, status: job.status, progress: job.progress,
      processed: Number(details.processed) || 0, total: Number(details.total) || 0 } : null,
    standalone: Number(details.standalone) || 0 }
}

export async function generateArtworkSummary(artworkId: number, requestId: string, userId: string, force = false) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Artwork" WHERE id = ${artworkId} FOR UPDATE`)
    const artwork = await tx.artwork.findUnique({ where: { id: artworkId, deletedAt: null, archiveLifecycleState: 'ACTIVE' },
      select: { id: true, visualSummary: true } })
    if (!artwork) throw new TRPCError({ code: 'NOT_FOUND', message: '作品不存在' })
    const existing = await tx.systemJob.findFirst({ where: {
      type: 'ARTWORK_SUMMARY_GENERATE', status: { in: [...ACTIVE_JOB_STATUSES] }, payload: { path: ['artworkId'], equals: artworkId }
    }, select: { id: true } })
    if (existing) return { jobId: existing.id }
    const replay = await tx.systemJob.findFirst({ where: { idempotencyKey: `artwork-summary:${artworkId}:${userId}:${requestId}` }, select: { id: true } })
    if (replay) return { jobId: replay.id }
    if (artwork.visualSummary?.replaceInProgress || await tx.artworkSummaryFeature.count({ where: { image: { artworkId }, writeInProgress: true } })) {
      throw new TRPCError({ code: 'CONFLICT', message: '原图正在写入，请完成上传或恢复替换后重试' })
    }
    const summary = await tx.artworkSummary.upsert({ where: { artworkId }, create: { artworkId }, update: {} })
    const generationId = crypto.randomUUID()
    const job = await enqueueJob({ type: 'ARTWORK_SUMMARY_GENERATE', triggerSource: 'MANUAL',
      requestedByUserId: userId, priority: 90, maxAttempts: 3,
      idempotencyKey: `artwork-summary:${artworkId}:${userId}:${requestId}`,
      payload: { artworkId, generationId, sourceRevision: summary.sourceRevision, force }
    }, { $transaction: (operation) => operation(tx as unknown as Prisma.TransactionClient) })
    await tx.artworkSummary.update({ where: { artworkId }, data: {
      generationId, jobId: job.id, publishedRevision: null, groups: Prisma.DbNull
    } })
    return { jobId: job.id }
  })
}
