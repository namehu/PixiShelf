import { prisma } from '@/lib/prisma'
import {
  cancelJobCommand,
  enqueueJob,
  getJobById,
  pauseJobCommand,
  resumeJobCommand,
  retryJobCommand
} from '@/services/background-task'
import { matchesVideoKeyframeFilter, normalizeVideoKeyframeFilter } from '@/services/video-keyframe-policy'
import { videoKeyframeGenerationPayloadSchema } from '@pixishelf/job-contracts'
import type { Prisma } from '@pixishelf/db'

const CENTRAL_KEYFRAME_TYPES = new Set(['VIDEO_KEYFRAME_DISCOVERY', 'VIDEO_KEYFRAME_GENERATION'])
const CENTRAL_KEYFRAME_ENQUEUE_LOCK_ID = 7_283_450
const FAILED_KEYFRAME_RETRY_PAGE_SIZE = 200

export async function enqueueCentralVideoKeyframeGeneration(input: {
  imageId: number
  force: boolean
  requestedByUserId: string
}) {
  const image = await prisma.image.findUnique({
    where: { id: input.imageId },
    select: { id: true, path: true, mediaType: true }
  })
  if (!image) throw new Error('Image not found')
  if (String(image.mediaType).toUpperCase() !== 'VIDEO' && !isVideoPath(image.path)) {
    throw new Error('Image is not a video')
  }
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', CENTRAL_KEYFRAME_ENQUEUE_LOCK_ID)
    const existing = await transaction.systemJob.findFirst({
      where: {
        type: 'VIDEO_KEYFRAME_GENERATION',
        definitionVersion: { gte: 1 },
        status: { in: ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] },
        payload: { path: ['imageId'], equals: image.id }
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true }
    })
    if (existing) return { jobId: existing.id, status: existing.status, reused: true }
    const created = await enqueueJob(
      {
        type: 'VIDEO_KEYFRAME_GENERATION',
        triggerSource: 'MANUAL',
        requestedByUserId: input.requestedByUserId,
        priority: 10,
        maxAttempts: 3,
        payload: {
          imageId: image.id,
          relativePath: image.path.replace(/^[/\\]+/, ''),
          mode: input.force ? 'MANUAL_FORCE' : 'MANUAL_INCREMENTAL'
        }
      },
      { $transaction: (operation) => operation(transaction as unknown as Prisma.TransactionClient) }
    )
    return { jobId: created.id, status: created.status, reused: false }
  })
}

export async function enqueueCentralVideoKeyframeDiscovery(input: {
  force: boolean
  previewOnly: boolean
  imageIds?: number[]
  filter?: unknown
  requestedByUserId: string
}) {
  if (!input.previewOnly && !input.imageIds?.length) {
    throw new Error('Manual video keyframe execution requires an explicit preview selection')
  }
  const filter = normalizeVideoKeyframeFilter(input.filter)
  const created = await enqueueJob({
    type: 'VIDEO_KEYFRAME_DISCOVERY',
    triggerSource: 'MANUAL',
    requestedByUserId: input.requestedByUserId,
    priority: 10,
    maxAttempts: 3,
    payload: {
      trigger: 'manual',
      force: input.force,
      previewOnly: input.previewOnly,
      ...(input.imageIds ? { imageIds: [...new Set(input.imageIds)] } : {}),
      filter
    }
  })
  return { jobId: created.id, status: created.status }
}

export async function controlCentralVideoKeyframeJob(jobId: string, action: 'pause' | 'resume' | 'cancel') {
  const current = await getCentralKeyframeJob(jobId)
  if (!current) return null
  const updated =
    action === 'pause'
      ? await pauseJobCommand({ jobId })
      : action === 'resume'
        ? await resumeJobCommand({ jobId })
        : await cancelJobCommand({ jobId })
  return { id: updated.id, status: updated.status }
}

export async function retryCentralVideoKeyframeJob(jobId: string, requestedByUserId: string) {
  const current = await getCentralKeyframeJob(jobId)
  if (!current) return null
  const retried = await retryJobCommand({ jobId, requestedByUserId })
  return { id: retried.id, status: retried.status }
}

export async function retryFailedCentralVideoKeyframes(input: { filter?: unknown; requestedByUserId: string }) {
  const filter = normalizeVideoKeyframeFilter(input.filter)
  const latestByImageId = new Map<number, { id: string; relativePath: string }>()
  const seenImageIds = new Set<number>()
  let cursor: string | undefined
  while (true) {
    const jobs = await prisma.systemJob.findMany({
      where: { type: 'VIDEO_KEYFRAME_GENERATION', definitionVersion: { gte: 1 } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: FAILED_KEYFRAME_RETRY_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, status: true, payload: true }
    })
    for (const job of jobs) {
      const parsed = videoKeyframeGenerationPayloadSchema.safeParse(job.payload)
      if (!parsed.success || seenImageIds.has(parsed.data.imageId)) continue
      seenImageIds.add(parsed.data.imageId)
      if (job.status === 'FAILED') {
        latestByImageId.set(parsed.data.imageId, { id: job.id, relativePath: parsed.data.relativePath })
      }
    }
    if (jobs.length < FAILED_KEYFRAME_RETRY_PAGE_SIZE) break
    cursor = jobs.at(-1)!.id
  }
  const images = await prisma.image.findMany({
    where: { id: { in: [...latestByImageId.keys()] } },
    select: { id: true, path: true, videoMetadata: { select: { duration: true } } }
  })
  let retried = 0
  let filtered = 0
  for (const image of images) {
    const job = latestByImageId.get(image.id)
    if (
      !job ||
      !matchesVideoKeyframeFilter(
        { duration: image.videoMetadata?.duration ?? null, path: image.path, status: 'FAILED' },
        filter
      )
    ) {
      filtered += 1
      continue
    }
    await retryJobCommand({ jobId: job.id, requestedByUserId: input.requestedByUserId })
    retried += 1
  }
  filtered += Math.max(0, latestByImageId.size - images.length)
  return { retried, filtered, capacityLimited: 0 }
}

async function getCentralKeyframeJob(jobId: string) {
  const job = await getJobById(jobId)
  return job && CENTRAL_KEYFRAME_TYPES.has(job.type) && job.definitionVersion >= 1 ? job : null
}

function isVideoPath(relativePath: string) {
  return /\.(?:mp4|webm|mkv|mov|avi|m4v|wmv|flv)$/i.test(relativePath)
}
