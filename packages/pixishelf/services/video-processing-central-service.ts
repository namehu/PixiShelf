import { prisma } from '@/lib/prisma'
import {
  cancelJobCommand,
  enqueueJob,
  getJobById,
  pauseJobCommand,
  resumeJobCommand,
  retryJobCommand
} from '@/services/background-task'
import {
  JOB_DEFINITION_VERSION,
  videoChapterPreviewPayloadSchema,
  videoStreamingOptimizationPayloadSchema,
  type JobDto
} from '@pixishelf/job-contracts'
import type { Prisma } from '@pixishelf/db'

const CENTRAL_VIDEO_PROCESSING_TYPES = new Set(['VIDEO_CHAPTER_PREVIEW_GENERATION', 'VIDEO_STREAMING_OPTIMIZATION'])
const CHAPTER_ENQUEUE_LOCK = 7_283_460
const STREAMING_ENQUEUE_LOCK = 7_283_461
const ACTIVE_STATUSES = ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] as const

export async function enqueueCentralVideoChapterPreview(input: {
  mode: 'FULL' | 'INCREMENTAL'
  requestedByUserId: string
}) {
  const payload = videoChapterPreviewPayloadSchema.parse({ mode: input.mode })
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', CHAPTER_ENQUEUE_LOCK)
    const existing = await transaction.systemJob.findFirst({
      where: {
        type: 'VIDEO_CHAPTER_PREVIEW_GENERATION',
        definitionVersion: JOB_DEFINITION_VERSION,
        status: { in: [...ACTIVE_STATUSES] },
        payload: { path: ['mode'], equals: payload.mode }
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, payload: true }
    })
    const existingPayload = existing ? parseStoredChapterPayload(existing.payload) : null
    if (existing && existingPayload?.mode === payload.mode) {
      return { jobId: existing.id, status: existing.status, reused: true }
    }
    const created = await enqueueJob(
      {
        type: 'VIDEO_CHAPTER_PREVIEW_GENERATION',
        triggerSource: 'MANUAL',
        requestedByUserId: input.requestedByUserId,
        priority: 20,
        maxAttempts: 3,
        payload
      },
      transactionClient(transaction as unknown as Prisma.TransactionClient)
    )
    return { jobId: created.id, status: created.status, reused: false }
  })
}

export async function enqueueCentralScheduledVideoChapterPreview(input: {
  mode: 'FULL' | 'INCREMENTAL'
  scheduledTaskId: string
  scheduledForDate: string
  deadlineAt: Date
}) {
  const payload = videoChapterPreviewPayloadSchema.parse({ mode: input.mode })
  const created = await enqueueJob({
    type: 'VIDEO_CHAPTER_PREVIEW_GENERATION',
    triggerSource: 'SCHEDULE',
    scheduledTaskId: input.scheduledTaskId,
    scheduledForDate: input.scheduledForDate,
    deadlineAt: input.deadlineAt,
    idempotencyKey: `schedule:${input.scheduledTaskId}:${input.scheduledForDate}:video-chapter-preview`,
    priority: 120,
    maxAttempts: 3,
    payload
  })
  return { jobId: created.id, status: created.status, reused: false }
}

