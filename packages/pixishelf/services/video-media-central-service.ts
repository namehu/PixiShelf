import { prisma } from '@/lib/prisma'
import {
  cancelJobCommand,
  enqueueJob,
  enqueueSingletonManualJobWithResult
} from '@/services/background-task'
import type { Prisma } from '@pixishelf/db'

const CENTRAL_VIDEO_MEDIA_ENQUEUE_LOCK = 7_283_470
const ACTIVE_JOB_STATUSES = ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] as const

export async function enqueueCentralVideoMediaProbe(input: {
  force: boolean
  enqueueMissingPosters?: boolean
  imageId?: number
  requestedByUserId: string
}) {
  const payload = {
    force: input.force,
    enqueueMissingPosters: input.enqueueMissingPosters ?? true,
    ...(input.imageId === undefined ? {} : { imageId: input.imageId })
  }
  const { job, reused } = await enqueueSingletonManualJobWithResult({
    type: 'VIDEO_MEDIA_PROBE',
    triggerSource: 'MANUAL',
    requestedByUserId: input.requestedByUserId,
    priority: input.imageId === undefined ? 40 : 20,
    maxAttempts: 3,
    payload
  })
  return { jobId: job.id, status: job.status, reused }
}

export async function enqueueCentralVideoMediaReprobe(input: { imageId: number; requestedByUserId: string }) {
  const image = await prisma.image.findUnique({
    where: { id: input.imageId },
    select: { id: true, path: true, mediaType: true }
  })
  if (!image) throw new Error('Video image not found')
  if (image.mediaType !== 'VIDEO' && !isVideoPath(image.path)) throw new Error('Image is not a video')
  return enqueueCentralVideoMediaProbe({
    force: true,
    enqueueMissingPosters: true,
    imageId: image.id,
    requestedByUserId: input.requestedByUserId
  })
}

export async function cancelCentralVideoMediaProbe(jobId: string) {
  const cancelled = await cancelJobCommand({ jobId })
  return { id: cancelled.id, status: cancelled.status }
}

export async function enqueueCentralVideoPoster(input: { imageId: number; requestedByUserId: string }) {
  const image = await prisma.image.findUnique({
    where: { id: input.imageId },
    select: { id: true, path: true, mediaType: true }
  })
  if (!image) throw new Error('Image not found')
  if (image.mediaType !== 'VIDEO' && !isVideoPath(image.path)) throw new Error('Image is not a video')
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1, $2)::text', CENTRAL_VIDEO_MEDIA_ENQUEUE_LOCK, image.id)
    const existing = await transaction.systemJob.findFirst({
      where: {
        type: 'VIDEO_POSTER_GENERATION',
        definitionVersion: 1,
        status: { in: [...ACTIVE_JOB_STATUSES] },
        payload: { path: ['imageId'], equals: image.id }
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true }
    })
    if (existing) return { jobId: existing.id, status: existing.status, reused: true }
    const job = await enqueueJob(
      {
        type: 'VIDEO_POSTER_GENERATION',
        triggerSource: 'MANUAL',
        requestedByUserId: input.requestedByUserId,
        priority: 20,
        maxAttempts: 3,
        payload: { imageId: image.id, relativePath: image.path.replace(/\\/g, '/').replace(/^\/+/, '') }
      },
      nestedTransaction(transaction as unknown as Prisma.TransactionClient)
    )
    return { jobId: job.id, status: job.status, reused: false }
  })
}

export async function enqueueCentralDerivedMediaGc(input: {
  entryIds?: string[]
  dryRun?: boolean
  reconcile?: boolean
  requestedByUserId: string
}) {
  const job = await enqueueJob({
    type: 'DERIVED_MEDIA_GC',
    triggerSource: 'MANUAL',
    requestedByUserId: input.requestedByUserId,
    priority: 50,
    maxAttempts: 3,
    payload: {
      ...(input.entryIds ? { entryIds: [...new Set(input.entryIds)] } : {}),
      dryRun: input.dryRun ?? false,
      reconcile: input.reconcile ?? false
    }
  })
  return { jobId: job.id, status: job.status }
}

function nestedTransaction(transaction: Prisma.TransactionClient) {
  return { $transaction: <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) => operation(transaction) }
}

function isVideoPath(value: string) {
  return /\.(?:mp4|webm|mkv|mov|avi|m4v|wmv|flv)$/i.test(value)
}
