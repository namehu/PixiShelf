import 'server-only'
import { ARTWORK_SUMMARY_ALGORITHM_VERSION, artworkSummaryGroupsSchema, ACTIVE_JOB_STATUSES } from '@pixishelf/job-contracts'
import { TRPCError } from '@trpc/server'
import { prisma } from '@/lib/prisma'
import { ARTWORK_SUMMARY_RETIRED_MESSAGE } from '@/lib/reading/artwork-stacks'
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

export async function generateArtworkSummary(..._args: [artworkId: number, requestId: string, userId: string, force?: boolean]): Promise<{ jobId: string }> {
  void _args
  throw new TRPCError({ code: 'BAD_REQUEST', message: ARTWORK_SUMMARY_RETIRED_MESSAGE })
}
