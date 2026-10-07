import { prisma } from '@/lib/prisma'
import { getScanPath } from '@/services/setting.service'
import { type VideoKeyframeBatchAccumulator } from '@/services/video-keyframe-discovery-state'
import { type VideoKeyframeFilter } from '@/services/video-keyframe-policy'
import { getPublishedVideoKeyframes, regenerateManualVideoPoster } from '@/services/video-keyframe-service'
import { JobStatus } from '@prisma/client'
import { projectJobTarget } from './background-task/job-target'
import { latestMediaJobs } from './background-task/media-job-query'

export const VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE = 'VIDEO_KEYFRAME_DISCOVERY'
export const VIDEO_KEYFRAME_GENERATION_JOB_TYPE = 'VIDEO_KEYFRAME_GENERATION'
export const VIDEO_KEYFRAME_QUEUE_CAPACITY = 100
export const VIDEO_KEYFRAME_AUTOMATIC_CAPACITY = 90
export const VIDEO_KEYFRAME_MANUAL_PRIORITY = 10
export const VIDEO_KEYFRAME_AUTOMATIC_PRIORITY = 100
const ACTIVE_STATUSES: JobStatus[] = [
  JobStatus.RETRY_WAIT,
  JobStatus.PENDING,
  JobStatus.RUNNING,
  JobStatus.PAUSING,
  JobStatus.PAUSED,
  JobStatus.CANCELLING
]
const TERMINAL_STATUSES: JobStatus[] = [JobStatus.SKIPPED, JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]

export type VideoKeyframeJobMode = 'AUTO_INCREMENTAL' | 'MANUAL_INCREMENTAL' | 'MANUAL_FORCE'
export type VideoKeyframeControlAction = 'pause' | 'resume' | 'cancel'

export interface VideoKeyframeBatchResult {
  discovered: number
  matched: number
  enqueued: number
  reused: number
  filtered: number
  current: number
  inaccessible: number
  capacityLimited: number
  previewOnly: boolean
  previewTruncated: boolean
  candidates: VideoKeyframePreviewCandidate[]
  failedSamples: Array<{ imageId: number; path: string; error: string }>
}

export interface VideoKeyframePreviewCandidate {
  imageId: number
  path: string
  duration: number | null
  status: 'MISSING' | 'STALE' | 'FAILED' | 'CURRENT'
  publishedCount: number
}

export interface VideoKeyframeDiscoveryRequest {
  trigger: 'manual' | 'schedule'
  force: boolean
  previewOnly: boolean
  imageIds?: number[]
  afterImageId?: number
  accumulated?: VideoKeyframeBatchAccumulator
  filter: VideoKeyframeFilter
}

export async function listVideoKeyframeQueue(recentLimit = 30) {
  const [active, recent, discoveryActive, discoveryRecent] = await Promise.all([
    prisma.systemJob.findMany({
      where: { type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, status: { in: ACTIVE_STATUSES } },
      orderBy: [{ queuePriority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    }),
    prisma.systemJob.findMany({
      where: { type: VIDEO_KEYFRAME_GENERATION_JOB_TYPE, status: { in: TERMINAL_STATUSES } },
      orderBy: { updatedAt: 'desc' },
      take: recentLimit
    }),
    prisma.systemJob.findMany({
      where: { type: VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE, status: { in: ACTIVE_STATUSES } },
      orderBy: [{ queuePriority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    }),
    prisma.systemJob.findMany({
      where: { type: VIDEO_KEYFRAME_DISCOVERY_JOB_TYPE, status: { in: TERMINAL_STATUSES } },
      orderBy: { updatedAt: 'desc' },
      take: recentLimit
    })
  ])
  const pendingIds = active.filter((job) => job.status === JobStatus.PENDING).map((job) => job.id)
  const positions = new Map(pendingIds.map((id, index) => [id, index + 1]))
  return {
    capacity: VIDEO_KEYFRAME_QUEUE_CAPACITY,
    automaticCapacity: VIDEO_KEYFRAME_AUTOMATIC_CAPACITY,
    active: active.map((job) => ({ ...projectJobTarget(job), queuePosition: positions.get(job.id) ?? null })),
    recent: recent.map((job) => ({ ...projectJobTarget(job), queuePosition: null as number | null })),
    discoveryActive: discoveryActive.map((job) => ({ ...projectJobTarget(job), queuePosition: null as number | null })),
    discoveryRecent: discoveryRecent.map((job) => ({ ...projectJobTarget(job), queuePosition: null as number | null }))
  }
}

export async function getLatestVideoKeyframeJobsByImageIds(imageIds: number[]) {
  if (!imageIds.length) return []
  const [jobs, pending] = await Promise.all([
    latestMediaJobs('VIDEO_KEYFRAME_GENERATION', imageIds),
    prisma.systemJob.findMany({
      where: { type: 'VIDEO_KEYFRAME_GENERATION', status: JobStatus.PENDING },
      select: { id: true },
      orderBy: [{ queuePriority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    })
  ])
  const positions = new Map(pending.map((job, index) => [job.id, index + 1]))
  return jobs.map((job) => ({ ...job, queuePosition: positions.get(job.id) ?? null }))
}

export async function getVideoKeyframeDetails(imageId: number) {
  const [published, jobs, videoMetadata] = await Promise.all([
    getPublishedVideoKeyframes(imageId),
    getLatestVideoKeyframeJobsByImageIds([imageId]),
    prisma.mediaVideoMetadata.findUnique({
      where: { imageId },
      select: { manualPosterTimestamp: true, manualPosterWarning: true }
    })
  ])
  return {
    published,
    job: jobs[0] ?? null,
    manualPosterTimestamp: videoMetadata?.manualPosterTimestamp ?? null,
    manualPosterWarning: videoMetadata?.manualPosterWarning ?? null
  }
}

export async function selectVideoKeyframePoster(imageId: number, frameId: string) {
  const frame = await prisma.mediaVideoKeyframe.findFirst({
    where: { id: frameId, set: { imageId, status: 'PUBLISHED' }, selectedOrder: { not: null } },
    select: { captureTime: true }
  })
  if (!frame) throw new Error('Published keyframe not found')
  return regenerateManualVideoPoster({
    imageId,
    scanPath: await requireVideoKeyframeScanPath(),
    captureTime: frame.captureTime,
    ffmpegThreads: getVideoKeyframeFfmpegThreads()
  })
}

export async function requireVideoKeyframeScanPath() {
  // 工作进程允许通过环境变量覆盖 scanPath；未配置时回退到 DB 设置，避免 worker 容器与 API 容器路径源不一致。
  const configured = (await getScanPath())?.trim()
  const workerMountedPath = process.env.SCAN_PATH?.trim() || process.env.ARCHIVE_STORAGE_PATH?.trim()
  const scanPath = workerMountedPath || configured
  if (!scanPath) throw new Error('Scan path is not configured')
  return scanPath
}

export function getVideoKeyframeFfmpegThreads() {
  const parsed = Number(process.env.KEYFRAME_FFMPEG_THREADS ?? 2)
  if (!Number.isInteger(parsed) || parsed < 1) return 2
  return Math.min(parsed, 8)
}
