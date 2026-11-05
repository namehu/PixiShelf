import { prisma } from '@/lib/prisma'
import { enqueueSingletonManualJobWithResult, resumeJobCommand, retryJobCommand } from '@/services/background-task'
import { WORKER_HEARTBEAT_STALE_AFTER_MS } from '@/services/background-task/worker-heartbeat'
import {
  ACTIVE_JOB_STATUSES,
  ARCHIVE_QUALITY_AUDIT_JOB_TYPE,
  archiveQualityAuditCheckpointSchema,
  workerCapabilitySchema
} from '@pixishelf/job-contracts'
import type { PrismaClient } from '@pixishelf/db'
import { TRPCError } from '@trpc/server'
import { archiveQualityEvidenceSchema } from '@pixishelf/job-contracts'
import { archiveQualityReasonLabels } from '@/lib/archive-quality-reason'

export async function getArchiveQualityDetails(
  input: { artworkId: number; offset: number; limit: number },
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const revision = await database.archiveRevision.findFirst({
    where: {
      artworkId: input.artworkId,
      isCurrent: true,
      retiredAt: null,
      externalRef: { providerKey: 'e-hentai' },
      artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
    },
    select: { id: true, qualityEvidence: true, qualityVerifiedAt: true }
  })
  if (!revision) return null
  const parsed = archiveQualityEvidenceSchema.safeParse(revision.qualityEvidence)
  const pages = parsed.success ? parsed.data.pages.filter((page) => page.quality === 'UNKNOWN') : []
  const reason = parsed.success
    ? (parsed.data.reason ?? null)
    : revision.qualityVerifiedAt
      ? 'INVALID_QUALITY_EVIDENCE'
      : 'NOT_AUDITED'
  return {
    revisionId: revision.id,
    reason:
      reason && Object.hasOwn(archiveQualityReasonLabels, reason)
        ? reason
        : reason
          ? 'NO_VERIFIED_DELIVERY_EVIDENCE'
          : null,
    unresolvedPageCount: parsed.success ? (parsed.data.unresolvedPageCount ?? 0) : 0,
    total: pages.length,
    pages: pages.slice(input.offset, input.offset + input.limit).map((page) => ({
      index: page.index,
      quality: page.quality,
      reason: Object.hasOwn(archiveQualityReasonLabels, page.reason) ? page.reason : 'NO_VERIFIED_DELIVERY_EVIDENCE'
    })),
    nextOffset: input.offset + input.limit < pages.length ? input.offset + input.limit : null
  }
}

const targetWhere = {
  archiveRevisions: { some: { isCurrent: true, externalRef: { providerKey: 'e-hentai' } } }
} as const
const jobSelect = {
  id: true,
  status: true,
  progress: true,
  message: true,
  result: true,
  error: true,
  createdAt: true,
  finishedAt: true
} as const

export async function getArchiveQualityAuditStatus(database: PrismaClient = prisma as unknown as PrismaClient) {
  const [active, latest, targetArtworkCount, workers] = await Promise.all([
    database.systemJob.findFirst({
      where: { type: ARCHIVE_QUALITY_AUDIT_JOB_TYPE, status: { in: [...ACTIVE_JOB_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: jobSelect
    }),
    database.systemJob.findFirst({
      where: { type: ARCHIVE_QUALITY_AUDIT_JOB_TYPE },
      orderBy: { createdAt: 'desc' },
      select: jobSelect
    }),
    database.artwork.count({ where: targetWhere }),
    database.workerInstance.findMany({
      where: { status: 'READY', heartbeatAt: { gte: new Date(Date.now() - WORKER_HEARTBEAT_STALE_AFTER_MS) } },
      select: { capabilities: true }
    })
  ])
  const serialize = (job: typeof latest) => {
    if (!job) return null
    const { result, ...fields } = job
    const parsed = archiveQualityAuditCheckpointSchema.safeParse(result)
    return { ...fields, checkpoint: parsed.success ? parsed.data : null }
  }
  return {
    activeJob: serialize(active),
    latestJob: serialize(latest),
    targetArtworkCount,
    capabilityAvailable: workers.some(
      (worker) =>
        Array.isArray(worker.capabilities) &&
        worker.capabilities.some((entry) => {
          const capability = workerCapabilitySchema.safeParse(entry)
          return (
            capability.success &&
            capability.data.jobType === ARCHIVE_QUALITY_AUDIT_JOB_TYPE &&
            capability.data.executionLane === 'BACKGROUND_WRITER' &&
            capability.data.definitionVersions.includes(1)
          )
        })
    )
  }
}

/** Paused/failed runs retain their durable cursor; completed/cancelled runs start a fresh audit. */
export async function startArchiveQualityAudit(input: { requestedByUserId: string; database?: PrismaClient }) {
  const database = input.database ?? (prisma as unknown as PrismaClient)
  const state = await getArchiveQualityAuditStatus(database)
  if (!state.capabilityAvailable) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '当前没有支持画质核验的 READY Worker' })
  }
  if (state.activeJob) {
    if (state.activeJob.status === 'PAUSED') await resumeJobCommand({ jobId: state.activeJob.id }, database)
    return { jobId: state.activeJob.id, reused: true }
  }
  if (state.latestJob?.status === 'FAILED') {
    const job = await retryJobCommand(
      { jobId: state.latestJob.id, requestedByUserId: input.requestedByUserId },
      database
    )
    return { jobId: job.id, reused: true }
  }
  const maximum = await database.artwork.aggregate({ where: targetWhere, _max: { id: true } })
  const result = await enqueueSingletonManualJobWithResult(
    {
      type: ARCHIVE_QUALITY_AUDIT_JOB_TYPE,
      triggerSource: 'MANUAL',
      requestedByUserId: input.requestedByUserId,
      priority: 99,
      maxAttempts: 3,
      payload: { targetMaxArtworkId: maximum._max.id ?? 0, targetArtworkCount: state.targetArtworkCount }
    },
    { client: database }
  )
  return { jobId: result.job.id, reused: result.reused }
}
