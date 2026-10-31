export interface VideoOptimizationJobView {
  id: string
  status: string
  progress: number
  message?: string | null
  error?: string | null
  result?: unknown
  targetImageId?: number | null
  targetPath?: string | null
  mode?: string | null
  queuePosition?: number | null
  createdAt?: Date | string
  updatedAt?: Date | string
  startedAt?: Date | string | null
  finishedAt?: Date | string | null
  attempt?: number
  failureNeedsAttention?: boolean
  retryAllowed?: boolean
}

export const ACTIVE_VIDEO_OPTIMIZATION_STATUSES = [
  'PENDING',
  'RUNNING',
  'PAUSING',
  'PAUSED',
  'RETRY_WAIT',
  'CANCELLING'
]

export function isActiveVideoOptimization(job?: VideoOptimizationJobView | null) {
  return Boolean(job && ACTIVE_VIDEO_OPTIMIZATION_STATUSES.includes(job.status))
}

export type {
  VideoOptimizationFilters,
  VideoOptimizationStatus,
  VideoOptimizationTarget,
  ListVideoStreamingOptimizationCandidatesInput,
  PreviewVideoStreamingOptimizationBatchInput,
  SubmitVideoStreamingOptimizationBatchInput
} from '@/schemas/video-optimization.dto'

import type { ESource } from '@/enums/e-source'
import type { VideoOptimizationStatus, VideoOptimizationTarget } from '@/schemas/video-optimization.dto'

export interface VideoOptimizationCandidate {
  artworkId: number
  title: string
  source: ESource
  artists: Array<{ id: number; name: string }>
  mp4Count: number
  matchingMp4Count: number
  actionableMp4Count: number
  statusCounts: Record<VideoOptimizationStatus, number>
}
export interface VideoOptimizationCandidatePage {
  items: VideoOptimizationCandidate[]
  total: number
  page: number
  pageSize: number
}
export interface VideoOptimizationBatchPreview {
  targets: VideoOptimizationTarget[]
  artworkCount: number
  mp4Count: number
  successRedoCount: number
}
export interface VideoOptimizationBatchItem {
  imageId: number
  artworkId: number
  outcome: 'SUBMITTED' | 'REUSED' | 'SKIPPED' | 'FAILED'
  jobId?: string
  reason?: string
}
export interface VideoOptimizationBatchResult {
  submitted: number
  reused: number
  skipped: number
  failed: number
  items: VideoOptimizationBatchItem[]
}