export async function enqueueCentralVideoStreamingOptimization(input: { imageId: number; requestedByUserId: string }) {
  const image = await prisma.image.findUnique({
    where: { id: input.imageId },
    select: { id: true, path: true, mediaType: true }
  })
  if (!image) throw new Error('Image not found')
  if (String(image.mediaType).toUpperCase() !== 'VIDEO' && !isVideoPath(image.path)) {
    throw new Error('Image is not a video')
  }
  if (!/\.mp4$/i.test(image.path)) throw new Error('Only MP4 videos can be optimized')
  const relativePath = image.path.replace(/^[/\\]+/, '')
  const payload = videoStreamingOptimizationPayloadSchema.parse({
    imageId: image.id,
    relativePath,
    mode: 'REMUX_FASTSTART'
  })

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock($1::integer, $2::integer)::text',
      STREAMING_ENQUEUE_LOCK,
      image.id
    )
    const existing = await transaction.systemJob.findFirst({
      where: {
        type: 'VIDEO_STREAMING_OPTIMIZATION',
        definitionVersion: JOB_DEFINITION_VERSION,
        status: { in: [...ACTIVE_STATUSES] },
        AND: [
          { payload: { path: ['imageId'], equals: image.id } },
          { payload: { path: ['mode'], equals: 'REMUX_FASTSTART' } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, payload: true }
    })
    const existingPayload = existing ? videoStreamingOptimizationPayloadSchema.safeParse(existing.payload) : null
    if (
      existing &&
      existingPayload?.success &&
      existingPayload.data.imageId === image.id &&
      existingPayload.data.relativePath === relativePath &&
      existingPayload.data.mode === 'REMUX_FASTSTART'
    ) {
      return { jobId: existing.id, imageId: image.id, path: image.path, status: existing.status, reused: true }
    }
    const created = await enqueueJob(
      {
        type: 'VIDEO_STREAMING_OPTIMIZATION',
        triggerSource: 'MANUAL',
        requestedByUserId: input.requestedByUserId,
        priority: 10,
        maxAttempts: 3,
        payload
      },
      transactionClient(transaction as unknown as Prisma.TransactionClient)
    )
    return { jobId: created.id, imageId: image.id, path: image.path, status: created.status, reused: false }
  })
}

export async function controlCentralVideoProcessingJob(jobId: string, action: 'pause' | 'resume' | 'cancel') {
  const current = await getCentralVideoProcessingJob(jobId)
  if (!current) return null
  const updated =
    action === 'pause'
      ? await pauseJobCommand({ jobId })
      : action === 'resume'
        ? await resumeJobCommand({ jobId })
        : await cancelJobCommand({ jobId })
  return { id: updated.id, status: updated.status }
}

export async function retryCentralVideoProcessingJob(jobId: string, requestedByUserId: string) {
  const current = await getCentralVideoProcessingJob(jobId)
  if (!current) return null
  const updated = await retryJobCommand({ jobId, requestedByUserId })
  return { id: updated.id, status: updated.status }
}

export async function cancelActiveCentralVideoChapterPreview() {
  const existing = await prisma.systemJob.findFirst({
    where: {
      type: 'VIDEO_CHAPTER_PREVIEW_GENERATION',
      definitionVersion: JOB_DEFINITION_VERSION,
      status: { in: [...ACTIVE_STATUSES] },
      OR: [{ payload: { path: ['mode'], equals: 'FULL' } }, { payload: { path: ['mode'], equals: 'INCREMENTAL' } }]
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, payload: true }
  })
  if (!existing || !parseStoredChapterPayload(existing.payload)) return null
  const updated = await cancelJobCommand({ jobId: existing.id })
  return { id: updated.id, status: updated.status }
}

function transactionClient(transaction: Prisma.TransactionClient) {
  return { $transaction: <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) => operation(transaction) }
}

async function getCentralVideoProcessingJob(jobId: string) {
  const job = await getJobById(jobId)
  if (!job || job.definitionVersion !== JOB_DEFINITION_VERSION || !CENTRAL_VIDEO_PROCESSING_TYPES.has(job.type)) {
    return null
  }
  return hasValidCentralPayload(job) ? job : null
}

function hasValidCentralPayload(job: JobDto) {
  if (job.type === 'VIDEO_CHAPTER_PREVIEW_GENERATION') {
    return parseStoredChapterPayload(job.payload) !== null
  }
  if (job.type === 'VIDEO_STREAMING_OPTIMIZATION') {
    return videoStreamingOptimizationPayloadSchema.safeParse(job.payload).success
  }
  return false
}

function parseStoredChapterPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('mode' in payload)) return null
  const parsed = videoChapterPreviewPayloadSchema.safeParse(payload)
  return parsed.success && payload.mode === parsed.data.mode ? parsed.data : null
}

function isVideoPath(relativePath: string) {
  return /\.(?:mp4|webm|mkv|mov|avi|m4v|wmv|flv)$/i.test(relativePath)
}
